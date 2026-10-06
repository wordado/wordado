import { type FormEvent, useState } from 'react'
import { type Language, LANGUAGE_NAMES, LANGUAGES, type ReviewerView } from '../../shared/hosted'
import { Dialog } from '../Dialog'
import { hostedApi } from '../hostedApi'
import { type Act, count, dayOf, type PageNotice } from './adminUtil'

/** One checkbox per language, labelled by its name. */
function LanguageBoxes(props: { value: readonly Language[]; onChange(next: Language[]): void }) {
  const toggle = (l: Language) =>
    props.onChange(LANGUAGES.filter((x) => (x === l ? !props.value.includes(l) : props.value.includes(x))))
  return (
    <span className="checkbox-group">
      {LANGUAGES.map((l) => (
        <label key={l} className="check">
          <input type="checkbox" checked={props.value.includes(l)} onChange={() => toggle(l)} /> {LANGUAGE_NAMES[l]}
        </label>
      ))}
    </span>
  )
}

/** The outcome of an invite (new or resent). */
type Invited = { inviteSent: boolean; link: string }

/** The link to send by hand when the invite mail did not go out. */
interface Unsent {
  readonly email: string
  readonly link: string
}

/** The Reviewers tab: Invite a reviewer (a dialog) and one row per reviewer with resend, edit languages (a dialog)
 * and disable/enable. */
export function AdminReviewers(props: { reviewers: readonly ReviewerView[] | undefined; act: Act } & PageNotice) {
  const { reviewers, act, notice } = props
  const [inviting, setInviting] = useState(false)
  const [unsent, setUnsent] = useState<Unsent | null>(null)
  const [sent, setSent] = useState('')
  const [editing, setEditing] = useState<ReviewerView | null>(null)

  /** Shows the outcome of an invite: the link when the mail failed, a note when it went out. */
  const showInvite = (to: string, r: Invited) => {
    setUnsent(r.inviteSent ? null : { email: to, link: r.link })
    setSent(r.inviteSent ? `Invite sent to ${to}.` : '')
  }

  const resend = (r: ReviewerView) => void act(async () => showInvite(r.email, await hostedApi.admin.resendInvite(r.email)))

  const disable = (r: ReviewerView) => {
    if (!window.confirm(`Disable ${r.name}? Their open assignments close; decisions they have not submitted are kept.`)) return
    void act(() => hostedApi.admin.patchReviewer(r.email, { disabled: true }))
  }
  const enable = (r: ReviewerView) => void act(() => hostedApi.admin.patchReviewer(r.email, { disabled: false }))

  const open = (what: () => void) => {
    props.clearNotice()
    what()
  }

  return (
    <>
      <div className="tab-actions">
        <button className="button primary" onClick={() => open(() => setInviting(true))}>
          Invite a reviewer
        </button>
      </div>
      {unsent && (
        <p className="invite-unsent">
          Invite not sent: send this link yourself to {unsent.email}: <span className="invite-link">{unsent.link}</span>
        </p>
      )}
      {sent && <p className="note">{sent}</p>}
      {reviewers === undefined && <p className="note">Loading…</p>}
      {reviewers?.length === 0 && <p className="note">No reviewers yet.</p>}
      {reviewers && reviewers.length > 0 && (
        <>
          <p className="eyebrow">{count(reviewers.length, 'reviewer')}</p>
          <ul className="settings-rows">
            {reviewers.map((r) => (
              <li key={r.email} className="settings-row">
                <span className="settings-row-text">
                  <span className="settings-row-title">
                    <span>{r.name}</span>
                    {r.role === 'admin' && <span className="chip">admin</span>}
                    {r.disabledAt && <span className="chip off">disabled</span>}
                    {!r.disabledAt && !r.inviteSentAt && <span className="chip minor">invite not sent</span>}
                  </span>
                  <span className="note">{r.email}</span>
                  <span className="note">
                    {r.languages.map((l) => LANGUAGE_NAMES[l]).join(', ') || 'no languages'}
                    {r.inviteSentAt ? ` · invited ${dayOf(r.inviteSentAt)}` : ''}
                  </span>
                </span>
                <span className="row-actions">
                  {!r.disabledAt && (
                    <button className="button small" onClick={() => resend(r)}>
                      Resend invite
                    </button>
                  )}
                  <button className="button small" aria-label={`Edit ${r.name}`} onClick={() => open(() => setEditing(r))}>
                    Edit
                  </button>
                  {r.disabledAt ? (
                    <button className="button small" aria-label={`Enable ${r.name}`} onClick={() => enable(r)}>
                      Enable
                    </button>
                  ) : (
                    <button className="button small danger" aria-label={`Disable ${r.name}`} onClick={() => disable(r)}>
                      Disable
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Dialog open={inviting} title="Invite a reviewer" onClose={() => setInviting(false)} error={notice}>
        <InviteForm
          act={act}
          onDone={(to, r) => {
            showInvite(to, r)
            setInviting(false)
          }}
        />
      </Dialog>
      <Dialog open={editing !== null} title={`Languages of ${editing?.name ?? ''}`} onClose={() => setEditing(null)} error={notice}>
        {editing && <LanguagesForm reviewer={editing} act={act} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  )
}

/** The invite form: email, name, languages, admin. */
function InviteForm(props: { act: Act; onDone(email: string, r: Invited): void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [languages, setLanguages] = useState<Language[]>([])
  const [admin, setAdmin] = useState(false)

  const invite = (e: FormEvent) => {
    e.preventDefault()
    void props.act(async () => {
      const r = await hostedApi.admin.invite({ email: email.trim(), name: name.trim(), languages, role: admin ? 'admin' : 'reviewer' })
      props.onDone(r.reviewer.email, r)
    })
  }

  return (
    <form aria-label="Invite a reviewer" className="form" onSubmit={invite}>
      <label className="field">
        Email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <LanguageBoxes value={languages} onChange={setLanguages} />
      <label className="check">
        <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Admin
      </label>
      <span className="form-actions">
        <button type="submit" className="button primary">
          Invite
        </button>
      </span>
    </form>
  )
}

/** A reviewer's languages: what they can be assigned. */
function LanguagesForm(props: { reviewer: ReviewerView; act: Act; onDone(): void }) {
  const { reviewer } = props
  const [languages, setLanguages] = useState<Language[]>([...reviewer.languages])
  const save = (e: FormEvent) => {
    e.preventDefault()
    void props.act(() => hostedApi.admin.patchReviewer(reviewer.email, { languages })).then((ok) => ok && props.onDone())
  }
  return (
    <form className="form" onSubmit={save}>
      <p className="note">{reviewer.email}</p>
      <LanguageBoxes value={languages} onChange={setLanguages} />
      <span className="form-actions">
        <button type="submit" className="button primary">
          Save
        </button>
        <button type="button" className="button ghost" onClick={props.onDone}>
          Cancel
        </button>
      </span>
    </form>
  )
}
