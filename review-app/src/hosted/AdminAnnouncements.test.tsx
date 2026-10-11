import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Announcement, AnnouncementPreview, AnnouncementTranslation, AnnouncementsView, PreparedNotice } from '../../shared/hosted'
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

const prepared: PreparedNotice = {
  file: '2026-10-11-new-terms.md', date: '2026-10-11', title: 'New terms of use',
  texts: { en: { subject: 'The terms of use have changed', body: 'Hello,\n\nthe terms have changed.' }, bg: { subject: 'Условията са променени', body: 'Здравейте.' }, de: { subject: 'Die Bedingungen haben sich geändert', body: 'Hallo.' } },
}

/** The tab over a server that has `list`; what is saved, tested and sent is answered as the server would. Nothing is prepared unless `notice` says so. */
function shown(list: readonly Announcement[] | AnnouncementsView | Error = [], notice: PreparedNotice | null = null) {
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
  const offer = vi.spyOn(hostedApi.admin, 'preparedNotice').mockResolvedValue({ notice })
  const translate = vi.spyOn(hostedApi.admin, 'translateAnnouncement').mockImplementation(async (_english, languages): Promise<AnnouncementTranslation> => ({ texts: Object.fromEntries(languages.map((l) => [l, { subject: `Subject in ${l}`, body: `Text in ${l}.` }])), failed: {} }))
  render(<AdminAnnouncements />)
  return { read, save, test, look, send, stop, resume, del, offer, translate }
}

const rows = async () => within(await screen.findByRole('list', { name: 'Announcements' })).getAllByRole('listitem')
const form = () => screen.findByRole('form', { name: 'Announcement' })
const marks = () => within(screen.getByRole('group', { name: 'Which languages have text' }))
const mark = (name: string) => marks().getByRole('button', { name: new RegExp(`^${name}:`) })
/** Shows a language in the editor, by its mark. */
const show = (name: string) => fireEvent.click(mark(name))
const subject = () => screen.getByLabelText('Subject') as HTMLInputElement
const text = () => screen.getByLabelText('Text') as HTMLTextAreaElement
/** Writes a language's subject and text, as typed into the editor. */
function write(name: string, said: { subject: string; body: string }) {
  show(name)
  fireEvent.change(subject(), { target: { value: said.subject } })
  fireEvent.change(text(), { target: { value: said.body } })
}
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const TRANSLATE = 'Translate from English into the empty languages'
/** Opens the one announcement of the list. */
async function open() {
  fireEvent.click(within((await rows())[0]!).getByRole('button', { name: 'Open' }))
  return form()
}

