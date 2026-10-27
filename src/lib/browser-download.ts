export const MAX_BROWSER_DOWNLOAD_BYTES = 256 * 1024 * 1024;

export type BrowserProgress = {
  downloadedBytes: number;
  totalBytes?: number;
  percent: number;
  speedBps?: number;
  etaSeconds?: number;
};

export function canDownloadInBrowser(format: {
  directUrl?: string;
  sizeBytes?: number;
  needsMerge: boolean;
}): boolean {
  return Boolean(format.directUrl) && !format.needsMerge &&
    (format.sizeBytes === undefined || format.sizeBytes <= MAX_BROWSER_DOWNLOAD_BYTES);
}

export async function downloadInBrowser(
  url: string,
  options: {
    signal: AbortSignal;
    onProgress: (progress: BrowserProgress) => void;
  }
): Promise<Blob> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("This media link cannot be downloaded directly in the browser.");
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.throwIfAborted();
  options.signal.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), 20_000);
  };

  resetTimeout();
  try {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`The direct download was unavailable (HTTP ${response.status}).`);
    }
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (contentType && !/^(video\/|audio\/|application\/(?:octet-stream|mp4)$|binary\/octet-stream$)/i.test(contentType)) {
      await response.body.cancel();
      throw new Error("The platform returned a page instead of a media file.");
    }

    const length = Number(response.headers.get("content-length"));
    const totalBytes = Number.isFinite(length) && length > 0 ? length : undefined;
    if (totalBytes && totalBytes > MAX_BROWSER_DOWNLOAD_BYTES) {
      await response.body.cancel();
      throw new Error("This file is too large to safely buffer in the browser.");
    }

    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    const startedAt = performance.now();
    let downloadedBytes = 0;
    let previousUpdate = 0;
    try {
      while (true) {
        options.signal.throwIfAborted();
        resetTimeout();
        const { done, value } = await reader.read();
        options.signal.throwIfAborted();
        if (done) break;
        downloadedBytes += value.byteLength;
        if (downloadedBytes > MAX_BROWSER_DOWNLOAD_BYTES) {
          throw new Error("This file is too large to safely buffer in the browser.");
        }
        chunks.push(new Uint8Array(value));
        const now = performance.now();
        if (previousUpdate === 0 || now - previousUpdate >= 100) {
          const speedBps = downloadedBytes / Math.max((now - startedAt) / 1000, 0.001);
          options.onProgress({
            downloadedBytes,
            totalBytes,
            percent: totalBytes ? Math.min(99, downloadedBytes / totalBytes * 100) : 0,
            speedBps,
            etaSeconds: totalBytes ? Math.max(0, (totalBytes - downloadedBytes) / speedBps) : undefined,
          });
          previousUpdate = now;
        }
      }
    } finally {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
    if (!downloadedBytes) throw new Error("The platform returned an empty file.");
    if (totalBytes && totalBytes !== downloadedBytes) {
      throw new Error("The direct download was incomplete.");
    }
    return new Blob(chunks, { type: contentType || "application/octet-stream" });
  } catch (error) {
    options.signal.throwIfAborted();
    if (controller.signal.aborted) {
      throw new Error("The direct download stopped responding.");
    }
    if (error instanceof TypeError) {
      throw new Error("The browser could not access the media directly (network or cross-origin restriction).");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
  }
}
