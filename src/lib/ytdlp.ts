import { spawn } from "node:child_process";

import { childEnv, resolveFfmpegPath, resolveYtDlpPath } from "@/lib/runtime";
import type { MediaFormat, VideoSummary } from "@/lib/types";
import { parseYouTubeUrl } from "@/lib/youtube-url";

export type Analysis = {
  video: VideoSummary;
  formats: MediaFormat[];
  createdAt: number;
};

type RawFormat = {
  format_id?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  width?: number;
  fps?: number;
  tbr?: number;
  abr?: number;
  vbr?: number;
  filesize?: number;
  filesize_approx?: number;
  format_note?: string;
  protocol?: string;
  language?: string;
};

type RawInfo = {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  webpage_url?: string;
  is_live?: boolean;
  live_status?: string;
  formats?: RawFormat[];
};

const ANALYZE_TIMEOUT_MS = 60_000;
const ANALYSIS_TTL_MS = 15 * 60 * 1000;

const analysisCache = new Map<string, Analysis>();

/** Rolling window of recent analyze durations, used to predict the next one. */
const recentDurations: number[] = [];
const DEFAULT_ESTIMATE_MS = 6500;

export function getAnalyzeEstimateMs(): number {
  if (recentDurations.length === 0) return DEFAULT_ESTIMATE_MS;
  const total = recentDurations.reduce((sum, value) => sum + value, 0);
  return Math.round(total / recentDurations.length);
}

function recordDuration(ms: number): void {
  recentDurations.push(ms);
  if (recentDurations.length > 8) recentDurations.shift();
}

function runYtDlpJson(url: string): Promise<RawInfo> {
  const bin = resolveYtDlpPath();
  const args = [
    "--dump-single-json",
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--no-call-home",
    "--socket-timeout",
    "15",
    "--retries",
    "3",
    url,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: childEnv(), windowsHide: true });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error("Analyzing the link took too long. Try again."));
    }, ANALYZE_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(cleanYtDlpError(Buffer.concat(stderr).toString("utf8"))));
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")) as RawInfo);
      } catch {
        reject(new Error("Could not read the video details."));
      }
    });
  });
}

export function cleanYtDlpError(stderr: string): string {
  const line = stderr
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("ERROR:"))
    .pop();

  if (!line) {
    return "YouTube did not return this video. Check the link and try again.";
  }

  const message = line.replace(/^ERROR:\s*/, "").replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, "");

  if (/private video/i.test(message)) return "This video is private.";
  if (/members-only/i.test(message)) return "This video is for channel members only.";
  if (/sign in|age/i.test(message)) return "This video requires sign-in and cannot be fetched.";
  if (/unavailable/i.test(message)) return "This video is unavailable.";
  if (/live event/i.test(message)) return "This is a live stream and cannot be downloaded.";

  return message.slice(0, 200);
}

function isUsableFormat(format: RawFormat): boolean {
  if (!format.format_id) return false;
  // Skip HLS/DASH manifest entries; the plain https streams are enough here.
  return format.protocol === "https" || format.protocol === "http";
}

function bytesOf(format: RawFormat): { size?: number; approx: boolean } {
  if (format.filesize) return { size: format.filesize, approx: false };
  if (format.filesize_approx) return { size: format.filesize_approx, approx: true };
  return { size: undefined, approx: true };
}

function pickBestAudio(formats: RawFormat[], preferredExt: string): RawFormat | undefined {
  const audioOnly = formats.filter(
    (format) => format.acodec && format.acodec !== "none" && format.vcodec === "none"
  );
  if (audioOnly.length === 0) return undefined;

  const preferred = audioOnly.filter((format) => format.ext === preferredExt);
  const pool = preferred.length > 0 ? preferred : audioOnly;

  return pool.reduce((best, current) =>
    (current.abr ?? current.tbr ?? 0) > (best.abr ?? best.tbr ?? 0) ? current : best
  );
}

