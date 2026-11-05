#!/usr/bin/env bash
# Updates the self-hosted site (aaPanel VPS) from GitHub and rebuilds it. Run on the server as root:
#
#   bash /www/wwwroot/oz-media/scripts/deploy.sh
#
# Then restart the Node project in aaPanel (Website → Node Project → Restart), unless pm2 restarts it below.
# The server copy is never edited by hand: content comes from GitHub (code pushes and CMS commits), so any local
# changes are discarded. `.env`, `data/`, `dist/` and `node_modules/` are git-ignored and left alone.
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/oz-media}"
BRANCH="${BRANCH:-main}"
APP_USER="${APP_USER:-www}"
PM2_NAME="${PM2_NAME:-oz-media}"

cd "$APP_DIR"

echo "==> Fetching origin/$BRANCH"
git fetch --quiet origin "$BRANCH"
before_lock="$(git rev-parse HEAD:package-lock.json)"
before_head="$(git rev-parse --short HEAD)"

# The build's image step (scripts/optimize-uploads.mjs) rewrites src/content and adds .webp files to
# public/uploads; drop those so the update applies cleanly. The next build regenerates them.
git reset --hard --quiet "origin/$BRANCH"
git clean -fdq -- src/content public/uploads
echo "    $before_head -> $(git rev-parse --short HEAD)"

if [ "$before_lock" != "$(git rev-parse HEAD:package-lock.json)" ] || [ ! -d node_modules ]; then
	echo "==> Dependencies changed, running npm ci"
	npm ci
fi

# Low priority so the build doesn't starve the Icecast stream on the same server. Astro empties dist/ first, so keep
# the last good build and put it back if this one fails.
echo "==> Building"
rm -rf dist.prev
[ -d dist ] && cp -a dist dist.prev
if ! nice -n 19 npm run build; then
	echo "!!> Build failed; restoring the previous build. Fix the error, push, and run this again." >&2
	if [ -d dist.prev ]; then rm -rf dist && mv dist.prev dist; fi
	chown -R "$APP_USER:$APP_USER" "$APP_DIR"
	exit 1
fi
rm -rf dist.prev

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 .env

if command -v pm2 >/dev/null 2>&1 && pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
	echo "==> Restarting $PM2_NAME"
	pm2 restart "$PM2_NAME"
else
	echo "==> Done. Restart the Node project in aaPanel to load the new build."
fi
