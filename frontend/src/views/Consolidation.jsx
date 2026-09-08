import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import DataTable from '../components/DataTable'
import { Card, FilterChip, KpiCard, Pill, Section, Tabs } from '../components/Bits'
import { PerfChart, StatusDonut } from '../components/Charts'
import { useMailEvidence } from '../components/EvidenceDrawer'
import { IconCheck, IconChartBar, IconCoins, IconFlag, IconPercent, IconReceipt,
  IconScales, IconTable, IconTrendUp } from '../components/Icons'
// Same lazy-loading reasoning as EvidenceDrawer.jsx's own DocumentViewer import - pdfjs-dist is
// sizeable and used by nothing else on this page, so it only loads once an auditor actually
// clicks to view a file, not on every Financial Outcome page load.
const DocumentViewer = lazy(() => import('../components/DocumentViewer'))
import { compact, money, signed, TONE } from '../utils'
import { buildReconciliationRows, canTrace, decisionPill, isTotal, lineStatus, StatusPill,
  STATUS_TONE, STATUS_LABEL, traceLineage, untraceable, worstStatus } from '../reconciliation'

/* One financial story per project, not three reports stacked. Tender -> Revenue -> ERP/Tally/
   Mail -> Reconciliation -> Auditor decision -> Approved cost -> Remaining tender -> Profit is
   one arithmetic chain, and everything on this page is a view of that same chain at a
   different grain - the flow strip at the whole-selection level, the item table at the line
   level, the waterfall at the "why this number" level. Every Approved/Final figure traces back
   to either an agreed line or a decision an auditor actually made through this screen.

   Two results, never conflated: CURRENT is what the resolved-so-far data supports right now
   (agreed lines and decisions already made) - the internal field names still say "provisional"
   (outcome.py's own vocabulary), but the word never appears on screen, since a number a Finance
   Manager is meant to act on should never read as hedged. FINAL only exists once every line is
   decided and the month has been explicitly finalized, and then it is frozen - later decisions
   cannot move it without reopening it first. */

