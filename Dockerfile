# syntax=docker/dockerfile:1

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- Dependencies ------------------------------------------------------------
FROM base AS deps
# The lockfile may point at a private mirror; rewrite tarball URLs to a public
# registry. Integrity hashes are unchanged, so npm still verifies every package.
ARG NPM_REGISTRY=https://registry.npmjs.org/
# yt-dlp is installed separately below as a standalone Linux binary, so skip
# youtube-dl-exec's Python check and its download of the Python zipapp.
ENV YOUTUBE_DL_SKIP_DOWNLOAD=1 \
    YOUTUBE_DL_SKIP_PYTHON_CHECK=1
COPY package.json package-lock.json ./
RUN sed -i -E "s#\"resolved\": \"https://[^\"]*/npm/registry/#\"resolved\": \"${NPM_REGISTRY}#" package-lock.json \
 && npm config set registry "${NPM_REGISTRY}" \
 && npm ci \
 && test -x node_modules/ffmpeg-static/ffmpeg

# --- yt-dlp standalone binary ------------------------------------------------
FROM debian:bookworm-slim AS ytdlp
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
ARG TARGETARCH
ARG YTDLP_VERSION=latest
# Changes on every deploy so each new commit also picks up the newest yt-dlp,
# which platforms like TikTok and Instagram regularly require. YTDLP_REFRESH is
# set by the updater's periodic refresh to fetch a new yt-dlp without a commit.
ARG GIT_COMMIT=unknown
ARG YTDLP_REFRESH=
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) asset=yt-dlp_linux ;; \
      arm64) asset=yt-dlp_linux_aarch64 ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    if [ "$YTDLP_VERSION" = latest ]; then base=https://github.com/yt-dlp/yt-dlp/releases/latest/download; \
    else base="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}"; fi; \
    cd /tmp; \
    curl -fsSL --retry 3 -o "$asset" "$base/$asset"; \
    curl -fsSL --retry 3 -o SHA2-256SUMS "$base/SHA2-256SUMS"; \
    grep " ${asset}\$" SHA2-256SUMS | sha256sum -c -; \
    install -m 0755 "$asset" /yt-dlp; \
    echo "yt-dlp for ${GIT_COMMIT} ${YTDLP_REFRESH}"

# --- Build -------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A failing test or build aborts the deploy and leaves the running app untouched.
RUN npm test && npm run build

# --- Runtime -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    FFMPEG_PATH=/usr/local/bin/ffmpeg

# yt-dlp needs a JavaScript runtime for YouTube; Deno is the one it enables by default.
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno
COPY --from=ytdlp /yt-dlp /usr/local/bin/yt-dlp
COPY --from=deps /app/node_modules/ffmpeg-static/ffmpeg /usr/local/bin/ffmpeg

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Downloads and yt-dlp's temp files live here (mounted as a volume in compose.yaml).
RUN mkdir -p /app/.vdodl && chown node:node /app/.vdodl

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Read by the updater to know which commit is running.
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.revision=$GIT_COMMIT \
      org.opencontainers.image.source=https://github.com/ttolaaa/VDODL

CMD ["node", "server.js"]
