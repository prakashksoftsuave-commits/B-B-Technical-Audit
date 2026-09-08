import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { FilterChip } from './components/Bits'
import { IconBars, IconBell, IconDown, IconHome, IconRefresh, IconStatement, IconTrace }
  from './components/Icons'
import { timeAgo } from './utils'
import Home from './views/Home'
import Consolidation from './views/Consolidation'
import Lineage from './views/Lineage'

// "Riverside Towers - Manapakkam · RA bill certified (Aug 2026)" instead of the raw subject
// line - parsed server-side the same way inbox.py itself will route it, so what the bell says
// arrived is exactly what R1 will actually file it as. Falls back to the raw subject only for
// something the router itself could not place (still worth surfacing, just not annotatable).
function describeArrival(a) {
  if (a.project && a.kind && a.month) return `${a.project} · ${a.kind} (${a.month})`
  if (a.project && a.kind) return `${a.project} · ${a.kind}`
  return a.subject || '(no subject)'
}

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
  const [now, setNow] = useState(() => new Date())
  // A small, shared corner-toast stack - reminders can be sent from two different screens
  // (Home's Evidence status, Financial Outcome's per-line hover), so the confirmation lives
  // once here rather than being built twice.
  const [toasts, setToasts] = useState([])
  const pushToast = useCallback((text, tone = 'ok') => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { id, text, tone }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])
  // Download's own filter choice is deliberately independent of whatever Financial Outcome
  // happens to be showing - a popup, not a read of the page's live state.
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [dlProj, setDlProj] = useState('all')
  // A range, not a single pick - null until touched, so the default (both ends = the latest
  // sampled month) tracks whatever the dataset currently is instead of freezing at whatever
  // month existed when this component first mounted.
  const [dlMonthFrom, setDlMonthFrom] = useState(null)
  const [dlMonthTo, setDlMonthTo] = useState(null)
  // Each view owns its own filter state, but the controls render up here, in the space beside
  // the page title - a portal target rather than lifted state, so views stay self-contained.
  const [filterHost, setFilterHost] = useState(null)
  // A one-shot handoff for "take me to X, already filtered to Y" links (Home's View Outcome,
  // Source Data's View in Financial Outcome, Financial Outcome's Trace Source). The target
  // view reads it once in its own useState initializer, then this clears itself so a later
  // plain nav-bar click doesn't reapply a stale filter.
  const [navFocus, setNavFocus] = useState(null)
  // A simple back-stack of view ids, one entry per real navigation (not every render) - lets
  // any page-to-page link (Home's cards, Financial Outcome's Trace source, Source Data's View
  // in Financial Outcome) get a genuine "go back to where I actually came from" instead of a
  // hardcoded "back to Home" that would be wrong for a Source Data -> Financial Outcome hop.
  const [navHistory, setNavHistory] = useState([])
  // New-mail notification: a count + the parsed arrivals behind it, built up from background
  // polls and cleared the moment Sync folds them into a real run. Sync itself also fetches
  // mail, so this is purely "something landed since you last looked", never a second source
  // of truth.
  const [newMail, setNewMail] = useState({ count: 0, arrivals: [] })
  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef(null)

  const onNavigate = useCallback((id, focus) => {
    // A no-op link to the page already showing (e.g. re-clicking the active nav tab) is not a
    // real hop - pushing it would make Back bounce in place instead of actually going back.
    setNavHistory((h) => (id === view ? h : [...h, view]))
    setView(id)
    if (focus) setNavFocus(focus)
  }, [view])

  // Pops one entry rather than pushing a matching "forward" one - this is a breadcrumb trail
  // back up the chain a reader actually clicked through, not a full browser-style history.
  const goBack = useCallback(() => {
    setNavHistory((h) => {
      if (!h.length) return h
      setView(h[h.length - 1])
      return h.slice(0, -1)
    })
  }, [])

  useEffect(() => { if (navFocus) setNavFocus(null) }, [view])

  const refreshHealth = useCallback(async () => {
    try { setHealth(await api.health()) } catch { setHealth(null) }
  }, [])

  // A ref, not the `busy` state, guards re-entrancy - `doRun` is memoized once via
  // useCallback, so a closure over `busy` itself would only ever see its value from that
  // first render (stale forever), never the live one. The ref is always read fresh, so a
  // second Sync click - or the bell's "Sync now" firing at the same moment - genuinely no-ops
  // instead of racing a second read of Tally/ERP/mail underneath the first.
  const runningRef = useRef(false)
  const doRun = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setBusy('run'); setErr(null); setMail(null)
    try {
      const next = await api.run(false)
      setState(next)
      setMail(next.meta.mail || null)
      // Sync fetches mail as part of the same call - if that turned up something new, say so
      // the same way the background poll would have, rather than only the bell ever
      // confirming an arrival. Runs whether or not the poll ever got a chance to fire first.
      // Otherwise a plain success toast, so a Sync that found nothing new still visibly
      // confirms it actually ran rather than leaving the button as the only evidence.
      const arrived = next.meta.mail?.arrivals || []
      if (arrived.length > 0) {
        pushToast(`Synced ${arrived.length} new return${arrived.length === 1 ? '' : 's'}: `
          + arrived.map(describeArrival).join('; '))
      } else {
        pushToast('Sync completed successfully.')
      }
      setNewMail({ count: 0, arrivals: [] })
      await refreshHealth()
    } catch (e) {
      setErr(e.message || 'The run could not be completed.')
      pushToast(e.message || 'Sync failed.', 'bad')
    } finally {
      setBusy(null)
      runningRef.current = false
    }
  }, [refreshHealth, pushToast])

  useEffect(() => {
    (async () => {
      await refreshHealth()
      try { setState(await api.state()) } catch { /* nothing has run yet */ }
      setBusy(null)
    })()
  }, [refreshHealth])

  // Background poll for new mail, so the bell can light up without anyone clicking Sync.
  // Only runs once a mailbox is actually configured - otherwise there is nothing to poll for,
  // and no point hitting the endpoint every cycle. Deliberately does NOT rebuild the report:
  // it only pulls new messages into the folder (mailbox.fetch() itself dedupes them), Sync is
  // still the one thing that folds them into a figure. Also fires a corner toast, not just the
  // bell badge - a badge is easy to miss entirely if no one happens to look at the nav rail.
  const pollBusy = useRef(false)
  useEffect(() => {
    if (!health?.mailboxConfigured) return undefined
    const poll = async () => {
      // setInterval fires every 45s regardless of whether the last poll finished, and
      // visibilitychange can fire on top of that - without this guard, overlapping calls each
      // wait their own turn behind the mailbox's fetch lock, and a Sync click can land at the
      // back of a queue several polls deep instead of behind at most one real fetch. The
      // backend also skips (wait=False) rather than queues for this same reason - belt and
      // braces, since a second browser tab polling on its own timer would only be caught here.
      if (pollBusy.current) return
      pollBusy.current = true
      try {
        const r = await api.fetchMail()
        if (r.fetched > 0) {
          setNewMail((prev) => ({
            count: prev.count + r.fetched,
            arrivals: [...(r.arrivals || []), ...prev.arrivals].slice(0, 20),
          }))
          const arrived = r.arrivals || []
          pushToast(`${r.fetched} new return${r.fetched === 1 ? '' : 's'} received`
            + (arrived.length ? `: ${arrived.map(describeArrival).join('; ')}` : ''))
        }
      } catch { /* a poll failing is not worth surfacing - Sync reports mail errors properly */
      } finally {
        pollBusy.current = false
      }
    }
    const id = setInterval(poll, 45000)
    // Most browsers throttle or fully pause setInterval in a backgrounded tab, so a poll timed
    // to fire while the tab was hidden can silently stall for minutes. Checking again the
    // moment the tab regains focus means a return sent while you were elsewhere still shows up
    // within a second of coming back, not whenever the throttled timer next happens to fire.
    const onVisible = () => { if (document.visibilityState === 'visible') poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [health?.mailboxConfigured, pushToast])

  useEffect(() => {
    if (!bellOpen) return undefined
    const onDocClick = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [bellOpen])

  useEffect(() => {
    if (!downloadOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setDownloadOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [downloadOpen])

  // Ticks the "Last synced Xm ago" label without needing a new run - only the clock moves.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])

  const active = VIEWS.find((v) => v.id === view) || VIEWS[0]
  const src = state?.meta?.source?.startsWith('live') ? 'Tally connected' : 'Reading saved data'

  // Deliberately independent of whatever Financial Outcome is currently filtered to - the
  // popup's own choice is the only thing that decides what gets downloaded.
  const dlMonthOptions = state?.masters?.months || []
  const dlLatestMonth = dlMonthOptions.length ? dlMonthOptions[dlMonthOptions.length - 1].key : ''
  const dlFrom = dlMonthFrom || dlLatestMonth
  const dlTo = dlMonthTo || dlLatestMonth

  const downloadParams = new URLSearchParams()
  if (dlProj !== 'all') downloadParams.set('project', dlProj)
  if (dlFrom) downloadParams.set('month', dlFrom)
  if (dlTo && dlTo !== dlFrom) downloadParams.set('monthTo', dlTo)
  const downloadHref = downloadParams.toString() ? `${api.reportUrl}?${downloadParams}` : api.reportUrl

  return (
    <div className="shell">
      <div className="nav-rail">
        <nav className="nav" aria-label="Sections">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true"><IconBars /></span>
            Monthly<i>Outcome</i>
          </div>

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

          <div className="bell-wrap" ref={bellRef}>
            <button type="button" className="bell" aria-label="Notifications"
                    onClick={() => setBellOpen((o) => !o)}>
              <IconBell />
              {newMail.count > 0 && <span className="bell-badge">{newMail.count}</span>}
            </button>
            {bellOpen && (
              <div className="bell-menu">
                <div className="bell-menu-head">New returns</div>
                {newMail.count === 0 ? (
                  <div className="bell-menu-empty">Nothing new since the last sync.</div>
                ) : (
                  <>
                    <ul className="bell-menu-list">
                      {newMail.arrivals.slice(0, 8).map((a, i) => (
                        <li key={i}>
                          <div className="bell-arrival-main">
                            {a.project && a.kind ? `${a.project} · ${a.kind}`
                              : (a.subject || '(no subject)')}
                          </div>
                          {a.month && <div className="bell-arrival-sub">{a.month}</div>}
                        </li>
                      ))}
                    </ul>
                    <button className="btn btn-ink btn-sm" type="button" disabled={!!busy}
                            onClick={() => { setBellOpen(false); doRun() }}>
                      {busy === 'run' ? <span className="spin" /> : null}
                      Sync now
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* One indicator, not two - while Sync is running the button itself says so (below);
              this slot only ever shows the quiet, at-rest "Last synced" fact, never a second,
              competing "Syncing…" of its own. Completion is announced once, as a corner toast,
              not as text lingering in this slot after the fact. */}
          {busy !== 'run' && state?.meta?.ranAt && (
            <span className="sync-status" title={new Date(state.meta.ranAt).toLocaleString()}>
              Last synced {timeAgo(state.meta.ranAt, now)}
            </span>
          )}

          <button className="btn btn-ink btn-sm" type="button" onClick={doRun}
                  disabled={!!busy}
                  title={`${health?.tally ? 'Tally connected' : src} · `
                    + (health?.mailboxConfigured ? 'Mailbox live' : 'Returns from folder')}>
            {busy === 'run' ? <span className="spin" /> : <IconRefresh />}
            {busy === 'run' ? 'Syncing…' : 'Sync'}
          </button>

          <button className="btn btn-out btn-sm" type="button" disabled={!state}
                  onClick={() => setDownloadOpen(true)}>
            <IconDown />
            Download
          </button>
        </nav>
      </div>

      <main className="band col" id={`tab-${view}`}>
        <div className="pagetitle">
          <div>
            {navHistory.length > 0 && (
              <button type="button" className="project-back" onClick={goBack}>
                ← Back to {VIEWS.find((v) => v.id === navHistory[navHistory.length - 1])?.label}
              </button>
            )}
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
              {mail.arrivals?.length ? `: ${mail.arrivals.map(describeArrival).join('; ')}` : ''}
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
                                onNavigate={onNavigate} filterHost={filterHost} navFocus={navFocus}
                                onToast={pushToast} />}
      </main>

      {downloadOpen && state && (
        <div className="modal-backdrop" onClick={() => setDownloadOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
               aria-label="Download report">
            <div className="modal-head">
              <h3>Download report</h3>
              <button type="button" className="modal-close" aria-label="Close"
                      onClick={() => setDownloadOpen(false)}>×</button>
            </div>
            <p className="modal-sub">
              Choose what to include - independent of whatever Financial Outcome is currently
              showing on screen.
            </p>
            <div className="modal-filters">
              <FilterChip label="Project" value={dlProj} onChange={(e) => setDlProj(e.target.value)}
                          options={[{ value: 'all', label: 'All projects' },
                            ...state.masters.projects.map((p) => ({ value: p.code, label: p.name }))]} />
              <FilterChip label="From month" value={dlFrom}
                          onChange={(e) => {
                            const v = e.target.value
                            setDlMonthFrom(v)
                            if (v > dlTo) setDlMonthTo(v)
                          }}
                          options={dlMonthOptions.map((m) => ({ value: m.key, label: m.label }))} />
              <FilterChip label="To month" value={dlTo}
                          onChange={(e) => {
                            const v = e.target.value
                            setDlMonthTo(v)
                            if (v < dlFrom) setDlMonthFrom(v)
                          }}
                          options={dlMonthOptions.map((m) => ({ value: m.key, label: m.label }))} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDownloadOpen(false)}>
                Cancel
              </button>
              <a className="btn btn-ink btn-sm" href={downloadHref} download
                 onClick={() => setDownloadOpen(false)}>
                <IconDown />
                Download
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </div>
  )
}
