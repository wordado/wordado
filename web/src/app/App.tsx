import { ChartColumn, LayoutGrid, Route as RouteIcon, SlidersVertical, Sun, type LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useT, type MessageKey } from '../i18n/i18n'
import { Link, useRoute, type Route } from '../router'
import { Home } from '../screens/Home'
import { Matching } from '../screens/Matching'
import { Path } from '../screens/Path'
import { Placement } from '../screens/Placement'
import { Practice } from '../screens/Practice'
import { Progress } from '../screens/Progress'
import { Settings } from '../screens/Settings'
import { SignIn } from '../screens/SignIn'
import { Study } from '../screens/Study'
import { Themes } from '../screens/Themes'
import { Setup } from '../setup/Setup'
import { AccountMenu } from './AccountMenu'
import { Banners } from './Banners'
import { LanguageMenu } from './LanguageMenu'

/** The icons show only in the phone's tab bar; the label is always the link's name. */
const NAV: readonly { readonly route: Route; readonly label: MessageKey; readonly icon: LucideIcon }[] = [
  { route: { name: 'home' }, label: 'nav.home', icon: Sun },
  { route: { name: 'path' }, label: 'nav.path', icon: RouteIcon },
  { route: { name: 'themes' }, label: 'nav.themes', icon: LayoutGrid },
  { route: { name: 'progress' }, label: 'nav.progress', icon: ChartColumn },
  { route: { name: 'settings' }, label: 'nav.settings', icon: SlidersVertical },
]

function Screen(props: { readonly route: Route }) {
  const { route } = props
  switch (route.name) {
    case 'study':
      return <Study kind="session" mode={route.mode} />
    case 'practice':
      return <Practice />
    case 'practice-words':
      return <Study kind="practice" mode={route.mode} />
    case 'matching':
      return <Matching />
    case 'path':
      return <Path />
    case 'themes':
      return <Themes />
    case 'progress':
      return <Progress />
    case 'signin':
      return <SignIn />
    case 'settings':
      return <Settings section={route.section ?? null} />
    case 'placement':
      return <Placement />
    default:
      return <Home />
  }
}

/** Routes that run a study session: the shell steps aside so the card has the screen (focus mode). */
const FOCUS: ReadonlySet<Route['name']> = new Set(['study', 'practice-words', 'matching'])

/**
 * The shell: the masthead's first row (the icon and wordmark, the language,
 * the account), the navigation (a second row, or the tab bar on a phone),
 * banners, and the routed screen. While studying, only the screen. While the
 * first-run setup is owed (`setup`, plan 11), the setup instead of the routed
 * screen (except Sign in, which a returning learner needs), under the
 * masthead's first row alone; `onFinishSetup` ends it.
 */
export function App(props: { readonly resumed: boolean; readonly setup: boolean; onFinishSetup(): void }) {
  const { t } = useT()
  const route = useRoute()
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)
  const setupBefore = useRef(props.setup)

  // The setup gave way to today without a navigation: focus the new screen, as a navigation would (spec §11.1).
  useEffect(() => {
    if (setupBefore.current && !props.setup) main.current?.focus()
    setupBefore.current = props.setup
  }, [props.setup])

  // After an in-app navigation, focus the new screen, as a page load would
  // (spec §11.1). The shell itself also mounts fresh after a take-over or a
  // retry — not on the first load — so it focuses itself right away then too.
  useEffect(() => {
    if (first.current) {
      first.current = false
      if (props.resumed) main.current?.focus()
      return
    }
    main.current?.focus()
  }, [route])

  const focus = FOCUS.has(route.name)
  const inSetup = props.setup && route.name !== 'signin'
  return (
    <div className={focus ? 'app is-focus' : 'app'}>
      <a className="skip" href="#main">
        {t('nav.skip')}
      </a>
      {!focus && (
        <header className="masthead">
          <div className="masthead-top">
            <Link className="wordmark" to={{ name: 'home' }}>
              <img src="/icon.svg" alt="" width="36" height="36" />
              {t('app.name')}
            </Link>
            <div className="masthead-actions">
              <LanguageMenu />
              <AccountMenu />
            </div>
          </div>
          {!props.setup && (
            <nav className="nav" aria-label={t('nav.label')}>
              <ul>
                {NAV.map((item) => (
                  <li key={item.label}>
                    <Link
                      to={item.route}
                      aria-current={item.route.name === route.name || (item.route.name === 'settings' && route.name === 'placement') ? 'page' : undefined}
                    >
                      <item.icon aria-hidden="true" className="nav-icon" size={24} strokeWidth={1.75} />
                      <span>{t(item.label)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </header>
      )}
      {!focus && !props.setup && (
        <aside aria-label={t('banner.label')}>
          <Banners />
        </aside>
      )}
      <main id="main" ref={main} tabIndex={-1}>
        {inSetup ? <Setup onFinish={props.onFinishSetup} /> : <Screen route={route} />}
      </main>
    </div>
  )
}
