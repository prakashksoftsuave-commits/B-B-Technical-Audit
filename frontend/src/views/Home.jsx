import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import DataTable from '../components/DataTable'
import { Card, FilterChip, KpiCard, Pill, Section } from '../components/Bits'
import { PerfChart, ProfitTrend } from '../components/Charts'
import { IconBell, IconBuilding, IconCheck, IconClock, IconCoins, IconGauge, IconInbox,
  IconPercent, IconReceipt, IconRefresh, IconScales, IconTrendUp } from '../components/Icons'
import { compact, pct, timeAgo } from '../utils'

/* The Finance Manager's morning read: portfolio position, which project needs attention, and
   whether the outcome is ready - all in numbers the Financial Outcome page already computed.
   Nothing here is a second calculation; every figure is read straight off position/cumulative/
   unattributed/counts/activity. Detailed ERP-vs-Tally reconciliation deliberately does not live
   here - that is Financial Outcome's job, one click away. */

const STATUS_LABEL = { OPEN: 'Open', AUDIT_IN_PROGRESS: 'Audit in progress',
  READY_FOR_FINALIZATION: 'Ready', FINALIZED: 'Finalized' }
const STATUS_TONE = { OPEN: 'bad', AUDIT_IN_PROGRESS: 'warn',
  READY_FOR_FINALIZATION: 'info', FINALIZED: 'ok' }

// Kept in sync by hand with the same rule in outcome.py's worst_status and Consolidation.jsx's
// own copy - see outcome.py's worst_status docstring.
function worstStatus(statuses) {
  for (const s of ['OPEN', 'AUDIT_IN_PROGRESS', 'READY_FOR_FINALIZATION']) {
    if (statuses.includes(s)) return s
  }
  return statuses.length ? 'FINALIZED' : 'OPEN'
}

function aggregate(rows, key) {
  const nums = rows.map((r) => r[key])
  return nums.some((v) => v === null || v === undefined) ? null : nums.reduce((s, v) => s + v, 0)
}

// One row per project, whatever the resolved figure is right now (approved once every line of
// that project-month clears, provisional otherwise) - the same "best available" rule the
// Project Outcomes table on Financial Outcome uses, so the two never read differently.
function projectRow(p, scoped) {
  if (!scoped) return { code: p.code, name: p.name, hasData: false }
  const final = scoped.approvedCost !== null
  const cost = final ? scoped.approvedCost : scoped.provisionalCost
  const revenue = scoped.provisionalRevenue
  const profit = final ? scoped.profit : scoped.provisionalProfit
  const margin = final ? scoped.margin : scoped.provisionalMargin
  return { code: p.code, name: p.name, hasData: true, final,
    tender: scoped.tenderAmount, revenue, cost, profit, margin,
    status: scoped.status, pendingCount: scoped.pending?.length || 0,
    impact: scoped.underReview || 0 }
}

// Portfolio totals for one month, built from the exact same projectRow/aggregate rule the KPI
// row and the project table both already use - called once per selected month, and again once
// per sampled month for the trend chart, so "this month's total" and "one point on the trend"
// can never quietly drift apart into two formulas.
function portfolioFor(monthKey, scopedProjects, position, proj) {
  const scoped = position.filter((p) => p.month === monthKey && (proj === 'all' || p.project === proj))
  const rows = scopedProjects.map((p) => projectRow(p, scoped.find((r) => r.project === p.code)))
  const withData = rows.filter((r) => r.hasData)
  const tender = withData.reduce((s, r) => s + r.tender, 0)
  const revenue = aggregate(withData, 'revenue')
  const cost = withData.reduce((s, r) => s + r.cost, 0)
  const profit = revenue === null ? null : revenue - cost
  const margin = profit !== null && revenue ? Math.round((profit / revenue) * 10000) / 100 : null
  return { rows, withData, tender, revenue, cost, profit, margin }
}

const SEVERITY_RANK = { bad: 0, warn: 1, info: 2, ok: 3 }
const ATTENTION_WASH = { bad: 'var(--bad-bg)', warn: 'var(--warn-tint)' }

