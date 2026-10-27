import type { MediaFormat } from "./types";

export type RawFormat = {
  format_id?: string;
  url?: string;
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
  protocol?: string;
  has_drm?: boolean;
};

const FILE_PROTOCOLS = new Set(["https", "http"]);
const STREAM_PROTOCOLS = new Set(["m3u8", "m3u8_native", "http_dash_segments"]);
const AUDIO_EXTENSIONS = new Set(["m4a", "mp3", "aac", "opus", "ogg", "wav", "flac"]);

function isAudioOnly(format: RawFormat): boolean {
  return format.vcodec === "none" ||
    (!format.vcodec && AUDIO_EXTENSIONS.has(format.ext ?? ""));
}

function bytesOf(format: RawFormat): { size?: number; approx: boolean } {
  if (format.filesize && format.filesize > 0) return { size: format.filesize, approx: false };
  return {
    size: format.filesize_approx && format.filesize_approx > 0 ? format.filesize_approx : undefined,
    approx: true,
  };
}

function directUrl(format: RawFormat): string | undefined {
  if (format.protocol && !FILE_PROTOCOLS.has(format.protocol)) return undefined;
  if (!format.url) return undefined;
  try {
    const url = new URL(format.url);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
        !/\.(m3u8|mpd)(?:$|\?)/i.test(url.href)) return url.href;
  } catch {
    // Extractors can return formats without a valid direct URL.
  }
  return undefined;
}

function bestAudio(formats: RawFormat[], preferredExt: string): RawFormat | undefined {
  const candidates = formats.filter(
    (format) => isAudioOnly(format) && format.acodec !== "none"
  );
  const preferred = candidates.filter((format) => format.ext === preferredExt);
  return (preferred.length ? preferred : candidates).sort(
    (a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0)
  )[0];
}

/** Quality class from the short side, so portrait 1080x1920 counts as Full HD. */
export function qualityTag(width?: number, height?: number): string | undefined {
  const shortSide = width && height ? Math.min(width, height) : height ?? 0;
  if (shortSide >= 4320) return "8K";
  if (shortSide >= 2160) return "4K";
  if (shortSide >= 1440) return "2K";
  if (shortSide >= 1080) return "Full HD";
  if (shortSide >= 720) return "HD";
  return undefined;
}

function score(format: RawFormat): number {
  return (!format.protocol || FILE_PROTOCOLS.has(format.protocol) ? 3_000_000 : 0) +
    (format.ext === "mp4" ? 1_000_000 : 0) +
    (format.acodec !== "none" ? 500_000 : 0) +
    (/^(avc|h264)/.test(format.vcodec ?? "") ? 10_000 : 0) +
    (format.tbr ?? format.vbr ?? 0);
}

export function buildMediaFormats(rawFormats: RawFormat[]): MediaFormat[] {
  const formats = rawFormats.filter((format) => {
    if (!format.format_id || format.has_drm) return false;
    if (format.vcodec === "none" && format.acodec === "none") return false;
    if (["mhtml", "jpg", "jpeg", "png", "webp"].includes(format.ext ?? "")) return false;
    return format.protocol
      ? FILE_PROTOCOLS.has(format.protocol) || STREAM_PROTOCOLS.has(format.protocol)
      : Boolean(directUrl(format));
  });

  const byResolution = new Map<number, RawFormat>();
  for (const format of formats.filter((entry) => !isAudioOnly(entry))) {
    const resolution = format.height ?? 0;
    const previous = byResolution.get(resolution);
    if (!previous || score(format) > score(previous)) byResolution.set(resolution, format);
  }

  const sorted = [...byResolution.entries()].sort(([a], [b]) => b - a);
  const videos: MediaFormat[] = sorted.map(([height, format]) => {
      const container = format.ext ?? "mp4";
      const audio = bestAudio(formats, container === "webm" ? "webm" : "m4a");
      // Social extractors often omit codec fields for complete MP4 files.
      const needsMerge = format.acodec === "none" && Boolean(audio);
      const videoSize = bytesOf(format);
      const audioSize = needsMerge && audio ? bytesOf(audio) : { size: 0, approx: false };
      const codec = /^(avc|h264)/.test(format.vcodec ?? "") ? "H.264"
        : /^vp0?9/.test(format.vcodec ?? "") ? "VP9"
          : format.vcodec?.startsWith("av01") ? "AV1" : undefined;
      const fps = format.fps ? Math.round(format.fps) : undefined;
      return {
        id: format.format_id!,
        kind: "video",
        label: height && format.width && format.width < height ? `${format.width}x${height}`
          : height ? `${height}p${fps && fps >= 50 ? fps : ""}` : "Original",
        container,
        height: height || undefined,
        quality: qualityTag(format.width, height),
        fps,
        sizeBytes: videoSize.size !== undefined && audioSize.size !== undefined
          ? videoSize.size + audioSize.size : undefined,
        sizeIsApprox: videoSize.approx || audioSize.approx,
        needsMerge,
        directUrl: needsMerge ? undefined : directUrl(format),
        note: [codec, container.toUpperCase(), format.acodec === "none" && !audio ? "No audio track" : undefined]
          .filter(Boolean).join(" · "),
      };
    });

  const shortSides = sorted.map(([height, format]) =>
    format.width && height ? Math.min(format.width, height) : height);
  const recommendedIndex = [1080, 720]
    .map((side) => shortSides.indexOf(side))
    .find((index) => index >= 0) ?? 0;
  if (videos[recommendedIndex]) videos[recommendedIndex].recommended = true;

  const audio = bestAudio(formats, "m4a");
  if (!audio) return videos;
  const size = bytesOf(audio);
  return [...videos, {
    id: audio.format_id!,
    kind: "audio",
    label: "Audio only",
    container: audio.ext ?? "m4a",
    abr: audio.abr ? Math.round(audio.abr) : undefined,
    sizeBytes: size.size,
    sizeIsApprox: size.approx,
    needsMerge: false,
    directUrl: directUrl(audio),
    note: audio.abr ? `${Math.round(audio.abr)} kbps` : "Best available",
  }];
}
