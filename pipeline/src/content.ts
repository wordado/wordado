import { join } from 'node:path'

/** Where everything lives inside a content directory, the private wordado-content repository (Decision 2). */
export function contentPaths(dir: string) {
  return {
    root: dir,
    config: join(dir, 'pipeline.json'),
    sources: join(dir, 'sources.json'),
    sourcesDir: join(dir, 'sources'),
    themes: join(dir, 'themes.json'),
    registry: join(dir, 'registry.json'),
    cacheDir: join(dir, 'cache'),
    cache: (stage: string) => join(dir, 'cache', `${stage}.jsonl`),
    draft: join(dir, 'work', 'draft.json'),
    reviewDir: join(dir, 'review'),
    queueDir: (queue: string) => join(dir, 'review', queue),
    decisionsDir: join(dir, 'decisions'),
    decisions: (queue: string) => join(dir, 'decisions', `${queue}.jsonl`),
    audioDir: join(dir, 'audio'),
    clip: (clipId: string) => join(dir, 'audio', `${clipId}.m4a`),
    audioRecords: join(dir, 'audio.jsonl'),
    lastPublished: join(dir, 'last-published'),
    essentials: join(dir, 'essentials.txt'),
    aiReviewDir: join(dir, 'ai-review'),
    aiReview: (queue: string) => join(dir, 'ai-review', `${queue}.jsonl`),
  }
}

export type ContentPaths = ReturnType<typeof contentPaths>
