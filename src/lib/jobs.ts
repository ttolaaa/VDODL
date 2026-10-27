import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  JOBS_DIR,
  childEnv,
  ensureRuntimeDirs,
  resolveFfmpegPath,
  resolveYtDlpPath,
} from "@/lib/runtime";
import type { JobProgress, MediaFormat } from "@/lib/types";
import { parseMediaUrl, PLATFORM_LABELS, safeFilename } from "@/lib/media-url";
import { cleanYtDlpError } from "@/lib/ytdlp";

/** How long a finished file stays available for saving. */
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_DOWNLOAD_HOURS = Number(process.env.VDODL_MAX_DOWNLOAD_HOURS) > 0
  ? Number(process.env.VDODL_MAX_DOWNLOAD_HOURS) : 6;
const MAX_ACTIVE_JOBS = Number(process.env.VDODL_MAX_JOBS) > 0
  ? Number(process.env.VDODL_MAX_JOBS) : 4;

const DL_PREFIX = "@@DL@@";
const PP_PREFIX = "@@PP@@";

type Job = {
  id: string;
  dir: string;
  createdAt: number;
  progress: JobProgress;
  child?: ChildProcessWithoutNullStreams;
  filePath?: string;
  downloadName: string;
  listeners: Set<(progress: JobProgress) => void>;
  cleanupTimer?: NodeJS.Timeout;
  deadlineTimer?: NodeJS.Timeout;
};

type JobStore = Map<string, Job>;

// Next dev re-evaluates modules on edit; keep jobs on globalThis so in-flight
// downloads survive a hot reload.
const globalStore = globalThis as typeof globalThis & { __vdodlJobs?: JobStore; __vdodlSwept?: boolean };
const jobs: JobStore = globalStore.__vdodlJobs ?? new Map<string, Job>();
globalStore.__vdodlJobs = jobs;

/** Deletes job folders left behind by a previous server process (e.g. a redeploy). */
function sweepOrphanedJobs(): void {
  if (globalStore.__vdodlSwept) return;
  globalStore.__vdodlSwept = true;
  for (const entry of fs.readdirSync(/* turbopackIgnore: true */ JOBS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && !jobs.has(entry.name)) {
      fs.rm(path.join(JOBS_DIR, entry.name), { recursive: true, force: true }, () => {});
    }
  }
}

function numberOrUndefined(value: string): number | undefined {
  if (!value || value === "NA" || value === "None") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function emit(job: Job): void {
  for (const listener of job.listeners) {
    listener(job.progress);
  }
}

function scheduleCleanup(job: Job, delay = JOB_TTL_MS): void {
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  job.cleanupTimer = setTimeout(() => removeJob(job.id), delay);
  job.cleanupTimer.unref?.();
}

function removeJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;

  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  if (job.deadlineTimer) clearTimeout(job.deadlineTimer);
  job.child?.kill();
  jobs.delete(jobId);
  fs.rm(job.dir, { recursive: true, force: true }, () => {});
}

function buildFormatSelector(format: MediaFormat): string {
  if (format.kind === "audio") return format.id;
  if (!format.needsMerge) return format.id;

  const audioPreference = format.container === "webm" ? "[ext=webm]" : "[ext=m4a]";
  return `${format.id}+bestaudio${audioPreference}/${format.id}+bestaudio/${format.id}`;
}

export function activeJobCount(): number {
  let count = 0;
  for (const job of jobs.values()) {
    if (["downloading", "queued", "merging"].includes(job.progress.status)) count += 1;
  }
  return count;
}

