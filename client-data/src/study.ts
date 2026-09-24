import {
  composeSession,
  computeUnlocks,
  corpusWordId,
  currentUnit,
  dueDay,
  entryClips,
  isLive,
  levelCompletion,
  localDay,
  masteryTier,
  MAX_NEW_WORD_LIMIT,
  parseWordId,
  pathNewWords,
  RETENTION_TARGETS,
  retentionRate,
  streakStatus,
  themeEntries,
  unitProgress,
  type AudioClip,
  type CefrLevel,
  type Corpus,
  type CorpusEntry,
  type DayCompleteInput,
  type LevelCompletion,
  type MasteryTier,
  type Mode,
  type PathContext,
  type SessionPlan,
  type Settings,
  type StreakStatus,
  type UnitProgress,
  type WordFlag,
  type WordId,
} from '@wordado/core'
import { allSummaries, provisionalXp, todayCounts, type Learner } from './learner'

/** Everything a study rule reads, captured once per call so every number agrees (roadmap contract). */
export interface StudyContext {
  readonly corpus: Corpus
  readonly learner: Learner
  readonly settings: Settings
  readonly flags: ReadonlyMap<WordId, WordFlag>
  /** The persisted grow-only unlock set. */
  readonly unlocked: ReadonlySet<string>
  readonly now: number
  readonly tzOffsetMin: number
}

export function today(ctx: StudyContext): number {
  return localDay(ctx.now, ctx.tzOffsetMin)
}

export function pathContext(ctx: StudyContext): PathContext {
  return {
    units: ctx.corpus.units,
    retired: ctx.corpus.retired,
    flags: ctx.flags,
    // A word has review state only after a scheduled review, which is what "introduced" means (spec §7.2).
    introduced: new Set(ctx.learner.states.keys()),
    declaredLevel: ctx.settings.declaredLevel,
    unlocked: ctx.unlocked,
  }
}

/** The session, from the same inputs the home screen shows (spec §7.4). */
export function sessionPlan(ctx: StudyContext): SessionPlan {
  const day = today(ctx)
  const counts = todayCounts(ctx.learner, day)
  const theme = ctx.settings.activeTheme
  return composeSession({
    now: ctx.now,
    today: day,
    states: ctx.learner.states,
    flags: ctx.flags,
    retention: RETENTION_TARGETS[ctx.settings.retention],
    newWordLimit: ctx.settings.newWordLimit,
    reviewCap: ctx.settings.reviewCap,
    reviewsDoneToday: counts.reviewsDone,
    newWordsDoneToday: counts.newWordsDone,
    personalNew: [],
    collectionNew: theme === null ? null : themeEntries(ctx.corpus, theme).map((e) => corpusWordId(e.entryId)),
    pathNew: pathNewWords(pathContext(ctx), MAX_NEW_WORD_LIMIT),
  })
}

/** What `isDayComplete` reads, after the latest answer (spec §8.4). */
export function dayCompleteInput(ctx: StudyContext, plan: SessionPlan): DayCompleteInput {
  const counts = todayCounts(ctx.learner, today(ctx))
  return {
    backlogTotal: plan.backlogTotal,
    reviewCap: ctx.settings.reviewCap,
    reviewsDoneToday: counts.reviewsDone,
    answeredToday: counts.answered,
    dailyGoal: ctx.settings.dailyGoal,
  }
}

/** Unit IDs the current state unlocks beyond the persisted set, in path order (spec §7.2). */
export function newUnlocks(ctx: StudyContext): string[] {
  return computeUnlocks(pathContext(ctx))
}

export interface ProgressView {
  /** The home screen's primary figure: today's reviews within the cap (spec §8.3). */
  readonly dueToday: number
  readonly backlogTotal: number
  readonly newWordsPaused: boolean
  /** Live corpus entries by tier; flagged words are neither counted nor mature (spec §7.4). */
  readonly tiers: Readonly<Record<MasteryTier, number>>
  readonly levels: Readonly<Partial<Record<CefrLevel, LevelCompletion>>>
  readonly units: ReadonlyMap<string, UnitProgress>
  readonly retention: number | null
  readonly streak: StreakStatus
  /** XP the server has not confirmed: provisional (spec §8.7). */
  readonly xpProvisional: number
}

