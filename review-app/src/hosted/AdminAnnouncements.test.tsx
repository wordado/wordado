import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Announcement, AnnouncementPreview, AnnouncementsView } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { dayWithYear } from './AdminAccounts'
import { AdminAnnouncements } from './AdminAnnouncements'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const STARTED = Date.parse('2026-10-12T09:00:00Z')
const en = { subject: 'The terms change on 1 December', body: 'Hello,\n\nthe terms change.' }
const limits = { perDay: 50, sentToday: 4, batch: 20 }

const announcement = (over: Partial<Announcement> = {}): Announcement => ({
  id: 1, kind: 'service', texts: { en }, version: 1, testedVersion: null, status: 'draft', createdAt: STARTED,
  startedAt: null, stoppedAt: null, finishedAt: null, held: null, recipients: 0, sent: 0, failed: 0, skipped: 0, queued: 0,
  ...over,
})
const preview = (over: Partial<AnnouncementPreview> = {}): AnnouncementPreview => ({
  version: 1, kind: 'service', recipients: 3, byLanguage: { en: 2, bg: 1 },
  mails: [{ language: 'en', subject: en.subject, text: `${en.body}\n\n-- \nYou are receiving this notice because you have a Wordado account.` }],
  ...over,
})

/** The tab over a server that has `list`; what is saved, tested and sent is answered as the server would. */
function shown(list: readonly Announcement[] | AnnouncementsView | Error = []) {
  let current: readonly Announcement[] = Array.isArray(list) ? list : []
  const read = vi.spyOn(hostedApi.admin, 'announcements').mockImplementation(async () => {
    if (list instanceof Error) throw list
    return Array.isArray(list) ? { connected: true, announcements: current, limits } : (list as AnnouncementsView)
  })
  const put = (next: Announcement) => {
    current = current.some((a) => a.id === next.id) ? current.map((a) => (a.id === next.id ? next : a)) : [next, ...current]
    return next
  }
  const save = vi.spyOn(hostedApi.admin, 'saveAnnouncement').mockImplementation(async (draft) => {
    const old = current.find((a) => a.id === draft.id)
    return { announcement: put(announcement({ ...old, id: draft.id ?? 7, kind: draft.kind, texts: draft.texts as Announcement['texts'], version: (old?.version ?? 0) + 1 })) }
  })
  const test = vi.spyOn(hostedApi.admin, 'testAnnouncement').mockImplementation(async (id, version) => ({ announcement: put({ ...current.find((a) => a.id === id)!, testedVersion: version }), mails: 1 }))
  const look = vi.spyOn(hostedApi.admin, 'previewAnnouncement').mockImplementation(async (id) => {
    const a = current.find((x) => x.id === id)!
    return preview({ version: a.version, kind: a.kind })
  })
  const send = vi.spyOn(hostedApi.admin, 'sendAnnouncement').mockImplementation(async (c) => ({ announcement: put({ ...current.find((a) => a.id === c.id)!, status: 'sending', startedAt: STARTED, recipients: c.recipients, queued: c.recipients }) }))
  const stop = vi.spyOn(hostedApi.admin, 'stopAnnouncement').mockImplementation(async (id) => ({ announcement: put({ ...current.find((a) => a.id === id)!, status: 'stopped', stoppedAt: STARTED }) }))
  const resume = vi.spyOn(hostedApi.admin, 'resumeAnnouncement').mockImplementation(async (id) => ({ announcement: put({ ...current.find((a) => a.id === id)!, status: 'sending', stoppedAt: null }) }))
  const del = vi.spyOn(hostedApi.admin, 'deleteAnnouncement').mockImplementation(async (id) => ((current = current.filter((a) => a.id !== id)), { deleted: true }))
  render(<AdminAnnouncements />)
  return { read, save, test, look, send, stop, resume, del }
}

const rows = async () => within(await screen.findByRole('list', { name: 'Announcements' })).getAllByRole('listitem')
const form = () => screen.findByRole('form', { name: 'Announcement' })
const language = (name: string) => within(screen.getByRole('group', { name }))
/** Opens the one announcement of the list. */
async function open() {
  fireEvent.click(within((await rows())[0]!).getByRole('button', { name: 'Open' }))
  return form()
}

