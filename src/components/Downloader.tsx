"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { ProgressBar } from "@/components/ProgressBar";
import { canDownloadInBrowser, downloadInBrowser } from "@/lib/browser-download";
import { formatBytes, formatDuration, formatEta, formatSpeed } from "@/lib/format";
import { parseMediaUrl, PLATFORM_LABELS, safeFilename } from "@/lib/media-url";
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
  const [transferNotice, setTransferNotice] = useState<string | null>(null);

  const eventsRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const savedJobRef = useRef<string | null>(null);
  const analyzeStartRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const clientFileRef = useRef<{ id: string; url: string } | null>(null);

  const clearClientFile = useCallback(() => {
    if (clientFileRef.current) URL.revokeObjectURL(clientFileRef.current.url);
    clientFileRef.current = null;
  }, []);

  // Seed the countdown with how long recent analyses actually took.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/analyze")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.estimateMs) setEstimateMs(data.estimateMs);
      })
      .catch((error) => console.warn("Could not load the analysis time estimate.", error));

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

  useEffect(() => () => {
    stopWatching();
    requestRef.current?.abort();
    clearClientFile();
    if (activeJobIdRef.current) {
      void fetch(`/api/jobs/${activeJobIdRef.current}`, { method: "DELETE", keepalive: true })
        .catch((error) => console.warn("Could not cancel the download on page close.", error));
    }
  }, [stopWatching, clearClientFile]);

  const saveFile = useCallback((jobId: string, filename?: string) => {
    const anchor = document.createElement("a");
    anchor.href = clientFileRef.current?.id === jobId
      ? clientFileRef.current.url : `/api/jobs/${jobId}/file`;
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
        activeJobIdRef.current = null;
        stopWatching();
      }
    },
    [saveFile, stopWatching]
  );

  const watchJob = useCallback(
    (jobId: string) => {
      stopWatching();

      const startPolling = () => {
        if (pollRef.current || activeJobIdRef.current !== jobId) return;
        pollRef.current = setInterval(async () => {
          if (activeJobIdRef.current !== jobId) return;
          try {
            const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
            if (activeJobIdRef.current !== jobId) return;
            if (!response.ok) {
              setError(response.status === 404
                ? "This download is no longer available. Cancel it and try again."
                : "Cannot read download progress. Retrying; you can still cancel.");
              return;
            }
            const progress = await response.json() as JobProgress;
            if (activeJobIdRef.current === jobId) applyProgress(progress);
          } catch {
            if (activeJobIdRef.current === jobId) {
              setError("Connection to download progress was lost. Retrying.");
            }
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
        if (activeJobIdRef.current !== jobId) return;
        try {
          applyProgress(JSON.parse(event.data) as JobProgress);
        } catch {
          setError("An invalid progress update was received. Reconnecting.");
          source.close();
          startPolling();
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
    if (phase === "analyzing" || jobBusy) return;

    let normalized: string;
    try {
      normalized = parseMediaUrl(url).normalized;
    } catch (error) {
      setError(error instanceof Error ? error.message : "That link is not supported.");
      return;
    }

    stopWatching();
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    clearClientFile();
    setError(null);
    setTransferNotice(null);
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
        body: JSON.stringify({ url: normalized }),
        signal: controller.signal,
      });

      const data = await response.json();
      if (controller.signal.aborted) return;

      if (!response.ok) {
        setError(data?.error ?? "Could not analyze that link.");
        setPhase("idle");
        return;
      }

      if (data.estimateMs) setEstimateMs(data.estimateMs);
      setAnalysis(data as AnalyzeResponse);
      setPhase("results");
    } catch {
      if (controller.signal.aborted) return;
      setError("The server could not be reached. Is the app still running?");
      setPhase("idle");
    }
  }

  async function handleDownload(format: MediaFormat) {
    if (!analysis || jobBusy) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    clearClientFile();
    savedJobRef.current = null;
    setActiveFormat(format);
    setError(null);
    setTransferNotice(null);
    setJob({
      id: "pending",
      status: "queued",
      percent: 0,
      downloadedBytes: 0,
      totalBytes: format.sizeBytes,
      label: format.kind === "audio" ? "Audio only" : format.label,
      transferMode: canDownloadInBrowser(format) ? "browser" : "server",
    });

    if (canDownloadInBrowser(format) && format.directUrl) {
      const id = `browser-${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;
      const label = format.kind === "audio" ? "Audio only" : format.label;
      try {
        const blob = await downloadInBrowser(format.directUrl, {
          signal: controller.signal,
          onProgress: (progress) => {
            setJob({ id, status: "downloading", label, transferMode: "browser", ...progress });
          },
        });
        controller.signal.throwIfAborted();
        clientFileRef.current = { id, url: URL.createObjectURL(blob) };
        applyProgress({
          id,
          status: "ready",
          label,
          transferMode: "browser",
          percent: 100,
          downloadedBytes: blob.size,
          totalBytes: blob.size,
          fileSizeBytes: blob.size,
          filename: safeFilename(analysis.video.title, format.container),
        });
        return;
      } catch (error) {
        if (controller.signal.aborted) return;
        setTransferNotice(
          `${error instanceof Error ? error.message : "Direct browser download failed."} Switching to server assistance.`
        );
      }
    } else {
      setTransferNotice(format.needsMerge
        ? "This quality has separate video and audio streams. The server will combine them."
        : format.directUrl
          ? "This file is too large to buffer in the browser, so the server will download it."
          : "This platform does not allow direct browser downloads, so the server will fetch it.");
    }

    if (controller.signal.aborted) return;
    setJob({
      id: "pending",
      status: "queued",
      label: format.label,
      transferMode: "server",
      percent: 0,
      downloadedBytes: 0,
      totalBytes: format.sizeBytes,
    });
    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: analysis.video.webpageUrl, formatId: format.id }),
        signal: AbortSignal.timeout(90_000),
      });

      const data = await response.json();

      if (controller.signal.aborted) {
        if (response.ok && data.jobId) {
          const cancelled = await fetch(`/api/jobs/${data.jobId}`, { method: "DELETE" });
          if (!cancelled.ok) console.warn("The pending server download could not be cancelled.");
        }
        return;
      }
      if (!response.ok) {
        setJob(null);
        setError(data?.error ?? "Could not start the download.");
        return;
      }

      activeJobIdRef.current = data.jobId;
      applyProgress(data.progress as JobProgress);
      if (activeJobIdRef.current) watchJob(data.jobId as string);
    } catch {
      if (controller.signal.aborted) return;
      setJob(null);
      setError("The download could not be started.");
    }
  }

  async function handleCancel() {
    if (!job) return;
    requestRef.current?.abort();
    const serverJobId = activeJobIdRef.current;
    activeJobIdRef.current = null;
    stopWatching();
    setJob(null);
    setActiveFormat(null);
    setTransferNotice(null);
    if (serverJobId) {
      try {
        const response = await fetch(`/api/jobs/${serverJobId}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw new Error("Server cancellation failed.");
      } catch {
        setError("The browser stopped watching, but the server could not confirm cancellation.");
      }
    }
  }

  function handleReset() {
    if (jobBusy) return;
    stopWatching();
    requestRef.current?.abort();
    clearClientFile();
    setUrl("");
    setPhase("idle");
    setAnalysis(null);
    setJob(null);
    setActiveFormat(null);
    setError(null);
    setTransferNotice(null);
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
          Video link
        </label>

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="url"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            disabled={analyzing || Boolean(jobBusy)}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="YouTube, TikTok, or Instagram URL"
            className="min-w-0 flex-1 border-2 border-ink bg-white px-4 py-3 text-base outline-none placeholder:text-neutral-400 focus:ring-4 focus:ring-ink/10"
          />

          <button
            type="submit"
            disabled={analyzing || Boolean(jobBusy) || url.trim().length === 0}
            className="shrink-0 bg-action px-7 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-action-dark disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500"
          >
            {analyzing ? "Analyzing" : "Submit"}
          </button>
        </div>

        <p className="text-xs text-muted">
          YouTube videos and Shorts, TikTok videos and share links, or Instagram Reels and
          video posts. Up to 4K when the original has it. One public video at a time.
        </p>
        <p className="text-xs text-muted">
          Browser-first downloads: files transfer directly when allowed. Link extraction,
          blocked transfers, and video/audio merging use the server.
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
          <VideoCard analysis={analysis} onReset={handleReset} disabled={Boolean(jobBusy)} />

          {transferNotice ? (
            <p role="status" className="border border-line px-4 py-3 text-sm text-muted">
              {transferNotice}
            </p>
          ) : null}

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

function VideoCard({ analysis, onReset, disabled }: {
  analysis: AnalyzeResponse; onReset: () => void; disabled: boolean;
}) {
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
          <div>
            <dt className="sr-only">Platform</dt>
            <dd>{PLATFORM_LABELS[video.platform]}</dd>
          </div>
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
          disabled={disabled}
          className="mt-4 border-2 border-ink px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
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
          {format.quality ? (
            <span className="bg-ink px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
              {format.quality}
            </span>
          ) : null}
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
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
            {canDownloadInBrowser(format) ? "Browser-first" : "Server-assisted"}
          </span>
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
  const indeterminate = job.status === "queued" ||
    (job.status === "merging" && job.percent >= 99) ||
    (job.status === "downloading" && !job.totalBytes);
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
          {job.status === "ready" ? "100%" : job.status === "downloading" && !job.totalBytes
            ? "Working" : `${Math.floor(job.percent)}%`}
        </span>
      </div>

      <ProgressBar
        value={job.status === "ready" ? 100 : job.percent}
        tone={job.status === "error" ? "action" : "go"}
        indeterminate={indeterminate}
        label="Download progress"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>{job.transferMode === "browser"
          ? job.status === "ready" ? "Downloaded on your device" : "Downloading on your device"
          : "Server-assisted download"}</span>
        <span className="font-mono">
          {formatBytes(job.downloadedBytes)}
          {job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ""}
          {job.speedBps ? ` · ${formatSpeed(job.speedBps)}` : ""}
        </span>

        {busy && job.status === "downloading" ? (
          <span className="font-mono">
            {job.etaSeconds === undefined ? "Estimating time remaining" : `${formatEta(job.etaSeconds)} remaining`}
          </span>
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

        {busy ? (
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