describe('AdminAnnouncements: the Mail tab (#185, #215)', () => {
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
    // A service notice unless chosen otherwise, with a line that says what the kind is for.
    const kind = f.getByLabelText('Kind') as HTMLSelectElement
    expect(kind.value).toBe('service')
    expect(f.getByText(/^For what is part of the service/)).toBeTruthy()
    fireEvent.change(kind, { target: { value: 'news' } })
    expect(f.getByText(/^For new features\. Every mail carries a link that stops it\./)).toBeTruthy()
    write('English', { subject: 'New: search', body: 'Find any word.' })
    write('German', { subject: 'Neu: Suche', body: 'Finde jedes Wort.' })
    // Nothing can be tested or sent before it is saved.
    expect((f.getByRole('button', { name: 'Send test' }) as HTMLButtonElement).disabled).toBe(true)
    expect((f.getByRole('button', { name: 'Send…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(f.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: null, kind: 'news', texts: { en: { subject: 'New: search', body: 'Find any word.' }, de: { subject: 'Neu: Suche', body: 'Finde jedes Wort.' } } }))
    expect(await screen.findByText('Saved as version 1.')).toBeTruthy()
    // Saved again, it is the same announcement.
    write('English', { subject: 'New: search', body: 'Find any word, fast.' })
    fireEvent.click(f.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ id: 7 })))
  })

  it('shows one language at a time, keeps what is typed in the others, and marks which are written (#215)', async () => {
    shown([])
    fireEvent.click(await screen.findByRole('button', { name: 'New announcement' }))
    const f = within(await form())
    const box = f.getByLabelText('Language') as HTMLSelectElement
    // English first, marked as needed until it has text; every mark is a button that says how its language stands.
    expect(box.value).toBe('en')
    expect(marks().getAllByRole('button').map((b) => b.textContent)).toEqual(['English: needed', 'Bulgarian: empty', 'German: empty', 'Spanish: empty'])
    expect([...box.options].map((o) => o.textContent)).toEqual(['English (needed) · empty', 'Bulgarian · empty', 'German · empty', 'Spanish · empty'])
    expect(mark('English').getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(subject(), { target: { value: 'Hello' } })
    expect(mark('English').textContent).toBe('English: written')
    // The lengths against the limits, of the language shown.
    expect(document.getElementById(subject().getAttribute('aria-describedby')!)!.textContent).toBe('5 / 150')
    expect(document.getElementById(text().getAttribute('aria-describedby')!)!.textContent).toBe('0 / 10,000')
    // By the box: German, which is empty, and whose fields are in German.
    fireEvent.change(box, { target: { value: 'de' } })
    expect(subject().value).toBe('')
    expect(subject().lang).toBe('de')
    expect(mark('German').getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(text(), { target: { value: 'Hallo.' } })
    expect([...box.options].map((o) => o.textContent)).toEqual(['English (needed) · written', 'Bulgarian · empty', 'German · written', 'Spanish · empty'])
    // By a mark, back to English: what was typed in both is there, and the kind changes none of it.
    show('English')
    expect(box.value).toBe('en')
    expect(subject().value).toBe('Hello')
    fireEvent.change(f.getByLabelText('Kind'), { target: { value: 'news' } })
    expect(subject().value).toBe('Hello')
    show('German')
    expect(text().value).toBe('Hallo.')
    expect(document.getElementById(text().getAttribute('aria-describedby')!)!.textContent).toBe('6 / 10,000')
  })

  it('does not save without English, and shows English to say so (#215)', async () => {
    const { save } = shown([])
    fireEvent.click(await screen.findByRole('button', { name: 'New announcement' }))
    await form()
    write('German', { subject: 'Neu', body: 'Hallo.' })
    fireEvent.submit(await form())
    expect((await screen.findByRole('alert')).textContent).toBe('English is needed: write its subject and its text.')
    expect(mark('English').getAttribute('aria-pressed')).toBe('true')
    expect(save).not.toHaveBeenCalled()
    // German is kept.
    show('German')
    expect(subject().value).toBe('Neu')
  })

  it('shows what went wrong with a save, and keeps what was written', async () => {
    const { save } = shown([])
    save.mockRejectedValue(new Error('en: the subject must be one line of plain text'))
    fireEvent.click(await screen.findByRole('button', { name: 'New announcement' }))
    await form()
    write('English', { subject: 'Hello', body: 'Text' })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect((await screen.findByRole('alert')).textContent).toContain('en: the subject must be one line of plain text')
    expect(subject().value).toBe('Hello')
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
    fireEvent.change(text(), { target: { value: 'Another text.' } })
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
    expect(subject().readOnly).toBe(true)
    expect(text().readOnly).toBe(true)
    expect((f.getByLabelText('Kind') as HTMLSelectElement).disabled).toBe(true)
    for (const name of ['Save draft', 'Send test', 'Send…', TRANSLATE, 'Use this text']) expect(f.queryByRole('button', { name })).toBeNull()
    // The languages can still be looked at.
    show('German')
    expect(subject().value).toBe('')
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

  describe('the prepared notice (#215)', () => {
    const offerOf = () => screen.findByRole('region', { name: 'Prepared notice' })

    it('is offered to a new service notice, and one press fills every language it has, saving nothing', async () => {
      const { save, offer } = shown([], prepared)
      fireEvent.click(await screen.findByRole('button', { name: 'New announcement' }))
      const region = await offerOf()
      expect(offer).toHaveBeenCalledTimes(1)
      expect(region.textContent).toContain('A notice was prepared with the change of 11 October 2026')
      expect(region.textContent).toContain('New terms of use · English, Bulgarian and German · no announcement has used it yet')
      fireEvent.click(within(region).getByRole('button', { name: 'Use this text' }))
      expect(marks().getAllByRole('button').map((b) => b.textContent)).toEqual(['English: written', 'Bulgarian: written', 'German: written', 'Spanish: empty'])
      expect(subject().value).toBe('The terms of use have changed')
      expect(screen.getByRole('status').textContent).toBe('English, Bulgarian and German filled from the prepared notice. Read each one, then save.')
      // Taken, it is not offered again here, and nothing went to the server.
      expect(screen.queryByRole('region', { name: 'Prepared notice' })).toBeNull()
      expect(save).not.toHaveBeenCalled()
      // It is a draft like one typed: saved, then tested, before it can be sent.
      expect(button('Send test').disabled).toBe(true)
      fireEvent.click(button('Save draft'))
      await waitFor(() => expect(save).toHaveBeenCalledWith({ id: null, kind: 'service', texts: prepared.texts }))
      expect(await screen.findByText('This version has not been sent as a test yet.')).toBeTruthy()
      expect(button('Send…').disabled).toBe(true)
    })

    it('is not offered for news, and comes back with the service notice without being asked for twice', async () => {
      const { offer } = shown([], prepared)
      fireEvent.click(await screen.findByRole('button', { name: 'New announcement' }))
      await offerOf()
      fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'news' } })
      expect(screen.queryByRole('region', { name: 'Prepared notice' })).toBeNull()
      fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'service' } })
      expect(await offerOf()).toBeTruthy()
      expect(offer).toHaveBeenCalledTimes(1)
    })

    it('asks before it takes the place of what is written, and Cancel keeps every word', async () => {
      shown([], prepared)
      fireEvent.click(await screen.findByRole('button', { name: 'New announcement' }))
      const region = await offerOf()
      write('Spanish', { subject: 'Hola', body: 'Texto.' })
      fireEvent.click(within(region).getByRole('button', { name: 'Use this text' }))
      const dialog = within(await screen.findByRole('dialog', { name: 'Replace what is written?' }))
      expect(subject().value).toBe('Hola')
      fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(subject().value).toBe('Hola')
      // Confirmed, the notice is all there is: Spanish, which it does not have, is empty.
      fireEvent.click(within(await offerOf()).getByRole('button', { name: 'Use this text' }))
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Replace what is written?' })).getByRole('button', { name: 'Replace with the prepared notice' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(mark('Spanish').textContent).toBe('Spanish: empty')
      expect(subject().value).toBe('The terms of use have changed')
    })

    it('makes a tested draft one that must be saved and tested again', async () => {
      shown([announcement({ testedVersion: 1 })], prepared)
      await open()
      expect(button('Send…').disabled).toBe(false)
      fireEvent.click(within(await offerOf()).getByRole('button', { name: 'Use this text' }))
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Replace what is written?' })).getByRole('button', { name: 'Replace with the prepared notice' }))
      expect(button('Send…').disabled).toBe(true)
      expect(button('Send test').disabled).toBe(true)
      expect(screen.getByText('Save the changes first.')).toBeTruthy()
      fireEvent.click(button('Save draft'))
      expect(await screen.findByText('This version has not been sent as a test yet.')).toBeTruthy()
      expect(button('Send…').disabled).toBe(true)
    })

    it('is nothing when none is prepared, when it cannot be read, and for what is no longer a draft', async () => {
      const { offer } = shown([announcement({ status: 'sent', startedAt: STARTED, finishedAt: STARTED, recipients: 3, sent: 3, testedVersion: 1 })])
      offer.mockRejectedValue(new Error('The app’s server answered 502.'))
      await open()
      expect(offer).not.toHaveBeenCalled()
      fireEvent.click(button('Back to the list'))
      fireEvent.click(await screen.findByRole('button', { name: 'New announcement' }))
      await form()
      await waitFor(() => expect(offer).toHaveBeenCalledTimes(1))
      expect(screen.queryByRole('region', { name: 'Prepared notice' })).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  describe('Translate (#215)', () => {
    it('fills the empty languages from the English text, never one that has text, and says a machine wrote them', async () => {
      const { translate, save } = shown([])
      fireEvent.click(await screen.findByRole('button', { name: 'New announcement' }))
      await form()
      // Nothing to translate from yet.
      expect(button(TRANSLATE).disabled).toBe(true)
      write('English', { subject: ' New: search ', body: 'Find any word.' })
      // A subject alone is text: German is not empty, and is left as it is.
      show('German')
      fireEvent.change(subject(), { target: { value: 'Neu: Suche' } })
      fireEvent.click(button(TRANSLATE))
      await waitFor(() => expect(translate).toHaveBeenCalledWith({ subject: 'New: search', body: 'Find any word.' }, ['bg', 'es']))
      expect((await screen.findByRole('status')).textContent).toBe('Translated into Bulgarian and Spanish. A machine wrote these: read each one before the test send.')
      expect(marks().getAllByRole('button').map((b) => b.textContent)).toEqual(['English: written', 'Bulgarian: written, by a machine', 'German: written', 'Spanish: written, by a machine'])
      expect(subject().value).toBe('Neu: Suche')
      expect(text().value).toBe('')
      show('Bulgarian')
      expect(subject().value).toBe('Subject in bg')
      expect(screen.getByText('A machine translated this from the English text. Read it before the test send.')).toBeTruthy()
      show('English')
      expect(screen.queryByText(/A machine translated this/)).toBeNull()
      // Nothing was saved by it, and nothing is left to translate.
      expect(save).not.toHaveBeenCalled()
      expect(button(TRANSLATE).disabled).toBe(true)
    })

    it('makes a tested draft one that must be saved and tested again', async () => {
      const { save } = shown([announcement({ testedVersion: 1 })])
      await open()
      expect(button('Send…').disabled).toBe(false)
      fireEvent.click(button(TRANSLATE))
      await screen.findByRole('status')
      expect(button('Send…').disabled).toBe(true)
      expect(button('Send test').disabled).toBe(true)
      expect(screen.getByText('Save the changes first.')).toBeTruthy()
      fireEvent.click(button('Save draft'))
      await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 1, texts: expect.objectContaining({ es: { subject: 'Subject in es', body: 'Text in es.' } }) })))
      expect(await screen.findByText('This version has not been sent as a test yet.')).toBeTruthy()
      expect(button('Send…').disabled).toBe(true)
    })

    it('leaves alone a language that got text while the AI wrote', async () => {
      const { translate } = shown([announcement()])
      let answer!: (value: AnnouncementTranslation) => void
      translate.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
      await open()
      fireEvent.click(button(TRANSLATE))
      await waitFor(() => expect(translate).toHaveBeenCalled())
      write('German', { subject: 'Selbst geschrieben', body: 'Hallo.' })
      answer({ texts: { bg: { subject: 'Тема', body: 'Текст.' }, de: { subject: 'Von der Maschine', body: 'Hallo.' }, es: { subject: 'Asunto', body: 'Texto.' } }, failed: {} })
      expect((await screen.findByRole('status')).textContent).toContain('Translated into Bulgarian and Spanish.')
      expect(subject().value).toBe('Selbst geschrieben')
      expect(mark('German').textContent).toBe('German: written')
    })

    it('says in plain words why nothing was translated, once', async () => {
      const { translate } = shown([announcement()])
      await open()
      for (const [why, line] of [
        ['off', 'Nothing was translated: AI help is off. It is switched on in the Feedback tab.'],
        ['not-set-up', 'Nothing was translated: AI help is not set up.'],
        ['limit', 'Nothing was translated: today’s limit of AI calls is reached.'],
        ['late', 'Nothing was translated: the AI gave no translation this time (it took too long).'],
      ] as const) {
        translate.mockResolvedValueOnce({ texts: {}, failed: { bg: why, de: why, es: why } })
        fireEvent.click(button(TRANSLATE))
        await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(line))
        await waitFor(() => expect(button(TRANSLATE).disabled).toBe(false))
      }
      expect(marks().getAllByRole('button').map((b) => b.textContent)).toEqual(['English: written', 'Bulgarian: empty', 'German: empty', 'Spanish: empty'])
    })

    it('puts in the languages that came and names each that did not, with why; a text that may not be saved is not put in', async () => {
      const { translate } = shown([announcement()])
      await open()
      translate.mockResolvedValueOnce({ texts: { bg: { subject: 'Тема', body: 'Текст.' }, es: { subject: 'Dos\nlíneas', body: 'Texto.' } }, failed: { de: 'too-long' } })
      fireEvent.click(button(TRANSLATE))
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('German was not translated: the translation came out longer than an announcement may be, and nothing was cut from it.')
      expect(alert.textContent).toContain('Spanish was not translated: the AI gave no translation this time (its answer could not be used).')
      expect(screen.getByRole('status').textContent).toBe('Translated into Bulgarian. A machine wrote it: read it before the test send.')
      expect(marks().getAllByRole('button').map((b) => b.textContent)).toEqual(['English: written', 'Bulgarian: written, by a machine', 'German: empty', 'Spanish: empty'])
    })

    it('shows a failed request, and keeps what was written', async () => {
      const { translate } = shown([announcement()])
      translate.mockRejectedValue(new Error('request failed (500)'))
      await open()
      fireEvent.click(button(TRANSLATE))
      expect((await screen.findByRole('alert')).textContent).toBe('request failed (500)')
      expect(subject().value).toBe(en.subject)
    })
  })
})
