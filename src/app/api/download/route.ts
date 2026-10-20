import { NextResponse } from "next/server";

import { createJob } from "@/lib/jobs";
import { analyze, getCachedAnalysis } from "@/lib/ytdlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let url: unknown;
  let formatId: unknown;

  try {
    const body = await request.json();
    url = body?.url;
    formatId = body?.formatId;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof url !== "string" || typeof formatId !== "string") {
    return NextResponse.json({ error: "A link and a quality are required." }, { status: 400 });
  }

  try {
    // Format details always come from the server's own analysis, never from the
    // client, so the request cannot smuggle arbitrary yt-dlp arguments.
    const analysis = getCachedAnalysis(url) ?? (await analyze(url));
    const format = analysis.formats.find((entry) => entry.id === formatId);

    if (!format) {
      return NextResponse.json(
        { error: "That quality is no longer available. Analyze the link again." },
        { status: 409 }
      );
    }

    const job = createJob({ url: analysis.video.webpageUrl, format, title: analysis.video.title });

    return NextResponse.json({ jobId: job.id, progress: job.progress }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the download.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
