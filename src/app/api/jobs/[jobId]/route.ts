import { NextResponse } from "next/server";

import { cancelJob, getProgress } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, context: Context) {
  const { jobId } = await context.params;
  const progress = getProgress(jobId);

  if (!progress) {
    return NextResponse.json({ error: "That download is no longer available." }, { status: 404 });
  }

  return NextResponse.json(progress, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE(_request: Request, context: Context) {
  const { jobId } = await context.params;

  if (!cancelJob(jobId)) {
    return NextResponse.json({ error: "That download is no longer available." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
