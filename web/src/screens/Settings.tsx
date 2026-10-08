import { useClient, useClientSnapshot } from '@wordado/client-data'
import type { L1 } from '@wordado/core'
import { BookOpen, ChevronLeft, ChevronRight, Globe, Info, Package, Smartphone, User, Bell, Volume2, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../app/context'
import { privacyUrl } from '../app/site'
import { ENDONYM, languageName, useT, type MessageKey } from '../i18n/i18n'
import { Link, type Route, type SettingsSection } from '../router'
import { AboutSettings } from '../settings/AboutSettings'
import { AccountSettings } from '../settings/AccountSettings'
import { AppSettings } from '../settings/AppSettings'
import { AudioDownload } from '../settings/AudioDownload'
import { LanguageSettings } from '../settings/LanguageSettings'
import { NativeLanguageSettings } from '../settings/NativeLanguageSettings'
import { ReminderSettings } from '../settings/ReminderSettings'
import { SetAsideWords } from '../settings/SetAsideWords'
import { StudySettings } from '../settings/StudySettings'
import { useStore } from '../useStore'

const toTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

/** The menu's rows, in groups; each opens its section at `/settings/<section>`. */
const GROUPS: readonly { readonly label: MessageKey; readonly sections: readonly SettingsSection[] }[] = [
  { label: 'settings.groupLearning', sections: ['study', 'words', 'audio'] },
  { label: 'settings.groupYou', sections: ['reminders', 'languages', 'account'] },
  { label: 'settings.groupWordado', sections: ['app', 'about'] },
]

const TITLE: Readonly<Record<SettingsSection, MessageKey>> = {
  study: 'settings.study',
  words: 'settings.setAside',
  audio: 'settings.audioDownload',
  reminders: 'reminders.title',
  languages: 'settings.languages',
  account: 'settings.account',
  app: 'settings.app',
  about: 'settings.aboutPrivacy',
}

const ICON: Readonly<Record<SettingsSection, LucideIcon>> = {
  study: BookOpen,
  words: Package,
  audio: Volume2,
  reminders: Bell,
  languages: Globe,
  account: User,
  app: Smartphone,
  about: Info,
}

/** A sub-page of one of the sections, replacing its own content (plan 11, Task 7: changing the native language).
 * The section still shows current in the menu and keeps the phone/desktop layout of any other section page; only
 * the content and the Back link's target (the section itself, not the menu) differ. */
export interface SettingsPage {
  readonly section: SettingsSection
  readonly content: ReactNode
}

/**
 * Settings (spec §7, §9.3, §11) as a menu of sections, each on its own page.
 * The menu says what each section is set to. On a phone the menu and a
 * section take turns; from 48rem they sit side by side, the menu opening on
 * the first section.
 */
export function Settings(props: { readonly section: SettingsSection | null; readonly page?: SettingsPage }) {
  const { t } = useT()
  const summaries = useSummaries()
  // A section with nothing to show here (no audio to download) is left out.
  const available = (section: SettingsSection) => summaries[section] !== null
  const section = props.page ? props.page.section : props.section !== null && available(props.section) ? props.section : null
  const shown = section ?? 'study'
  // A sub-page's Back goes to its own section, not all the way to the menu; every other page's goes to the menu.
  const backTo: Route = props.page ? { name: 'settings', section: props.page.section } : { name: 'settings' }
  const backLabel = props.page ? TITLE[props.page.section] : 'settings.title'
  return (
    <div className={section ? 'settings has-section' : 'settings'}>
      <h1 className="settings-title">{t('settings.title')}</h1>
      <nav className="settings-menu" aria-label={t('settings.sectionsLabel')}>
        {GROUPS.map((group) => {
          const sections = group.sections.filter(available)
          if (sections.length === 0) return null
          return (
            <div key={group.label} className="settings-group">
              <p className="eyebrow">{t(group.label)}</p>
              <ul>
                {sections.map((s) => {
                  const Icon = ICON[s]
                  return (
                    <li key={s}>
                      <Link className={s === shown ? 'settings-row is-shown' : 'settings-row'} to={{ name: 'settings', section: s }} aria-current={s === section ? 'page' : undefined}>
                        <span className="settings-row-icon" aria-hidden="true">
                          <Icon size={20} strokeWidth={1.75} />
                        </span>
                        <span className="settings-row-text">
                          <span className="settings-row-title">{t(TITLE[s])}</span>
                          <span className="note">{summaries[s]}</span>
                        </span>
                        <ChevronRight aria-hidden="true" size={18} className="settings-chevron" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>
      <div className="settings-page">
        <Link className="settings-back" to={backTo}>
          <ChevronLeft aria-hidden="true" size={18} />
          {t(backLabel)}
        </Link>
        {props.page ? <div className="panel settings-section">{props.page.content}</div> : <SectionPage section={shown} />}
      </div>
    </div>
  )
}

function SectionPage(props: { readonly section: SettingsSection }) {
  const { t, locale } = useT()
  const page: Readonly<Record<SettingsSection, ReactNode>> = {
    study: <StudySettings />,
    words: <SetAsideWords />,
    audio: <AudioDownload />,
    reminders: <ReminderSettings />,
    languages: (
      <section className="settings-languages" aria-labelledby="settings-languages">
        <h2 id="settings-languages">{t('settings.languages')}</h2>
        <NativeLanguageSettings />
        <LanguageSettings />
      </section>
    ),
    account: <AccountSettings />,
    app: <AppSettings />,
    about: (
      <>
        <AboutSettings />
        <p className="privacy-link">
          <a href={privacyUrl(locale)}>{t('privacy.link')}</a>
        </p>
      </>
    ),
  }
  return <div className="panel settings-section">{page[props.section]}</div>
}

/** What each section is set to, for the menu; null where the section has nothing to show here. */
function useSummaries(): Readonly<Record<SettingsSection, string | null>> {
  const { t, locale } = useT()
  const client = useClient()
  const { settings, flags, l1 } = useClientSnapshot()
  const { account, audio, reminders, lifecycle } = useApp()
  const { installable, autoUpdate } = useStore(lifecycle.store)
  const clips = settings.audio ? client.levelClips(settings.declaredLevel) : []
  const cached = audio.cachedClips()
  const prefs = reminders.prefs()
  const translations = (settings.l1 ?? l1) as L1
  return {
    study: t('settings.summaryStudy', {
      level: settings.declaredLevel,
      count: settings.newWordLimit,
      retention: t(`settings.retention.${settings.retention}` as MessageKey),
    }),
    words: flags.size === 0 ? t('settings.summaryNone') : t('settings.summaryWords', { count: flags.size }),
    audio: clips.length === 0 ? null : t('settings.audioDownloaded', { done: clips.filter((c) => cached.has(c.clipId)).length, total: clips.length }),
    reminders: account === null ? t('reminders.needAccount') : prefs ? t('settings.summaryRemindersOn', { time: toTime(prefs.minute) }) : t('reminders.off'),
    // The translation language named in itself, as Native language lists it.
    languages: t('settings.summaryLanguages', { translations: languageName(translations, translations), menus: ENDONYM[locale] }),
    account: account?.email ?? t('settings.summaryDemo'),
    app: t(installable !== null ? 'settings.summaryApp' : autoUpdate ? 'settings.summaryAppAuto' : 'settings.summaryAppManual'),
    about: t('settings.summaryAbout'),
  }
}
