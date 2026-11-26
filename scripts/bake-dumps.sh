#!/usr/bin/env bash
# Bake public/data/universe*.json from the newest sc-gamedata-dumps releases.
#
#   scripts/bake-dumps.sh [--tag <tag> --channel LIVE|PTU] [--skip-unchanged <site url>]
#
# LIVE is the dumps repo's latest release; PTU is its newest prerelease. A --tag pins
# that channel to one tag instead. The baked files are build output, not committed:
# Pages bakes fresh data on every deploy. public/data/source.json records the tags and
# revisions baked, and --skip-unchanged compares it with the deployed site's copy.
#
# Needs gh (authenticated; GH_TOKEN in Actions), git, node, jq.
# Writes skip=true|false to $GITHUB_OUTPUT when set.
set -euo pipefail

DUMPS=${DUMPS_REPO:-voidput/sc-gamedata-dumps}
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=${RUNNER_TEMP:-$root/.tmp}/dumps
pin_tag="" pin_channel="" site=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) pin_tag=$2; shift 2 ;;
    --channel) pin_channel=$2; shift 2 ;;
    --skip-unchanged) site=$2; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

valid() { case "$1" in ""|*[!0-9A-Za-z._-]*) return 1 ;; esac; }
output() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1" >> "$GITHUB_OUTPUT"; return 0; }

live=$(gh api "repos/$DUMPS/releases/latest" -q .tag_name)
ptu=$(gh api "repos/$DUMPS/releases?per_page=30" -q '[.[] | select(.prerelease and (.draft | not))][0].tag_name // ""')
if [ -n "$pin_tag" ]; then
  valid "$pin_tag" || { echo "::error::Bad tag '$pin_tag'"; exit 1; }
  case "$pin_channel" in
    LIVE) live=$pin_tag ;;
    PTU) ptu=$pin_tag ;;
    *) echo "::error::--tag needs --channel LIVE or PTU, not '$pin_channel'"; exit 1 ;;
  esac
fi
valid "$live" || { echo "::error::No LIVE release in $DUMPS"; exit 1; }

# Fetch one tag's data/ and build.json (cone mode keeps root files). Prints the revision.
fetch() {
  local tag=$1 channel=$2 dir=$tmp/$2
  rm -rf "$dir"
  git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" --filter=blob:none --sparse "https://github.com/$DUMPS" "$dir" >&2
  git -C "$dir" sparse-checkout set data >&2
  local manifest=$dir/build.json tagged="" revision=0
  if [ -f "$manifest" ]; then
    tagged=$(jq -r '.channel // ""' "$manifest")
    revision=$(jq -r '.revision // 0' "$manifest")
  fi
  if [ -n "$tagged" ] && [ "$tagged" != "$channel" ]; then
    echo "::error::$tag is a $tagged build, not $channel." >&2
    return 1
  fi
  for name in game-starmap game-ship-components game-quantum game-ships; do
    [ -f "$dir/data/$name.json" ] || { echo "::error::$tag has no data/$name.json" >&2; return 1; }
  done
  echo "$revision"
}

live_rev=$(fetch "$live" LIVE)
ptu_rev=""
if valid "$ptu"; then
  ptu_rev=$(fetch "$ptu" PTU)
else
  echo "::warning::No PTU prerelease in $DUMPS; keeping the committed universe-ptu.json."
fi

source=$(jq -cn --arg lt "$live" --arg lr "$live_rev" --arg pt "$ptu" --arg pr "$ptu_rev" \
  '{live: {tag: $lt, revision: ($lr | tonumber)}}
   + (if $pt == "" then {} else {ptu: {tag: $pt, revision: ($pr | tonumber)}} end)')
echo "Baking $source"

if [ -n "$site" ]; then
  deployed=$(curl -fsSL "${site%/}/data/source.json" 2>/dev/null | jq -c . 2>/dev/null || true)
  if [ "$deployed" = "$source" ]; then
    echo "::notice::The site already serves $source; skipping."
    output skip=true
    exit 0
  fi
fi

node "$root/scripts/build-data.mjs" --channel live --data "$tmp/LIVE/data"
[ -n "$ptu_rev" ] && node "$root/scripts/build-data.mjs" --channel ptu --data "$tmp/PTU/data"
echo "$source" > "$root/public/data/source.json"
output skip=false
