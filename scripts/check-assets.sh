#!/usr/bin/env bash
set -euo pipefail

IMAGE_SIZE_LIMIT_KB=200
VIDEO_SIZE_LIMIT_KB=1024
VIDEO_BITRATE_LIMIT_KBPS=500
FAILED=0

# Images: .png/.jpg over the limit should have been converted to .webp and removed
for img in public/*.png public/*.jpg; do
    [ -f "$img" ] || continue
    size_kb=$(du -k "$img" | cut -f1)
    if [ "$size_kb" -gt "$IMAGE_SIZE_LIMIT_KB" ]; then
        echo "ERROR: $img is ${size_kb}KB (limit ${IMAGE_SIZE_LIMIT_KB}KB) — convert to .webp."
        echo "       Run: pnpm run optimize:images $img"
        FAILED=1
    fi
done

# Videos: any .mp4 over the size limit must be within the bitrate ceiling
for vid in public/*.mp4; do
    [ -f "$vid" ] || continue
    size_kb=$(du -k "$vid" | cut -f1)
    if [ "$size_kb" -gt "$VIDEO_SIZE_LIMIT_KB" ]; then
        bitrate_kbps=$(ffprobe -v error -select_streams v:0 \
            -show_entries stream=bit_rate -of csv=p=0 "$vid" 2>/dev/null)
        bitrate_kbps=$((bitrate_kbps / 1000))
        if [ "$bitrate_kbps" -gt "$VIDEO_BITRATE_LIMIT_KBPS" ]; then
            echo "ERROR: $vid is ${size_kb}KB with bitrate ${bitrate_kbps}kbps (limit ${VIDEO_BITRATE_LIMIT_KBPS}kbps)."
            echo "       Run: pnpm run optimize:videos $vid"
            FAILED=1
        else
            echo "OK: $vid — ${bitrate_kbps}kbps"
        fi
    fi
done

exit $FAILED
