# Sample content

`a1-bg/` is a small hand-made A1 English–Bulgarian sample pack: 60 entries with their
translations, example sentences, units, themes and audio. Wordado's demo mode studies it, and
every test suite uses it.

## Terms

This content is **not** covered by the repository's MIT licence, which applies to the code
only.

Copyright © 2026 Yordan Mihaylov. All rights reserved. You may use it to build, run and test
this software, for example in a local development setup or a fork's test suite. You may not
redistribute it, or use it in another product, without permission.

## Audio

The 60 clips in `a1-bg/audio/` (one British English pronunciation per headword, AAC in m4a,
mono, 48 kbit/s) are made by [`pipeline/scripts/tts-audio.sh`](../scripts/tts-audio.sh) with:

- **Engine:** [Piper](https://github.com/OHF-Voice/piper1-gpl), the `piper-tts` 1.8.0 Python
  package, which is GPL-3.0-or-later. The GPL covers the program, not the audio it produces
  (see the GNU project's [FAQ](https://www.gnu.org/licenses/gpl-faq.html#GPLOutput)).
- **Voice:** `en_GB-cori-high` ("Cori", UK English, female, high quality) by Bryce Beattie,
  from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/cori/high).
  Its [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/cori/high/MODEL_CARD)
  and its [author's page](https://brycebeattie.com/files/tts/) give its licence as **public
  domain**. It was trained from scratch, not fine-tuned from another voice, on recordings
  from [LibriVox](https://librivox.org/pages/public-domain/), which are in the public domain.

Neither the voice nor its training data places conditions on the audio made with it, so no
attribution is required; we credit Bryce Beattie and LibriVox as a courtesy. The Terms above
apply to the clips as part of this content, to the extent that anyone holds rights in them.

The clips are placeholders: they are below the audio quality bar of the spec (§5.4) and are
replaced by plan 8's TTS pipeline. Piper's output varies from run to run, so rerunning the
script gives similar but not identical clips. The committed clips were checked with a speech
recogniser (Whisper), and clips it misheard were made again.
