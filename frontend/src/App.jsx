import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { IconDown, IconHome, IconRefresh, IconStatement, IconTrace } from './components/Icons'
import Home from './views/Home'
import Consolidation from './views/Consolidation'
import Lineage from './views/Lineage'

// Three pages, three different questions. Outcome Readiness is not a fourth page - its
// content now lives inside Home (portfolio-level "what's blocking finalization") and
// Financial Outcome (line-level decisions, right where they get resolved).
const VIEWS = [
  { id: 'home', label: 'Home', Icon: IconHome, Comp: Home,
    title: 'Financial Dashboard',
    lede: 'Overall financial position and reconciliation status across all projects.',
    count: () => null },
  { id: 'consolidation', label: 'Financial Outcome', Icon: IconStatement, Comp: Consolidation,
    title: 'Financial Outcome',
    lede: 'Project financial performance, reconciliation and final outcome.',
    count: () => null },
  { id: 'source', label: 'Source Data', Icon: IconTrace, Comp: Lineage,
    title: 'Source Data',
    lede: 'Trace every financial figure back to its original source.',
    count: (s) => s.lineage.length },
]

export default function App() {
  const [health, setHealth] = useState(null)
  const [state, setState] = useState(null)
  const [view, setView] = useState('home')
  const [busy, setBusy] = useState('boot')
  const [err, setErr] = useState(null)
  const [mail, setMail] = useState(null)
  const [reportFilter, setReportFilter] = useState({ proj: 'all', month: null })
  // Each view owns its own filter state, but the controls render up here, in the space beside
  // the page title - a portal target rather than lifted state, so views stay self-contained.
  const [filterHost, setFilterHost] = useState(null)
  // A one-shot handoff for "take me to X, already filtered to Y" links (Home's View Outcome,
  // Source Data's View in Financial Outcome, Financial Outcome's Trace Source). The target
  // view reads it once in its own useState initializer, then this clears itself so a later
  // plain nav-bar click doesn't reapply a stale filter.
  const [navFocus, setNavFocus] = useState(null)

  const onNavigate = useCallback((id, focus) => {
    setView(id)
    if (focus) setNavFocus(focus)
  }, [])

  useEffect(() => { if (navFocus) setNavFocus(null) }, [view])

  const refreshHealth = useCallback(async () => {
    try { setHealth(await api.health()) } catch { setHealth(null) }
  }, [])

  const doRun = useCallback(async () => {
    setBusy('run'); setErr(null); setMail(null)
    try {
      const next = await api.run(false)
      setState(next)
      setMail(next.meta.mail || null)
      await refreshHealth()
    } catch (e) {
      setErr(e.message || 'The run could not be completed.')
    } finally { setBusy(null) }
  }, [refreshHealth])

  useEffect(() => {
    (async () => {
      await refreshHealth()
      try { setState(await api.state()) } catch { /* nothing has run yet */ }
      setBusy(null)
    })()
  }, [refreshHealth])

  const active = VIEWS.find((v) => v.id === view) || VIEWS[0]
  const src = state?.meta?.source?.startsWith('live') ? 'Tally connected' : 'Reading saved data'

  const reportParams = new URLSearchParams()
  if (view === 'consolidation') {
    if (reportFilter.proj !== 'all') reportParams.set('project', reportFilter.proj)
    if (reportFilter.month && reportFilter.month !== 'all') reportParams.set('month', reportFilter.month)
  }
  const reportHref = reportParams.toString() ? `${api.reportUrl}?${reportParams}` : api.reportUrl

  return (
    <div className="shell">
      <div className="nav-rail">
        <nav className="nav" aria-label="Sections">
          <div className="brand">Monthly<i>Outcome</i></div>

          <div className="nav-links">
            {VIEWS.map(({ id, label, Icon, count, hot }) => {
              const n = state ? count(state) : null
              return (
                <button
                  key={id}
                  type="button"
                  className={id === 'consolidation' ? 'nav-primary' : undefined}
                  aria-current={id === view ? 'page' : undefined}
                  onClick={() => onNavigate(id)}
                  disabled={!state}
                >
                  <Icon />
                  {label}
                  {n ? (
                    <span className={`n${hot && hot(state) ? ' hot' : ''}`}>{n}</span>
                  ) : null}
                </button>
              )
            })}
          </div>

          <div className="spacer" />

          <div className="link-state">
            <span className={`dot ${health?.tally ? 'd-ok' : 'd-mute'}`} />
            {src}
          </div>

          <div className="link-state" title={health?.mailbox || 'no mailbox configured'}>
            <span className={`dot ${health?.mailboxConfigured ? 'd-ok' : 'd-mute'}`} />
            {health?.mailboxConfigured ? 'Mailbox live' : 'Returns from folder'}
          </div>

          <button className="btn btn-quiet btn-sm" type="button" onClick={doRun}
                  disabled={!!busy}>
            {busy === 'run' ? <span className="spin" /> : <IconRefresh />}
            Refresh
          </button>

          <a className="btn btn-ink btn-sm" href={reportHref}>
            <IconDown />
            Excel
          </a>
        </nav>
      </div>

      <main className="band col" id={`tab-${view}`}>
        <div className="pagetitle">
          <div>
            <h1>{active.title}</h1>
            <p className="lede">{active.lede}</p>
          </div>
          <div className="pagetitle-filters" ref={setFilterHost} />
        </div>

        {err && (
          <div className="section">
            <div className="banner banner-err">{err}</div>
          </div>
        )}

        {mail?.error && (
          <div className="section">
            <div className="banner banner-err">
              Mailbox: {mail.error} — the figures below are from the returns already on file.
            </div>
          </div>
        )}

        {mail?.fetched > 0 && (
          <div className="section">
            <div className="banner banner-ok">
              {mail.fetched} new {mail.fetched === 1 ? 'return' : 'returns'} received
              {mail.subjects?.length ? `: ${mail.subjects.join('; ')}` : ''}
            </div>
          </div>
        )}

        {busy === 'boot' && (
          <div className="center"><span className="spin" style={{
            borderColor: 'var(--line)', borderTopColor: 'var(--ink)' }} /></div>
        )}

        {!state && busy !== 'boot' && !err && (
          <div className="center">
            <div>
              <h2>Nothing read yet</h2>
              <p>
                Read Tally, the ERP and the mailbox, and consolidate this period&apos;s
                figures.
              </p>
              <button className="btn btn-ink" onClick={doRun} disabled={!!busy}>
                {busy === 'run' ? <span className="spin" /> : null}
                Read the sources
              </button>
            </div>
          </div>
        )}

        {state && <active.Comp state={state} onStateChange={setState}
                                onFilterChange={(proj, month) => setReportFilter({ proj, month })}
                                onNavigate={onNavigate} filterHost={filterHost} navFocus={navFocus} />}
      </main>
    </div>
  )
}
