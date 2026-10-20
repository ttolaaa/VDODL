import fs from "node:fs";
import { Readable } from "node:stream";

import { getReadyFile } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ jobId: string }> };

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".opus": "audio/opus",
};

function contentDisposition(name: string): string {
  const asciiFallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(_request: Request, context: Context) {
  const { jobId } = await context.params;
  const file = getReadyFile(jobId);

  if (!file) {
    return new Response("File is not ready.", { status: 404 });
  }

  const extension = file.name.slice(file.name.lastIndexOf("."));
  const stream = Readable.toWeb(
    fs.createReadStream(file.path)
  ) as unknown as ReadableStream<Uint8Array>;

  return new Response(stream, {
    headers: {
      "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "Content-Length": String(file.size),
      "Content-Disposition": contentDisposition(file.name),
      "Cache-Control": "no-store",
    },
  });
}
