# VDODL

**Paste a YouTube link, choose a quality, and download the video.**

VDODL is a simple web app built with Next.js, React, TypeScript, and Tailwind CSS.
It has a black-and-white design with orange-red Submit buttons and green Download buttons.

> Only download videos you own or have permission to download. Respect copyright
> and YouTube's terms of service.

## What can it do?

- Read YouTube watch, share, and Shorts links.
- Show an estimated waiting time while checking a video.
- List available video qualities, file types, and file sizes.
- Download video with sound, or download audio only.
- Show download progress, speed, and estimated time remaining.
- Let you cancel a download or save a completed file again.

Available qualities depend on the video. The app cannot improve the original quality.

## Before you start

You need:

- [Node.js](https://nodejs.org/) installed. Node.js 24 LTS is recommended; the minimum is 20.9.
- An internet connection and enough free disk space for downloaded videos.
- [Git](https://git-scm.com/downloads) if you want to copy the project using `git clone`.

The commands below are for **Windows PowerShell**, including the VS Code terminal.
On macOS or Linux, use `npm` instead of `npm.cmd`.

## Run the app

### 1. Open the project

If you already have the project, open its folder in VS Code, then choose
**Terminal > New Terminal**. Make sure the terminal is in the folder containing
[package.json](./package.json).

If you do not have the project yet, run these commands from the folder where you
want to keep it:

```powershell
git clone https://github.com/ttolaaa/VDODL.git
cd VDODL
```

**Tip:** Keep the project outside OneDrive to avoid Git file-locking problems.

### 2. Install the required packages

```powershell
npm.cmd install
```

Do this the first time you set up the project. It may take a few minutes.
It also downloads **yt-dlp**, which reads and downloads videos, and **ffmpeg**,
which combines video and sound. Wait until installation finishes before continuing.

### 3. Start the app

```powershell
npm.cmd run dev
```

Wait until the terminal says `Ready`.

### 4. Open it in your browser

Open **http://localhost:3000**. If the terminal shows a different `Local` address,
use that address instead.

**Keep the terminal running while using the app.** Press **Ctrl+C** when you want
to stop it. Next time, you normally only need to run `npm.cmd run dev`.

## Download your first video

1. Paste a YouTube video link into the input box.
2. Click **Submit**. A progress bar and estimated waiting time appear.
3. Wait for the video details and quality list.
4. Click **Download** next to the quality you want. Start with a lower resolution
   if you want a smaller file.
5. Watch the download progress. Some qualities need an extra step to combine
   video and sound.
6. When ready, the browser starts saving the file. Check your browser's Downloads
   list, or click **Save file again** if needed.

Choose **Audio only** if you only want the sound. The file type is shown in the
quality list; audio is not automatically converted to MP3.

## Check that it works

Use a video you own or are allowed to download.

| Try this | What should happen |
| --- | --- |
| Leave the input empty | Submit is disabled. |
| Submit a valid video link | Video details and available qualities appear. |
| Download a small video quality | Progress updates and the file downloads. Play it to check picture and sound. |
| Choose Audio only | A playable audio file downloads. |
| Enter a non-YouTube link | A clear error message appears. |
| Cancel an active download | The download stops and you can choose a quality again. |

The analysis time is an **estimate**, not an exact countdown. A recently checked
link can load almost immediately because its results are temporarily remembered.

## Common problems

### The page does not load

Run `npm.cmd run dev`, wait for `Ready`, and open the `Local` address printed in
the terminal. Opening a browser address does not start the server.

### PowerShell says scripts are disabled

Use `npm.cmd` instead of `npm`, as shown above. You do not need to change your
computer's execution policy.

### A video cannot be downloaded

Check the error shown in the app. Live streams and videos requiring sign-in,
such as private or members-only videos, are not supported. YouTube may also
temporarily block requests, so even a public video is not guaranteed to work.

### Git keeps asking whether to retry deleting a directory

This can happen when OneDrive or another program locks Git's files. Do not
manually delete Git's internal folders. Keeping your project outside OneDrive
helps avoid this problem.

## Other useful commands

Run these from the project folder:

| Command | What it does |
| --- | --- |
| `npm.cmd run dev` | Starts the app for local development. |
| `npm.cmd run lint` | Checks the code for lint problems. |
| `npm.cmd run build` | Creates the production version. |
| `npm.cmd run start` | Runs the production version after a successful build. |

To test production mode, stop the development server with **Ctrl+C**, then run
`npm.cmd run build` followed by `npm.cmd run start`. Only continue if the build succeeds.

## Important limits

- One video at a time per request. Playlist-only links are not supported.
- This version is designed to run on one computer/server, not several servers
  sharing the same downloads.
- Restarting the server makes existing download jobs unavailable.
- Temporary server copies are stored in `.vdodl` and normally expire 30 minutes
  after a job starts, while the server is running. Files already saved to your
  own Downloads folder are not removed.
- GitHub stores the source code; it does not run the app. This app needs a
  running Node.js server and cannot run as a static GitHub Pages site.

## Where to find the code

| Location | Purpose |
| --- | --- |
| [src/app](./src/app) | Pages, styles, and server API routes. |
| [src/components](./src/components) | The form, quality list, and progress bars. |
| [src/lib](./src/lib) | Video analysis, downloading, and helper functions. |
| [package.json](./package.json) | Dependencies and available commands. |

**Advanced:** If you already have yt-dlp or ffmpeg installed, set `YTDLP_PATH` or
`FFMPEG_PATH` to the executable's full path before starting the server. Otherwise,
the app uses the binaries downloaded during installation.
