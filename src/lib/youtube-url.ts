const ALLOWED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export type ParsedYouTubeUrl = {
  /** Canonical watch URL handed to yt-dlp. */
  normalized: string;
  videoId: string;
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

/**
 * Accepts the YouTube link shapes people actually paste and rejects anything
 * else, so no arbitrary URL ever reaches yt-dlp.
 */
export function parseYouTubeUrl(raw: string): ParsedYouTubeUrl {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Paste a YouTube link to get started.");

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("That does not look like a valid link.");
  }

  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Only YouTube links are supported.");
  }

  const videoId = extractVideoId(url);
  if (!videoId || !/^[\w-]{6,20}$/.test(videoId)) {
    throw new Error("No video id found in that link.");
  }

  return {
    videoId,
    normalized: `https://www.youtube.com/watch?v=${videoId}`,
  };
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