const dash = (v) => (v === null || v === undefined ? '—' : money(v))
const pct = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(2)}%`)

// ---------------------------------------------------------------------------- the statement

// A financial statement, not a dashboard: one row per line item, description left-aligned,
// amount right-aligned and tabular, a ruled total row rather than a floating metric block. No
// icon per row - an auditor reading this wants numbers, labels and alignment, not decoration.
function StatementTable({ rows }) {
  return (
    // Same overflow safety net DataTable's own table-wrap already uses elsewhere in this app -
    // if a narrow column ever can't fit this table's two columns, it scrolls inside its own
    // box instead of being silently clipped by the card around it.
    <div className="table-wrap">
      <table className="stmt-t">
        <thead><tr><th>Description</th><th>Amount</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.total ? 'total' : r.sub ? 'sub' : undefined}>
              <td>{r.label}</td>
              <td className={r.tone ? `t-${r.tone}` : undefined}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ResultBlock({ heading, note, tone, emphasis, children }) {
  return (
    <div className={`result-block${tone ? ` t-${tone}` : ''}${emphasis ? ' emphasis' : ''}`}>
      <div className="result-heading">{heading}</div>
      {note && <p className="result-note">{note}</p>}
      {children}
    </div>
  )
}

function FinancialFlow({ hero, onFinalize, onReopen, onReview, canFinalize, canReopen, canReview, busy }) {
  const finalResolved = hero.profit !== null && hero.profit !== undefined
  // Revenue = Cost + Profit, at the point every line has an approved figure - never a second
  // formula for the same number outcome.py's approvedRevenue already carries.
  const finalRevenue = hero.profit !== null && hero.approvedCost !== null
    ? hero.profit + hero.approvedCost : null

  const contractRows = [
    { label: 'Contract Value (Tender)', value: compact(hero.tender) },
    { label: 'Revenue Recognized',
      value: hero.provisionalRevenue === null ? 'Pending' : compact(hero.provisionalRevenue) },
    { label: 'Remaining Contract Value', total: true,
      value: hero.provisionalRemaining === null ? 'Pending' : compact(hero.provisionalRemaining) },
  ]
  const performanceRows = [
    { label: 'Revenue Recognized',
      value: hero.provisionalRevenue === null ? 'Pending' : compact(hero.provisionalRevenue) },
    { label: 'Cost Incurred', value: compact(hero.provisionalCost) },
    {
      label: 'Profit / Loss', total: true,
      value: hero.provisionalProfit === null ? 'Pending' : compact(hero.provisionalProfit),
      tone: hero.provisionalProfit === null ? 'warn' : hero.provisionalProfit >= 0 ? 'good' : 'bad',
    },
    { label: 'Profit Margin', sub: true,
      value: hero.provisionalMargin !== null && hero.provisionalMargin !== undefined
        ? `${hero.provisionalMargin}%` : 'Pending' },
    { label: 'Audit Impact', sub: true, value: compact(hero.underReview),
      tone: hero.underReview ? 'warn' : 'good' },
  ]
  const finalContractRows = [
    { label: 'Contract Value (Tender)', value: compact(hero.tender) },
    { label: 'Revenue Recognized', value: finalRevenue === null ? 'Pending' : compact(finalRevenue) },
    { label: 'Remaining Contract Value', total: true,
      value: hero.remaining === null ? 'Pending' : compact(hero.remaining) },
  ]
  const finalPerformanceRows = [
    { label: 'Revenue Recognized', value: finalRevenue === null ? 'Pending' : compact(finalRevenue) },
    { label: 'Final Approved Cost', tone: finalResolved ? undefined : 'warn',
      value: finalResolved ? compact(hero.approvedCost) : 'Pending' },
    {
      label: 'Final Profit / Loss', total: true,
      value: finalResolved ? compact(hero.profit) : 'Pending',
      tone: finalResolved ? (hero.profit >= 0 ? 'good' : 'bad') : 'warn',
    },
    { label: 'Final Margin', sub: true, tone: finalResolved ? undefined : 'warn',
      value: finalResolved && hero.margin !== null ? `${hero.margin}%` : 'Pending' },
    { label: 'Audit Status', sub: true, value: <StatusPill status={hero.status} /> },
  ]

  return (
    <>
      <ResultBlock heading="Current result — from data resolved so far">
        <div className="stmt-columns">
          <div>
            <div className="flow-group-label">Contract position</div>
            <StatementTable rows={contractRows} />
          </div>
          <div>
            <div className="flow-group-label">Financial performance</div>
            <StatementTable rows={performanceRows} />
          </div>
        </div>
      </ResultBlock>

      <ResultBlock heading="Final financial outcome" emphasis
                   tone={finalResolved ? undefined : 'warn'}
                   note="Final values are shown once every applicable financial line is decided and finalized.">
        <div className="stmt-columns">
          <div>
            <div className="flow-group-label">Contract position</div>
            <StatementTable rows={finalContractRows} />
          </div>
          <div>
            <div className="flow-group-label">Financial performance</div>
            <StatementTable rows={finalPerformanceRows} />
          </div>
        </div>
        {(canReview || canFinalize || canReopen) && (
          <div className="stmt-actions">
            {canReview && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={onReview}>
                Review
              </button>
            )}
            {canReopen && (
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy}
                      onClick={onReopen}>
                Reopen
              </button>
            )}
            {canFinalize && (
              <button type="button" className="btn btn-approve btn-sm" disabled={busy}
                      onClick={onFinalize}>
                <IconCheck /> Approve &amp; Finalize
              </button>
            )}
          </div>
        )}
      </ResultBlock>
    </>
  )
}

// ---------------------------------------------------------------------------- profit waterfall

function ProfitWaterfall({ pos, cons, masters }) {
  const costLines = masters.lines.filter((l) => l.key !== 'revenue')
  const revenue = pos.lines.revenue.approved
  const rows = costLines.map(({ key, label }) => ({ label, value: pos.lines[key].approved,
    flag: !pos.lines[key].agrees }))
  const final = pos.profit !== null && pos.profit !== undefined
  return (
    <div className="waterfall">
      <div className="waterfall-row head"><span>Revenue</span><b>{dash(revenue)}</b></div>
      {rows.map((r) => (
        <div key={r.label} className={`waterfall-row${r.flag ? ' t-warn' : ''}`}>
          <span>{r.label}</span><b>{r.value === null ? 'pending' : `−${money(r.value)}`}</b>
        </div>
      ))}
      <div className="waterfall-row"><span>Mail/site expenses (salary, formwork)</span>
        <b>−{money(pos.mailCost)}</b></div>
      <div className="waterfall-row"><span>Adjustments (from mail)</span>
        <b>{signed(cons.adjustments.reduce((s, a) => s + a.amount, 0))}</b></div>
      <div className="waterfall-row total">
        <span>{final ? 'FINAL APPROVED COST' : 'COST SO FAR'}</span>
        <b>{money(final ? pos.approvedCost : pos.provisionalCost)}</b>
      </div>
      <div className={`waterfall-row total${final ? '' : ' t-warn'}`}>
        <span>{final ? 'FINAL PROFIT' : 'CURRENT PROFIT'}</span>
        <b>{dash(final ? pos.profit : pos.provisionalProfit)}</b>
      </div>
      <div className="waterfall-row emphasis">
        <span>PROFIT MARGIN</span>
        <b>{pct(final ? pos.margin : pos.provisionalMargin)}</b>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------- per-item table

// A "Not received" tag that is also the reminder action - hover it, and a popover names who
// it goes to and what for, with a Remind button right there. One send still covers everything
// outstanding for that project-month (service.send_reminder's own batching), not just this one
// line, so the popover says so rather than implying a narrower scope than what actually fires.
//
// Portal'd to <body> and positioned from the trigger's own getBoundingClientRect, not CSS
// top/left on a relatively-positioned parent - the table this sits in scrolls internally, and
// an absolutely-positioned popover would just get clipped by that, not float free the way a
// hover card should. Position is recomputed after the popover itself has a size, then nudged
// back on screen if it would run off the right edge or the bottom.
function RemindTag({ owner, item, projectName, monthLabel, project, month, onToast }) {
  const [open, setOpen] = useState(false)
  const [st, setSt] = useState(null)
  const [pos, setPos] = useState(null)
  const triggerRef = useRef(null)
  const popRef = useRef(null)
  const closeTimer = useRef(null)

  const openNow = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpen(true)
  }
  const closeSoon = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const t = triggerRef.current.getBoundingClientRect()
    const pw = popRef.current?.offsetWidth || 260
    const ph = popRef.current?.offsetHeight || 150
    const margin = 12
    let left = t.left
    let top = t.bottom + 8
    if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin
    if (left < margin) left = margin
    if (top + ph > window.innerHeight - margin) top = t.top - ph - 8
    if (top < margin) top = margin
    setPos({ top, left })
  }, [open, st])

  async function send() {
    setSt('sending')
    try {
      const res = await api.sendReminder(project, month, 'Audit Lead')
      setSt('sent')
      onToast?.(`Reminder sent to ${res.to}`)
    } catch (e) {
      setSt(e.message || 'Send failed')
      onToast?.(e.message || 'Reminder failed to send', 'bad')
    }
  }

  return (
    <span className="remind-hover" ref={triggerRef} onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <Pill tone="bad">Not received</Pill>
      {open && createPortal(
        <div className="remind-popover" ref={popRef}
             style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999,
               visibility: pos ? 'visible' : 'hidden' }}
             onMouseEnter={openNow} onMouseLeave={closeSoon}>
          <div className="remind-popover-head">Send reminder</div>
          <div className="remind-popover-row"><span>To</span><b>{owner}</b></div>
          <div className="remind-popover-row"><span>For</span><b>{item} · {projectName} ({monthLabel})</b></div>
          <div className="remind-popover-note">
            Covers everything still outstanding for {projectName} this month, not just this line.
          </div>
          <button type="button" className="btn btn-ink btn-xs" style={{ width: '100%', justifyContent: 'center' }}
                  disabled={st === 'sending' || st === 'sent'} onClick={send}>
            {st === 'sending' ? 'Sending…' : st === 'sent' ? 'Sent ✓' : st ? 'Retry' : 'Remind'}
          </button>
        </div>,
        document.body,
      )}
    </span>
  )
}

// A drilled-down source record, inline. For a mail-sourced one this fetches the same real email
// evidence (from/subject/attachments) the Source Data drawer's own evidence card does - the
// records are already listed one per row here (that's what "expand the line item" did), so there
// is no separate list-of-records step the way the drawer has one; clicking goes straight to the
// file, the same real endpoint (api.evidenceAttachmentUrl) and viewer (DocumentViewer) Source
// Data uses. ERP/Tally records have no attachment to view - they stay plain text, same as before.
function DrillItemCell({ record, onOpenDocument }) {
  const isMail = record.source === 'Return' || record.source === 'Unrouted'
  const evidence = useMailEvidence(isMail ? record.attachmentId : null)
  const label = <>{record.description}{record.ref ? ` (${record.ref})` : ''}</>
  if (!isMail) return <span className="child-item">{label}</span>
  const attachments = evidence?.data?.attachments || []
  if (!evidence) {
    return <span className="child-item">{label} <em className="dim-note">· loading evidence…</em></span>
  }
  if (evidence.error || !attachments.length) return <span className="child-item">{label}</span>
  // Exactly one attachment per return in this system's real data (see DocumentViewer.jsx) -
  // opens it directly rather than making the reader pick from a list of one. No visible "View
  // file" label - the row reads exactly like any other drill-down record, clickable the same
  // way the item name above it is.
  return (
    <button type="button" className="link-btn child-item-link"
            onClick={() => onOpenDocument({ record, attachment: attachments[0] })}>
      {label}
    </button>
  )
}

function ItemTable({ project, month, rows, pos, masters, lineage, siteMailbox, onDecide, busy,
                      onToast, empty }) {
  const lineLabel = Object.fromEntries(masters.lines.map((l) => [l.key, l.label]))
  const projectName = masters.projects.find((p) => p.code === project)?.name || project
  const monthLabel = masters.months.find((m) => m.key === month)?.label || month
  const locked = pos.status === 'FINALIZED'

  const [open, setOpen] = useState(() => new Set())
  const toggle = (key) => setOpen((prev) => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const drillDown = (r) => traceLineage(r, { project, month, lineage, lineLabel })

  // A small, real ratio - not a second difference metric, just the existing amount-based
  // Difference expressed against ERP's own figure so a reader can compare severity across rows
  // of very different scale at a glance. Dash wherever there's no ERP/Tally comparison to ratio
  // against in the first place (mail-only rows, adjustments, the derived stock line).
  const diffPct = (r) => (r.diff !== null && r.diff !== undefined && r.erp
    ? Math.round((r.diff / r.erp) * 1000) / 10 : null)

  // A line's source records expand inline, right under it - the same table, everywhere this
  // component is used (the all-projects view's compact per-project panel and the single-project
  // page alike), so a reader never gets a different interaction for the same action depending on
  // which project filter happens to be selected. The trigger lives on the item name itself, the
  // same ">" caret + label the project-row toggle uses elsewhere in this app - not a separate
  // button off in the Auditor Action column.
  const trace = (r) => toggle(r.key)

  // The file a mail-sourced drill-down row was clicked to view (DrillItemCell fetches its real
  // evidence and hands the resolved attachment back here).
  const [viewingDoc, setViewingDoc] = useState(null)

  return (
    <>
    <DataTable
      rows={rows.flatMap((r) => (open.has(r.key) && canTrace(r)
        ? [r, ...drillDown(r).map((d, i) => ({ ...d, _drill: true, _parentItem: r.item, key: `${r.key}-d${i}` }))]
        : [r]))}
      rowKey={(r) => r.key}
      rowClass={(r) => (r._drill ? 'row-child'
        : isTotal(r) ? 'row-total'
        : r.kind === 'mail' ? (r.missing ? 'row-flag' : undefined)
        : r.kind === 'adj' || r.kind === 'derived' ? undefined
        : !r.agrees ? 'row-flag' : undefined)}
      empty={empty || 'Nothing to show.'}
      cols={[
        {
          key: 'item', label: 'Item', sortable: false, nowrap: true,
          render: (r) => {
            if (r._drill) return <DrillItemCell record={r} onOpenDocument={setViewingDoc} />
            if (!canTrace(r)) return <span className="child-item">{r.item}</span>
            const isOpen = open.has(r.key)
            return (
              <button type="button" className="row-toggle" aria-expanded={isOpen}
                      title={isOpen ? 'Hide source detail' : 'View source detail'}
                      onClick={() => trace(r)}>
                <span className={`caret${isOpen ? ' open' : ''}`} aria-hidden="true">&gt;</span>
                {r.item}
              </button>
            )
          },
        },
        { key: 'erp', label: 'ERP', num: true, sortable: false,
          render: (r) => (r._drill ? (r.source !== 'Tally' && r.source !== 'Return'
            ? money(r.amount) : '') : dash(r.erp)) },
        { key: 'tally', label: 'Tally', num: true, sortable: false,
          render: (r) => (r._drill ? (r.source === 'Tally' ? money(r.amount) : '') : dash(r.tally)) },
        { key: 'mail', label: 'Mail/Site', num: true, sortable: false,
          render: (r) => (r._drill
            ? ((r.source === 'Return' || r.source === 'Unrouted') && r.amount != null
              ? money(r.amount) : '')
            : (r.kind === 'adj' || r.kind === 'derived') ? (r.mail === null ? '—' : signed(r.mail))
            : dash(r.mail)) },
        {
          key: 'consolidated', label: 'Consolidated amount', num: true, sortable: false,
          render: (r) => {
            if (r._drill) return ''
            if (r.approved === null || r.approved === undefined) return <span className="dim-note">Pending</span>
            return money(r.approved)
          },
        },
        { key: 'diff', label: 'Difference', num: true, sortable: false,
          render: (r) => (r._drill ? ''
            : r.diff === null || r.diff === undefined ? '—'
            : <span className={!r.agrees ? 'neg' : undefined}>{signed(r.diff)}</span>) },
        {
          key: 'diffPct', label: 'Difference %', num: true, sortable: false,
          render: (r) => {
            if (r._drill) return ''
            const p = diffPct(r)
            return p === null ? '—' : <span className={!r.agrees ? 'neg' : undefined}>{signed(p)}%</span>
          },
        },
        {
          key: 'status', label: 'Status', sortable: false,
          render: (r) => {
            if (r._drill) return null
            if (r.kind === 'mail') {
              if (r.missing) {
                return <RemindTag owner={siteMailbox || r.owner} item={r.item} projectName={projectName}
                                   monthLabel={monthLabel} project={project} month={month}
                                   onToast={onToast} />
              }
              if (r.restated) return <Pill tone="info">Restated</Pill>
              return <Pill tone="ok">Reported</Pill>
            }
            if (r.kind === 'adj') return <Pill tone={TONE[r.adjKind] || 'info'}>{r.reason}</Pill>
            if (r.kind === 'derived') return <Pill tone="info">Computed</Pill>
            if (r.kind === 'total-cost') return <Pill tone={r.final ? 'ok' : 'warn'}>{r.final ? 'Final' : 'Current'}</Pill>
            if (r.kind === 'salary' && r.missing) {
              return <RemindTag owner={siteMailbox || r.owner} item={r.item} projectName={projectName}
                                 monthLabel={monthLabel} project={project} month={month}
                                 onToast={onToast} />
            }
            return decisionPill(r)
          },
        },
        {
          key: 'action', label: 'Auditor action', sortable: false, wrap: true,
          render: (r) => {
            if (r._drill) return null
            if (r.kind === 'mail') {
              return r.missing
                ? <span className="dim-note">Owed by {r.owner}</span>
                : null
            }
            if (r.kind === 'adj' || r.kind === 'derived') return null
            if (r.kind === 'total-cost') return null
            if (r.kind === 'salary' && r.missing) {
              return <span className="dim-note">Owed by {r.owner}</span>
            }
            if (r.agrees) return <span className="dim-note">No decision needed</span>
            if (locked) {
              return <span className="dim-note">Locked, month finalized</span>
            }
            const inFlight = busy.has(r.kind === 'total' ? 'total' : r.ln)
            if (r.kind === 'total') {
              return <span className="dim-note">{r.approved === null ? 'Waiting on the lines above' : 'Resolved'}</span>
            }
            // Undecided: both options stay equally prominent, since either is a live choice to
            // make. Once a choice is recorded, only the chosen side keeps the solid "approved"
            // look - the other option drops back to an outline pill so the reader sees which one
            // won at a glance instead of two identical buttons either way. Salary is ERP-vs-mail
            // rather than ERP-vs-Tally, so its second option reads "Mail" and reads its value
            // from r.mail instead of r.tally - same buttons otherwise. Amounts stay visible
            // inline (compact() form) rather than hidden behind a hover, since the figure is
            // exactly what the decision is keyed on.
            const isSalary = r.kind === 'salary'
            const secondChoice = isSalary ? 'mail' : 'tally'
            const secondLabel = isSalary ? 'Mail' : 'Tally'
            const secondValue = isSalary ? r.mail : r.tally
            const chosenErp = r.decision?.choice === 'erp'
            const chosenSecond = r.decision?.choice === secondChoice
            return (
              <span className="action-cell decide-row-compact">
                <button type="button"
                        className={`btn-compact${!r.decision || chosenErp ? ' chosen' : ''}`}
                        disabled={inFlight} title={`Approve ERP (${money(r.erp)})`}
                        onClick={() => onDecide(r.ln, 'erp')}>
                  <span>{chosenErp && <IconCheck />} Approve ERP</span>
                  <b>{compact(r.erp)}</b>
                </button>
                <button type="button"
                        className={`btn-compact${!r.decision || chosenSecond ? ' chosen' : ''}`}
                        disabled={inFlight} title={`Approve ${secondLabel} (${money(secondValue)})`}
                        onClick={() => onDecide(r.ln, secondChoice)}>
                  <span>{chosenSecond && <IconCheck />} Approve {secondLabel}</span>
                  <b>{compact(secondValue)}</b>
                </button>
                {r.decision && (
                  <button type="button" className="btn-compact undo" disabled={inFlight}
                          onClick={() => onDecide(r.ln, null)}>
                    Undo
                  </button>
                )}
              </span>
            )
          },
        },
      ]}
    />
    {viewingDoc && (
      <Suspense fallback={null}>
        <DocumentViewer record={viewingDoc.record} item={{ label: viewingDoc.record._parentItem }}
                         projectName={projectName} attachment={viewingDoc.attachment}
                         basePath="Financial Outcome" onClose={() => setViewingDoc(null)} />
      </Suspense>
    )}
    </>
  )
}

// ---------------------------------------------------------------------------- reconciliation panel

const STAT_LABEL = { matched: 'Matched', 'needs-review': 'Needs review', reported: 'Reported',
  'not-received': 'Not received' }
// Same vocabulary Source Data's ITEM_STATUS already uses for these four states - matched/green,
// needs-review/orange, not-received/red, reported/blue - so a status never means a different
// colour depending on which page is showing it.
const STAT_COLOR = { matched: 'var(--ok-fg)', 'needs-review': 'var(--warn-fg)',
  'not-received': 'var(--bad-fg)', reported: 'var(--info-fg)' }
// A brighter tint of the same four hues, for the donut ring only - the -fg tokens above read
// dark/heavy filled edge-to-edge across a 34px-thick arc even though they read fine as small
// pill text and dots. Legend dots and any status text keep the darker -fg tokens so they never
// diverge from Source Data's own status colours; only the big filled ring gets the lift.
const STAT_CHART_COLOR = { matched: '#2e9d5f', 'needs-review': '#dba13a',
  'not-received': '#d9584a', reported: '#4a7fb0' }

// The tallies both the compact stat strip (all-projects expand) and the fuller Audit Status
// Overview (single-project page) read from - one function, so a count can never differ between
// the two just because they compute it separately.
function reconStats(rows) {
  const counted = rows.map((r) => ({ r, status: lineStatus(r) })).filter((x) => x.status)
  const total = counted.length
  const countOf = (s) => counted.filter((x) => x.status === s).length
  const stats = ['matched', 'needs-review', 'not-received', 'reported'].map((s) => ({
    key: s, label: STAT_LABEL[s], count: countOf(s), color: STAT_COLOR[s],
    share: total ? Math.round((countOf(s) / total) * 100) : 0,
  }))
  const exceptionRows = counted.filter((x) => x.status === 'needs-review' || x.status === 'not-received')
    .map((x) => x.r)
  const decidedRows = rows.filter((r) => r.decision)
  return { total, stats, exceptionRows, decidedRows }
}

// The three tab bodies, reused as-is by both the all-projects expand (ReconciliationPanel,
// below) and the dedicated single-project page - one rendering, never two, so the two can never
// grow apart in how they behave.
function ReconciliationTabsBody({ tab, project, month, rows, consolidationRows, exceptionRows,
                                   decidedRows, pos, masters, lineage, siteMailbox, onToast, busy,
                                   onDecide, projectName, monthLabel, emptyMessage }) {
  return (
    <>
      {tab === 'consolidation' && (
        <ItemTable project={project} month={month} rows={consolidationRows || rows} pos={pos}
                   masters={masters} lineage={lineage} siteMailbox={siteMailbox} onToast={onToast}
                   busy={busy} onDecide={onDecide} empty={emptyMessage} />
      )}

      {tab === 'exceptions' && (
        <DataTable
          rows={exceptionRows}
          rowKey={(r) => r.key}
          empty="Nothing outstanding - every line is matched or already decided."
          cols={[
            { key: 'item', label: 'Item', sortable: false },
            { key: 'erp', label: 'ERP', num: true, sortable: false, render: (r) => dash(r.erp) },
            { key: 'tally', label: 'Tally', num: true, sortable: false, render: (r) => dash(r.tally) },
            { key: 'mail', label: 'Mail/Site', num: true, sortable: false, render: (r) => dash(r.mail) },
            {
              key: 'diff', label: 'Difference', num: true, sortable: false,
              render: (r) => (r.diff === null || r.diff === undefined
                ? '—' : <span className="neg">{signed(r.diff)}</span>),
            },
            {
              key: 'status', label: 'Status', sortable: false,
              render: (r) => (r.missing
                ? <RemindTag owner={siteMailbox || r.owner} item={r.item} projectName={projectName}
                             monthLabel={monthLabel} project={project} month={month} onToast={onToast} />
                : <Pill tone="bad">Needs review</Pill>),
            },
          ]}
        />
      )}

      {tab === 'audit' && (
        <DataTable
          rows={decidedRows}
          rowKey={(r) => r.key}
          empty="No decisions recorded yet for this month."
          cols={[
            { key: 'item', label: 'Item', sortable: false },
            {
              key: 'choice', label: 'Approved', sortable: false,
              render: (r) => (r.decision.choice === 'erp' ? 'ERP'
                : r.decision.choice === 'tally' ? 'Tally'
                : r.decision.choice === 'mail' ? 'Mail' : 'Custom'),
            },
            { key: 'approved', label: 'Amount', num: true, sortable: false, render: (r) => money(r.approved) },
            { key: 'decidedBy', label: 'Decided by', sortable: false, render: (r) => r.decision.decidedBy || '—' },
            {
              key: 'decidedAt', label: 'Decided at', sortable: false,
              render: (r) => (r.decision.decidedAt ? r.decision.decidedAt.slice(0, 16).replace('T', ' ') : '—'),
            },
            {
              key: 'note', label: 'Note', wrap: true, sortable: false,
              render: (r) => r.decision.note || <span className="dim-note">—</span>,
            },
          ]}
        />
      )}
    </>
  )
}

// Tabs plus a stat strip wrapping the one set of reconciliation rows three ways - never three
// computations, just three filters/columns over buildReconciliationRows()'s own output. This is
// the all-projects view's compact per-project expand specifically; the dedicated single-project
// page (below) builds its own richer header/summary around the same reconStats()/
// ReconciliationTabsBody, so the two share every number without sharing this exact layout.
function ReconciliationPanel({ project, month, cons, pos, masters, lineage, siteMailbox, onToast,
                                busy, onDecide }) {
  const [tab, setTab] = useState('consolidation')
  // The donut/stat-list status filter - null means "show every line." Scoped to this one panel,
  // not lifted higher, since each project-month reads its own rows and a filter on one month's
  // table has no meaning for another's.
  const [statusFilter, setStatusFilter] = useState(null)
  const rows = useMemo(() => buildReconciliationRows({ cons, pos, masters }), [cons, pos, masters])
  const { total, stats, exceptionRows, decidedRows } = useMemo(() => reconStats(rows), [rows])
  const projectName = masters.projects.find((p) => p.code === project)?.name || project
  const monthLabel = masters.months.find((m) => m.key === month)?.label || month

  // Clicking a segment or its matching stat count both do the same thing: jump to Consolidation
  // View (the table a status filter actually applies to) and toggle that status on - clicking the
  // already-active one again clears it, so there's exactly one control for "on" and "off."
  const selectStatus = (key) => {
    setTab('consolidation')
    setStatusFilter((prev) => (prev === key ? null : key))
  }

  const filteredRows = statusFilter ? rows.filter((r) => lineStatus(r) === statusFilter) : rows
  const filterLabel = statusFilter && STAT_LABEL[statusFilter]
  const consolidationTabLabel = statusFilter
    ? `Consolidation View · ${filterLabel} (${filteredRows.length})`
    : 'Consolidation View'

  return (
    <div className="recon-panel">
      <div className="summary-donut-row">
        <div className="summary-waterfall">
          <ProfitWaterfall pos={pos} cons={cons} masters={masters} />
        </div>
        <div className="audit-overview">
          <div className="section-banner">Outcome Status</div>
          <div className="audit-overview-body">
            <StatusDonut segments={stats.map((s) => ({ ...s, color: STAT_CHART_COLOR[s.key] }))}
                         centerValue={total} centerLabel="Total" size={180} thickness={24}
                         activeKey={statusFilter} onSelect={selectStatus} />
            <div className="audit-overview-legend">
              {stats.map((s) => (
                <button key={s.key} type="button"
                        className={`legend-item${statusFilter === s.key ? ' active' : ''}`
                          + `${statusFilter && statusFilter !== s.key ? ' dimmed' : ''}`}
                        style={{ '--stat-color': s.color }} onClick={() => selectStatus(s.key)}>
                  <span className="legend-dot" aria-hidden="true" />
                  <span className="legend-label">{s.label}</span>
                  <span className="legend-count">{s.count}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="audit-overview-hint">
            {statusFilter
              ? <>Showing <b style={{ color: STAT_COLOR[statusFilter] }}>{filterLabel}</b> only.{' '}
                  <button type="button" className="status-filter-clear" onClick={() => setStatusFilter(null)}>
                    <span aria-hidden="true">×</span> Clear filter
                  </button>
                </>
              : 'Click a status to filter the items below.'}
          </p>
          {exceptionRows.length > 0 && (
            <div className="recon-pending audit-overview-pending">
              <span>Pending approval <b>{exceptionRows.length}</b> item{exceptionRows.length === 1 ? '' : 's'}</span>
              <button type="button" className="btn btn-quiet btn-sm"
                      onClick={() => { setTab('consolidation'); setStatusFilter('needs-review') }}>
                Review now
              </button>
            </div>
          )}
        </div>
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'consolidation', label: consolidationTabLabel },
        { key: 'exceptions', label: 'Exceptions & Pending', count: exceptionRows.length },
        { key: 'audit', label: 'Audit Trail', count: decidedRows.length },
      ]} />
      {tab === 'consolidation' && statusFilter && (
        <div className="filter-indicator">
          <span>Showing: {filterLabel} · {filteredRows.length} item{filteredRows.length === 1 ? '' : 's'}</span>
          <button type="button" aria-label="Clear filter" onClick={() => setStatusFilter(null)}>×</button>
        </div>
      )}

      <ReconciliationTabsBody tab={tab} project={project} month={month} rows={rows}
                               consolidationRows={filteredRows}
                               emptyMessage={statusFilter ? 'No items match this filter.' : undefined}
                               exceptionRows={exceptionRows} decidedRows={decidedRows} pos={pos}
                               masters={masters} lineage={lineage} siteMailbox={siteMailbox}
                               onToast={onToast} busy={busy} onDecide={onDecide}
                               projectName={projectName} monthLabel={monthLabel} />
    </div>
  )
}

// ---------------------------------------------------------------------------- single-project page

// One project, one month, everything an auditor needs to go from "what's the financial position"
// to "which lines need my decision" to "what evidence backs this number," without leaving the
// page. showHeader is false only when more than one month is in scope at once (the Month filter
// left on "All months" for a single project) - a rare secondary case, kept working via the same
// small per-month Section banner this page always used, rather than repeating the big project
// header once per month.
function ProjectDetailPanel({ pos, cons, masters, lineage, siteMailbox, onToast, busy, onDecide,
                               showHeader, canFinalize, canReopen, onFinalize,
                               onReopen, busyAction }) {
  const [tab, setTab] = useState('consolidation')
  // The donut/stat-list status filter - null means "show every line." Scoped to this one panel,
  // not lifted higher, since each project-month reads its own rows and a filter on one month's
  // table has no meaning for another's.
  const [statusFilter, setStatusFilter] = useState(null)
  const rows = useMemo(() => buildReconciliationRows({ cons, pos, masters }), [cons, pos, masters])
  const { total, stats, exceptionRows, decidedRows } = useMemo(() => reconStats(rows), [rows])

  // Clicking a segment or its matching stat count both do the same thing: jump to Consolidation
  // View (the table a status filter actually applies to) and toggle that status on - clicking the
  // already-active one again clears it, so there's exactly one control for "on" and "off."
  const selectStatus = (key) => {
    setTab('consolidation')
    setStatusFilter((prev) => (prev === key ? null : key))
  }

  const filteredRows = statusFilter ? rows.filter((r) => lineStatus(r) === statusFilter) : rows
  const filterLabel = statusFilter && STAT_LABEL[statusFilter]
  const consolidationTabLabel = statusFilter
    ? `Consolidation View · ${filterLabel} (${filteredRows.length})`
    : 'Consolidation View'

  const body = (
    <Card>
      {pos.finalized && (
        <p className="dim-note" style={{ marginBottom: 'var(--s3)' }}>
          Finalized by {pos.finalized.finalizedBy || 'unknown'} on{' '}
          {pos.finalized.finalizedAt?.slice(0, 10)}.
          {pos.finalized.reopened && ' Since reopened.'}
        </p>
      )}
      {!pos.finalized && pos.readyToFinalize && (
        <p className="dim-note" style={{ marginBottom: 'var(--s3)' }}>
          Every line is resolved — ready to finalize below.
        </p>
      )}
      <div className="summary-donut-row">
        <div className="summary-waterfall">
          <ProfitWaterfall pos={pos} cons={cons} masters={masters} />
        </div>
        <div className="audit-overview">
          <div className="section-banner">Outcome Status</div>
          <div className="audit-overview-body">
            <StatusDonut segments={stats.map((s) => ({ ...s, color: STAT_CHART_COLOR[s.key] }))}
                         centerValue={total} centerLabel="Total" size={280} thickness={34}
                         activeKey={statusFilter} onSelect={selectStatus} />
            <div className="audit-overview-legend">
              {stats.map((s) => (
                <button key={s.key} type="button"
                        className={`legend-item${statusFilter === s.key ? ' active' : ''}`
                          + `${statusFilter && statusFilter !== s.key ? ' dimmed' : ''}`}
                        style={{ '--stat-color': s.color }} onClick={() => selectStatus(s.key)}>
                  <span className="legend-dot" aria-hidden="true" />
                  <span className="legend-label">{s.label}</span>
                  <span className="legend-count">{s.count}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="audit-overview-hint">
            {statusFilter
              ? <>Showing <b style={{ color: STAT_COLOR[statusFilter] }}>{filterLabel}</b> only.{' '}
                  <button type="button" className="status-filter-clear" onClick={() => setStatusFilter(null)}>
                    <span aria-hidden="true">×</span> Clear filter
                  </button>
                </>
              : 'Click a status to filter the items below.'}
          </p>
          {exceptionRows.length > 0 && (
            <div className="recon-pending audit-overview-pending">
              <span>Pending approval <b>{exceptionRows.length}</b> item{exceptionRows.length === 1 ? '' : 's'}</span>
              <button type="button" className="btn btn-quiet btn-sm"
                      onClick={() => { setTab('consolidation'); setStatusFilter('needs-review') }}>
                Review now
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 'var(--s4)' }}>
        <Tabs active={tab} onChange={setTab} tabs={[
          { key: 'consolidation', label: consolidationTabLabel },
          { key: 'exceptions', label: 'Exceptions & Pending', count: exceptionRows.length },
          { key: 'audit', label: 'Audit Trail', count: decidedRows.length },
        ]} />
        {tab === 'consolidation' && statusFilter && (
          <div className="filter-indicator">
            <span>Showing: {filterLabel} · {filteredRows.length} item{filteredRows.length === 1 ? '' : 's'}</span>
            <button type="button" aria-label="Clear filter" onClick={() => setStatusFilter(null)}>×</button>
          </div>
        )}
        <ReconciliationTabsBody tab={tab} project={pos.project} month={pos.month} rows={rows}
                                 consolidationRows={filteredRows}
                                 emptyMessage={statusFilter ? 'No items match this filter.' : undefined}
                                 exceptionRows={exceptionRows} decidedRows={decidedRows} pos={pos}
                                 masters={masters} lineage={lineage} siteMailbox={siteMailbox}
                                 onToast={onToast} busy={busy} onDecide={onDecide}
                                 projectName={pos.projectName}
                                 monthLabel={pos.monthLabel} />
      </div>

      {(canFinalize || canReopen) && (
        <div className="stmt-actions" style={{ marginTop: 'var(--s3)' }}>
          {canReopen && (
            <button type="button" className="btn btn-quiet btn-sm" disabled={busyAction} onClick={onReopen}>
              Reopen
            </button>
          )}
          {canFinalize && (
            <button type="button" className="btn btn-approve btn-sm" disabled={busyAction} onClick={onFinalize}>
              <IconCheck /> Approve &amp; Finalize
            </button>
          )}
        </div>
      )}
    </Card>
  )

  if (showHeader) return body
  return (
    <Section label={pos.monthLabel} count={{ text: <StatusPill status={pos.status} /> }}>
      {body}
    </Section>
  )
}

// ---------------------------------------------------------------------------- page

function aggregate(rows, key) {
  const nums = rows.map((r) => r[key])
  return nums.some((v) => v === null || v === undefined) ? null : nums.reduce((s, v) => s + v, 0)
}

export default function Consolidation({ state, onStateChange, filterHost,
                                         navFocus, onNavigate, onToast }) {
  const { consolidation, masters, position, cumulative, poc, lineage, unattributed, outstanding,
          submission } = state
  const latest = masters.months.at(-1).key
  // Reminders go to the site's own mailbox (one per project, every kind), not the role label
  // masters.inputs carries ("Formwork department" etc.) - submission.rows already resolved the
  // real address per tracker.py's own CONTRIBUTORS lookup, so read it back rather than guessing.
  const siteMailbox = useMemo(() => {
    const map = {}
    for (const r of submission?.rows || []) if (!map[r.project]) map[r.project] = r.owner
    return map
  }, [submission])
  const [proj, setProj] = useState(() => navFocus?.project || 'all')
  const [month, setMonth] = useState(() => navFocus?.month || latest)
  const [busyKeys, setBusyKeys] = useState(() => new Set())
  const [busyAction, setBusyAction] = useState(false)
  const [finalizeAllResult, setFinalizeAllResult] = useState(null)
  const [outcomeView, setOutcomeView] = useState('table')

  useEffect(() => { setFinalizeAllResult(null) }, [month])

  const decide = async (project, mk, line, choice) => {
    const busyKey = `${project}|${mk}|${line}`
    setBusyKeys((prev) => new Set(prev).add(busyKey))
    try {
      const next = choice === null
        ? await api.undecide(project, mk, line)
        : await api.decide(project, mk, line, choice, { decidedBy: 'Technical Audit' })
      onStateChange(next)
    } catch (e) {
      window.alert(e.message || 'Could not record that decision.')
    } finally {
      setBusyKeys((prev) => { const n = new Set(prev); n.delete(busyKey); return n })
    }
  }

  const finalize = async (project, mk) => {
    setBusyAction(true)
    try {
      onStateChange(await api.finalize(project, mk, 'Technical Audit'))
    } catch (e) {
      window.alert(e.message || 'Could not finalize this month.')
    } finally { setBusyAction(false) }
  }

  const reopen = async (project, mk) => {
    setBusyAction(true)
    try {
      onStateChange(await api.reopen(project, mk, 'Technical Audit'))
    } catch (e) {
      window.alert(e.message || 'Could not reopen this month.')
    } finally { setBusyAction(false) }
  }

  const pname = (code) => masters.projects.find((p) => p.code === code)?.name || code

  const finalizeAll = async (mk) => {
    setBusyAction(true)
    setFinalizeAllResult(null)
    try {
      const next = await api.finalizeAll(mk, 'Technical Audit')
      const { finalizedProjects, skippedProjects, ...state } = next
      onStateChange(state)
      setFinalizeAllResult({ finalized: finalizedProjects, skipped: skippedProjects })
    } catch (e) {
      window.alert(e.message || 'Could not finalize this month.')
    } finally { setBusyAction(false) }
  }

  const scopedPosition = position.filter((r) =>
    (proj === 'all' || r.project === proj) && (month === 'all' || r.month === month))
  const scopedCumulative = cumulative.filter((r) => proj === 'all' || r.project === proj)
  const scopedPoc = poc.filter((r) =>
    (proj === 'all' || r.project === proj) && (month === 'all' || r.month === month))
  const heroRows = month === 'all' ? scopedCumulative : scopedPosition

  const hero = useMemo(() => {
    const tender = heroRows.reduce((s, r) => s + r.tenderAmount, 0)
    const mailCost = heroRows.reduce((s, r) => s + r.mailCost, 0)
    const underReview = heroRows.reduce((s, r) => s + r.underReview, 0)
    const provisionalCost = heroRows.reduce((s, r) => s + r.provisionalCost, 0)
    const provisionalRevenue = aggregate(heroRows, 'provisionalRevenue')
    // Aggregated from the backend's own field, not rederived here - Remaining is tender minus
    // REVENUE, not cost (outcome._figures already has the one canonical formula for this).
    const provisionalRemaining = provisionalRevenue === null ? null : tender - provisionalRevenue
    const provisionalProfit = provisionalRevenue === null ? null : provisionalRevenue - provisionalCost
    const provisionalMargin = provisionalProfit !== null && provisionalRevenue
      ? Math.round((provisionalProfit / provisionalRevenue) * 10000) / 100 : null
    const approvedCost = aggregate(heroRows, 'approvedCost')
    const remaining = aggregate(heroRows, 'remaining')
    const profit = aggregate(heroRows, 'profit')
    const margin = profit !== null && approvedCost !== null && (approvedCost + profit)
      ? Math.round((profit / (approvedCost + profit)) * 10000) / 100 : null
    const pendingCount = heroRows.reduce((s, r) => s +
      (r.pending ? (Array.isArray(r.pending) ? r.pending.length : 0) : 0), 0)
    const status = worstStatus(heroRows.map((r) => r.status))
    return { tender, mailCost, underReview, provisionalRevenue, provisionalCost,
      provisionalRemaining, provisionalProfit, provisionalMargin, approvedCost, remaining,
      profit, margin, pendingCount, status,
      scopeLabel: month === 'all' ? 'this sample' : 'this month' }
  }, [heroRows, month])

  const single = proj !== 'all' && month !== 'all' && scopedPosition.length === 1
    ? scopedPosition[0] : null

  const kpiFinal = hero.profit !== null && hero.profit !== undefined
  const kpiCost = kpiFinal ? hero.approvedCost : hero.provisionalCost
  const kpiProfit = kpiFinal ? hero.profit : hero.provisionalProfit
  const kpiMargin = kpiFinal ? hero.margin : hero.provisionalMargin

  // Same figure kpiProfit itself resolves to (final once every line clears, provisional
  // otherwise), computed for whichever month came before the one selected - only meaningful
  // with one specific month picked, same as Home's own portfolio delta.
  const scopeProfit = (rows) => {
    const revenue = aggregate(rows, 'provisionalRevenue')
    const provisionalProfit = revenue === null ? null : revenue - rows.reduce((s, r) => s + r.provisionalCost, 0)
    const profit = aggregate(rows, 'profit')
    return profit !== null ? profit : provisionalProfit
  }
  const profitDelta = useMemo(() => {
    if (month === 'all') return null
    const idx = masters.months.findIndex((m) => m.key === month)
    if (idx <= 0 || kpiProfit === null) return null
    const prevMonth = masters.months[idx - 1]
    const prevRows = position.filter((r) => r.month === prevMonth.key && (proj === 'all' || r.project === proj))
    if (!prevRows.length) return null
    const prevProfit = scopeProfit(prevRows)
    if (prevProfit === null || prevProfit === 0) return null
    const pctChange = Math.round(((kpiProfit - prevProfit) / Math.abs(prevProfit)) * 1000) / 10
    return { pct: pctChange, label: prevMonth.label }
  }, [month, proj, position, masters.months, kpiProfit])

  // Key exceptions are portfolio-wide, independent of whatever project/month is currently
  // filtered above - the same "how much is still outstanding, company-wide" figures Home's
  // attention cards show, kept in one place rather than recomputed from scratch here.
  const allLatest = position.filter((r) => r.month === latest)
  const exceptionPending = allLatest.reduce((s, r) => s + r.pending.length, 0)
  const exceptionImpact = allLatest.reduce((s, r) => s + r.underReview, 0)
  const unattrAtLatest = unattributed.filter((u) => u.month === latest)
  const unattrTotal = unattrAtLatest.reduce((s, u) => s + u.amount, 0)
  const missingCount = outstanding.filter((r) => r.kind === 'chase' && r.month === latest).length

  const filterBar = (
    <div className="filter-bar">
      <FilterChip label="Project" value={proj} onChange={(e) => setProj(e.target.value)}
                  options={[{ value: 'all', label: 'All projects' },
                    ...masters.projects.map((p) => ({ value: p.code, label: p.name }))]} />
      <FilterChip label="Month" value={month} onChange={(e) => setMonth(e.target.value)}
                  options={[{ value: 'all', label: 'All months' },
                    ...masters.months.map((m) => ({ value: m.key, label: m.label }))]} />
    </div>
  )

  return (
    <>
      {filterHost && createPortal(filterBar, filterHost)}

      {/* Portfolio-level KPI cards make sense across every project - for one project, section 3's
          own compact financial summary (inside ProjectDetailPanel, below) replaces them, so this
          grid only renders in the all-projects view. */}
      {proj === 'all' && (
        <Section label="Financial KPI summary">
          <div className="kpi-grid">
            <KpiCard tone="accent" icon={<IconCoins />} num={hero.tender} format={compact} label="Contract Value" />
            <KpiCard tone="info" icon={<IconTrendUp />}
                      num={hero.provisionalRevenue} format={compact}
                      label="Revenue" />
            <KpiCard tone="warn" icon={<IconReceipt />} num={kpiCost} format={compact} label="Cost" />
            <KpiCard tone={kpiProfit !== null && kpiProfit < 0 ? 'bad' : 'ok'} icon={<IconScales />}
                      num={kpiProfit} format={compact}
                      valueTone={kpiProfit !== null && kpiProfit < 0 ? 'hot' : 'good'}
                      // Same rule as Home's portfolio card: one word, never both, so a loss never
                      // reads as "Profit / Loss" with the sign left for the reader to infer from
                      // colour alone.
                      label={kpiProfit === null ? 'Profit / Loss' : kpiProfit < 0 ? '↓ LOSS' : '↑ PROFIT'}
                      subTone="accent-label"
                      sub={profitDelta ? {
                        text: `${profitDelta.pct >= 0 ? '↑' : '↓'} ${Math.abs(profitDelta.pct)}% vs ${profitDelta.label}`,
                        tone: profitDelta.pct >= 0 ? 'ok' : 'bad',
                      } : undefined} />
            <KpiCard tone="accent" icon={<IconPercent />}
                      num={kpiMargin} format={pct} label="Margin" />
            <KpiCard tone={STATUS_TONE[hero.status]} icon={<IconFlag />}
                      value={STATUS_LABEL[hero.status] || hero.status} label="Overall Status" />
          </div>
        </Section>
      )}

      {proj === 'all' ? (
        <Section label="Project outcomes"
                 count={{ text: `${heroRows.length} projects · ${month === 'all'
                   ? 'this sample' : masters.months.find((m) => m.key === month)?.label}` }}
                 right={
                   <div className="view-toggle" role="group" aria-label="Table or chart view">
                     <button type="button" className={outcomeView === 'table' ? 'active' : ''}
                             aria-pressed={outcomeView === 'table'} title="Table view"
                             onClick={() => setOutcomeView('table')}>
                       <IconTable />
                     </button>
                     <button type="button" className={outcomeView === 'chart' ? 'active' : ''}
                             aria-pressed={outcomeView === 'chart'} title="Chart view"
                             onClick={() => setOutcomeView('chart')}>
                       <IconChartBar />
                     </button>
                   </div>
                 }>
          <Card note="Expand a project to see the reconciliation, decide its lines, and finalize
            it right here - the same rows shown here are what the Financial outcome summary
            above is summed from.">
            {outcomeView === 'table' ? (
              <ProjectSummaryTable
                rows={heroRows} consolidation={consolidation}
                position={position} masters={masters} lineage={lineage} busyKeys={busyKeys}
                decide={decide} month={month} siteMailbox={siteMailbox} onToast={onToast}
                finalize={finalize} reopen={reopen} busyAction={busyAction}
                initialOpen={navFocus?.expandExceptions
                  ? heroRows.filter((r) => r.status !== 'FINALIZED').map((r) => r.project)
                  : undefined}
              />
            ) : (
              <PerfChart rows={heroRows.map((r) => ({
                code: r.project, name: r.projectName, hasData: true,
                revenue: r.provisionalRevenue,
                cost: r.approvedCost !== null ? r.approvedCost : r.provisionalCost,
                profit: r.profit !== null ? r.profit : r.provisionalProfit,
                margin: r.margin !== null ? r.margin : r.provisionalMargin,
              }))} />
            )}
            {month !== 'all' && (() => {
              const thisMonth = position.filter((p) => p.month === month)
              const open = thisMonth.filter((p) => p.status !== 'FINALIZED')
              const ready = open.filter((p) => p.readyToFinalize)
              const notReady = open.filter((p) => !p.readyToFinalize)
              if (!ready.length && !finalizeAllResult) return null
              return (
                <div className="finalize-panel">
                  {finalizeAllResult && (
                    <div className={`finalize-summary${finalizeAllResult.finalized.length ? ' ok' : ''}`}>
                      <p>
                        {finalizeAllResult.finalized.length
                          ? <><IconCheck /> Finalized {finalizeAllResult.finalized.map(pname).join(', ')}.</>
                          : 'Nothing new to finalize.'}
                      </p>
                      {finalizeAllResult.skipped.length > 0 && (
                        <p className="skipped">
                          Skipped {finalizeAllResult.skipped.map(pname).join(', ')} - already finalized
                          or still has pending decisions.
                        </p>
                      )}
                      <button type="button" onClick={() => setFinalizeAllResult(null)}>Dismiss</button>
                    </div>
                  )}
                  {ready.length > 0 && (
                    <>
                      {notReady.length > 0 && (
                        <p className="finalize-note">
                          {ready.length} of {open.length} open project{open.length === 1 ? '' : 's'} ready
                          to finalize - {notReady.map(pname).join(', ')} still {notReady.length === 1 ? 'has' : 'have'} pending decisions.
                        </p>
                      )}
                      <button type="button" className="btn btn-approve btn-sm" disabled={busyAction}
                              onClick={() => finalizeAll(month)}>
                        <IconCheck /> Finalize all ready ({ready.length})
                      </button>
                    </>
                  )}
                </div>
              )
            })()}
          </Card>
        </Section>
      ) : (
        <div id="cost-reconciliation">
          <button type="button" className="project-back" onClick={() => setProj('all')}>
            ← Back to Project Outcomes
          </button>
          <div className="project-header">
            <div>
              <h1>{masters.projects.find((p) => p.code === proj)?.name || proj}</h1>
              {scopedPosition.length === 1 && (
                <div className="project-header-meta">
                  <StatusPill status={scopedPosition[0].status} />
                  <span>·</span>
                  <span>{scopedPosition[0].monthLabel}</span>
                </div>
              )}
            </div>
            <button type="button" className="btn btn-quiet btn-sm project-settings-btn" disabled
                    title="Not available in this preview">
              Project settings
            </button>
          </div>

          {scopedPosition.map((pos) => {
            const cons = consolidation.find((r) => r.project === pos.project && r.month === pos.month)
            const canFinalizeThis = pos.readyToFinalize && pos.status !== 'FINALIZED'
            const canReopenThis = pos.status === 'FINALIZED'
            return (
              <ProjectDetailPanel key={pos.month} pos={pos} cons={cons} masters={masters}
                lineage={lineage} siteMailbox={siteMailbox[pos.project]} onToast={onToast}
                showHeader={scopedPosition.length === 1}
                busy={new Set([...busyKeys].filter((k) => k.startsWith(`${pos.project}|${pos.month}|`))
                  .map((k) => k.split('|')[2]))}
                onDecide={(line, choice) => decide(pos.project, pos.month, line, choice)}
                canFinalize={canFinalizeThis} canReopen={canReopenThis} busyAction={busyAction}
                onFinalize={() => finalize(pos.project, pos.month)}
                onReopen={() => reopen(pos.project, pos.month)}
              />
            )
          })}
        </div>
      )}

      <Section label="Financial outcome"
               count={{ text: proj === 'all' ? 'every project' : masters.projects.find((p) => p.code === proj)?.name }}>
        <Card>
          <FinancialFlow hero={hero} busy={busyAction}
            canFinalize={!!single && single.readyToFinalize && single.status !== 'FINALIZED'}
            canReopen={!!single && single.status === 'FINALIZED'}
            canReview={!!single}
            onFinalize={() => single && finalize(single.project, single.month)}
            onReopen={() => single && reopen(single.project, single.month)}
            onReview={() => document.getElementById('cost-reconciliation')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
        </Card>
      </Section>

      <Section label="Percentage of completion (estimated)"
               count={{ text: proj === 'all' ? 'every project' : masters.projects.find((p) => p.code === proj)?.name }}>
        <Card note="Revenue recognized in proportion to cost incurred against each project's
          total estimated cost to complete (the cost-to-cost method) - kept separate from, and
          never merged into, the auditor-decided Current/Final figures above.">
          <DataTable
            rows={scopedPoc}
            rowKey={(r) => `${r.project}-${r.month}`}
            empty="No months in scope."
            cols={[
              { key: 'projectName', label: 'Project' },
              { key: 'monthLabel', label: 'Month' },
              { key: 'pctComplete', label: '% complete', num: true, fmt: pct },
              { key: 'costToDate', label: 'Cost to date', num: true, fmt: money },
              { key: 'revenueToDate', label: 'Revenue recognized to date', num: true,
                fmt: (v) => (v === null || v === undefined ? '—' : money(v)) },
              { key: 'revenueThisMonth', label: 'Revenue this month', num: true,
                fmt: (v) => (v === null || v === undefined ? '—' : money(v)) },
              { key: 'profit', label: 'Profit (POC)', num: true,
                fmt: (v) => (v === null || v === undefined ? '—' : money(v)) },
              { key: 'margin', label: 'Margin', num: true, fmt: pct },
              { key: 'foreseeableLoss', label: 'Foreseeable loss', num: true,
                fmt: (v) => (v ? money(v) : '—') },
            ]}
          />
        </Card>
      </Section>

      {/* Hidden for now, at the user's request - kept rather than deleted since the figures
          (exceptionPending/exceptionImpact/unattrTotal/missingCount) are still computed above
          and this is the one place that surfaced them as a portfolio-wide summary.
      <Section label="Key exceptions" count={{ text: masters.months.find((m) => m.key === latest)?.label }}>
        <Card>
          <div className="pad key-exceptions">
            <Tally label="Key exceptions" items={[
              { label: 'Pending decisions', value: exceptionPending, tone: exceptionPending ? 'hot' : 'good' },
              { label: 'Unresolved impact', value: compact(exceptionImpact), tone: exceptionImpact ? 'hot' : 'good' },
              { label: 'Unassigned costs', value: compact(unattrTotal), tone: unattrTotal ? 'warm' : 'good' },
              { label: 'Missing evidence', value: missingCount, tone: missingCount ? 'warm' : 'good' },
            ]} />
            <div className="decide-row" style={{ marginTop: 'var(--s3)' }}>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setProj('all')}>
                Review decisions
              </button>
              <button type="button" className="btn btn-quiet btn-sm"
                      onClick={() => onNavigate?.('source')}>
                Review allocations
              </button>
              <button type="button" className="btn btn-quiet btn-sm"
                      onClick={() => onNavigate?.('source')}>
                Trace evidence
              </button>
            </div>
          </div>
        </Card>
      </Section>
      */}
    </>
  )
}

// ---------------------------------------------------------------------------- project summary

function ProjectSummaryTable({ rows, consolidation, position, masters, lineage, siteMailbox,
                                busyKeys, decide, month, finalize, reopen, busyAction, onToast,
                                initialOpen }) {
  // Read once at mount, same one-shot contract as navFocus's project/month fields elsewhere on
  // this page - a later change to initialOpen (there isn't one today) would not reopen rows a
  // reader has since collapsed by hand.
  const [open, setOpen] = useState(() => new Set(initialOpen || []))
  const toggle = (project) => setOpen((prev) => {
    const next = new Set(prev)
    next.has(project) ? next.delete(project) : next.add(project)
    return next
  })

  const tableRows = rows.flatMap((r) => {
    const base = [{ ...r, key: r.project }]
    if (!open.has(r.project)) return base
    const monthsForProject = month === 'all'
      ? position.filter((p) => p.project === r.project)
      : position.filter((p) => p.project === r.project && p.month === month)
    return [...base, {
      key: `${r.project}-detail`, _detail: true,
      content: monthsForProject.map((pos) => {
        const cons = consolidation.find((c) => c.project === pos.project && c.month === pos.month)
        const canFinalize = pos.readyToFinalize && pos.status !== 'FINALIZED'
        const canReopen = pos.status === 'FINALIZED'
        return (
          <div key={pos.month} style={{ marginBottom: 'var(--s2)' }}>
            <div className="section-banner" style={{ marginBottom: 6 }}>
              {pos.monthLabel} <StatusPill status={pos.status} />
            </div>
            <ReconciliationPanel
              project={pos.project} month={pos.month}
              cons={cons} pos={pos} masters={masters} lineage={lineage}
              siteMailbox={siteMailbox[pos.project]} onToast={onToast}
              busy={new Set([...busyKeys].filter((k) => k.startsWith(`${pos.project}|${pos.month}|`))
                .map((k) => k.split('|')[2]))}
              onDecide={(line, choice) => decide(pos.project, pos.month, line, choice)}
            />
            {(canFinalize || canReopen) && (
              <div className="stmt-actions" style={{ marginTop: 'var(--s2)' }}>
                {canReopen && (
                  <button type="button" className="btn btn-quiet btn-sm" disabled={busyAction}
                          onClick={() => reopen(pos.project, pos.month)}>
                    Reopen
                  </button>
                )}
                {canFinalize && (
                  <button type="button" className="btn btn-approve btn-sm" disabled={busyAction}
                          onClick={() => finalize(pos.project, pos.month)}>
                    <IconCheck /> Approve &amp; Finalize
                  </button>
                )}
              </div>
            )}
          </div>
        )
      }),
    }]
  })

  // One clean row per project - Tender, Revenue, Cost, Profit, Margin, Status - Final where
  // every line is resolved, Provisional (marked as such) otherwise. Company total below sums
  // exactly these rows, so "does the total match" is never a question over a different table.
  const finalCost = (r) => (r.approvedCost !== null ? r.approvedCost : r.provisionalCost)
  const finalProfit = (r) => (r.profit !== null ? r.profit : r.provisionalProfit)
  const finalMargin = (r) => (r.margin !== null ? r.margin : r.provisionalMargin)
  const isFinal = (r) => r.approvedCost !== null

  const total = {
    key: '__total', _total: true, projectName: 'Total',
    tenderAmount: rows.reduce((s, r) => s + r.tenderAmount, 0),
    provisionalRevenue: aggregate(rows, 'provisionalRevenue'),
    cost: rows.reduce((s, r) => s + finalCost(r), 0),
    profit: aggregate(rows.map((r) => ({ v: finalProfit(r) })), 'v'),
    allFinal: rows.every(isFinal),
    status: worstStatus(rows.map((r) => r.status)),
  }
  total.margin = total.profit !== null && total.cost
    ? Math.round((total.profit / (total.cost + total.profit)) * 10000) / 100 : null

  return (
    <DataTable
      rows={[...tableRows, total]}
      rowKey={(r) => r.key}
      rowClass={(r) => (r._detail ? 'row-section' : r._total ? 'row-total'
        : r.status === 'OPEN' ? 'row-flag' : undefined)}
      rowSpan={(r) => (r._detail ? <div>{r.content}</div> : null)}
      empty="No projects match."
      cols={[
        {
          key: 'projectName', label: 'Project', sortable: false, nowrap: true,
          render: (r) => (r._total ? <b>Total</b> : (
            <button type="button" className="row-toggle" onClick={() => toggle(r.project)}
                    aria-expanded={open.has(r.project)}>
              <span className={`caret${open.has(r.project) ? ' open' : ''}`} aria-hidden="true">&gt;</span>
              {r.projectName}
            </button>
          )),
        },
        { key: 'tenderAmount', label: 'Tender', num: true, sortable: false, fmt: money },
        { key: 'provisionalRevenue', label: 'Revenue', num: true, sortable: false, fmt: dash },
        {
          key: 'cost', label: 'Cost', num: true, sortable: false,
          render: (r) => money(r._total ? r.cost : finalCost(r)),
        },
        {
          key: 'profit', label: 'Profit / loss', num: true, sortable: false,
          render: (r) => {
            const v = r._total ? r.profit : finalProfit(r)
            return v === null ? 'Pending' : money(v)
          },
        },
        { key: 'margin', label: 'Margin', num: true, sortable: false,
          render: (r) => pct(r._total ? r.margin : finalMargin(r)) },
        { key: 'status', label: 'Status', sortable: false,
          render: (r) => <StatusPill status={r.status} /> },
      ]}
    />
  )
}
