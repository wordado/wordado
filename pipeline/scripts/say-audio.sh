#!/usr/bin/env bash
# One-off, macOS only. Placeholder clips for the sample pack from the system
# voice: below the quality bar of spec §5.4, replaced by plan 8's TTS. Skips
# clips that already exist, so it is safe to rerun after adding an entry.
set -euo pipefail
dir="$(cd "$(dirname "$0")/../samples/a1-bg" && pwd)"
mkdir -p "$dir/audio"
node --input-type=module -e '
import { readFileSync } from "node:fs"
const source = JSON.parse(readFileSync(process.argv[1], "utf8"))
for (const e of source.entries) if (e.audio.uk) console.log(`${e.audio.uk}\t${e.headword}`)
' "$dir/source.json" | while IFS=$'\t' read -r clip word; do
  out="$dir/audio/$clip.m4a"
  [ -f "$out" ] && continue
  say -v Daniel -o "$dir/audio/$clip.aiff" "$word"
  afconvert -f m4af -d aac -b 48000 "$dir/audio/$clip.aiff" "$out"
  rm "$dir/audio/$clip.aiff"
  echo "$clip"
done
