# Wordado

**[wordado.com](https://wordado.com)** · **[Open the app](https://app.wordado.com)**

Learn English words, a few minutes a day, online or off. An installable web app (PWA) with
spaced repetition (FSRS), a level path, and sync across devices. For speakers of Bulgarian, German and
Spanish: every word comes with its translation, pronunciation and an example sentence.

<p>
  <img src="https://wordado.com/screens/en/today.webp" width="260" alt="The Study screen of the app: the number of new words for today, the button “Start studying” and the ways to study one way.">
  <img src="https://wordado.com/screens/en/flashcard.webp" width="260" alt="A flashcard in the app: the English word, its pronunciation, its translation and an example sentence, with the buttons Again, Hard, Good and Easy.">
</p>

## Packages

| Package | What it is |
|---|---|
| `core` | The learning rules: scheduling, sessions, streaks, XP, sync reconciliation. Pure TypeScript. |
| `client-data` | The client's local database, outbox and sync engine, over a SQL driver. |
| `web` | The web app: Vite + React, SQLite in a Worker (OPFS, then IndexedDB). |
| `server` | The API: Hono on Cloudflare Workers, Postgres through Hyperdrive. |
| `pipeline` | Builds the corpus: frequency data to reviewed, published packs (`pipeline/README.md`). |
| `review-app` | Where reviewers check the corpus and the coordinator reads feedback: React, with a Worker of its own (`review-app/README.md`). |

## Run it

Needs Node 24, pnpm 12 and Docker.

```bash
pnpm install
pnpm test                               # every package
pnpm --filter @wordado/server dev       # the API on :8787, with Postgres in Docker
pnpm --filter @wordado/web dev          # the app on http://localhost:5173
```

Building a feature, step by step: `docs/development.md`. More in each package's README, and deployment in
`docs/deploy.md`.

## Problems and contributions

- **A bug or an idea:** open an [issue](https://github.com/wordado/wordado/issues). A wrong word, translation or
  sentence is best reported from the app itself (the ⋯ menu on a card, “Report this word”), so it reaches the
  people who review the content.
- **A security problem:** do not open an issue; write to hello@wordado.com (`SECURITY.md`).
- **Pull requests** are not taken for now. An issue that describes the problem is the most useful thing to send.

## Licence

The **code** in this repository is licensed under the MIT licence (`LICENSE`).

The **content** is not: the word lists, translations, example sentences and audio under
`pipeline/samples/` are not covered by the MIT licence. See
[`pipeline/samples/README.md`](pipeline/samples/README.md) for their terms. The same applies
to the corpus packs and audio that Wordado serves to learners. The corpus's sources and review history
live in a private repository.
