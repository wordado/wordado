import { act, fireEvent } from '@testing-library/react'
import type { ObjectionView, RowView } from '../server/types'

/** Rows for the component tests: "bank", edge of river, as the mockups show it. */
export const objection = (over: Partial<ObjectionView> = {}): ObjectionView => ({
  reviewer: 'flash', model: 'google/gemini-3.8-flash', field: 'translation', category: 'wrong-sense', severity: 'major', reason: 'банка is the money sense', fix: 'бряг', ...over,
})

export const bank: RowView = {
  queue: 'translation-bg', file: 'review/translation-bg/2026-10-04-01.csv', version: 'v', key: 'bank-2', kind: 'translation',
  cells: { translation: 'банка', alternates: '', sense: 'край на река' }, fields: ['translation', 'alternates', 'sense'],
  context: { headword: 'bank', pos: 'noun', sense_en: 'edge of river', level: 'A2', example: 'We sat on the bank and watched the boats.' },
  otherSenses: [{ key: 'bank-1', translation: 'банка', sense_en: 'financial institution' }], reports: '', ai: 'flagged', severity: 'major',
  objections: [objection()],
  decided: null, stale: false, rowHash: 'h',
}

/** Two objections on the translation and one on the sense. */
export const bankThree: RowView = {
  ...bank,
  objections: [
    objection(),
    objection({ reviewer: 'bggpt', model: 'bggpt-gemma-3-27b', reason: 'a shore, not a jar', fix: 'крайбрежие' }),
    objection({ field: 'sense', category: 'sense-unclear', severity: 'minor', reason: 'say which edge', fix: 'бряг на река' }),
  ],
}

/** One objection on the translation and one on the sense. */
export const bankTwoFields: RowView = { ...bank, objections: [bankThree.objections[0]!, bankThree.objections[2]!] }

export const bankClean: RowView = { ...bank, ai: 'passed', severity: null, objections: [] }

/** Runs `run` as in a browser without `showModal` (a dialog is then shown by its `open` attribute). */
export function withoutShowModal(run: () => void): void {
  const proto = HTMLDialogElement.prototype as { showModal?: unknown }
  const original = proto.showModal
  proto.showModal = undefined
  try {
    run()
  } finally {
    proto.showModal = original
  }
}

/** Escape as a browser handles it while a modal dialog is open: the keydown, then the dialog closes itself and says
 * so with a `close` event (happy-dom leaves that part out). */
export function pressEscapeInDialog(): void {
  fireEvent.keyDown(window, { key: 'Escape' })
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
  if (!dialog) throw new Error('no dialog is open')
  act(() => dialog.close())
}
