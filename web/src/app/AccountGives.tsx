import { useClientSnapshot } from '@wordado/client-data'
import { BookOpen, Mail, RefreshCw } from 'lucide-react'
import { useId } from 'react'
import { useT } from '../i18n/i18n'

/**
 * What an account gives (#289), where a learner of the demo decides: the whole course, with the declared level's
 * size when the trial pack names it; progress kept on every device; and what the email is used for.
 */
export function AccountGives() {
  const { t } = useT()
  const { corpus, settings } = useClientSnapshot()
  const id = useId()
  const level = settings.declaredLevel
  const units = corpus?.trial?.course[level]?.units
  return (
    <div className="account-gives">
      <p className="eyebrow" id={id}>
        {t('gives.title')}
      </p>
      <ul aria-labelledby={id}>
        <li>
          <BookOpen aria-hidden="true" size={20} />
          {units === undefined ? t('gives.course') : t('gives.courseSize', { count: units, level })}
        </li>
        <li>
          <RefreshCw aria-hidden="true" size={20} />
          {t('gives.progress')}
        </li>
        <li>
          <Mail aria-hidden="true" size={20} />
          {t('gives.email')}
        </li>
      </ul>
    </div>
  )
}
