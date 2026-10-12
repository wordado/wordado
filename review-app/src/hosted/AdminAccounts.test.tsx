import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountDetails, AccountFound, AccountSeries, AccountSeriesView, AccountSplits, AccountSplitsView, AccountStats, AccountStatsView, AccountSweep, AccountSweepView } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { utcDay } from './AccountCharts'
import { AdminAccounts, dayWithYear, reminderTime } from './AdminAccounts'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const CREATED = Date.parse('2026-01-05T09:00:00Z')
const SIGNED_IN = Date.parse('2026-09-30T18:00:00Z')
const sweep = (over: Partial<AccountSweep> = {}): AccountSweep => ({ months: 24, batch: 50, due: 0, undated: 0, taken: 0, lastRunAt: null, lastTaken: 0, ...over })
const READ = Date.parse('2026-10-11T08:30:00Z')
const stats = (over: Partial<AccountStats> = {}): AccountStats => ({ readAt: READ, accounts: 0, made7: 0, made30: 0, studied7: 0, studied30: 0, newsGiven: 0, newsWithdrawn: 0, newsNone: 0, reminders: 0, ...over })
const STUDIED = Date.parse('2026-10-10T19:00:00Z')
const AGREED = Date.parse('2026-09-03T08:00:00Z')
const NOT_BEFORE = Date.parse('2028-10-01T18:00:00Z')
const details = (over: Partial<AccountDetails> = {}): AccountDetails => ({ lastStudiedAt: null, daysStudied30: 0, newsConsent: 'none', newsConsentAt: null, newsConsentLanguage: null, reminders: [], devices: 0, sweepNotBefore: null, ...over })
const found: AccountFound = { found: true, createdAt: CREATED, lastSignInAt: SIGNED_IN, details: details() }
const DAY = 86_400_000
/** A Monday and the Wednesday in its week, 00:00 UTC. */
const WEEK_START = Date.parse('2026-10-05T00:00:00Z')
const DAY_START = Date.parse('2026-10-07T00:00:00Z')
/** 26 weeks, the last three 4, 7 and 2; 90 days, the last three 5, 9 and 3. */
const series = (over: Partial<AccountSeries> = {}): AccountSeries => ({
  readAt: READ, accounts: 100, weekStart: WEEK_START, madeByWeek: [...Array.from({ length: 23 }, () => 1), 4, 7, 2], dayStart: DAY_START, studiedByDay: [...Array.from({ length: 87 }, () => 6), 5, 9, 3], ...over,
})
const splits = (over: Partial<AccountSplits> = {}): AccountSplits => ({
  readAt: READ,
  news: [{ language: 'bg', given: 6, withdrawn: 1, none: 40 }, { language: 'de', given: 9, withdrawn: 0, none: 60 }, { language: null, given: 0, withdrawn: 0, none: 80 }],
  reminders: [{ language: 'bg', sending: 5, paused: 2 }],
  ...over,
})

interface Behind { series?: AccountSeriesView | Error; splits?: AccountSplitsView | Error }

function shown(first: AccountSweepView | Error = { connected: true, sweep: sweep() }, account: AccountFound | Error = found, counts: AccountStatsView | Error = { connected: true, stats: stats() }, behind: Behind = {}) {
  const read = vi.spyOn(hostedApi.admin, 'accountSweep')
  if (first instanceof Error) read.mockRejectedValue(first)
  else read.mockResolvedValue(first)
  const counted = vi.spyOn(hostedApi.admin, 'accountStats')
  if (counts instanceof Error) counted.mockRejectedValue(counts)
  else counted.mockResolvedValue(counts)
  const { series: byTime = { connected: true, series: series() }, splits: byLanguage = { connected: true, splits: splits() } } = behind
  const readSeries = vi.spyOn(hostedApi.admin, 'accountSeries')
  if (byTime instanceof Error) readSeries.mockRejectedValue(byTime)
  else readSeries.mockResolvedValue(byTime)
  const readSplits = vi.spyOn(hostedApi.admin, 'accountSplits')
  if (byLanguage instanceof Error) readSplits.mockRejectedValue(byLanguage)
  else readSplits.mockResolvedValue(byLanguage)
  const lookUp = vi.spyOn(hostedApi.admin, 'lookUpAccount')
  if (account instanceof Error) lookUp.mockRejectedValue(account)
  else lookUp.mockResolvedValue(account)
  const del = vi.spyOn(hostedApi.admin, 'deleteAccount').mockResolvedValue({ deleted: true })
  render(<AdminAccounts />)
  return { read, counted, readSeries, readSplits, lookUp, del }
}

