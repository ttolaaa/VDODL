import type { MediaPlatform } from "./types";

export const PLATFORM_LABELS: Record<MediaPlatform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export type ParsedMediaUrl = {
  normalized: string;
  videoId: string;
  platform: MediaPlatform;
};

function extractVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();

  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id ?? null;
  }

  const paramId = url.searchParams.get("v");
  if (paramId) return paramId;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 2 && ["shorts", "embed", "live", "v"].includes(segments[0])) {
    return segments[1];
  }

  return null;
}

export function parseMediaUrl(raw: string): ParsedMediaUrl {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Paste a YouTube, TikTok, or Instagram link.");
  if (trimmed.length > 2048) throw new Error("That link is too long.");

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("That does not look like a valid link.");
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error("Use a public video link without a custom port or sign-in details.");
  }

  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) {
    const videoId = extractVideoId(url);
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
      throw new Error("No YouTube video found. Paste a watch, Shorts, or share link.");
    }
    return {
      videoId,
      platform: "youtube",
      normalized: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }

  if (["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(host)) {
    const video = url.pathname.match(/^\/(@[\w.-]+)\/video\/(\d{10,25})\/?$/);
    if (video) {
      return {
        platform: "tiktok",
        videoId: video[2],
        normalized: `https://www.tiktok.com/${video[1]}/video/${video[2]}`,
      };
    }
    const share = url.pathname.match(/^\/t\/([a-zA-Z0-9_-]+)\/?$/);
    if (share) {
      return {
        platform: "tiktok",
        videoId: share[1],
        normalized: `https://www.tiktok.com/t/${share[1]}/`,
      };
    }
    throw new Error("Paste a TikTok video or share link, not a profile or photo post.");
  }

  if (["vm.tiktok.com", "vt.tiktok.com"].includes(host)) {
    const share = url.pathname.match(/^\/([a-zA-Z0-9_-]+)\/?$/);
    if (!share) throw new Error("That TikTok share link is not valid.");
    return {
      platform: "tiktok",
      videoId: share[1],
      normalized: `https://${host}/${share[1]}/`,
    };
  }

  if (["instagram.com", "www.instagram.com", "m.instagram.com"].includes(host)) {
    const post = url.pathname.match(/^\/(?:[\w.]+\/)?(reels?|p|tv)\/([\w-]{5,64})\/?$/);
    if (!post) throw new Error("Paste an Instagram Reel or video post link, not a profile.");
    const kind = post[1].startsWith("reel") ? "reel" : post[1];
    return {
      platform: "instagram",
      videoId: post[2],
      normalized: `https://www.instagram.com/${kind}/${post[2]}/`,
    };
  }

  throw new Error("Only YouTube, TikTok, and Instagram video links are supported.");
}

/** Strips characters that browsers or filesystems dislike in a filename. */
export function safeFilename(title: string, container: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  const ext = container.replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp4";
  return `${base || "video"}.${ext}`;
}
