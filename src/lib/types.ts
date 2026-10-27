export type MediaKind = "video" | "audio";
export type MediaPlatform = "youtube" | "tiktok" | "instagram";

export type MediaFormat = {
  /** yt-dlp format id used to start the download. */
  id: string;
  kind: MediaKind;
  /** Human label shown in the quality list, e.g. "1080p" or "Audio only". */
  label: string;
  /** Container the finished file will use. */
  container: string;
  height?: number;
  /** Quality class such as "HD", "Full HD", "2K", or "4K". */
  quality?: string;
  fps?: number;
  /** Audio bitrate in kbps, for audio-only entries. */
  abr?: number;
  sizeBytes?: number;
  sizeIsApprox: boolean;
  /** True when video and audio are separate streams and must be muxed. */
  needsMerge: boolean;
  /** A complete media file the browser may fetch directly if the CDN permits CORS. */
  directUrl?: string;
  note?: string;
  recommended?: boolean;
};

export type VideoSummary = {
  id: string;
  platform: MediaPlatform;
  title: string;
  uploader?: string;
  durationSeconds?: number;
  thumbnail?: string;
  webpageUrl: string;
};

export type AnalyzeResponse = {
  video: VideoSummary;
  formats: MediaFormat[];
  elapsedMs: number;
};

export type JobStatus =
  | "queued"
  | "downloading"
  | "merging"
  | "ready"
  | "error"
  | "cancelled";

export type JobProgress = {
  id: string;
  status: JobStatus;
  /** 0-100 overall completion of the whole job. */
  percent: number;
  downloadedBytes: number;
  totalBytes?: number;
  /** Bytes per second for the active stream. */
  speedBps?: number;
  /** Seconds remaining, when it can be estimated. */
  etaSeconds?: number;
  filename?: string;
  fileSizeBytes?: number;
  error?: string;
  label: string;
  transferMode?: "browser" | "server";
};