// A card that needs a decision reads heavier than one that's clear - a tinted surface, not just
// a coloured border, so red genuinely pops and green recedes rather than all four cards reading
// as the same weight regardless of what's actually wrong.
function AttentionCard({ tone, title, icon, figure, sub, detail, action, onAction, clear, expand }) {
  const accent = { bad: 'var(--bad-fg)', warn: 'var(--warn-fg)', ok: 'var(--ok-fg)',
    info: 'var(--info-fg)' }[tone]
  return (
    <Card accent={accent} wash={ATTENTION_WASH[tone]}>
      <div className="pad attn-card">
        <div className="attn-head">
          <span className="attn-icon" style={{ color: accent }} aria-hidden="true">{icon}</span>
          <div className="attn-title">{title}</div>
        </div>
        <div className={`attn-figure t-${tone}`}>{figure}</div>
        {sub && <div className="attn-sub">{sub}</div>}
        <p className="dim-note">{detail}</p>
        {clear ? <Pill tone="ok">Clear</Pill> : (
          action && <button type="button" className="btn btn-quiet btn-sm" onClick={onAction}>
            {action}
          </button>
        )}
        {expand}
      </div>
    </Card>
  )
}

const ACTIVITY_ICON = { sync: IconRefresh, decision: IconScales, finalize: IconCheck,
  reopen: IconGauge, reminder: IconBell }
const ACTIVITY_DOT = { ok: 'var(--ok-fg)', info: 'var(--info-fg)', warn: 'var(--warn-fg)',
  bad: 'var(--bad-fg)' }

