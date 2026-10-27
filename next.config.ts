import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone for the Docker image (see Dockerfile).
  output: "standalone",
  // The Docker image installs Linux yt-dlp/ffmpeg itself (YTDLP_PATH/FFMPEG_PATH),
  // so don't copy the npm-provided binaries into the standalone output.
  outputFileTracingExcludes: {
    "/**": ["node_modules/youtube-dl-exec/bin/**", "node_modules/ffmpeg-static/ffmpeg*"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "i9.ytimg.com" },
    ],
  },
  // These packages only exist to provide the yt-dlp and ffmpeg binaries; keep
  // them out of the server bundle so their paths resolve at runtime.
  serverExternalPackages: ["youtube-dl-exec", "ffmpeg-static"],
};

export default nextConfig;
