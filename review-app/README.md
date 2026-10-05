# Review app

A local web app for deciding the rows `corpus ai-review` flags (spec
`docs/superpowers/specs/2026-10-04-ai-review-and-review-app-design.md`).

    pnpm --filter @wordado/review-app review "$PWD/content"

builds the UI, starts a server on 127.0.0.1 and opens the browser. It needs a content checkout whose
`pipeline.json` has an `ai_review` block, review files (`corpus queues`) and verdicts (`corpus ai-review`).

- Pick a queue. Learner-reported rows come first, then major and minor objections; "show unflagged" adds the rest.
- **Accept fix (1)** writes the ticked fixes, **Keep (2)** marks the row ok, **Edit (3)** lets you change the cells,
  **Drop (4)** (translations only) drops the sense, **S** skips. Every decision is written into the review CSV at once.
- **Import decisions** runs `corpus import` under your name. Then commit and push the content repository as usual.
- If a file changed on disk (a new draft, a spreadsheet save), the app reloads instead of overwriting it.

Your name is kept in `~/.config/wordado/review-app.json`. Nothing leaves your machine.