/** Presses the count whose words are `what`. */
const press = async (what: string | RegExp) => fireEvent.click(await screen.findByRole('button', { name: what }))
const pressed = () => within(screen.getByRole('list', { name: 'Accounts and their use' })).getAllByRole('button', { pressed: true }).map((b) => b.textContent)
/** The rows of the table under a chart, as "label value". */
const numbers = (panel: HTMLElement) => within(within(panel).getByRole('table')).getAllByRole('row').slice(1).map((row) => [...row.children].map((c) => c.textContent).join(' '))
/** What the account card says, as "name: value". */
const facts = (account: HTMLElement) => [...account.querySelectorAll('dl > div')].map((div) => `${div.querySelector('dt')!.textContent}: ${[...div.querySelectorAll('dd')].map((dd) => dd.textContent).join(' | ')}`)

const tiles = async () => within(await screen.findByRole('list', { name: 'The sweep of inactive accounts' })).getAllByRole('listitem').map((li) => li.textContent)
const counts = async () => within(await screen.findByRole('list', { name: 'Accounts and their use' })).getAllByRole('listitem').map((li) => li.textContent)
const lookUpForm = () => screen.findByRole('form', { name: 'Look an account up' })
async function lookUp(email: string) {
  const form = await lookUpForm()
  fireEvent.change(within(form).getByLabelText('Email address'), { target: { value: email } })
  fireEvent.click(within(form).getByRole('button', { name: 'Look up' }))
}
/** Looks the account up and opens the question; gives the dialog. */
async function asking(email = 'ana@example.com') {
  await lookUp(email)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete this account…' }))
  return screen.getByRole('dialog', { name: 'Delete this account?' })
}