export function createJob(options: {
  url: string;
  format: MediaFormat;
  title: string;
}): Job {
  const { url, format, title } = options;
  parseMediaUrl(url);

  if (format.needsMerge && !resolveFfmpegPath()) {
    throw new Error(
      "This quality needs ffmpeg to combine video and audio. Install ffmpeg or pick a lower quality."
    );
  }

  if (activeJobCount() >= MAX_ACTIVE_JOBS) {
    throw new Error("Too many downloads are running right now. Try again in a moment.");
  }

  ensureRuntimeDirs();
  sweepOrphanedJobs();

  const id = randomUUID();
  const dir = path.join(JOBS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  const label =
    format.kind === "audio" ? "Audio only" : `${format.label} · ${format.container.toUpperCase()}`;

  const job: Job = {
    id,
    dir,
    createdAt: Date.now(),
    downloadName: safeFilename(title, format.container),
    listeners: new Set(),
    progress: {
      id,
      status: "queued",
      percent: 0,
      downloadedBytes: 0,
      totalBytes: format.sizeBytes,
      label,
      transferMode: "server",
    },
  };

  jobs.set(id, job);
  // The 30-minute file TTL starts once the file is ready; until then only this
  // generous cap applies, so long or 4K videos are not cut off mid-download.
  job.deadlineTimer = setTimeout(() => {
    if (!job.child) return;
    failJob(job, `The download took longer than ${MAX_DOWNLOAD_HOURS} hours and was stopped.`);
    job.child.kill();
  }, MAX_DOWNLOAD_HOURS * 60 * 60 * 1000);
  job.deadlineTimer.unref?.();
  startDownload(job, url, format);

  return job;
}

function startDownload(job: Job, url: string, format: MediaFormat): void {
  const ffmpegPath = resolveFfmpegPath();

  const args = [
    "--ignore-config",
    "--no-playlist",
    "--no-warnings",
    "--no-call-home",
    "--newline",
    "--retries",
    "5",
    "--socket-timeout",
    "20",
    "-f",
    buildFormatSelector(format),
    "-o",
    path.join(job.dir, "media.%(ext)s"),
    "--progress-template",
    `download:${DL_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
    "--progress-template",
    `postprocess:${PP_PREFIX}%(progress.status)s`,
  ];

  if (format.kind === "video" && format.needsMerge) {
    args.push("--merge-output-format", format.container);
  }
  if (ffmpegPath) {
    args.push("--ffmpeg-location", ffmpegPath);
  }

  args.push(url);

  const child = spawn(resolveYtDlpPath(), args, { env: childEnv(), windowsHide: true });
  job.child = child;
  job.progress.status = "downloading";
  emit(job);

  // yt-dlp downloads video and audio as separate sequential streams, so overall
  // progress is "bytes finished in earlier streams" plus the current stream.
  let completedBytes = 0;
  let lastStreamBytes = 0;
  let lastStreamTotal = 0;
  let stderrBuffer = "";
  let stdoutBuffer = "";

  const handleDownloadLine = (payload: string) => {
    const [downloadedRaw, totalRaw, estimateRaw, speedRaw, etaRaw] = payload.split("|");

    const downloaded = numberOrUndefined(downloadedRaw) ?? 0;
    const streamTotal = numberOrUndefined(totalRaw) ?? numberOrUndefined(estimateRaw);
    const speed = numberOrUndefined(speedRaw);

    if (downloaded < lastStreamBytes) {
      completedBytes += lastStreamBytes;
      lastStreamBytes = 0;
    }

    lastStreamBytes = downloaded;
    if (streamTotal) lastStreamTotal = streamTotal;

    const overallDownloaded = completedBytes + downloaded;
    const overallTotal = format.needsMerge && !format.sizeBytes ? undefined :
      job.progress.totalBytes && job.progress.totalBytes > overallDownloaded
        ? job.progress.totalBytes
        : lastStreamTotal
          ? completedBytes + lastStreamTotal
          : undefined;

    const percent = overallTotal
      ? Math.min(99, (overallDownloaded / overallTotal) * 100)
      : Math.min(99, job.progress.percent);

    const etaSeconds = overallTotal && speed
      ? Math.max(0, (overallTotal - overallDownloaded) / speed)
      : numberOrUndefined(etaRaw);

    job.progress = {
      ...job.progress,
      status: "downloading",
      percent,
      downloadedBytes: overallDownloaded,
      totalBytes: overallTotal,
      speedBps: speed,
      etaSeconds,
    };
    emit(job);
  };

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith(DL_PREFIX)) {
      handleDownloadLine(trimmed.slice(DL_PREFIX.length));
      return;
    }

    if (trimmed.startsWith(PP_PREFIX) || trimmed.includes("[Merger]")) {
      if (job.progress.status === "downloading" || job.progress.status === "merging") {
        job.progress = {
          ...job.progress,
          status: "merging",
          percent: Math.max(job.progress.percent, 99),
          speedBps: undefined,
          etaSeconds: undefined,
        };
        emit(job);
      }
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n|\r/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrBuffer += chunk;
    if (stderrBuffer.length > 8000) stderrBuffer = stderrBuffer.slice(-8000);
  });

  child.on("error", (error) => {
    failJob(job, error.message);
  });

  child.on("close", (code) => {
    job.child = undefined;
    if (job.deadlineTimer) clearTimeout(job.deadlineTimer);
    if (job.progress.status === "cancelled" || job.progress.status === "error") return;

    if (code !== 0) {
      failJob(job, cleanYtDlpError(stderrBuffer, PLATFORM_LABELS[parseMediaUrl(url).platform]));
      return;
    }

    const produced = findOutputFile(job.dir);
    if (!produced) {
      failJob(job, "The download finished but no file was produced.");
      return;
    }

    // Paths always live inside .vdodl/jobs/<id>, but the bundler cannot prove
    // that, so opt out of its filesystem tracing.
    const stats = fs.statSync(/* turbopackIgnore: true */ produced);
    job.filePath = produced;
    job.downloadName = swapExtension(job.downloadName, path.extname(produced));
    job.progress = {
      ...job.progress,
      status: "ready",
      percent: 100,
      downloadedBytes: stats.size,
      totalBytes: stats.size,
      speedBps: undefined,
      etaSeconds: 0,
      filename: job.downloadName,
      fileSizeBytes: stats.size,
    };
    scheduleCleanup(job);
    emit(job);
  });
}

function swapExtension(filename: string, extension: string): string {
  if (!extension) return filename;
  const base = filename.replace(/\.[^.]+$/, "");
  return `${base}${extension}`;
}

function findOutputFile(dir: string): string | null {
  const candidates = fs
    .readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.endsWith(".part"))
    .map((entry) => path.join(dir, entry.name));

  if (candidates.length === 0) return null;

  // A merge leaves the muxed file as the largest artifact in the folder.
  return candidates.reduce((largest, current) =>
    fs.statSync(/* turbopackIgnore: true */ current).size >
    fs.statSync(/* turbopackIgnore: true */ largest).size
      ? current
      : largest
  );
}

function failJob(job: Job, message: string): void {
  job.progress = {
    ...job.progress,
    status: "error",
    speedBps: undefined,
    etaSeconds: undefined,
    error: message || "The download failed.",
  };
  emit(job);
  scheduleCleanup(job, 60_000);
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function getProgress(jobId: string): JobProgress | undefined {
  return jobs.get(jobId)?.progress;
}

export function subscribe(jobId: string, listener: (progress: JobProgress) => void): () => void {
  const job = jobs.get(jobId);
  if (!job) return () => {};

  job.listeners.add(listener);
  return () => {
    job.listeners.delete(listener);
  };
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;

  job.progress = { ...job.progress, status: "cancelled", speedBps: undefined, etaSeconds: undefined };
  emit(job);
  job.child?.kill();
  scheduleCleanup(job, 5_000);
  return true;
}

export function getReadyFile(jobId: string): { path: string; name: string; size: number } | null {
  const job = jobs.get(jobId);
  if (!job || job.progress.status !== "ready" || !job.filePath) return null;
  if (!fs.existsSync(/* turbopackIgnore: true */ job.filePath)) return null;

  return {
    path: job.filePath,
    name: job.downloadName,
    size: fs.statSync(/* turbopackIgnore: true */ job.filePath).size,
  };
}
