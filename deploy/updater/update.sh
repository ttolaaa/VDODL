#!/bin/sh
# Polls the git remote and redeploys the app service whenever the branch moves.
set -u

REPO_DIR="${REPO_DIR:-/repo}"
REMOTE="${GIT_REMOTE:-origin}"
INTERVAL="${POLL_INTERVAL:-60}"
SERVICE="${APP_SERVICE:-app}"
WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-180}"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') [updater] $*"; }

if [ ! -d "$REPO_DIR/.git" ]; then
  log "No git checkout found at $REPO_DIR. Mount the cloned repository there."
  exit 1
fi

# Run git as the checkout's owner so pulled files don't become root-owned on the host.
OWNER="$(stat -c '%u:%g' "$REPO_DIR")"
git_() { su-exec "$OWNER" env HOME=/tmp git -c safe.directory='*' -C "$REPO_DIR" "$@"; }
compose() { docker compose --project-directory "$REPO_DIR" "$@"; }

BRANCH="${GIT_BRANCH:-}"
[ -n "$BRANCH" ] || BRANCH="$(git_ rev-parse --abbrev-ref HEAD)" || exit 1

deployed_revision() {
  id="$(compose ps -q "$SERVICE" 2>/dev/null | head -n 1)"
  [ -n "$id" ] || return 0
  docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$id" 2>/dev/null
}

failed=""
REFRESH_SECONDS=$(( ${YTDLP_REFRESH_HOURS:-24} * 3600 ))
last_build="$(date +%s)"
log "Watching $REMOTE/$BRANCH in $REPO_DIR every ${INTERVAL}s"

# Rebuilds and replaces the app. Each build fetches the newest yt-dlp because
# YTDLP_REFRESH changes; unchanged layers are cached, and if the resulting image
# is identical the running container is left alone.
deploy() {
  last_build="$(date +%s)"
  GIT_COMMIT="$1" YTDLP_REFRESH="$last_build" \
    compose up -d --build --wait --wait-timeout "$WAIT_TIMEOUT" "$SERVICE"
}

while :; do
  if git_ fetch --quiet "$REMOTE" "$BRANCH"; then
    local_head="$(git_ rev-parse HEAD)"
    remote_head="$(git_ rev-parse "$REMOTE/$BRANCH")"
    if [ "$local_head" != "$remote_head" ]; then
      if git_ merge --ff-only --quiet "$REMOTE/$BRANCH"; then
        log "Pulled $(git_ log -1 --format='%h %s')"
      else
        log "Cannot fast-forward to $REMOTE/$BRANCH (local edits or diverged history in $REPO_DIR); skipping."
      fi
    fi
  else
    log "git fetch failed; retrying in ${INTERVAL}s"
  fi

  head="$(git_ rev-parse HEAD 2>/dev/null)"
  if [ -n "$head" ] && [ "$head" != "$failed" ] && [ "$head" != "$(deployed_revision)" ]; then
    log "Deploying $head"
    if deploy "$head"; then
      failed=""
      log "Deployed $head"
      docker image prune -f --filter "label=vdodl.component=app" >/dev/null 2>&1 || true
    else
      failed="$head"
      log "Deploy of $head failed. If the build failed, the previous version is still running. Waiting for the next commit."
    fi
  elif [ -n "$head" ] && [ "$REFRESH_SECONDS" -gt 0 ] &&
       [ $(( $(date +%s) - last_build )) -ge "$REFRESH_SECONDS" ]; then
    # TikTok/Instagram/YouTube changes often need a newer yt-dlp before any commit
    # lands. Only refresh when the checkout is what's running, never a failed commit.
    if [ "$head" = "$(deployed_revision)" ]; then
      log "Refreshing yt-dlp for $head"
      if deploy "$head"; then
        log "yt-dlp refresh done"
        docker image prune -f --filter "label=vdodl.component=app" >/dev/null 2>&1 || true
      else
        log "yt-dlp refresh failed; the current version keeps running."
      fi
    else
      last_build="$(date +%s)"
    fi
  fi

  sleep "$INTERVAL"
done
