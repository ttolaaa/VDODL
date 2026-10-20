import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
