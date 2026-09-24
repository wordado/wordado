import { useT } from '../i18n/i18n'
import { AccountSettings } from '../settings/AccountSettings'
import { AppSettings } from '../settings/AppSettings'
import { AudioDownload } from '../settings/AudioDownload'
import { LanguageSettings } from '../settings/LanguageSettings'
import { ReminderSettings } from '../settings/ReminderSettings'
import { SetAsideWords } from '../settings/SetAsideWords'
import { StudySettings } from '../settings/StudySettings'

/** Settings (spec §7, §9.3, §11): each section is its own component. */
export function Settings() {
  const { t } = useT()
  return (
    <div className="settings">
      <h1>{t('settings.title')}</h1>
      <StudySettings />
      <SetAsideWords />
      <AudioDownload />
      <ReminderSettings />
      <LanguageSettings />
      <AccountSettings />
      <AppSettings />
    </div>
  )
}
