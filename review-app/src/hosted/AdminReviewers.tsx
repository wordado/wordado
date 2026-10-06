import { type FormEvent, useState } from 'react'
import { type Language, LANGUAGE_NAMES, LANGUAGES, type ReviewerView } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { type Act, dateOf } from './adminUtil'

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

function statusOf(r: ReviewerView): string {
  if (r.disabledAt) return 'disabled'
  return r.inviteSentAt ? `invited ${dateOf(r.inviteSentAt)}` : 'invited, not sent'
}

/** The link to send by hand when the invite mail did not go out. */
interface Unsent {
  readonly email: string
  readonly link: string
}

/** Reviewers: the invite form and one row per reviewer with resend, edit languages and disable/enable. */
export function AdminReviewers(props: { reviewers: readonly ReviewerView[] | undefined; act: Act }) {
  const { reviewers, act } = props
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [languages, setLanguages] = useState<Language[]>([])
  const [admin, setAdmin] = useState(false)
  const [unsent, setUnsent] = useState<Unsent | null>(null)
  const [sent, setSent] = useState('')
  const [editing, setEditing] = useState<{ email: string; languages: Language[] } | null>(null)

  /** Shows the outcome of an invite (new or resent): the link when the mail failed, a note when it went out. */
  const showInvite = (to: string, r: { inviteSent: boolean; link: string }) => {
    setUnsent(r.inviteSent ? null : { email: to, link: r.link })
    setSent(r.inviteSent ? `Invite sent to ${to}.` : '')
  }

  const invite = (e: FormEvent) => {
    e.preventDefault()
    void act(async () => {
      const r = await hostedApi.admin.invite({ email: email.trim(), name: name.trim(), languages, role: admin ? 'admin' : 'reviewer' })
      showInvite(r.reviewer.email, r)
      setEmail('')
      setName('')
      setLanguages([])
      setAdmin(false)
    })
  }

  const resend = (r: ReviewerView) => void act(async () => showInvite(r.email, await hostedApi.admin.resendInvite(r.email)))

  const saveLanguages = () => {
    if (!editing) return
    const { email: who, languages: next } = editing
    void act(() => hostedApi.admin.patchReviewer(who, { languages: next })).then((ok) => ok && setEditing(null))
  }

  const disable = (r: ReviewerView) => {
    if (!window.confirm(`Disable ${r.name}? Their open assignments close; decisions they have not submitted are kept.`)) return
    void act(() => hostedApi.admin.patchReviewer(r.email, { disabled: true }))
  }
  const enable = (r: ReviewerView) => void act(() => hostedApi.admin.patchReviewer(r.email, { disabled: false }))

  return (
    <section className="panel" aria-label="Reviewers">
      <h2 className="panel-title">Reviewers</h2>
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
        <span>
          <button type="submit" className="button primary">
            Invite
          </button>
        </span>
      </form>
      {unsent && (
        <p className="invite-unsent">
          Invite not sent: send this link yourself to {unsent.email}: <span className="invite-link">{unsent.link}</span>
        </p>
      )}
      {sent && <p className="note">{sent}</p>}
      {reviewers === undefined && <p className="note">Loading…</p>}
      {reviewers?.length === 0 && <p className="note">No reviewers yet.</p>}
      {reviewers && reviewers.length > 0 && (
        <ul className="settings-rows">
          {reviewers.map((r) => (
            <li key={r.email} className="settings-row">
              <span className="settings-row-text">
                <span className="settings-row-title">
                  {r.name}
                  {r.role === 'admin' ? ' (admin)' : ''}
                </span>
                <span className="note">{r.email}</span>
                <span className="note">
                  {r.languages.map((l) => LANGUAGE_NAMES[l]).join(', ') || 'no languages'} · {statusOf(r)}
                </span>
                {editing?.email === r.email && (
                  <span className="row-edit">
                    <LanguageBoxes value={editing.languages} onChange={(next) => setEditing({ email: r.email, languages: next })} />
                    <button className="button small" onClick={saveLanguages}>
                      Save
                    </button>
                    <button className="button small ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </span>
                )}
              </span>
              <span className="row-actions">
                {!r.disabledAt && (
                  <button className="button small" onClick={() => resend(r)}>
                    Resend invite
                  </button>
                )}
                {editing?.email !== r.email && (
                  <button className="button small" onClick={() => setEditing({ email: r.email, languages: [...r.languages] })}>
                    Edit languages
                  </button>
                )}
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
      )}
    </section>
  )
}
