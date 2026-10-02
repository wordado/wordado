import { ChartColumn, LayoutGrid, Route as RouteIcon, SlidersVertical, Sun, type LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useT, type MessageKey } from '../i18n/i18n'
import { Link, navigate, useRoute, type Route } from '../router'
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
import { LanguageStep } from '../setup/LanguageStep'
import { Setup } from '../setup/Setup'
import { AccountMenu } from './AccountMenu'
import { useInterfaceLocales } from './interfaceLanguage'
import { Banners, NoticeLine } from './Banners'
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
    case 'native-language':
      // Changing the native language later (plan 11, Task 7): the setup's language page, as a sub-page of
      // Settings' Languages section, so it gets that section's own has-section layout and Back link for free.
      return (
        <Settings
          section={null}
          page={{ section: 'languages', content: <LanguageStep mode="change" ownBack={false} onDone={() => navigate({ name: 'settings', section: 'languages' })} /> }}
        />
      )
    default:
      return <Home />
  }
}

/** Routes that run a study session: the shell steps aside so the card has the screen (focus mode). */
const FOCUS: ReadonlySet<Route['name']> = new Set(['study', 'practice-words', 'matching', 'placement'])

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
  useInterfaceLocales()
  const route = useRoute()
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)
  const setupBefore = useRef(props.setup)

  // The setup gave way to today without a navigation: focus the new screen, as a navigation would (spec §11.1).
  useEffect(() => {
    if (setupBefore.current && !props.setup) main.current?.focus()
    setupBefore.current = props.setup
  }, [props.setup])

  const inSetup = props.setup && route.name !== 'signin'

  // After an in-app navigation, focus the new screen, as a page load would
  // (spec §11.1). The shell itself also mounts fresh after a take-over or a
  // retry — not on the first load — so it focuses itself right away then too.
  // In the setup, the current step's heading takes focus instead (plan 11): the
  // step has already focused it (child effects run first), and main must not take it back.
  useEffect(() => {
    const target = (): HTMLElement | null =>
      (inSetup ? main.current?.querySelector<HTMLElement>('.setup h2[tabindex="-1"]') : null) ?? main.current
    if (first.current) {
      first.current = false
      if (props.resumed) target()?.focus()
      return
    }
    target()?.focus()
  }, [route])

  // The setup is never a study session, whatever the address says: it keeps the masthead.
  const focus = !inSetup && FOCUS.has(route.name)
  // Whatever address the setup was reached on, it ends on today.
  const finishSetup = () => {
    props.onFinishSetup()
    navigate({ name: 'home' }, { replace: true })
  }
  return (
    <div className={focus ? 'app is-focus' : 'app'}>
      <a className="skip" href="#main">
        {t('nav.skip')}
      </a>
      {!focus && (
        <header className="masthead">
          <div className="masthead-top">
            {/* Inert while the setup shows: home would only show it again. From Sign in it leads back to the setup. */}
            {inSetup ? (
              <span className="wordmark">
                <img src="/icon.svg" alt="" width="36" height="36" />
                {t('app.name')}
              </span>
            ) : (
              <Link className="wordmark" to={{ name: 'home' }}>
                <img src="/icon.svg" alt="" width="36" height="36" />
                {t('app.name')}
              </Link>
            )}
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
                      aria-current={
                        item.route.name === route.name || (item.route.name === 'settings' && (route.name === 'placement' || route.name === 'native-language'))
                          ? 'page'
                          : undefined
                      }
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
      {!focus && (
        <aside aria-label={t('banner.label')}>
          {/* During the setup, only what just happened to the account (signed out, deleted…): the rest waits. */}
          {props.setup ? (
            <div className="banners">
              <NoticeLine />
            </div>
          ) : (
            <Banners />
          )}
        </aside>
      )}
      <main id="main" ref={main} tabIndex={-1}>
        {inSetup ? <Setup onFinish={finishSetup} /> : <Screen route={route} />}
      </main>
    </div>
  )
}
