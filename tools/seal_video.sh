#!/bin/sh
# Commit a hide recording to the board: sha256 of the file goes public now, the link opens when the coin is found.
# usage: tools/seal_video.sh <round> <number> <video file> <url shown when found>
set -e; [ $# -eq 4 ] || { echo "usage: $0 <round> <number> <file> <url>"; exit 1; }
set -a; . ~/.config/quillcoin/env; set +a
SHA=$(shasum -a 256 "$3" | cut -d' ' -f1)
curl -s -X POST "https://ovjeipprgkeygnlkraiu.supabase.co/functions/v1/api/video" -H "Authorization: Bearer $HIDER_KEY" -H 'content-type: application/json' \
  -d "{\"round\":$1,\"number\":$2,\"sha256\":\"$SHA\",\"url\":\"$4\"}"; echo
