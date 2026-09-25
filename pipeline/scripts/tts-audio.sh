#!/usr/bin/env bash
# One-off, macOS only (afconvert, afinfo). Placeholder clips for the sample pack from
# Piper TTS with the en_GB "cori" (high) voice, whose licence is public domain
# (see pipeline/samples/README.md): below the quality bar of spec §5.4,
# replaced by plan 8's TTS. Skips clips that already exist, so it is safe to
# rerun after adding an entry; delete audio/*.m4a first to regenerate them all.
#
# Needs:
#   PIPER        the piper CLI, e.g. from `python3 -m venv .venv && .venv/bin/pip install piper-tts`
#                (default: piper on PATH)
#   PIPER_VOICE  the voice model, en_GB-cori-high.onnx, with its .onnx.json beside it, from
#                https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/cori/high
# If piper writes empty files and reports "Error processing file '…/phontab'" (the piper-tts
# 1.8.0 wheel on macOS), point espeak-ng at the data the wheel ships: make a directory holding
# a symlink espeak-ng-data -> <venv>/lib/python3.*/site-packages/piper/espeak-ng-data and
# export ESPEAK_DATA_PATH=<that directory>.
set -euo pipefail
piper="${PIPER:-piper}"
voice="${PIPER_VOICE:?set PIPER_VOICE to the path of en_GB-cori-high.onnx}"
dir="$(cd "$(dirname "$0")/../samples/a1-bg" && pwd)"
mkdir -p "$dir/audio"
node --input-type=module -e '
import { readFileSync } from "node:fs"
const source = JSON.parse(readFileSync(process.argv[1], "utf8"))
for (const e of source.entries) if (e.audio.uk) console.log(`${e.audio.uk}\t${e.headword}`)
' "$dir/source.json" | while IFS=$'\t' read -r clip word; do
  out="$dir/audio/$clip.m4a"
  [ -f "$out" ] && continue
  # A bare single word sometimes makes the model run on into babble; a trailing comma
  # keeps it to the word. As a guard, a clip longer than 2 s is made again.
  for try in 1 2 3 4 5; do
    printf '%s,\n' "$word" | "$piper" -m "$voice" -f "$dir/audio/$clip.wav"
    [ -s "$dir/audio/$clip.wav" ] || { echo "piper wrote no audio for $clip" >&2; exit 1; }
    secs="$(afinfo "$dir/audio/$clip.wav" | awk '/estimated duration/ { print $3 }')"
    awk -v s="$secs" 'BEGIN { exit !(s < 2) }' && break
    [ "$try" = 5 ] && { echo "$clip is still $secs s long after 5 tries" >&2; exit 1; }
  done
  afconvert -f m4af -d aac -c 1 -b 48000 "$dir/audio/$clip.wav" "$out"
  rm "$dir/audio/$clip.wav"
  echo "$clip"
done
