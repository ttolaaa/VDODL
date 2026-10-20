# VDODL

A small Next.js app for saving a video from a YouTube link in the quality you choose.

Paste a link → the app reads the available streams → you pick a resolution → the file downloads
with a live progress bar and an estimated time remaining.

> Only download videos you own or that the rights holder allows you to download. You are
> responsible for how you use the files you save.

## How it works

1. **Submit** a YouTube watch, share or Shorts link. While the link is analyzed, a progress bar
   shows an estimated time to completion based on how long recent analyses actually took.
2. **Pick a quality.** The app lists one entry per resolution (plus an audio-only option) with the
   container, codec and expected file size.
3. **Download.** The server fetches the streams, muxes video and audio when needed, and reports
   real byte-level progress, transfer speed and ETA over server-sent events. The finished file is
   handed to the browser automatically, and a *Save file again* button stays available.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Keep the terminal running while you use the app. Wait for Next.js to print `Ready`,
and open the exact `Local` URL it reports (the port can change if 3000 is occupied).
If the browser reports that it cannot connect, make sure the development server is
still running; opening the URL alone does not start it.

On Windows PowerShell, if `npm.ps1` is blocked by execution policy, run
`npm.cmd run dev` instead of `npm run dev`. There is no need to change the
machine's execution policy.

`npm install` also fetches the two binaries the app shells out to:

| Binary   | Package           | Used for                                 |
| -------- | ----------------- | ---------------------------------------- |
| `yt-dlp` | `youtube-dl-exec` | Reading stream metadata and downloading  |
| `ffmpeg` | `ffmpeg-static`   | Muxing video-only and audio-only streams |

To use binaries you already have installed, set `YTDLP_PATH` and/or `FFMPEG_PATH`.

## Project layout

```
src/
  app/
    api/analyze/route.ts             POST: read a link's streams, GET: current time estimate
    api/download/route.ts            POST: start a download job
    api/jobs/[jobId]/route.ts        GET: job progress, DELETE: cancel
    api/jobs/[jobId]/events/route.ts SSE progress feed
    api/jobs/[jobId]/file/route.ts   Serves the finished file as an attachment
    page.tsx                         Landing page
  components/
    Downloader.tsx                   Form, quality list and progress UI
    ProgressBar.tsx                  Shared bar used by both progress states
  lib/
    jobs.ts                          Download jobs, progress parsing, cleanup
    ytdlp.ts                         yt-dlp calls, format list, analysis cache
    runtime.ts                       Binary + scratch directory resolution
    youtube-url.ts                   Link validation and filename sanitising
    format.ts                        Byte, duration and ETA formatting
```

Downloads are written to `.vdodl/jobs/<id>/` and deleted 30 minutes after the job is created.
The whole folder is git-ignored and safe to delete at any time.

## Notes and limits

- One video per request; playlist links are rejected.
- Live streams, private and members-only videos cannot be downloaded.
- Job state lives in the server process's memory, so the app expects to run as a single local
  server rather than across several instances.
- On managed Windows machines, code execution from the user temp folder is sometimes blocked,
  which stops the yt-dlp bundle from unpacking. Child processes are therefore given a
  project-local temp directory (`.vdodl/tmp`).

## Design

Monochrome layout on white. Colour is reserved for controls that trigger something: orange-red
for *Submit* and error states, green for *Download* and download progress.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
```