describe('AdminAccounts: the Accounts tab (#187)', () => {
  it('shows how many accounts there are and how many are used, with when that was counted (#206)', async () => {
    shown(undefined, undefined, { connected: true, stats: stats({ accounts: 1204, made7: 4, made30: 31, studied7: 40, studied30: 75, newsGiven: 50, newsWithdrawn: 3, newsNone: 1151, reminders: 22 }) })
    expect(await counts()).toEqual([
      '1,204accounts',
      '4made in the last 7 days',
      '31made in the last 30 days',
      '22with reminders on',
      '40studied in the last 7 days',
      '75studied in the last 30 days',
      '50agreed to news',
      '3withdrew from news',
    ])
    expect(screen.getByText(`An account studied when it has at least one answer in that time. 1,151 accounts have said nothing about news yet. Counted ${new Date(READ).toLocaleString()}.`)).toBeTruthy()
    // Above the sweep, which is above the lookup.
    const order = [screen.getByRole('list', { name: 'Accounts and their use' }), screen.getByRole('list', { name: 'The sweep of inactive accounts' }), await lookUpForm()]
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('counts nothing as nothing, and one account as one', async () => {
    shown(undefined, undefined, { connected: true, stats: stats({ accounts: 1, newsNone: 1 }) })
    expect(await counts()).toEqual(['1account', '0made in the last 7 days', '0made in the last 30 days', '0with reminders on', '0studied in the last 7 days', '0studied in the last 30 days', '0agreed to news', '0withdrew from news'])
    expect(screen.getByText(/1 account has said nothing about news yet\./)).toBeTruthy()
  })

  it('says the counts of accounts could not be read, and reads them again when asked; the rest of the tab is there all the same', async () => {
    const { counted } = shown(undefined, undefined, new Error('The app’s server could not be reached.'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The counts of accounts could not be read. The app’s server could not be reached.')
    expect(screen.queryByRole('list', { name: 'Accounts and their use' })).toBeNull()
    expect(await tiles()).toHaveLength(4)
    expect(await lookUpForm()).toBeTruthy()
    counted.mockResolvedValue({ connected: true, stats: stats({ accounts: 7 }) })
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect((await counts())[0]).toBe('7accounts')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows what the sweep would take next and what it took', async () => {
    shown({ connected: true, sweep: sweep({ due: 70, taken: 12, lastRunAt: SIGNED_IN, lastTaken: 2 }) })
    expect(await tiles()).toEqual(['70past 24 months now', '50the next run deletes', '2deleted by the last run', '12deleted so far'])
    expect(screen.getByText(`An account not signed in to for 24 months is deleted, at most 50 a day, with no mail first. Last run: ${dayWithYear(SIGNED_IN)}.`)).toBeTruthy()
    expect(screen.queryByText(/no date of a last sign-in/)).toBeNull()
  })

  it('says so while the sweep has not run, and counts the accounts it never takes', async () => {
    shown({ connected: true, sweep: sweep({ due: 3, undated: 1 }) })
    expect(await tiles()).toEqual(['3past 24 months now', '3the next run deletes', '0deleted by the last run', '0deleted so far'])
    expect(screen.getByText(/It has not run yet\.$/)).toBeTruthy()
    expect(screen.getByText('1 account has no date of a last sign-in: the sweep never takes it.')).toBeTruthy()
  })

  it('says it is not connected, and offers nothing to do', async () => {
    shown({ connected: false })
    expect(await screen.findByText(/Accounts are not connected/)).toBeTruthy()
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('says the counts could not be read, and reads them again when asked; the lookup is there all the same', async () => {
    const { read } = shown(new Error('The app’s server could not be reached.'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The sweep’s counts could not be read. The app’s server could not be reached.')
    read.mockResolvedValue({ connected: true, sweep: sweep({ due: 1 }) })
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect((await tiles())[0]).toBe('1past 24 months now')
    expect(await lookUpForm()).toBeTruthy()
  })

  it('looks an account up by the whole address: when it was made and last signed in, and how it is used (#209)', async () => {
    const used = details({
      lastStudiedAt: STUDIED, daysStudied30: 19, language: 'en', newsConsent: 'given', newsConsentAt: AGREED, newsConsentLanguage: 'bg',
      reminders: [{ minute: 1170, tzOffsetMin: 180, paused: false }, { minute: 480, tzOffsetMin: -300, paused: true }], devices: 2, sweepNotBefore: NOT_BEFORE,
    })
    const { lookUp: asked } = shown(undefined, { found: true, createdAt: CREATED, lastSignInAt: SIGNED_IN, details: used })
    await lookUp('  ana@example.com ')
    const account = await screen.findByRole('region', { name: 'The account' })
    expect(asked).toHaveBeenCalledWith('ana@example.com')
    expect(within(account).getByRole('heading', { name: 'ana@example.com' })).toBeTruthy()
    expect(facts(account)).toEqual([
      `Created: ${dayWithYear(CREATED)}`,
      `Last sign-in: ${dayWithYear(SIGNED_IN)}`,
      `Last studied: ${dayWithYear(STUDIED)}`,
      'Days studied, last 30: 19',
      'Language: English',
      `News by email: Agreed ${dayWithYear(AGREED)}, in Bulgarian`,
      'Reminders: On 19:30 (UTC+3) | Paused 08:00 (UTC−5)',
      'Devices: 2',
      `Deleted for inactivity: not before ${new Date(NOT_BEFORE).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`,
    ])
    expect(within(account).getByText('Shown only for an address typed in whole. Nothing of it is kept here.')).toBeTruthy()
    expect(within(account).getByRole('button', { name: 'Delete this account…' })).toBeTruthy()
  })

  it('says so when no account has the address, and what an account that is not used has', async () => {
    const { lookUp: asked } = shown(undefined, { found: false })
    await lookUp('nobody@example.com')
    expect(await screen.findByText('No account has the address nobody@example.com.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete this account…' })).toBeNull()
    asked.mockResolvedValue({ found: true, createdAt: CREATED, lastSignInAt: null, details: details() })
    await lookUp('ben@example.com')
    expect(facts(await screen.findByRole('region', { name: 'The account' }))).toEqual([
      `Created: ${dayWithYear(CREATED)}`,
      'Last sign-in: not recorded',
      'Last studied: never',
      'Days studied, last 30: 0',
      'News by email: Said nothing',
      'Reminders: Off',
      'Devices: 0',
      'Deleted for inactivity: never: it has no date of a last sign-in',
    ])
  })

  it('says a consent that was withdrawn, and one in a language the server does not know', async () => {
    const { lookUp: asked } = shown(undefined, { found: true, createdAt: CREATED, lastSignInAt: SIGNED_IN, details: details({ newsConsent: 'withdrawn', newsConsentAt: AGREED, newsConsentLanguage: 'de' }) })
    await lookUp('ana@example.com')
    expect(facts(await screen.findByRole('region', { name: 'The account' }))[4]).toBe(`News by email: Withdrew ${dayWithYear(AGREED)}, had agreed in German`)
    asked.mockResolvedValue({ found: true, createdAt: CREATED, lastSignInAt: SIGNED_IN, details: details({ newsConsent: 'given', newsConsentAt: AGREED }) })
    await lookUp('ben@example.com')
    await waitFor(() => expect(facts(screen.getByRole('region', { name: 'The account' }))[4]).toBe(`News by email: Agreed ${dayWithYear(AGREED)}`))
  })

  it('says an account’s language is not known, and nothing of it when the app’s server is from before it said one (#199)', async () => {
    const { lookUp: asked } = shown(undefined, { found: true, createdAt: CREATED, lastSignInAt: SIGNED_IN, details: details({ language: null }) })
    await lookUp('ana@example.com')
    expect(facts(await screen.findByRole('region', { name: 'The account' }))[4]).toBe('Language: not known: written to in English')
    asked.mockResolvedValue({ found: true, createdAt: CREATED, lastSignInAt: SIGNED_IN, details: details() })
    await lookUp('ben@example.com')
    await waitFor(() => expect(facts(screen.getByRole('region', { name: 'The account' }))[4]).toBe('News by email: Said nothing'))
  })

  it('shows the two dates and says so when the app’s server is from before it said more: the account can still be deleted', async () => {
    shown(undefined, { found: true, createdAt: CREATED, lastSignInAt: SIGNED_IN, details: null })
    await lookUp('ana@example.com')
    const account = await screen.findByRole('region', { name: 'The account' })
    expect(facts(account)).toEqual([`Created: ${dayWithYear(CREATED)}`, `Last sign-in: ${dayWithYear(SIGNED_IN)}`])
    expect(within(account).getByText('The app’s server says no more of an account: it is from before it did. Deploy it too.')).toBeTruthy()
    expect(within(account).getByRole('button', { name: 'Delete this account…' })).toBeTruthy()
  })

  it('writes a reminder’s time with its offset from UTC', () => {
    expect(reminderTime(0, 0)).toBe('00:00 (UTC)')
    expect(reminderTime(1170, 180)).toBe('19:30 (UTC+3)')
    expect(reminderTime(545, -300)).toBe('09:05 (UTC−5)')
    expect(reminderTime(1439, 330)).toBe('23:59 (UTC+5:30)')
    expect(reminderTime(60, -210)).toBe('01:00 (UTC−3:30)')
  })

  it('forgets the account when the address in the field changes: what is deleted is what was looked up', async () => {
    shown()
    await lookUp('ana@example.com')
    await screen.findByRole('region', { name: 'The account' })
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ana@example.co' } })
    expect(screen.queryByRole('region', { name: 'The account' })).toBeNull()
  })

  it('deletes only after the question is answered with the address typed again', async () => {
    const { del, read, counted } = shown()
    const dialog = await asking()
    expect(within(dialog).getByText(`Created ${dayWithYear(CREATED)} · last sign-in ${dayWithYear(SIGNED_IN)}`)).toBeTruthy()
    const button = within(dialog).getByRole('button', { name: 'Delete the account' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    const again = within(dialog).getByLabelText('Type the address again to delete the account')
    fireEvent.change(again, { target: { value: 'ana@example.co' } })
    expect(button.disabled).toBe(true)
    fireEvent.submit(again.closest('form')!)
    expect(del).not.toHaveBeenCalled()
    fireEvent.change(again, { target: { value: ' Ana@Example.com' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(del).toHaveBeenCalledWith('ana@example.com'))
    expect(await screen.findByText('The account of ana@example.com was deleted.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('region', { name: 'The account' })).toBeNull()
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('')
    // The counts are read again.
    expect(read).toHaveBeenCalledTimes(2)
    expect(counted).toHaveBeenCalledTimes(2)
  })

  it('deletes nothing when the question is closed', async () => {
    const { del } = shown()
    const dialog = await asking()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(del).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'The account' })).toBeTruthy()
  })

  it('says in the dialog what went wrong, and when the account was already gone', async () => {
    const { del } = shown()
    del.mockRejectedValueOnce(new Error('The app’s server could not be reached.'))
    const dialog = await asking()
    fireEvent.change(within(dialog).getByLabelText('Type the address again to delete the account'), { target: { value: 'ana@example.com' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the account' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('The app’s server could not be reached.')
    del.mockResolvedValueOnce({ deleted: false })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the account' }))
    expect(await screen.findByText('No account had the address ana@example.com any more: nothing was deleted.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says why an account could not be looked up', async () => {
    shown(undefined, new Error('The app’s server answered 404. Check that ADMIN_WRITE_TOKEN is the same in both deployments.'))
    await lookUp('ana@example.com')
    expect((await screen.findByRole('alert')).textContent).toContain('ADMIN_WRITE_TOKEN is the same in both deployments')
  })
})

describe('AdminAccounts: what is behind the counts (#209)', () => {
  const counted: AccountStatsView = { connected: true, stats: stats({ accounts: 100, made7: 2, made30: 14, studied7: 9, studied30: 20, newsGiven: 15, newsWithdrawn: 1, newsNone: 84, reminders: 7 }) }
  const panelOf = (name: string) => screen.findByRole('region', { name })

  it('makes each count a button, one of them pressed, and shows under them what the pressed one is about', async () => {
    const { readSeries, readSplits } = shown(undefined, undefined, counted)
    const panel = await panelOf('Accounts that studied, per day')
    expect(pressed()).toEqual(['20studied in the last 30 days'])
    expect(within(screen.getByRole('list', { name: 'Accounts and their use' })).getAllByRole('button')).toHaveLength(8)
    expect(within(panel).getByText(/An account counts on a day when it gave at least one answer\. Days are UTC days/)).toBeTruthy()
    // The chart is one picture with its range in words, and every number is in the table under it.
    const chart = await within(panel).findByRole('img')
    expect(chart.getAttribute('aria-label')).toBe(`Accounts that studied, per day, 90 days, ${utcDay(DAY_START - 89 * DAY)} to ${utcDay(DAY_START)}: between 3 and 9, 3 at the end. The numbers are in the table below.`)
    expect(numbers(panel)).toHaveLength(90)
    expect(numbers(panel).slice(-3)).toEqual([`${utcDay(DAY_START - 2 * DAY)} 5`, `${utcDay(DAY_START - DAY)} 9`, `${utcDay(DAY_START)} 3`])
    // The other period, from the same numbers: nothing is read again.
    const period = within(panel).getByRole('group', { name: 'Period' })
    expect(within(period).getByRole('button', { pressed: true }).textContent).toBe('90 days')
    fireEvent.click(within(period).getByRole('button', { name: '30 days' }))
    expect(numbers(panel)).toHaveLength(30)
    expect(numbers(panel)[0]).toBe(`${utcDay(DAY_START - 29 * DAY)} 6`)
    expect(within(panel).getByRole('img').getAttribute('aria-label')).toContain('per day, 30 days')
    expect(readSeries).toHaveBeenCalledTimes(1)
    expect(readSplits).not.toHaveBeenCalled()
  })

  it('shows the new accounts by week, 12 weeks or 26, and the accounts in total over 26', async () => {
    const { readSeries } = shown(undefined, undefined, counted)
    await press(/made in the last 7 days$/)
    expect(pressed()).toEqual(['2made in the last 7 days'])
    const made = await panelOf('New accounts per week')
    expect(numbers(made)).toHaveLength(12)
    expect(numbers(made).slice(-3)).toEqual([`${utcDay(WEEK_START - 14 * DAY)} 4`, `${utcDay(WEEK_START - 7 * DAY)} 7`, `${utcDay(WEEK_START)} 2`])
    expect(within(made).getByText(/the paler bar is the week so far/)).toBeTruthy()
    fireEvent.click(within(made).getByRole('button', { name: '26 weeks' }))
    expect(numbers(made)).toHaveLength(26)
    // The other count of new accounts opens the same view, as it was left.
    await press(/made in the last 30 days$/)
    expect(pressed()).toEqual(['14made in the last 30 days'])
    expect(numbers(await panelOf('New accounts per week'))).toHaveLength(26)
    // In total: today's count at the end, and each week before it less the accounts made since.
    await press(/^100\s*accounts$/)
    const total = await panelOf('Accounts in total')
    expect(within(total).queryByRole('group', { name: 'Period' })).toBeNull()
    expect(numbers(total)).toHaveLength(26)
    expect(numbers(total).slice(-3)).toEqual([`${utcDay(WEEK_START - 14 * DAY)} 91`, `${utcDay(WEEK_START - 7 * DAY)} 98`, `${utcDay(WEEK_START)} 100`])
    expect(numbers(total)[0]).toBe(`${utcDay(WEEK_START - 25 * 7 * DAY)} 65`)
    expect(within(total).getByText(/A deleted account leaves the earlier weeks too/)).toBeTruthy()
    expect(readSeries).toHaveBeenCalledTimes(1)
  })

  it('splits news and reminders by language, in words: the largest language first, the one not known last', async () => {
    const { readSplits } = shown(undefined, undefined, counted)
    expect(readSplits).not.toHaveBeenCalled()
    await press(/agreed to news$/)
    const news = await panelOf('News by email, by language')
    const rows = async (panel: HTMLElement) => within(await within(panel).findByRole('list')).getAllByRole('listitem').map((li) => [...li.querySelectorAll('.split-name, .split-total, .split-part')].map((el) => el.textContent).join(' / '))
    expect(await rows(news)).toEqual(['German / 69 / 9 agreed / 0 withdrew / 60 said nothing', 'Bulgarian / 47 / 6 agreed / 1 withdrew / 40 said nothing', 'Not known / 80 / 0 agreed / 0 withdrew / 80 said nothing'])
    expect(within(news).queryByRole('img')).toBeNull()
    await press(/withdrew from news$/)
    expect(pressed()).toEqual(['1withdrew from news'])
    expect(await rows(await panelOf('News by email, by language'))).toHaveLength(3)
    await press(/with reminders on$/)
    const reminders = await panelOf('Reminders, by language')
    expect(await rows(reminders)).toEqual(['Bulgarian / 7 / 5 sending / 2 paused'])
    expect(within(reminders).getByText(/The count above has these as on\./)).toBeTruthy()
    expect(readSplits).toHaveBeenCalledTimes(1)
  })

  it('says so when a split has no accounts', async () => {
    shown(undefined, undefined, counted, { splits: { connected: true, splits: splits({ reminders: [] }) } })
    await press(/with reminders on$/)
    expect(await within(await panelOf('Reminders, by language')).findByText('No accounts to count here yet.')).toBeTruthy()
  })

  it('says in the panel that its numbers could not be read, as from a server that has none yet; the counts, the sweep and the lookup work all the same', async () => {
    const older = new Error('The app’s server answered 404. It may be from before it had these numbers: deploy it too.')
    const { readSeries } = shown(undefined, undefined, counted, { series: older, splits: older })
    const panel = await panelOf('Accounts that studied, per day')
    const alert = await within(panel).findByRole('alert')
    expect(alert.textContent).toContain('These numbers could not be read. The app’s server answered 404. It may be from before it had these numbers: deploy it too.')
    expect(within(panel).queryByRole('img')).toBeNull()
    expect(await counts()).toHaveLength(8)
    expect(await tiles()).toHaveLength(4)
    await lookUp('ana@example.com')
    expect(await screen.findByRole('region', { name: 'The account' })).toBeTruthy()
    // The other kind of numbers fails by itself, in its own words.
    await press(/agreed to news$/)
    expect((await within(await panelOf('News by email, by language')).findByRole('alert')).textContent).toContain('These numbers could not be read.')
    // Asked again, they are read.
    await press(/studied in the last 7 days$/)
    readSeries.mockResolvedValue({ connected: true, series: series() })
    fireEvent.click(within(await within(await panelOf('Accounts that studied, per day')).findByRole('alert')).getByRole('button', { name: 'Try again' }))
    expect(await within(await panelOf('Accounts that studied, per day')).findByRole('img')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows no panel while the counts themselves cannot be read', async () => {
    const { readSeries } = shown(undefined, undefined, new Error('The app’s server could not be reached.'))
    await screen.findByRole('alert')
    expect(screen.queryByRole('region', { name: 'Accounts that studied, per day' })).toBeNull()
    expect(readSeries).not.toHaveBeenCalled()
  })

  it('reads what is behind the counts again after an account is deleted', async () => {
    const { readSeries } = shown(undefined, undefined, counted)
    await within(await panelOf('Accounts that studied, per day')).findByRole('img')
    const dialog = await asking()
    fireEvent.change(within(dialog).getByLabelText('Type the address again to delete the account'), { target: { value: 'ana@example.com' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the account' }))
    await screen.findByText('The account of ana@example.com was deleted.')
    await waitFor(() => expect(readSeries).toHaveBeenCalledTimes(2))
  })
})
