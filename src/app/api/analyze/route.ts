import { NextResponse } from "next/server";

import { analyze, getAnalyzeEstimateMs } from "@/lib/ytdlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lets the client show a realistic countdown before it submits a link. */
export async function GET() {
  return NextResponse.json({ estimateMs: getAnalyzeEstimateMs() });
}

export async function POST(request: Request) {
  let url: unknown;

  try {
    const body = await request.json();
    url = body?.url;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof url !== "string") {
    return NextResponse.json({ error: "Paste a YouTube, TikTok, or Instagram link." }, { status: 400 });
  }

  const startedAt = Date.now();

  try {
    const analysis = await analyze(url);
    return NextResponse.json({
      video: analysis.video,
      formats: analysis.formats,
      elapsedMs: Date.now() - startedAt,
      estimateMs: getAnalyzeEstimateMs(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not analyze that link.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
