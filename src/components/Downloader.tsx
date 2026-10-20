"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { ProgressBar } from "@/components/ProgressBar";
import { formatBytes, formatDuration, formatEta, formatSpeed } from "@/lib/format";
import type { AnalyzeResponse, JobProgress, MediaFormat } from "@/lib/types";

type Phase = "idle" | "analyzing" | "results";

const DEFAULT_ESTIMATE_MS = 6500;

export function Downloader() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);

  const [estimateMs, setEstimateMs] = useState(DEFAULT_ESTIMATE_MS);
  const [elapsedMs, setElapsedMs] = useState(0);

  const [job, setJob] = useState<JobProgress | null>(null);
  const [activeFormat, setActiveFormat] = useState<MediaFormat | null>(null);

  const eventsRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const savedJobRef = useRef<string | null>(null);
  const analyzeStartRef = useRef(0);

  // Seed the countdown with how long recent analyses actually took.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/analyze")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.estimateMs) setEstimateMs(data.estimateMs);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "analyzing") return;

    const timer = setInterval(() => setElapsedMs(Date.now() - analyzeStartRef.current), 100);

    return () => clearInterval(timer);
  }, [phase]);

  const stopWatching = useCallback(() => {
    eventsRef.current?.close();
    eventsRef.current = null;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => stopWatching, [stopWatching]);

  const saveFile = useCallback((jobId: string, filename?: string) => {
    const anchor = document.createElement("a");
    anchor.href = `/api/jobs/${jobId}/file`;
    if (filename) anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  const applyProgress = useCallback(
    (next: JobProgress) => {
      setJob(next);

      if (next.status === "ready" && savedJobRef.current !== next.id) {
        savedJobRef.current = next.id;
        saveFile(next.id, next.filename);
      }

      if (next.status === "ready" || next.status === "error" || next.status === "cancelled") {
        stopWatching();
      }
    },
    [saveFile, stopWatching]
  );

  const watchJob = useCallback(
    (jobId: string) => {
      stopWatching();

      const startPolling = () => {
        if (pollRef.current) return;
        pollRef.current = setInterval(async () => {
          try {
            const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
            if (!response.ok) return;
            applyProgress((await response.json()) as JobProgress);
          } catch {
            // Keep polling; a transient failure should not kill the UI.
          }
        }, 700);
      };

      if (typeof EventSource === "undefined") {
        startPolling();
        return;
      }

      const source = new EventSource(`/api/jobs/${jobId}/events`);
      eventsRef.current = source;

      source.onmessage = (event) => {
        try {
          applyProgress(JSON.parse(event.data) as JobProgress);
        } catch {
          // Ignore malformed frames.
        }
      };

      source.onerror = () => {
        source.close();
        eventsRef.current = null;
        startPolling();
      };
    },
    [applyProgress, stopWatching]
  );

  async function handleAnalyze(event: React.FormEvent) {
    event.preventDefault();
    if (phase === "analyzing") return;

    stopWatching();
    setError(null);
    setAnalysis(null);
    setJob(null);
    setActiveFormat(null);
    savedJobRef.current = null;
    analyzeStartRef.current = Date.now();
    setElapsedMs(0);
    setPhase("analyzing");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data?.error ?? "Could not analyze that link.");
        setPhase("idle");
        return;
      }

      if (data.estimateMs) setEstimateMs(data.estimateMs);
      setAnalysis(data as AnalyzeResponse);
      setPhase("results");
    } catch {
      setError("The server could not be reached. Is the app still running?");
      setPhase("idle");
    }
  }

  async function handleDownload(format: MediaFormat) {
    if (!analysis) return;

    savedJobRef.current = null;
    setActiveFormat(format);
    setError(null);
    setJob({
      id: "pending",
      status: "queued",
      percent: 0,
      downloadedBytes: 0,
      totalBytes: format.sizeBytes,
      label: format.kind === "audio" ? "Audio only" : format.label,
    });

    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: analysis.video.webpageUrl, formatId: format.id }),
      });

      const data = await response.json();

      if (!response.ok) {
        setJob(null);
        setError(data?.error ?? "Could not start the download.");
        return;
      }

      applyProgress(data.progress as JobProgress);
      watchJob(data.jobId as string);
    } catch {
      setJob(null);
      setError("The download could not be started.");
    }
  }

  async function handleCancel() {
    if (!job || job.id === "pending") return;
    stopWatching();
    await fetch(`/api/jobs/${job.id}`, { method: "DELETE" }).catch(() => {});
    setJob(null);
    setActiveFormat(null);
  }

  function handleReset() {
    stopWatching();
    setUrl("");
    setPhase("idle");
    setAnalysis(null);
    setJob(null);
    setActiveFormat(null);
    setError(null);
    savedJobRef.current = null;
  }

  const analyzing = phase === "analyzing";
  const analyzePercent = Math.min(96, 100 * (1 - Math.exp((-3 * elapsedMs) / estimateMs)));
  const remainingSeconds = Math.max(0, (estimateMs - elapsedMs) / 1000);
  const jobBusy = job?.status === "queued" || job?.status === "downloading" || job?.status === "merging";

  return (
    <div className="w-full space-y-10">
      <form onSubmit={handleAnalyze} className="space-y-3">
        <label htmlFor="url" className="block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          YouTube link
        </label>

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="url"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="min-w-0 flex-1 border-2 border-ink bg-white px-4 py-3 text-base outline-none placeholder:text-neutral-400 focus:ring-4 focus:ring-ink/10"
          />

          <button
            type="submit"
            disabled={analyzing || url.trim().length === 0}
            className="shrink-0 bg-action px-7 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-action-dark disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500"
          >
            {analyzing ? "Analyzing" : "Submit"}
          </button>
        </div>

        <p className="text-xs text-muted">
          Paste a watch, share or Shorts link. Playlists are ignored — one video at a time.
        </p>
      </form>

      {error ? (
        <div className="border-2 border-action bg-white px-4 py-3 text-sm">
          <span className="font-semibold text-action">Something went wrong. </span>
          <span>{error}</span>
        </div>
      ) : null}

      {analyzing ? (
        <section className="border-2 border-ink bg-white p-5" aria-live="polite">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em]">Analyzing link</h2>
            <span className="font-mono text-xs text-muted">
              {(elapsedMs / 1000).toFixed(1)}s elapsed
            </span>
          </div>

          <ProgressBar value={analyzePercent} tone="action" label="Analyzing link" />

          <p className="mt-3 text-sm text-muted">
            {remainingSeconds > 0.4
              ? `Estimated ${formatEta(remainingSeconds)} until the quality list is ready.`
              : "Taking a little longer than usual — still working."}
          </p>
        </section>
      ) : null}

      {analysis ? (
        <section className="space-y-6">
          <VideoCard analysis={analysis} onReset={handleReset} />

          {job ? (
            <JobPanel
              job={job}
              format={activeFormat}
              onCancel={handleCancel}
              onSave={() => saveFile(job.id, job.filename)}
            />
          ) : null}

          <div className="border-2 border-ink bg-white">
            <div className="flex items-baseline justify-between gap-4 border-b-2 border-ink px-5 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em]">Choose a quality</h2>
              <span className="font-mono text-xs text-muted">
                {analysis.formats.length} options
              </span>
            </div>

            <ul>
              {analysis.formats.map((format) => (
                <FormatRow
                  key={`${format.kind}-${format.id}`}
                  format={format}
                  disabled={Boolean(jobBusy)}
                  active={activeFormat?.id === format.id && Boolean(jobBusy)}
                  onDownload={() => handleDownload(format)}
                />
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function VideoCard({ analysis, onReset }: { analysis: AnalyzeResponse; onReset: () => void }) {
  const { video } = analysis;

  return (
    <div className="flex flex-col gap-5 border-2 border-ink bg-white p-5 sm:flex-row">
      {video.thumbnail ? (
        <div className="relative aspect-video w-full shrink-0 overflow-hidden border-2 border-ink bg-wash sm:w-56">
          <Image
            src={video.thumbnail}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 224px"
            className="object-cover"
            unoptimized
          />
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold leading-snug">{video.title}</h2>

        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          {video.uploader ? (
            <div className="flex gap-2">
              <dt className="sr-only">Channel</dt>
              <dd>{video.uploader}</dd>
            </div>
          ) : null}
          <div className="flex gap-2">
            <dt className="sr-only">Duration</dt>
            <dd className="font-mono">{formatDuration(video.durationSeconds)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="sr-only">Analysis time</dt>
            <dd className="font-mono">
              {analysis.elapsedMs < 250
                ? "loaded from cache"
                : `analyzed in ${(analysis.elapsedMs / 1000).toFixed(1)}s`}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={onReset}
          className="mt-4 border-2 border-ink px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-ink hover:text-white"
        >
          Analyze another link
        </button>
      </div>
    </div>
  );
}

function FormatRow({
  format,
  disabled,
  active,
  onDownload,
}: {
  format: MediaFormat;
  disabled: boolean;
  active: boolean;
  onDownload: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-base font-semibold">{format.label}</span>
          {format.recommended ? (
            <span className="border border-ink px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
              Recommended
            </span>
          ) : null}
          {format.needsMerge ? (
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
              video + audio merge
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-xs text-muted">
          {format.note ? `${format.note} · ` : ""}
          {format.sizeIsApprox && format.sizeBytes ? "~" : ""}
          {formatBytes(format.sizeBytes)}
        </p>
      </div>

      <button
        type="button"
        onClick={onDownload}
        disabled={disabled}
        className="shrink-0 bg-go px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-go-dark disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500"
      >
        {active ? "Working" : "Download"}
      </button>
    </li>
  );
}

const STATUS_TEXT: Record<JobProgress["status"], string> = {
  queued: "Starting download",
  downloading: "Downloading",
  merging: "Finishing up",
  ready: "Ready to save",
  error: "Download failed",
  cancelled: "Cancelled",
};

function JobPanel({
  job,
  format,
  onCancel,
  onSave,
}: {
  job: JobProgress;
  format: MediaFormat | null;
  onCancel: () => void;
  onSave: () => void;
}) {
  const busy = job.status === "queued" || job.status === "downloading" || job.status === "merging";
  const indeterminate = job.status === "queued" || (job.status === "merging" && job.percent >= 99);
  const heading =
    job.status === "merging" && format?.needsMerge
      ? "Combining video and audio"
      : STATUS_TEXT[job.status];

  return (
    <section className="border-2 border-ink bg-white p-5" aria-live="polite">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em]">
          {heading}
          {format ? <span className="ml-2 font-mono normal-case text-muted">{job.label}</span> : null}
        </h2>
        <span className="font-mono text-sm font-semibold">
          {job.status === "ready" ? "100%" : `${Math.floor(job.percent)}%`}
        </span>
      </div>

      <ProgressBar
        value={job.status === "ready" ? 100 : job.percent}
        tone={job.status === "error" ? "action" : "go"}
        indeterminate={indeterminate}
        label="Download progress"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span className="font-mono">
          {formatBytes(job.downloadedBytes)}
          {job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ""}
          {job.speedBps ? ` · ${formatSpeed(job.speedBps)}` : ""}
        </span>

        {busy && job.status === "downloading" ? (
          <span className="font-mono">{formatEta(job.etaSeconds)} remaining</span>
        ) : null}
      </div>

      {job.status === "error" ? (
        <p className="mt-3 border-2 border-action px-3 py-2 text-sm">{job.error}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        {job.status === "ready" ? (
          <>
            <button
              type="button"
              onClick={onSave}
              className="bg-go px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-go-dark"
            >
              Save file again
            </button>
            <span className="self-center font-mono text-xs text-muted">{job.filename}</span>
          </>
        ) : null}

        {busy && job.id !== "pending" ? (
          <button
            type="button"
            onClick={onCancel}
            className="border-2 border-ink px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-ink hover:text-white"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </section>
  );
}
