# VDODL

**Paste a YouTube (incl. Shorts), TikTok, or Instagram link, choose a quality (HD, Full HD, 2K, or 4K when available), and download the video.**

## How to use

1. **Paste your link.** Copy a public YouTube, TikTok, or Instagram link into the input box.
2. **Click Submit.** The app checks the video and shows an estimated waiting time.
3. **Choose a quality.** Review the available resolutions and file sizes. Rows are
   tagged **HD** (720p), **Full HD** (1080p), **2K** (1440p), or **4K** (2160p);
   vertical Shorts/TikTok videos are classed by their short side.
4. **Click Download.** Use the button next to the quality you want.
5. **Follow the progress.** The progress bar shows how much has downloaded and
   the estimated time remaining.
6. **Save your file.** When ready, the browser starts the download. Find the file
   in your browser's Downloads list.

### Other options

- **Audio only:** When listed, download just the sound using the Download button on that row.
- **Cancel:** Stop a download that is still running.
- **Save file again:** Download a completed file again.
- **Analyze another link:** Start over with a different video.

## Browser-first downloads

The app checks links and tracks progress in your browser. When a platform allows
it, a complete video or audio file downloads directly to your device without
passing through the app's server.

The app still needs a server to find the available video files. It also uses the
server if a platform blocks direct browser downloads, video and sound need to be
combined, or a file exceeds the browser's 256 MB memory-buffer limit. The app
shows **Browser-first** or **Server-assisted** and explains when it switches.
It is not a fully browser-only app. YouTube and TikTok always block direct
browser downloads (and YouTube links only work from the server's IP), so those
always use the server.

## Start the app on your computer

Install [Node.js](https://nodejs.org/) version 20.9 or newer, then open a terminal
in the project folder.

On Windows, run these commands one at a time. Wait for installation to finish
successfully before starting the app:

```powershell
npm.cmd install
npm.cmd run dev
```

Wait for `Ready`, then open **http://localhost:3000**. If the terminal shows a
different `Local` address, use that address instead.

**Keep the terminal running while using the app.** Press **Ctrl+C** to stop it.
After the first setup, you normally only need `npm.cmd run dev` to start it again.

On macOS or Linux, use `npm` instead of `npm.cmd`.

## Deploy with Docker Compose

The server needs [Docker](https://docs.docker.com/engine/install/) with the
Compose plugin and git. Clone over **HTTPS** (the updater has no SSH keys), then
start everything from the project folder:

```bash
git clone https://github.com/ttolaaa/VDODL.git vdodl
cd vdodl
GIT_COMMIT=$(git rev-parse HEAD) docker compose up -d --build
```

Open **http://SERVER:3000**. Downloads and temporary files are kept in the
`vdodl-data` Docker volume.

### Automatic updates

Compose also starts an `updater` container. It checks the git remote every 60
seconds, and when new commits land on the branch it:

1. fast-forwards the server's checkout (`git merge --ff-only`),
2. runs the tests and rebuilds the image (this also fetches the latest yt-dlp),
3. replaces the running `app` container and waits until it is healthy.

If the tests or build fail, the current version keeps running and the updater
waits for the next commit. Watch it with `docker compose logs -f updater`.

Platforms (especially TikTok and Instagram) change often, so the updater also
rebuilds every 24 hours to pull the newest yt-dlp even without a commit. If
nothing changed, the running container is left untouched.

Notes:

- Treat the server checkout as deploy-only. Local edits or a force-pushed branch
  stop fast-forwarding until you fix the checkout (e.g. `git reset --hard origin/master`).
- The updater mounts the Docker socket, which gives it full control of Docker on
  that host.
- The updater does not rebuild itself. After changing `deploy/updater/`, run
  `docker compose up -d --build updater` on the server.
- Plain `docker compose up -d --build` also works; the updater then rebuilds
  once to record which commit is running.

Optional settings go in a `.env` file next to `compose.yaml`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VDODL_PORT` | `3000` | Host port for the app |
| `VDODL_BRANCH` | current branch | Branch to follow |
| `VDODL_POLL_INTERVAL` | `60` | Seconds between git checks |
| `VDODL_YTDLP_REFRESH_HOURS` | `24` | Hours between yt-dlp refresh rebuilds (`0` disables) |
| `VDODL_MAX_DOWNLOAD_HOURS` | `6` | Longest a single server download may run before it is stopped |
| `VDODL_CPUS` | `1` | CPU cores the app container may use |
| `VDODL_MEMORY` | `1536m` | Memory the app container may use |
| `VDODL_MAX_JOBS` | `3` | Downloads running at the same time (others get "try again") |
| `VDODL_MAX_ANALYSES` | `3` | Links being checked at the same time |

### Server resource use

The server never re-encodes video and uses no GPU. Measured for a 250 MB 4K
download: about 4 CPU-seconds in total and under 100 MB of memory per running
download (yt-dlp ~90 MB, ffmpeg ~20 MB) on top of the ~150 MB Node.js server.
Finished files are streamed to the browser from disk, not held in memory. The
main costs are **network** (each file is downloaded by the server and then sent
to the user) and **disk**. The limits above cap CPU, memory, and concurrency.
Rebuilds after a commit (`npm ci` + `next build`) run outside these limits and
briefly use 1–2 GB of memory.

## Please note

- Only download videos you own or have permission to download. Respect copyright
  and YouTube's terms of service.
- Available qualities depend on the original video. YouTube offers 2K/4K only as
  separate video and audio streams (VP9 or AV1), so the server merges them with
  ffmpeg; these files can take a while and may not play on older devices.
- YouTube watch/Shorts links, TikTok video/share links, and Instagram
  `instagram.com/reel/...`, `/p/...` (video posts), and `/tv/...` links are supported.
- Waiting times are estimates and depend on the video and your connection.
- There is no limit on video length. A single server download may run for up to
  6 hours (`VDODL_MAX_DOWNLOAD_HOURS`), and a finished file stays available for
  30 minutes. Make sure the server has enough free disk space for long 4K videos
  (roughly 1 GB per 10 minutes at 4K60). Files left over from a restart or
  redeploy are deleted on the next download.
- Live streams, playlist-only links, and videos requiring sign-in are not supported.
- TikTok and Instagram may block automated access even to public videos. If that
  happens, the app shows an error; it does not bypass login or access restrictions.
