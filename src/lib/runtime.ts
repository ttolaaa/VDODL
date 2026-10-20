import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

export const RUNTIME_DIR = path.join(projectRoot, ".vdodl");
export const JOBS_DIR = path.join(RUNTIME_DIR, "jobs");

/**
 * yt-dlp ships as a PyInstaller bundle that unpacks its Python runtime into the
 * system temp folder. Some managed machines block execution from the user temp
 * directory, so child processes get a project-local temp folder instead.
 */
export const CHILD_TMP_DIR = path.join(RUNTIME_DIR, "tmp");

const isWindows = process.platform === "win32";

function firstExistingFile(candidates: (string | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

let cachedYtDlp: string | null = null;
let cachedFfmpeg: string | null = null;

export function resolveYtDlpPath(): string {
  if (cachedYtDlp) return cachedYtDlp;

  const binName = isWindows ? "yt-dlp.exe" : "yt-dlp";
  const resolved = firstExistingFile([
    process.env.YTDLP_PATH,
    path.join(projectRoot, "node_modules", "youtube-dl-exec", "bin", binName),
    path.join(projectRoot, "bin", binName),
  ]);

  if (!resolved) {
    throw new Error(
      "yt-dlp binary was not found. Run `npm install`, or set YTDLP_PATH to a yt-dlp executable."
    );
  }

  cachedYtDlp = resolved;
  return resolved;
}

export function resolveFfmpegPath(): string | null {
  if (cachedFfmpeg) return cachedFfmpeg;

  const binName = isWindows ? "ffmpeg.exe" : "ffmpeg";
  cachedFfmpeg = firstExistingFile([
    process.env.FFMPEG_PATH,
    path.join(projectRoot, "node_modules", "ffmpeg-static", binName),
    path.join(projectRoot, "bin", binName),
  ]);

  return cachedFfmpeg;
}

export function ensureRuntimeDirs(): void {
  for (const dir of [RUNTIME_DIR, JOBS_DIR, CHILD_TMP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function childEnv(): NodeJS.ProcessEnv {
  ensureRuntimeDirs();
  return {
    ...process.env,
    TMP: CHILD_TMP_DIR,
    TEMP: CHILD_TMP_DIR,
    TMPDIR: CHILD_TMP_DIR,
  };
}
