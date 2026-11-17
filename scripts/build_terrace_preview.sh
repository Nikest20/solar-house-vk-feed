#!/usr/bin/env bash
set -euo pipefail

# Generates a review-only 9-second silent vertical clip from AI stills.
# No VK API calls and no publication.
PREVIEW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_DIR="$PREVIEW_ROOT/generated_images"
OUT_DIR="$PREVIEW_ROOT/review"
mkdir -p "$OUT_DIR"

SCENE_1="$IMAGE_DIR/exec-e57000b5-fb6b-4624-9352-1bdcee035aef.png"
SCENE_2="$IMAGE_DIR/exec-937be063-53d2-4793-91bf-8fb01ee81e10.png"
SCENE_3="$IMAGE_DIR/exec-256b0516-ebaa-4cc1-8a8d-474557b00227.png"
OUTPUT="$OUT_DIR/solar-house-terrace-2026-11-19-9s-preview.mp4"
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

for file in "$SCENE_1" "$SCENE_2" "$SCENE_3" "$FONT"; do
  [[ -f "$file" ]] || { echo "Missing: $file" >&2; exit 1; }
done

ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -framerate 30 -t 3 -i "$SCENE_1" \
  -loop 1 -framerate 30 -t 3 -i "$SCENE_2" \
  -loop 1 -framerate 30 -t 3 -i "$SCENE_3" \
  -filter_complex "\
[0:v]scale=1200:2130,crop=1080:1920,zoompan=z='min(zoom+0.00045,1.09)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,drawbox=x=0:y=0:w=iw:h=420:color=black@0.27:t=fill,drawtext=fontfile=$FONT:text='ТЕРРАСА?':x=(w-text_w)/2:y=165:fontsize=97:fontcolor=white:borderw=2:bordercolor=black@0.5,drawtext=fontfile=$FONT:text='ЗАЧЕМ ОНА НАМ?':x=(w-text_w)/2:y=286:fontsize=62:fontcolor=white:borderw=2:bordercolor=black@0.5,setsar=1[v0];\
[1:v]scale=1200:2130,crop=1080:1920,zoompan=z='min(zoom+0.00043,1.09)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,drawbox=x=0:y=0:w=iw:h=420:color=black@0.32:t=fill,drawtext=fontfile=$FONT:text='А ПОТОМ...':x=(w-text_w)/2:y=165:fontsize=91:fontcolor=white:borderw=2:bordercolor=black@0.5,drawtext=fontfile=$FONT:text='КАЖДОЕ УТРО — ЗДЕСЬ':x=(w-text_w)/2:y=285:fontsize=57:fontcolor=white:borderw=2:bordercolor=black@0.5,setsar=1[v1];\
[2:v]scale=1200:2130,crop=1080:1920,zoompan=z='min(zoom+0.00036,1.09)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,drawbox=x=0:y=0:w=iw:h=450:color=black@0.32:t=fill,drawtext=fontfile=$FONT:text='В ДОМЕ ТОЛЬКО СПЯТ':x=(w-text_w)/2:y=168:fontsize=63:fontcolor=white:borderw=2:bordercolor=black@0.5,drawtext=fontfile=$FONT:text='ВСЯ ЖИЗНЬ — НА ТЕРРАСЕ!':x=(w-text_w)/2:y=288:fontsize=51:fontcolor=white:borderw=2:bordercolor=black@0.5,setsar=1[v2];\
[v0][v1][v2]concat=n=3:v=1:a=0[outv]" \
  -map '[outv]' -c:v libx264 -preset veryfast -crf 24 \
  -pix_fmt yuv420p -movflags +faststart -r 30 -an "$OUTPUT"

ffprobe -v error -show_entries format=duration,size -show_entries stream=width,height,r_frame_rate -of default=noprint_wrappers=1 "$OUTPUT"
printf 'REVIEW_ONLY=%s\n' "$OUTPUT"
