#!/bin/sh
# Builds assets/flow.gif (or, given `claude`, assets/claude.gif) from the frames of scripts/preview.ts --flow (--claude); needs Google Chrome (headless) and ffmpeg. Run from the repo root.
set -eu
mode=${1:-flow} # flow or claude
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
npx -y tsx scripts/preview.ts --$mode "$tmp"
first=$(ls "$tmp"/f*.svg | head -n 1)
w=$(sed -n 's/.*<svg[^>]* width="\([0-9.]*\)".*/\1/p' "$first")
h=$(sed -n 's/.*<svg[^>]* height="\([0-9.]*\)".*/\1/p' "$first")
w=$(printf '%.0f' "$w"); h=$(printf '%.0f' "$h")
# one Chrome at a time: parallel runs hang
for svg in "$tmp"/f*.svg; do
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size="$w,$h" --screenshot="${svg%.svg}.png" "file://$svg" >/dev/null 2>&1
done
colors=128
[ "$mode" = claude ] && colors=32 # the camera pans, so every moving frame is a full redraw: fewer colors keep it small
ffmpeg -y -loglevel error -framerate 10 -i "$tmp/f%04d.png" -vf "scale=1080:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=$colors:stats_mode=full[p];[b][p]paletteuse=dither=none" -loop 0 assets/$mode.gif