describe('AdminAnnouncements: the Announcements tab (#185)', () => {
  it('says it is not connected, and offers nothing to do', async () => {
    shown({ connected: false })
    expect(await screen.findByText(/Announcements are not connected/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says that the list could not be read, and reads it again when asked', async () => {
    const { read } = shown(new Error('The app’s server answered 500.'))
    expect((await screen.findByRole('alert')).textContent).toContain('The announcements could not be read. The app’s server answered 500.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  })

  it('lists what there is: the kind, the state, to how many it went and what holds it', async () => {
    shown([
      announcement({ id: 3, kind: 'news', texts: { en: { subject: 'New: search', body: 'b' } }, testedVersion: 1 }),
      announcement({ id: 2, status: 'sending', startedAt: STARTED, recipients: 120, sent: 40, queued: 77, failed: 1, skipped: 1, held: { reason: 'day', at: STARTED } }),
      announcement({ id: 1, status: 'sent', startedAt: STARTED, finishedAt: STARTED, recipients: 10, sent: 9, queued: 0 }),
    ])
    const [draft, sending, sent] = await rows()
    expect(draft!.textContent).toContain('New: search')
    expect(draft!.textContent).toContain('News')
    expect(draft!.textContent).toContain('Draft')
    expect(draft!.textContent).toContain('Version 1 · test sent')
    expect(sending!.textContent).toContain('Service notice')
    expect(sending!.textContent).toContain('40 of 120 sent · 77 waiting · 1 failed · 1 skipped (consent withdrawn) · 1 deleted before their turn')
    expect(sending!.textContent).toContain('Today’s allowance of announcement mails is used')
    expect(within(sending!).getByRole('button', { name: 'Stop sending' })).toBeTruthy()
    expect(sent!.textContent).toContain(`9 of 10 sent · 1 deleted before their turn`)
    expect(sent!.textContent).toContain(`Finished ${dayWithYear(STARTED)}`)
    expect(within(sent!).queryByRole('button', { name: 'Delete…' })).toBeNull()
    expect(screen.getByText(/At most 50 announcement mails go out a day \(4 so far today\), 20 every 15 minutes\./)).toBeTruthy()
  })

  it('writes a new announcement: the kind, English, and the other languages that have a text', async () => {
    const { save } = shown([])
    fireEvent.click(await screen.findByRole('button', { name: 'New announcement' }))
    const f = within(await form())
    // A service notice unless chosen otherwise.
    expect((f.getByRole('radio', { name: /^Service notice/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(f.getByRole('radio', { name: /^News/ }))
    fireEvent.change(language('English (needed)').getByLabelText('Subject'), { target: { value: 'New: search' } })
    fireEvent.change(language('English (needed)').getByLabelText('Text'), { target: { value: 'Find any word.' } })
    fireEvent.change(language('German').getByLabelText('Subject'), { target: { value: 'Neu: Suche' } })
    fireEvent.change(language('German').getByLabelText('Text'), { target: { value: 'Finde jedes Wort.' } })
    // Nothing can be tested or sent before it is saved.
    expect((f.getByRole('button', { name: 'Send test' }) as HTMLButtonElement).disabled).toBe(true)
    expect((f.getByRole('button', { name: 'Send…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(f.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: null, kind: 'news', texts: { en: { subject: 'New: search', body: 'Find any word.' }, de: { subject: 'Neu: Suche', body: 'Finde jedes Wort.' } } }))
    expect(await screen.findByText('Saved as version 1.')).toBeTruthy()
    // Saved again, it is the same announcement.
    fireEvent.change(language('English (needed)').getByLabelText('Text'), { target: { value: 'Find any word, fast.' } })
    fireEvent.click(f.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ id: 7 })))
  })

  it('shows what went wrong with a save, and keeps what was written', async () => {
    const { save } = shown([])
    save.mockRejectedValue(new Error('en: the subject must be one line of plain text'))
    fireEvent.click(await screen.findByRole('button', { name: 'New announcement' }))
    await form()
    fireEvent.change(language('English (needed)').getByLabelText('Subject'), { target: { value: 'Hello' } })
    fireEvent.change(language('English (needed)').getByLabelText('Text'), { target: { value: 'Text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect((await screen.findByRole('alert')).textContent).toContain('en: the subject must be one line of plain text')
    expect((language('English (needed)').getByLabelText('Subject') as HTMLInputElement).value).toBe('Hello')
  })

  it('previews the mails as they go, with how many accounts get which language', async () => {
    const { look } = shown([announcement()])
    const f = within(await open())
    fireEvent.click(f.getByRole('button', { name: 'Preview' }))
    const shownMail = await screen.findByRole('region', { name: 'Preview' })
    expect(look).toHaveBeenCalledWith(1)
    expect(shownMail.textContent).toContain('It would go to 3 accounts now: English 2, Bulgarian 1.')
    expect(shownMail.textContent).toContain(en.subject)
    expect(shownMail.textContent).toContain('You are receiving this notice because you have a Wordado account.')
  })

  it('lets a version be sent only after its test send, and not with changes that are not saved', async () => {
    const { test } = shown([announcement()])
    const f = within(await open())
    const sendButton = () => f.getByRole('button', { name: 'Send…' }) as HTMLButtonElement
    expect(sendButton().disabled).toBe(true)
    expect(f.getByText('This version has not been sent as a test yet.')).toBeTruthy()
    fireEvent.change(f.getByLabelText('Send a test to'), { target: { value: ' owner@example.com ' } })
    fireEvent.click(f.getByRole('button', { name: 'Send test' }))
    await waitFor(() => expect(test).toHaveBeenCalledWith(1, 1, 'owner@example.com'))
    expect(await f.findByText('The test of version 1 was sent: 1 mail. Read it before sending.')).toBeTruthy()
    await waitFor(() => expect(sendButton().disabled).toBe(false))
    // A change makes it another text than the one that was tested.
    fireEvent.change(language('English (needed)').getByLabelText('Text'), { target: { value: 'Another text.' } })
    expect(sendButton().disabled).toBe(true)
    expect((f.getByRole('button', { name: 'Send test' }) as HTMLButtonElement).disabled).toBe(true)
    expect(f.getByText('Save the changes first.')).toBeTruthy()
    fireEvent.click(f.getByRole('button', { name: 'Save draft' }))
    expect(await f.findByText('This version has not been sent as a test yet.')).toBeTruthy()
    expect(sendButton().disabled).toBe(true)
  })

  it('sends after a question that shows the kind and the count, answered by typing both', async () => {
    const { send, look } = shown([announcement({ testedVersion: 1 })])
    const f = within(await open())
    fireEvent.click(f.getByRole('button', { name: 'Send…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Send this announcement?' }))
    expect(await dialog.findByText('A service notice, to 3 accounts.')).toBeTruthy()
    expect(look).toHaveBeenCalledWith(1)
    const confirm = dialog.getByRole('button', { name: 'Send to 3 accounts' }) as HTMLButtonElement
    const typed = dialog.getByLabelText('Type service 3 to send')
    expect(confirm.disabled).toBe(true)
    for (const wrong of ['service', 'service 2', 'news 3', '3']) {
      fireEvent.change(typed, { target: { value: wrong } })
      expect(confirm.disabled).toBe(true)
    }
    fireEvent.change(typed, { target: { value: 'service 3' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(send).toHaveBeenCalledWith({ id: 1, version: 1, kind: 'service', recipients: 3, confirm: 'service 3' }))
    // Back on the list, where it is being sent.
    const [row] = await rows()
    expect(row!.textContent).toContain('Sending')
    expect(row!.textContent).toContain('0 of 3 sent · 3 waiting')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sends nothing when the count changed: says so in the question, and asks for the new count to be typed', async () => {
    const { send, look } = shown([announcement({ testedVersion: 1 })])
    send.mockRejectedValueOnce(new Error('The number of accounts has changed: it would now go to 4. Nothing was sent. Read the count again and confirm it.'))
    const f = within(await open())
    fireEvent.click(f.getByRole('button', { name: 'Send…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Send this announcement?' }))
    fireEvent.change(await dialog.findByLabelText('Type service 3 to send'), { target: { value: 'service 3' } })
    look.mockResolvedValue(preview({ recipients: 4, byLanguage: { en: 4 } }))
    fireEvent.click(dialog.getByRole('button', { name: 'Send to 3 accounts' }))
    expect((await dialog.findByRole('alert')).textContent).toContain('it would now go to 4')
    const again = (await dialog.findByRole('button', { name: 'Send to 4 accounts' })) as HTMLButtonElement
    // What was typed for the old count does not send to the new one.
    expect(again.disabled).toBe(true)
    expect(dialog.getByLabelText('Type service 4 to send')).toBeTruthy()
  })

  it('stops a send and resumes it from the list', async () => {
    const { stop, resume } = shown([announcement({ status: 'sending', startedAt: STARTED, recipients: 5, sent: 2, queued: 3 })])
    fireEvent.click(within((await rows())[0]!).getByRole('button', { name: 'Stop sending' }))
    await waitFor(() => expect(stop).toHaveBeenCalledWith(1))
    await waitFor(async () => expect((await rows())[0]!.textContent).toContain('Stopped'))
    fireEvent.click(within((await rows())[0]!).getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(resume).toHaveBeenCalledWith(1))
    await waitFor(async () => expect((await rows())[0]!.textContent).toContain('Sending'))
  })

  it('shows what was sent as it was written, with nothing to change', async () => {
    shown([announcement({ status: 'sent', startedAt: STARTED, finishedAt: STARTED, recipients: 3, sent: 3, testedVersion: 1 })])
    const f = within(await open())
    expect((language('English (needed)').getByLabelText('Subject') as HTMLInputElement).readOnly).toBe(true)
    expect((language('English (needed)').getByLabelText('Text') as HTMLTextAreaElement).readOnly).toBe(true)
    for (const name of ['Save draft', 'Send test', 'Send…']) expect(f.queryByRole('button', { name })).toBeNull()
    expect(screen.getByText(/cannot be changed or sent again/)).toBeTruthy()
  })

  it('deletes a draft after a question', async () => {
    const { del } = shown([announcement()])
    fireEvent.click(within((await rows())[0]!).getByRole('button', { name: 'Delete…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete this draft?' }))
    expect(del).not.toHaveBeenCalled()
    fireEvent.click(dialog.getByRole('button', { name: 'Delete the draft' }))
    await waitFor(() => expect(del).toHaveBeenCalledWith(1))
    expect(await screen.findByText('No announcement has been written yet.')).toBeTruthy()
  })
})
