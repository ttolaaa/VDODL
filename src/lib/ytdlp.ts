import { spawn } from "node:child_process";

import { buildMediaFormats, type RawFormat } from "@/lib/media-formats";
import { parseMediaUrl, PLATFORM_LABELS } from "@/lib/media-url";
import { childEnv, resolveFfmpegPath, resolveYtDlpPath } from "@/lib/runtime";
import type { MediaFormat, MediaPlatform, VideoSummary } from "@/lib/types";

// Their CDNs reject cross-origin browser fetches (YouTube URLs are also locked to
// the server's IP), so a direct browser attempt always fails for these.
const SERVER_ONLY_PLATFORMS = new Set<MediaPlatform>(["youtube", "tiktok"]);

export type Analysis = {
  video: VideoSummary;
  formats: MediaFormat[];
  createdAt: number;
};

type RawInfo = RawFormat & {
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
  entries?: unknown[];
  availability?: string;
};

const ANALYZE_TIMEOUT_MS = 60_000;
const ANALYSIS_TTL_MS = 15 * 60 * 1000;
const MAX_ACTIVE_ANALYSES = Number(process.env.VDODL_MAX_ANALYSES) > 0
  ? Number(process.env.VDODL_MAX_ANALYSES) : 4;

const analysisCache = new Map<string, Analysis>();
let activeAnalyses = 0;

function pruneAnalysisCache(): void {
  const now = Date.now();
  for (const [key, entry] of analysisCache) {
    if (now - entry.createdAt > ANALYSIS_TTL_MS) analysisCache.delete(key);
  }
}

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

function runYtDlpJson(url: string, platform: string): Promise<RawInfo> {
  const bin = resolveYtDlpPath();
  const args = [
    "--dump-single-json",
    "--ignore-config",
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
        reject(new Error(cleanYtDlpError(Buffer.concat(stderr).toString("utf8"), platform)));
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

export function cleanYtDlpError(stderr: string, platform = "The platform"): string {
  const line = stderr
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("ERROR:"))
    .pop();

  if (!line) {
    return `${platform} did not return this video. Check the link and try again.`;
  }

  const message = line.replace(/^ERROR:\s*/, "").replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, "");

  if (/private video/i.test(message)) return "This video is private.";
  if (/members-only/i.test(message)) return "This video is for channel members only.";
  if (/login|log in|sign.?in|age.restrict|cookies|not a bot/i.test(message)) {
    return `${platform} requires sign-in or has blocked automated access. This app cannot download that video.`;
  }
  if (/429|rate.limit|too many requests/i.test(message)) {
    return `${platform} is limiting requests. Wait a while before trying again.`;
  }
  if (/403|forbidden|blocked|unable to extract|failed to parse/i.test(message)) {
    return `${platform} blocked access or changed its video page. Try another public video or update yt-dlp.`;
  }
  if (/unavailable/i.test(message)) return "This video is unavailable.";
  if (/live event/i.test(message)) return "This is a live stream and cannot be downloaded.";

  return message.slice(0, 200);
}

export async function analyze(rawUrl: string, force = false): Promise<Analysis> {
  const { normalized, platform } = parseMediaUrl(rawUrl);

  const cached = analysisCache.get(normalized);
  if (!force && cached && Date.now() - cached.createdAt < ANALYSIS_TTL_MS) {
    return cached;
  }

  // Each analysis is a separate yt-dlp process; cap them so bursts of traffic
  // cannot exhaust the server's CPU and memory.
  if (activeAnalyses >= MAX_ACTIVE_ANALYSES) {
    throw new Error("The server is busy checking other links. Try again in a few seconds.");
  }
  activeAnalyses += 1;
  const startedAt = Date.now();
  let info: RawInfo;
  try {
    info = await runYtDlpJson(normalized, PLATFORM_LABELS[platform]);
  } finally {
    activeAnalyses -= 1;
  }
  recordDuration(Date.now() - startedAt);

  if (info.entries) throw new Error("Paste a link to one video, not a collection.");
  if (info.is_live || info.live_status === "is_live") {
    throw new Error("This is a live stream and cannot be downloaded.");
  }
  if (["private", "needs_auth", "subscriber_only", "premium_only"].includes(info.availability ?? "")) {
    throw new Error("This video requires sign-in and cannot be downloaded.");
  }

  const rawFormats = info.formats?.length
    ? info.formats
    : info.url ? [{ ...info, format_id: info.format_id ?? "best" }] : [];
  const formats = buildMediaFormats(rawFormats);
  if (SERVER_ONLY_PLATFORMS.has(platform)) {
    for (const format of formats) delete format.directUrl;
  }
  if (formats.length === 0) {
    throw new Error("No downloadable streams were found for this video.");
  }

  const analysis: Analysis = {
    video: {
      id: info.id ?? "",
      platform,
      title: info.title?.trim() || "Untitled video",
      uploader: info.uploader ?? info.channel,
      durationSeconds: info.duration,
      thumbnail: info.thumbnail,
      webpageUrl: normalized,
    },
    formats,
    createdAt: Date.now(),
  };

  pruneAnalysisCache();
  analysisCache.set(normalized, analysis);
  return analysis;
}

export function getCachedAnalysis(rawUrl: string): Analysis | null {
  const { normalized } = parseMediaUrl(rawUrl);
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