function buildVideoFormats(formats: RawFormat[]): MediaFormat[] {
  const videoFormats = formats.filter(
    (format) => format.vcodec && format.vcodec !== "none" && format.height
  );

  // Keep one entry per resolution, preferring mp4/H.264 for compatibility.
  const bestByHeight = new Map<number, RawFormat>();
  for (const format of videoFormats) {
    const height = format.height as number;
    const current = bestByHeight.get(height);
    if (!current) {
      bestByHeight.set(height, format);
      continue;
    }

    const score = (candidate: RawFormat) =>
      (candidate.ext === "mp4" ? 1_000_000 : 0) +
      (candidate.acodec && candidate.acodec !== "none" ? 500_000 : 0) +
      (candidate.tbr ?? candidate.vbr ?? 0);

    if (score(format) > score(current)) bestByHeight.set(height, format);
  }

  const audioForMp4 = pickBestAudio(formats, "m4a");
  const audioForWebm = pickBestAudio(formats, "webm");

  const entries = [...bestByHeight.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([height, format]) => {
      const isProgressive = Boolean(format.acodec && format.acodec !== "none");
      const container = format.ext === "webm" && !isProgressive ? "webm" : "mp4";
      const audio = container === "webm" ? audioForWebm : audioForMp4;

      const video = bytesOf(format);
      const audioBytes = isProgressive ? { size: 0, approx: false } : bytesOf(audio ?? {});

      const size =
        video.size === undefined || audioBytes.size === undefined
          ? undefined
          : video.size + audioBytes.size;

      const codecNote = format.vcodec?.startsWith("avc")
        ? "H.264"
        : format.vcodec?.startsWith("vp9") || format.vcodec?.startsWith("vp09")
          ? "VP9"
          : format.vcodec?.startsWith("av01")
            ? "AV1"
            : undefined;

      return {
        id: format.format_id as string,
        kind: "video" as const,
        label: `${height}p${format.fps && format.fps >= 50 ? Math.round(format.fps) : ""}`,
        container,
        height,
        fps: format.fps ? Math.round(format.fps) : undefined,
        sizeBytes: size,
        sizeIsApprox: video.approx || audioBytes.approx,
        needsMerge: !isProgressive,
        note: [codecNote, container.toUpperCase()].filter(Boolean).join(" · "),
      } satisfies MediaFormat;
    });

  return entries;
}

function buildAudioFormat(formats: RawFormat[]): MediaFormat | null {
  const best = pickBestAudio(formats, "m4a");
  if (!best?.format_id) return null;

  const { size, approx } = bytesOf(best);

  return {
    id: best.format_id,
    kind: "audio",
    label: "Audio only",
    container: best.ext === "webm" ? "webm" : "m4a",
    abr: best.abr ? Math.round(best.abr) : undefined,
    sizeBytes: size,
    sizeIsApprox: approx,
    needsMerge: false,
    note: best.abr ? `${Math.round(best.abr)} kbps` : "Best available",
  };
}

export async function analyze(rawUrl: string, force = false): Promise<Analysis> {
  const { normalized } = parseYouTubeUrl(rawUrl);

  const cached = analysisCache.get(normalized);
  if (!force && cached && Date.now() - cached.createdAt < ANALYSIS_TTL_MS) {
    return cached;
  }

  const startedAt = Date.now();
  const info = await runYtDlpJson(normalized);
  recordDuration(Date.now() - startedAt);

  if (info.is_live || info.live_status === "is_live") {
    throw new Error("This is a live stream and cannot be downloaded.");
  }

  const rawFormats = (info.formats ?? []).filter(isUsableFormat);
  if (rawFormats.length === 0) {
    throw new Error("No downloadable streams were found for this video.");
  }

  const videoFormats = buildVideoFormats(rawFormats);
  const audioFormat = buildAudioFormat(rawFormats);

  const preferred =
    videoFormats.find((format) => format.height === 1080) ??
    videoFormats.find((format) => format.height === 720) ??
    videoFormats[0];
  if (preferred) preferred.recommended = true;

  const formats = [...videoFormats, ...(audioFormat ? [audioFormat] : [])];

  const analysis: Analysis = {
    video: {
      id: info.id ?? "",
      title: info.title?.trim() || "Untitled video",
      uploader: info.uploader ?? info.channel,
      durationSeconds: info.duration,
      thumbnail: info.thumbnail,
      webpageUrl: info.webpage_url ?? normalized,
    },
    formats,
    createdAt: Date.now(),
  };

  analysisCache.set(normalized, analysis);
  return analysis;
}

export function getCachedAnalysis(rawUrl: string): Analysis | null {
  const { normalized } = parseYouTubeUrl(rawUrl);
  const cached = analysisCache.get(normalized);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > ANALYSIS_TTL_MS) {
    analysisCache.delete(normalized);
    return null;
  }
  return cached;
}

export function hasFfmpeg(): boolean {
  return resolveFfmpegPath() !== null;
}
