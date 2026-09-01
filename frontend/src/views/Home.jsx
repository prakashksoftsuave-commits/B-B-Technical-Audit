import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import DataTable from '../components/DataTable'
import { Bar, Card, COST_COLORS, FilterChip, Legend, LOSS_COLOR, Pill, PROFIT_COLOR, Section,
  Tally } from '../components/Bits'
import { IconBuilding, IconCheck, IconCoins, IconGauge, IconInbox, IconPercent, IconReceipt,
  IconScales, IconTrendUp } from '../components/Icons'
import { compact, pct } from '../utils'

/* The Finance Manager's morning read: portfolio position, which project needs attention, and
   whether the outcome is ready - all in numbers the Financial Outcome page already computed.
   Nothing here is a second calculation; every figure is read straight off position/cumulative/
   unattributed/outstanding. Detailed ERP-vs-Tally reconciliation deliberately does not live
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

// Sorted by profit, highest first, so "which project is winning" is the order you read top to
// bottom rather than a comparison you have to do yourself across nine numbers. Margin sits
// right next to the name for the same reason - the bars carry magnitude, the badge carries the
// verdict. The bars are decorative once sorted: the group's own aria-label already states
// revenue/cost/profit/margin as one sentence, so screen readers get that instead of nine
// separately-announced mini-bars.
function PerfChart({ rows }) {
  const withData = rows.filter((r) => r.hasData)
  const sorted = [...withData].sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity))
  const max = Math.max(1, ...withData.flatMap((r) => [r.revenue || 0, r.cost || 0, Math.abs(r.profit || 0)]))
  return (
    <div className="pad">
      <Legend items={[
        { color: 'var(--accent)', label: 'Revenue' },
        { color: COST_COLORS.material, label: 'Cost' },
        { color: PROFIT_COLOR, label: 'Profit' },
      ]} />
      <div className="perf-chart">
        {sorted.map((r, i) => (
          <div key={r.code}
               className={`perf-group${i === 0 && r.profit > 0 ? ' leader' : ''}`}
               role="group"
               aria-label={`${r.name}: revenue ${compact(r.revenue)}, cost ${compact(r.cost)}, `
                 + `profit ${compact(r.profit)}`
                 + (r.margin !== null && r.margin !== undefined ? `, ${pct(r.margin)} margin` : '')}>
            <div className="perf-group-head">
              <h4 className="perf-group-label">{r.name}</h4>
              {r.margin !== null && r.margin !== undefined && (
                <span className="perf-group-margin">{pct(r.margin)} margin</span>
              )}
            </div>
            <div className="bars" aria-hidden="true">
              <Bar label="Revenue" max={max} value={compact(r.revenue)}
                   parts={[{ value: r.revenue || 0, color: 'var(--accent)', label: 'Revenue' }]} />
              <Bar label="Cost" max={max} value={compact(r.cost)}
                   parts={[{ value: r.cost || 0, color: COST_COLORS.material, label: 'Cost' }]} />
              <Bar label="Profit" max={max} value={compact(r.profit)}
                   parts={[{ value: Math.abs(r.profit || 0),
                     color: r.profit < 0 ? LOSS_COLOR : PROFIT_COLOR, label: 'Profit' }]} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
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

const SUBMISSION_TONE = { late: 'warn', 'not received': 'bad' }
const SUBMISSION_LABEL = { late: 'Late', 'not received': 'Not received' }

export default function Home({ state, onNavigate, filterHost }) {
  const { masters, position, unattributed, submission } = state
  const latest = masters.months.at(-1).key
  const [month, setMonth] = useState(latest)
  const [evidenceOpen, setEvidenceOpen] = useState(false)

  const ownerLabel = Object.fromEntries(masters.inputs.map((i) => [i.kind, i.owner]))
  const inMonth = (m) => m === null || m === month
  const scopedRows = position.filter((p) => p.month === month)

  const rows = masters.projects.map((p) => projectRow(p, scopedRows.find((r) => r.project === p.code)))
  const withData = rows.filter((r) => r.hasData)

  const portfolio = useMemo(() => {
    const tender = withData.reduce((s, r) => s + r.tender, 0)
    const revenue = aggregate(withData, 'revenue')
    const cost = withData.reduce((s, r) => s + r.cost, 0)
    const profit = revenue === null ? null : revenue - cost
    const margin = profit && revenue ? Math.round((profit / revenue) * 10000) / 100 : null
    return { tender, revenue, cost, profit, margin }
  }, [withData])

  const pendingCount = scopedRows.reduce((s, r) => s + r.pending.length, 0)
  const unresolvedImpact = scopedRows.reduce((s, r) => s + r.underReview, 0)
  // Unassigned costs card retired for now - see the commented-out descriptor below for how to
  // bring it back; state.unattributed is untouched, still read on Source Data.
  // const unattr = unattributed.filter((u) => inMonth(u.month))
  // const unattrTotal = unattr.reduce((s, u) => s + u.amount, 0)
  const readyRows = scopedRows.filter((r) => r.status === 'READY_FOR_FINALIZATION')
  // Not received AND late-but-received - the client's own loudest complaint was the follow-up,
  // not the arithmetic, so "evidence status" covers both, not just outright-missing returns.
  const lateRows = [...(submission?.rows || [])]
    .filter((r) => r.month === month && r.status !== 'on time')
    .sort((a, b) => (b.daysLate || 0) - (a.daysLate || 0))
  const missingCount = lateRows.filter((r) => r.status === 'not received').length
  const lateOnlyCount = lateRows.length - missingCount
  const overallStatus = worstStatus(scopedRows.map((r) => r.status))

  const riskRows = [...withData].sort((a, b) => b.impact - a.impact)

  const outcomeTone = overallStatus === 'FINALIZED' ? 'ok'
    : overallStatus === 'READY_FOR_FINALIZATION' ? 'info' : 'bad'

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
      onAction: () => onNavigate?.('consolidation'),
    },
    /* Retired for now, at the user's request - state.unattributed is still there (still shown
       on Source Data), just not surfaced as a Home card. To bring it back: uncomment this, the
       unattr/unattrTotal lines above, and drop the id:'ready' card below back to 3 cards.
    {
      id: 'unassigned', tone: unattrTotal ? 'warn' : 'ok', title: 'Unassigned costs',
      icon: <IconUnlink />,
      figure: compact(unattrTotal),
      sub: unattr.length ? `${unattr.length} record${unattr.length === 1 ? '' : 's'}` : undefined,
      detail: unattrTotal ? 'Costs are not currently linked to a project.'
        : 'Every cost is linked to a project.',
      clear: !unattrTotal,
      action: unattrTotal ? 'Review →' : undefined,
      onAction: () => onNavigate?.('source'),
    },
    */
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
      onAction: () => onNavigate?.('consolidation'),
    },
    {
      id: 'evidence', tone: missingCount ? 'bad' : lateOnlyCount ? 'warn' : 'ok',
      title: 'Evidence status', icon: <IconInbox />, figure: String(lateRows.length),
      detail: lateRows.length
        ? [missingCount && `${missingCount} not yet received`,
            lateOnlyCount && `${lateOnlyCount} received late`].filter(Boolean).join(', ') + '.'
        : 'All expected evidence has been received on time.',
      clear: !lateRows.length,
      action: lateRows.length ? (evidenceOpen ? 'Hide details' : 'View details →') : undefined,
      onAction: () => setEvidenceOpen((o) => !o),
      expand: evidenceOpen && lateRows.length > 0 && (
        <div className="mini-list" style={{ marginTop: 10 }}>
          {lateRows.map((r) => (
            <div key={`${r.project}|${r.month}|${r.kind}`}>
              <span>{r.projectName} · {r.label} — {ownerLabel[r.kind]}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Pill tone={SUBMISSION_TONE[r.status]}>{SUBMISSION_LABEL[r.status]}</Pill>
                <b>{r.status === 'not received' ? '—' : `${r.daysLate}d late`}</b>
              </span>
            </div>
          ))}
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
      action: 'Open Financial Outcome →', onAction: () => onNavigate?.('consolidation'),
    },
  ].sort((a, b) => SEVERITY_RANK[a.tone] - SEVERITY_RANK[b.tone])

  return (
    <>
      {filterHost && createPortal(
        <div className="filter-bar">
          <FilterChip label="Month" value={month} onChange={(e) => setMonth(e.target.value)}
                      options={masters.months.map((m) => ({ value: m.key, label: m.label }))} />
        </div>,
        filterHost,
      )}

      <Section label="Portfolio at a glance">
        <Tally label="Portfolio at a glance" items={[
          { label: 'Total projects', value: masters.projects.length, icon: <IconBuilding /> },
          { label: 'Contract value', value: compact(portfolio.tender), icon: <IconCoins /> },
          { label: 'Revenue', value: portfolio.revenue === null ? '—' : compact(portfolio.revenue),
            icon: <IconTrendUp /> },
          { label: 'Total cost', value: compact(portfolio.cost), icon: <IconReceipt /> },
          {
            label: 'Profit / loss',
            value: portfolio.profit === null ? '—' : compact(portfolio.profit),
            icon: <IconScales />,
            // The one number this whole page exists to answer - bigger, and coloured by sign
            // rather than reading as just another stat in the row.
            tone: `big ${portfolio.profit !== null && portfolio.profit < 0 ? 'hot' : 'good'}`,
          },
          { label: 'Margin', value: portfolio.margin === null ? '—' : pct(portfolio.margin),
            icon: <IconPercent /> },
        ]} />
      </Section>

      <Section label="Financial performance"
               count={{ text: 'Revenue, cost and profit by project' }}>
        <Card>
          <PerfChart rows={rows} />
        </Card>
      </Section>

      <Section label="Project performance" count={{ text: masters.months.find((m) => m.key === month)?.label }}>
        <Card>
          <DataTable
            rows={withData}
            rowKey={(r) => r.code}
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
                  const profit = rs.reduce((s, r) => s + r.profit, 0)
                  return rev ? pct(Math.round((profit / rev) * 10000) / 100) : '—'
                },
                render: (r) => pct(r.margin),
              },
              { key: 'status', label: 'Status', sortable: false,
                render: (r) => <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill> },
              {
                key: 'action', label: '', sortable: false,
                render: (r) => (
                  <button type="button" className="btn btn-quiet btn-xs"
                          onClick={() => onNavigate?.('consolidation', { project: r.code, month })}>
                    View outcome →
                  </button>
                ),
              },
            ]}
          />
        </Card>
      </Section>

      <Section label="Financial risk / attention">
        <div className="grid2">
          {attentionCards.map((c) => <AttentionCard key={c.id} {...c} />)}
        </div>
      </Section>

      <Section label="Project risk / exceptions" count={{ text: 'sorted by unresolved impact' }}>
        <Card>
          <DataTable
            rows={riskRows}
            rowKey={(r) => r.code}
            sortKey="impact" sortDir="desc"
            empty="No projects match."
            cols={[
              { key: 'name', label: 'Project', sortable: false },
              { key: 'pendingCount', label: 'Pending decisions', num: true },
              { key: 'impact', label: 'Unresolved impact', num: true, fmt: compact },
              { key: 'status', label: 'Status', sortable: false,
                render: (r) => <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill> },
            ]}
          />
        </Card>
      </Section>

    </>
  )
}
