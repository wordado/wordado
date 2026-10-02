# Sample content

`a1/` is a small hand-made A1 sample corpus: 60 entries with their example sentences, units,
themes and audio, translated into Bulgarian (`corpus-v0-bg.pack`), German
(`corpus-v0-de.pack`) and Spanish (`corpus-v0-es.pack`). Wordado's demo mode studies the
learner's L1 pack, and the test suites use all three.

## Terms

This content is **not** covered by the repository's MIT licence, which applies to the code
only.

Copyright © 2026 Yordan Mihaylov. All rights reserved. You may use it to build, run and test
this software, for example in a local development setup or a fork's test suite. You may not
redistribute it, or use it in another product, without permission.

## Audio

The 60 clips in `a1/audio/` (one British English pronunciation per headword, AAC in m4a,
mono, 48 kbit/s), shared by the three packs, are made by
[`pipeline/scripts/tts-audio.sh`](../scripts/tts-audio.sh) with:

- **Engine:** [Piper](https://github.com/OHF-Voice/piper1-gpl), the `piper-tts` 1.8.0 Python
  package, which is GPL-3.0-or-later. The GPL covers the program, not the audio it produces
  (see the GNU project's [FAQ](https://www.gnu.org/licenses/gpl-faq.html#GPLOutput)).
- **Voice:** `en_GB-cori-high` ("Cori", UK English, female, high quality) by Bryce Beattie,
  from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/cori/high).
  Its [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/cori/high/MODEL_CARD)
  and its [author's page](https://brycebeattie.com/files/tts/) give its licence as **public
  domain**. It was trained from scratch, not fine-tuned from another voice, on recordings
  from [LibriVox](https://librivox.org/pages/public-domain/). LibriVox states its recordings
  are in the public domain in the USA, and notes that this is not necessarily so in other
  countries.

Neither the voice nor its training data places conditions on the audio made with it, so no
attribution is required; we credit Bryce Beattie and LibriVox as a courtesy. The Terms above
apply to the clips as part of this content, to the extent that anyone holds rights in them.

The clips are placeholders: they are below the audio quality bar of the spec (§5.4) and are
replaced by plan 8's TTS pipeline. Piper's output varies from run to run, so rerunning the
script gives similar but not identical clips. The committed clips were checked with a speech
recogniser (Whisper), and clips it misheard were made again.
