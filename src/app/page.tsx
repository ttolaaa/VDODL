import { Downloader } from "@/components/Downloader";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-14 sm:py-20">
      <header className="mb-12">
        <div className="flex items-center gap-3">
          <span aria-hidden className="block h-6 w-6 bg-action" />
          <span className="font-mono text-sm font-semibold uppercase tracking-[0.34em]">VDODL</span>
        </div>

        <h1 className="mt-8 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
          Save a video in the
          <br />
          quality you want.
        </h1>

        <p className="mt-4 max-w-xl text-base text-muted">
          Drop in a YouTube, TikTok, or Instagram link and pick the quality, from HD up to
          2K and 4K. Progress is shown the whole way through.
        </p>
      </header>

      <Downloader />

      <footer className="mt-16 border-t-2 border-ink pt-5 text-xs leading-relaxed text-muted">
        <p>
          Only download videos you own or that the rights holder allows you to download. You are
          responsible for how you use the files you save.
        </p>
        <p className="mt-2 font-mono uppercase tracking-[0.14em]">
          VDODL · browser-first downloads · yt-dlp + ffmpeg fallback
        </p>
      </footer>
    </main>
  );
}