// A real feed, not decoration: every row is something core/activity.py recorded at the moment
// it actually happened (service.py's own hooks on run/decide/finalize/reopen/remind), never
// invented copy - see the "Decided" note in CLAUDE.md this feature was built against.
function ActivityFeed({ items, now }) {
  if (!items.length) {
    return <p className="dim-note" style={{ padding: '4px 0' }}>Nothing recorded yet this session.</p>
  }
  return (
    <ul className="activity-feed">
      {items.map((a, i) => {
        const Icon = ACTIVITY_ICON[a.kind] || IconClock
        return (
          <li key={i}>
            <span className="activity-icon" aria-hidden="true"><Icon /></span>
            <div className="activity-body">
              <div className="activity-title">{a.title}</div>
              {a.detail && <div className="activity-detail">{a.detail}</div>}
            </div>
            <span className="activity-time">
              <i style={{ background: ACTIVITY_DOT[a.tone] || 'var(--dust)' }} />
              {timeAgo(a.ts, now)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

const SUBMISSION_TONE = { late: 'warn', 'not received': 'bad', pending: 'info' }
const SUBMISSION_LABEL = { late: 'Late', 'not received': 'Not received', pending: 'Not due yet' }

export default function Home({ state, onNavigate, filterHost, onToast }) {
  const { masters, position, unattributed, submission, counts, activity } = state
  const latest = masters.months.at(-1).key
  const [month, setMonth] = useState(latest)
  const [proj, setProj] = useState('all')
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  // One reminder mail covers everything outstanding for a project-month, not one per row - so
  // "sent" is tracked per project-month, and clicking Remind on any row belonging to it marks
  // every row in that group sent, matching what the single mail actually covered.
  const [reminding, setReminding] = useState({})
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])

  async function sendReminder(project, monthKey) {
    const key = `${project}|${monthKey}`
    setReminding((s) => ({ ...s, [key]: 'sending' }))
    try {
      const res = await api.sendReminder(project, monthKey, 'Audit Lead')
      setReminding((s) => ({ ...s, [key]: 'sent' }))
      onToast?.(`Reminder sent to ${res.to}`)
    } catch (e) {
      setReminding((s) => ({ ...s, [key]: e.message || 'Send failed' }))
      onToast?.(e.message || 'Reminder failed to send', 'bad')
    }
  }

  const ownerLabel = Object.fromEntries(masters.inputs.map((i) => [i.kind, i.owner]))
  const inProject = (p) => proj === 'all' || p === proj
  const scopedProjects = proj === 'all' ? masters.projects
    : masters.projects.filter((p) => p.code === proj)
  const scopedRows = position.filter((p) => p.month === month && inProject(p.project))

  const { rows, withData, tender, revenue, cost, profit, margin } =
    useMemo(() => portfolioFor(month, scopedProjects, position, proj),
      [month, scopedProjects, position, proj])
  const portfolio = { tender, revenue, cost, profit, margin }

  // One point per sampled month, same rule as "this month" above - a genuine trend, not a
  // second calculation. Recomputed only when the project filter or the source data changes,
  // not on every month-selector click (the trend spans every month regardless of which one is
  // "selected" for the KPI row).
  const trendPoints = useMemo(() => masters.months.map((m) => {
    const p = portfolioFor(m.key, scopedProjects, position, proj)
    return { key: m.key, label: m.label, profit: p.profit, revenue: p.revenue, cost: p.cost,
      margin: p.margin }
  }), [masters.months, scopedProjects, position, proj])

  const monthIdx = masters.months.findIndex((m) => m.key === month)
  const prevPoint = monthIdx > 0 ? trendPoints[monthIdx - 1] : null
  const prevMonthLabel = monthIdx > 0 ? masters.months[monthIdx - 1].label : null
  const profitDeltaPct = prevPoint?.profit && portfolio.profit !== null
    ? Math.round(((portfolio.profit - prevPoint.profit) / Math.abs(prevPoint.profit)) * 1000) / 10
    : null

  const pendingCount = scopedRows.reduce((s, r) => s + r.pending.length, 0)
  const unresolvedImpact = scopedRows.reduce((s, r) => s + r.underReview, 0)
  const readyRows = scopedRows.filter((r) => r.status === 'READY_FOR_FINALIZATION')
  // Not received AND late-but-received - the client's own loudest complaint was the follow-up,
  // not the arithmetic, so "evidence status" covers both, not just outright-missing returns.
  // "pending" is kept out of this list and its count on purpose: the cut-off has not passed
  // yet, so it is not a problem - the automatic Pending -> Overdue rule. It is not hidden
  // altogether though - pendingRows below surfaces it separately, neutrally, so "not due yet"
  // stays visible without reading as something wrong.
  const lateRows = [...(submission?.rows || [])]
    .filter((r) => r.month === month && inProject(r.project)
      && r.status !== 'on time' && r.status !== 'pending')
    .sort((a, b) => (b.daysLate || 0) - (a.daysLate || 0))
  const pendingRows = [...(submission?.rows || [])]
    .filter((r) => r.month === month && inProject(r.project) && r.status === 'pending')
  const missingCount = lateRows.filter((r) => r.status === 'not received').length
  const lateOnlyCount = lateRows.length - missingCount
  const overallStatus = worstStatus(scopedRows.map((r) => r.status))

  const outcomeTone = overallStatus === 'FINALIZED' ? 'ok'
    : overallStatus === 'READY_FOR_FINALIZATION' ? 'info' : 'bad'

  // Whatever generated the figure on this card is exactly whatever Home's own Project/Month
  // filters are currently scoped to (scopedRows, above) - so the destination has to carry those
  // same two values, not just drop the reader on Financial Outcome's own default month. Omitting
  // `project` when "All projects" is selected lets that page fall back to its own "all" default
  // rather than forcing a single project that was never actually selected here.
  const financialFocus = proj === 'all' ? { month } : { project: proj, month }

  // Whatever needs attention most sits first - a red card with real decisions pending should
  // never sit below a green "Clear" one just because of source order in the JSX.
  const attentionCards = [
    {
      id: 'pending', tone: pendingCount ? 'bad' : 'ok', title: 'Pending decisions',
      icon: <IconScales />,
      figure: `${pendingCount} decision${pendingCount === 1 ? '' : 's'}`,
      sub: pendingCount ? `Impact: ${compact(unresolvedImpact)}` : undefined,
      detail: pendingCount ? 'ERP/Tally differences awaiting approval.'
        : 'No ERP/Tally differences are awaiting approval.',
      clear: !pendingCount,
      action: pendingCount ? 'Review →' : undefined,
      onAction: () => onNavigate?.('consolidation', financialFocus),
    },
    {
      id: 'ready', tone: readyRows.length ? 'info' : 'ok', title: 'Ready to finalize',
      icon: <IconCheck />,
      figure: `${readyRows.length} project${readyRows.length === 1 ? '' : 's'}`,
      sub: readyRows.length ? readyRows.map((r) => r.projectName).join(', ') : undefined,
      detail: readyRows.length
        ? 'Every line is decided - awaiting sign-off in Financial Outcome.'
        : 'Nothing is currently waiting on a finalize decision.',
      clear: !readyRows.length,
      action: readyRows.length ? 'Review →' : undefined,
      // A single ready project is named exactly, so the destination is that project, not
      // whatever Home's own filter happens to say - closer to "the respective related item"
      // than the generic financialFocus the other three cards use.
      onAction: () => onNavigate?.('consolidation', readyRows.length === 1
        ? { project: readyRows[0].project, month: readyRows[0].month } : financialFocus),
    },
    {
      // The headline figure/tone/detail is driven by lateRows only - pendingRows is never a
      // problem, so it never turns this card red or adds to its count. It is still shown
      // below, neutrally, once expanded - visible, not alarming.
      id: 'evidence', tone: missingCount ? 'bad' : lateOnlyCount ? 'warn' : 'ok',
      title: 'Evidence status', icon: <IconInbox />, figure: String(lateRows.length),
      detail: lateRows.length
        ? [missingCount && `${missingCount} not yet received`,
            lateOnlyCount && `${lateOnlyCount} received late`].filter(Boolean).join(', ') + '.'
        : 'All expected evidence has been received on time.',
      clear: !lateRows.length,
      action: (lateRows.length || pendingRows.length)
        ? (evidenceOpen ? 'Hide details' : 'View details →') : undefined,
      onAction: () => setEvidenceOpen((o) => !o),
      expand: evidenceOpen && (lateRows.length > 0 || pendingRows.length > 0) && (
        <div className="mini-list" style={{ marginTop: 10 }}>
          {lateRows.map((r) => {
            const key = `${r.project}|${r.month}`
            const st = reminding[key]
            return (
            <div key={`${r.project}|${r.month}|${r.kind}`}>
              <span>{r.projectName} · {r.label} — {ownerLabel[r.kind]}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Pill tone={SUBMISSION_TONE[r.status]}>{SUBMISSION_LABEL[r.status]}</Pill>
                <b>{r.status === 'not received' ? '—' : `${r.daysLate}d late`}</b>
                {/* A "late" row already arrived, just after cut-off - nothing left to chase,
                    so only a genuinely missing return gets a reminder action. */}
                {r.status === 'not received' && (
                  <button type="button" className="btn btn-quiet btn-xs"
                          disabled={st === 'sending' || st === 'sent'}
                          title={st && st !== 'sending' && st !== 'sent' ? st : undefined}
                          onClick={() => sendReminder(r.project, r.month)}>
                    {st === 'sending' ? 'Sending…'
                      : st === 'sent' ? 'Sent ✓'
                      : st ? 'Retry' : 'Remind'}
                  </button>
                )}
              </span>
            </div>
            )
          })}
          {pendingRows.length > 0 && (
            <>
              <div className="mini-list-note">Not yet due - within the submission window</div>
              {pendingRows.map((r) => (
                <div key={`${r.project}|${r.month}|${r.kind}`}>
                  <span>{r.projectName} · {r.label} — {ownerLabel[r.kind]}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Pill tone={SUBMISSION_TONE.pending}>{SUBMISSION_LABEL.pending}</Pill>
                    <b>due {r.cutoff}</b>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      ),
    },
    {
      id: 'outcome', tone: outcomeTone, title: 'Outcome status', icon: <IconGauge />,
      figure: overallStatus === 'FINALIZED' ? 'FINALIZED'
        : overallStatus === 'READY_FOR_FINALIZATION' ? 'READY' : 'NOT READY',
      detail: pendingCount
        ? `${pendingCount} financial decision${pendingCount === 1 ? '' : 's'} still unresolved.`
        : 'Nothing is blocking finalization.',
      action: 'Open Financial Outcome →', onAction: () => onNavigate?.('consolidation', financialFocus),
    },
  ].sort((a, b) => SEVERITY_RANK[a.tone] - SEVERITY_RANK[b.tone])

  // Opens the same detail list the "Evidence status" alert card itself expands, then scrolls
  // it into view - the three submission figures below are exactly that card's own numbers
  // (expected/received/pending), so "the respective related item" for all three is that one
  // list, not a second copy of it.
  const openEvidence = () => {
    setEvidenceOpen(true)
    requestAnimationFrame(() => {
      document.getElementById('evidence-status-card')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const receivedCount = (counts.onTime || 0) + (counts.late || 0)
  const pendingReportsCount = (counts.missing || 0) + (counts.pending || 0)
  // counts.* is a portfolio-wide, every-project/every-month total (service.py builds it once
  // from the full sample, not scoped to Home's own Project/Month filters) - so its destination
  // is "all" on both axes, the honest match for what the figure actually adds up, rather than
  // guessing at whichever month happens to be selected here.
  const glance = [
    { label: 'Reports Expected', value: counts.expected, icon: <IconInbox />, tone: 'neutral',
      onClick: openEvidence },
    { label: 'Reports Received', value: receivedCount,
      sub: counts.expected ? `${Math.round((receivedCount / counts.expected) * 1000) / 10}%` : null,
      icon: <IconCheck />, tone: 'ok', onClick: openEvidence },
    { label: 'Pending Reports', value: pendingReportsCount,
      sub: counts.expected ? `${Math.round((pendingReportsCount / counts.expected) * 1000) / 10}%` : null,
      icon: <IconClock />, tone: pendingReportsCount ? 'warn' : 'ok', onClick: openEvidence },
    { label: 'Reconciliations', value: counts.compared, sub: 'Total', icon: <IconScales />, tone: 'neutral',
      // "Total" - the whole reconciliation surface, so it lands on Financial Outcome as-is,
      // browsable project by project, rather than pre-filtered to any one subset.
      onClick: () => onNavigate?.('consolidation', { project: 'all', month: 'all' }) },
    { label: 'Unreconciled Items', value: counts.differs,
      sub: counts.compared ? `${Math.round((counts.differs / counts.compared) * 1000) / 10}%` : null,
      icon: <IconGauge />, tone: counts.differs ? 'warn' : 'ok',
      // Distinct from "Reconciliations" above, not just a second link to the same top-of-page
      // spot - expandExceptions pre-opens every project that isn't fully finalized, so the
      // differing lines this figure counts are actually on screen on arrival, not one more
      // click away.
      onClick: () => onNavigate?.('consolidation', { project: 'all', month: 'all', expandExceptions: true }) },
    { label: 'Exceptions / Issues', value: counts.toAttribute, sub: 'Requires attention',
      icon: <IconInbox />, tone: counts.toAttribute ? 'bad' : 'ok',
      onClick: () => onNavigate?.('source', { project: 'all', month: 'all' }) },
  ]

  const rowAccent = (r) => `row-accent-${withData.indexOf(r) % 3}`

  return (
    <>
      {filterHost && createPortal(
        <div className="filter-bar">
          <FilterChip label="Project" value={proj} onChange={(e) => setProj(e.target.value)}
                      options={[{ value: 'all', label: 'All projects' },
                        ...masters.projects.map((p) => ({ value: p.code, label: p.name }))]} />
          <FilterChip label="Month" value={month} onChange={(e) => setMonth(e.target.value)}
                      options={masters.months.map((m) => ({ value: m.key, label: m.label }))} />
        </div>,
        filterHost,
      )}

      <Section label="Portfolio at a glance">
        <div className="kpi-grid">
          <KpiCard tone="neutral" icon={<IconBuilding />} num={scopedProjects.length}
                    label="Total Projects"
                    sub={{ text: overallStatus === 'FINALIZED' ? 'All finalized' : 'Active',
                      tone: overallStatus === 'FINALIZED' ? 'ok' : 'info' }} />
          <KpiCard tone="accent" icon={<IconCoins />} num={portfolio.tender} format={compact}
                    label="Contract Value" sub={{ text: 'Total contract value' }} />
          <KpiCard tone="info" icon={<IconTrendUp />}
                    num={portfolio.revenue} format={compact}
                    label="Revenue" sub={{ text: 'Total revenue' }} />
          <KpiCard tone="warn" icon={<IconReceipt />} num={portfolio.cost} format={compact}
                    label="Total Cost" sub={{ text: 'Total project cost' }} />
          <KpiCard tone={portfolio.profit !== null && portfolio.profit < 0 ? 'bad' : 'ok'}
                    icon={<IconScales />}
                    num={portfolio.profit} format={compact}
                    valueTone={portfolio.profit !== null && portfolio.profit < 0 ? 'hot' : 'good'}
                    label={portfolio.profit === null ? 'Profit / Loss'
                      : portfolio.profit < 0 ? '↓ LOSS' : '↑ PROFIT'}
                    subTone="accent-label"
                    sub={profitDeltaPct !== null ? {
                      text: `${profitDeltaPct >= 0 ? '↑' : '↓'} ${Math.abs(profitDeltaPct)}% vs ${prevMonthLabel}`,
                      tone: profitDeltaPct >= 0 ? 'ok' : 'bad',
                    } : undefined} />
          <KpiCard tone="accent" icon={<IconPercent />}
                    num={portfolio.margin} format={pct}
                    label="Margin" sub={{ text: 'Cost-to-revenue ratio' }} />
        </div>
      </Section>

      <div className="dash-grid">
        <div className="dash-perf">
          <div className="dash-charts">
            {/* Short on purpose: this now shares a half-width column with Profitability Trend
                (see .dash-charts) - the old, longer caption wrapped to two lines there and
                made this header measurably taller than its neighbour's (verified with
                Playwright: 79px vs 43px), which is what actually pushed this card's own top
                edge down below Profitability Trend's, even though both still ended at the same
                bottom. */}
            <Section label="Financial Overview" count={{ text: 'By project' }}>
              <Card><PerfChart rows={rows} /></Card>
            </Section>
            <Section label="Profitability Trend" count={{ text: `Last ${trendPoints.length} months` }}>
              <Card><ProfitTrend points={trendPoints} /></Card>
            </Section>
          </div>

          <Section label="Projects Performance"
                   count={{ text: masters.months.find((m) => m.key === month)?.label }}
                   right={<button type="button" className="btn btn-quiet btn-sm"
                                   onClick={() => onNavigate?.('consolidation')}>
                             View full report →
                           </button>}>
            <Card>
              <DataTable
                rows={withData}
                rowKey={(r) => r.code}
                rowClass={rowAccent}
                empty="No projects match."
                footer
                cols={[
                  { key: 'name', label: 'Project', sortable: false },
                  { key: 'tender', label: 'Tender', num: true, foot: 'sum', fmt: compact },
                  { key: 'revenue', label: 'Revenue', num: true, foot: 'sum', fmt: compact },
                  { key: 'cost', label: 'Cost', num: true, foot: 'sum', fmt: compact },
                  {
                    key: 'profit', label: 'Profit / loss', num: true, fmt: compact,
                    foot: (rs) => compact(rs.reduce((s, r) => s + r.profit, 0)),
                  },
                  {
                    key: 'margin', label: 'Margin', num: true,
                    foot: (rs) => {
                      const rev = rs.reduce((s, r) => s + r.revenue, 0)
                      const p = rs.reduce((s, r) => s + r.profit, 0)
                      return rev ? pct(Math.round((p / rev) * 10000) / 100) : '—'
                    },
                    render: (r) => pct(r.margin),
                  },
                  { key: 'status', label: 'Status', sortable: false,
                    render: (r) => <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill> },
                  {
                    key: 'action', label: 'Action', sortable: false,
                    render: (r) => (
                      <button type="button" className="btn btn-out btn-xs"
                              onClick={() => onNavigate?.('consolidation', { project: r.code, month })}>
                        View outcome →
                      </button>
                    ),
                  },
                ]}
              />
            </Card>
          </Section>
        </div>

        <Section className="dash-glance" label="At a Glance"
                 count={{ text: masters.months.find((m) => m.key === month)?.label }}>
          <div className="glance-grid">
            {glance.map((g) => (
              <Card key={g.label}>
                {g.onClick ? (
                  <button type="button" className="pad glance-cell glance-clickable" onClick={g.onClick}>
                    <span className={`glance-icon glance-icon-${g.tone}`} aria-hidden="true">{g.icon}</span>
                    <div>
                      <b>{g.value}</b>
                      <span>{g.label}</span>
                      {g.sub && <em>{g.sub}</em>}
                    </div>
                  </button>
                ) : (
                  <div className="pad glance-cell">
                    <span className={`glance-icon glance-icon-${g.tone}`} aria-hidden="true">{g.icon}</span>
                    <div>
                      <b>{g.value}</b>
                      <span>{g.label}</span>
                      {g.sub && <em>{g.sub}</em>}
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </Section>

        <Section className="dash-alerts" label="Alerts & Status">
          <div className="sidebar-cards">
            {attentionCards.map((c) => (
              <div key={c.id} id={c.id === 'evidence' ? 'evidence-status-card' : undefined}>
                <AttentionCard {...c} />
              </div>
            ))}
          </div>
        </Section>

        <Section className="dash-activity" label="Recent Activity">
          <Card>
            <div className="pad">
              <ActivityFeed items={activity || []} now={now} />
            </div>
          </Card>
        </Section>
      </div>
    </>
  )
}
