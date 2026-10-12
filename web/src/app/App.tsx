import { ChartColumn, LayoutGrid, Route as RouteIcon, Search as SearchIcon, SlidersVertical, Sun, type LucideIcon } from 'lucide-react'
import { useClientSnapshot } from '@wordado/client-data'
import { useEffect, useRef, useState } from 'react'
import { useT, type MessageKey } from '../i18n/i18n'
import { Link, navigate, useRoute, type Route } from '../router'
import { Feedback } from '../screens/Feedback'
import { Home } from '../screens/Home'
import { Matching } from '../screens/Matching'
import { Path } from '../screens/Path'
import { Placement } from '../screens/Placement'
import { Practice } from '../screens/Practice'
import { Progress } from '../screens/Progress'
import { Search } from '../screens/Search'
import { Settings } from '../screens/Settings'
import { SignIn } from '../screens/SignIn'
import { Study } from '../screens/Study'
import { ThemeWords } from '../screens/Theme'
import { Themes } from '../screens/Themes'
import { LanguageStep } from '../setup/LanguageStep'
import { hasLevels, LevelAsk } from '../setup/LevelAsk'
import { Setup } from '../setup/Setup'
import { AccountMenu } from './AccountMenu'
import { useInterfaceLocales } from './interfaceLanguage'
import { Banners, NoticeLine } from './Banners'
import { LanguageMenu } from './LanguageMenu'
import { useUpdateSafety } from './updateSafety'

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
      return <Practice unit={route.unit} theme={route.theme} />
    case 'practice-words':
      return <Study kind="practice" mode={route.mode} unit={route.unit} theme={route.theme} />
    case 'matching':
      return <Matching unit={route.unit} theme={route.theme} />
    case 'path':
      return <Path unit={route.unit} />
    case 'themes':
      return <Themes />
    case 'theme':
      return <ThemeWords themeId={route.themeId} query={route.q ?? ''} />
    case 'search':
      return <Search q={route.q} />
    case 'progress':
      return <Progress />
    case 'signin':
      return <SignIn />
    case 'settings':
      return <Settings section={route.section ?? null} />
    case 'placement':
      return <Placement />
    case 'feedback':
      return <Feedback from={route.from} />
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

/** The wordmark: the icon, then "Word" in ink and "ado" in rose. The name is not translated; it reads as one word. */
const WORDMARK = (
  <>
    <img src="/icon.svg" alt="" width="36" height="36" />
    <span className="wordmark-name">
      Word<span className="wordmark-ado">ado</span>
    </span>
  </>
)

/**
 * The shell: the masthead's first row (the icon and wordmark, the search, the
 * language, the account), the navigation (a second row, or the tab bar on a phone),
 * banners, and the routed screen. While studying, only the screen. While the
 * first-run setup is owed (`setup`, plan 11), the setup instead of the routed
 * screen (except Sign in, which a returning learner needs, and Feedback, for
 * a setup that does not work), under the
 * masthead's first row alone; `onFinishSetup` ends it.
 */
export function App(props: {
  readonly resumed: boolean
  readonly setup: boolean
  onFinishSetup(): void
  /** Nobody asked for a level yet (a demo carried into this account, or a visitor's device that got the trial pack): Today gives way to that question once. */
  readonly askLevel?: boolean
  /** Why it is asked, when not for an account. */
  readonly levelLead?: MessageKey
  onLevelAsked?(): void
}) {
  const { t } = useT()
  useInterfaceLocales()
  useUpdateSafety(props.setup)
  const route = useRoute()
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)
  const before = useRef(route.name)
  const setupBefore = useRef(props.setup)

  // The setup gave way to today without a navigation: focus the new screen, as a navigation would (spec §11.1).
  useEffect(() => {
    if (setupBefore.current && !props.setup) main.current?.focus()
    setupBefore.current = props.setup
  }, [props.setup])

  const inSetup = props.setup && route.name !== 'signin' && route.name !== 'feedback'
  const { corpus } = useClientSnapshot()
  // Asked on Today only, and only of a course with a level to choose: every other screen stays within reach.
  const asking = !props.setup && props.askLevel === true && route.name === 'home' && hasLevels(corpus)

  // After an in-app navigation, focus the new screen, as a page load would
  // (spec §11.1). The shell itself also mounts fresh after a take-over or a
  // retry — not on the first load — so it focuses itself right away then too.
  // In the setup, the current step's heading takes focus instead (plan 11): the
  // step has already focused it (child effects run first), and main must not take it back.
  useEffect(() => {
    const from = before.current
    before.current = route.name
    // A screen may name what takes focus on arrival (`data-route-focus`): the unit a search led to, the search
    // field. The setup names its step's heading. Otherwise the screen itself.
    const target = (): HTMLElement | null =>
      main.current?.querySelector<HTMLElement>(inSetup || asking ? '.setup h2[tabindex="-1"]' : '[data-route-focus]') ?? main.current
    if (first.current) {
      first.current = false
      if (props.resumed) target()?.focus()
      return
    }
    // The search rewrites its own address as the learner types: that is not an arrival, and the field keeps focus.
    if (from === 'search' && route.name === 'search') return
    target()?.focus()
  }, [route])

  // The setup is never a study session, whatever the address says: it keeps the masthead.
  // The setup's placement test takes the whole screen, as it does from Settings.
  const [setupFocus, setSetupFocus] = useState(false)
  const focus = inSetup || asking ? setupFocus : FOCUS.has(route.name)
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
              <span className="wordmark">{WORDMARK}</span>
            ) : (
              // Named in one word: the two parts of the visible name are never read as two.
              <Link className="wordmark" to={{ name: 'home' }} aria-label={t('app.name')}>
                {WORDMARK}
              </Link>
            )}
            <div className="masthead-actions">
              {/* Not while the setup is owed, on its Sign in and Feedback pages either: there is no course to search yet. */}
              {!props.setup && (
                <Link className="search-circle" to={{ name: 'search', q: '' }} aria-label={t('search.open')} aria-current={route.name === 'search' ? 'page' : undefined}>
                  <SearchIcon aria-hidden="true" size={20} />
                </Link>
              )}
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
                        item.route.name === route.name ||
                        (item.route.name === 'settings' && (route.name === 'placement' || route.name === 'native-language')) ||
                        (item.route.name === 'themes' && route.name === 'theme')
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
        {inSetup ? (
          <Setup onFinish={finishSetup} onFocus={setSetupFocus} />
        ) : asking ? (
          <LevelAsk onDone={() => props.onLevelAsked?.()} onFocus={setSetupFocus} {...(props.levelLead ? { lead: props.levelLead } : {})} />
        ) : (
          <Screen route={route} />
        )}
      </main>
    </div>
  )
}
