import { getProgress, subscribe } from "@/lib/jobs";
import type { JobProgress } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ jobId: string }> };

/** Server-sent events feed that drives the download progress bar. */
export async function GET(request: Request, context: Context) {
  const { jobId } = await context.params;
  const initial = getProgress(jobId);

  if (!initial) {
    return new Response("Unknown job", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (progress: JobProgress) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
        } catch {
          closed = true;
        }

        if (
          progress.status === "ready" ||
          progress.status === "error" ||
          progress.status === "cancelled"
        ) {
          finish();
        }
      };

      const unsubscribe = subscribe(jobId, send);

      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          finish();
        }
      }, 15_000);

      function finish() {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The client already went away.
        }
      }

      request.signal.addEventListener("abort", finish);
      send(initial);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
