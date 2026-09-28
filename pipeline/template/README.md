# Wordado content

The corpus of [Wordado](https://github.com/wordado/wordado): the licence register, frequency lists, LLM results,
the ID registry, review decisions, audio and the last published packs. The pipeline that reads and writes this
repository is `pipeline/` in the public repository; its README is the runbook.

## Terms

Copyright © 2026 Yordan Mihaylov. All rights reserved. This repository is private. Its content is not covered by
the public repository's MIT licence, and it may not be copied, redistributed or used in another product without
permission. Frequency lists in `sources/` stay under their own licences, recorded in `sources.json`.

## Reviewing

Open a file in `review/<queue>/` in Excel, Numbers or Google Sheets. For each row:

- If the proposal is right, write `ok` in **verdict**.
- If it is nearly right, correct the cells in place, then write `ok`. Lists (alternates, variants, examples) are
  separated by ` | `.
- If the entry should not be in the course at all, write `drop`.
- For audio, listen to the file named in **listen**, then write `ok` or `redo`.

Leave a row's verdict empty to decide later. Save as CSV (UTF-8) with the same name, commit, and open a pull
request. The pipeline imports it with `corpus import`.

Queues: `translation-bg` (every translation set and its sense gloss), `english` (IPA, spelling variants and example
sentences), `level` (a sample of CEFR levels, and every level the frequency band disagreed with), `title-bg` (unit
titles), and `audio` (a sample of every batch, and every clip made again).