export function progressView(ctx: StudyContext, plan: SessionPlan): ProgressView {
  const day = today(ctx)
  const visibility = { retired: ctx.corpus.retired, flags: ctx.flags, declaredLevel: ctx.settings.declaredLevel }
  const tiers: Record<MasteryTier, number> = { new: 0, learning: 0, young: 0, mature: 0 }
  for (const entry of ctx.corpus.entries.values()) {
    const wordId = corpusWordId(entry.entryId)
    if (!isLive(wordId, visibility)) continue
    tiers[masteryTier(ctx.learner.states.get(wordId))] += 1
  }
  const levels: Partial<Record<CefrLevel, LevelCompletion>> = {}
  for (const level of new Set(ctx.corpus.units.map((u) => u.level))) {
    levels[level] = levelCompletion(level, ctx.corpus.units, ctx.learner.states, visibility)
  }
  const units = new Map(ctx.corpus.units.map((u) => [u.unitId, unitProgress(u, ctx.learner.states, visibility)]))
  return {
    dueToday: plan.reviews.length,
    backlogTotal: plan.backlogTotal,
    newWordsPaused: plan.newWordsPaused,
    tiers,
    levels,
    units,
    retention: retentionRate(allSummaries(ctx.learner).values(), day),
    streak: streakStatus(ctx.learner.completeDays, day),
    xpProvisional: provisionalXp(ctx.learner).total,
  }
}

export function entryOf(corpus: Corpus, wordId: WordId): CorpusEntry | null {
  const { kind, key } = parseWordId(wordId)
  return kind === 'corpus' ? (corpus.entries.get(key) ?? null) : null
}

/**
 * The modes one item can run in right now (spec §7.5, §9.3): listening only
 * with audio on and a clip either cached or fetchable. Matching is a practice
 * game and is never a session mode.
 */
export function availableModes(ctx: StudyContext, wordId: WordId, cachedClips: ReadonlySet<string>, online: boolean): Set<Mode> {
  const modes = new Set<Mode>(['flashcard', 'multiple_choice'])
  const entry = entryOf(ctx.corpus, wordId)
  if (!entry || !ctx.settings.audio) return modes
  const clips = entryClips(ctx.corpus, entry)
  if (clips.length > 0 && (online || clips.some((c) => cachedClips.has(c.clipId)))) modes.add('listening_select')
  return modes
}

/** What the path screen draws (spec §7.2): every unit open to the learner, and where new words come from. */
export interface PathView {
  /** The persisted grow-only set plus what the rules unlock now, so the first unit shows before any answer. */
  readonly unlocked: ReadonlySet<string>
  /** Null once every live word on the path has been introduced. */
  readonly currentUnitId: string | null
}

export function pathView(ctx: StudyContext): PathView {
  const path = pathContext(ctx)
  return { unlocked: new Set([...ctx.unlocked, ...computeUnlocks(path)]), currentUnitId: currentUnit(path)?.unitId ?? null }
}

/** Days of upcoming reviews whose audio is fetched ahead (spec §9.3). Tuning (§15). */
export const AUDIO_PREFETCH_DAYS = 3

/**
 * The clips of the words the learner is about to meet (spec §9.3): today's
 * session, and every unflagged word due within the horizon. Each clip once.
 */
export function upcomingClips(ctx: StudyContext, plan: SessionPlan, horizonDays: number = AUDIO_PREFETCH_DAYS): AudioClip[] {
  const day = today(ctx)
  const retention = RETENTION_TARGETS[ctx.settings.retention]
  const words = new Set<WordId>([...plan.reviews, ...plan.newWords])
  for (const [wordId, state] of ctx.learner.states) {
    if (!ctx.flags.has(wordId) && dueDay(state, retention) <= day + horizonDays) words.add(wordId)
  }
  const clips = new Map<string, AudioClip>()
  for (const wordId of words) {
    const entry = entryOf(ctx.corpus, wordId)
    if (entry) for (const clip of entryClips(ctx.corpus, entry)) clips.set(clip.clipId, clip)
  }
  return [...clips.values()]
}
