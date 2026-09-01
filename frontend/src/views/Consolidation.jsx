import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import DataTable from '../components/DataTable'
import { Card, FilterChip, Pill, Section, Tally } from '../components/Bits'
import { IconCheck, IconCoins, IconPercent, IconReceipt, IconScales, IconTrendUp } from '../components/Icons'
import { compact, money, signed, TONE } from '../utils'

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

const OWNER = (masters) => Object.fromEntries(masters.inputs.map((i) => [i.kind, i.owner]))
const LABEL = (masters) => Object.fromEntries(masters.inputs.map((i) => [i.kind, i.label]))

const dash = (v) => (v === null || v === undefined ? '—' : money(v))
const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`)

const STATUS_TONE = { OPEN: 'bad', AUDIT_IN_PROGRESS: 'warn', READY_FOR_FINALIZATION: 'info', FINALIZED: 'ok' }
const STATUS_LABEL = { OPEN: 'Open', AUDIT_IN_PROGRESS: 'Audit in progress',
  READY_FOR_FINALIZATION: 'Ready for finalization', FINALIZED: 'Finalized' }
// Same four states, in the Tally strip's own tone vocabulary (hot/warm/cool/good).
const STATUS_TALLY_TONE = { OPEN: 'hot', AUDIT_IN_PROGRESS: 'warm',
  READY_FOR_FINALIZATION: 'cool', FINALIZED: 'good' }
function StatusPill({ status }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status] || status}</Pill>
}
// A company/portfolio status is the least-resolved status among its parts - one open item
// anywhere means the whole is not finalized, same logic outcome.status_of already applies
// per project-month.
function worstStatus(statuses) {
  for (const s of ['OPEN', 'AUDIT_IN_PROGRESS', 'READY_FOR_FINALIZATION']) {
    if (statuses.includes(s)) return s
  }
  return statuses.length ? 'FINALIZED' : 'OPEN'
}

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
      <div className="waterfall-row">
        <span>PROFIT MARGIN</span>
        <b>{pct(final ? pos.margin : pos.provisionalMargin)}</b>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------- per-item table

const COMPARE_ORDER = ['revenue', 'material', 'subcon', 'machinery', 'site']
// Mirrors outcome.py's ADJUSTS_REVENUE / ADJUSTS_COST exactly - which side of the ledger each
// mail-reported adjustment kind lands on, so it can sit next to the line it actually affects.
const REV_ADJ_KINDS = new Set(['revenue_accrued'])
const COST_ADJ_KINDS = new Set(['cost_saving', 'provisional'])
// The lineage label each mail-only row's evidence traces back to - one mail return can now
// state a real breakdown (see fabricate.py's *_ITEMS / service._lineage), so opening and
// closing each get their own label even though both come from the same stock email.
const MAIL_LINEAGE_LABEL = {
  'work-done': 'Work done report', 'opening-stock': 'Opening stock',
  'closing-stock': 'Closing stock', 'site-salary': 'Site salary', formwork: 'Formwork report',
}

function decisionPill(line) {
  if (line.agrees) return <Pill tone="ok">Matched</Pill>
  if (!line.decision) return <Pill tone="bad">Needs review</Pill>
  const label = line.decision.choice === 'erp' ? 'Approved — ERP'
    : line.decision.choice === 'tally' ? 'Approved — Tally'
    : line.decision.choice === 'mail' ? 'Approved — Mail' : 'Approved — adjusted'
  return <Pill tone="info">{label}</Pill>
}

function ItemTable({ project, month, cons, pos, masters, lineage, onDecide, busy }) {
  const lineLabel = Object.fromEntries(masters.lines.map((l) => [l.key, l.label]))

  const [open, setOpen] = useState(() => new Set())
  const toggle = (key) => setOpen((prev) => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const locked = pos.status === 'FINALIZED'
  const label = LABEL(masters)
  const owner = OWNER(masters)
  const rows = []

  // A mail-only line: nothing for ERP/Tally to compare it against, so it is never disputed -
  // shown as its own row, in place, rather than filed away in a separate section further down
  // the page, so an auditor reads everything relevant to a decision in one continuous table.
  const mailRow = (slug, item, value, ownerEmail, restated) => ({
    key: `mail-${slug}`, kind: 'mail', slug, item, mail: value,
    missing: value === null || value === undefined, owner: ownerEmail, restated: !!restated,
  })
  const adjRow = (slug, a) => ({
    key: `adj-${slug}`, kind: 'adj', item: a.kind.replace(/_/g, ' '), mail: a.amount,
    adjKind: a.kind, reason: a.reason,
  })

  // Revenue - its ERP/Tally reconciliation, then the mail evidence and adjustments that bear on
  // it, right underneath.
  const revLine = pos.lines.revenue
  rows.push({ key: 'line-revenue', kind: 'compare', ln: 'revenue', item: lineLabel.revenue,
    erp: revLine.erp, tally: revLine.tally, mail: cons.raBill, diff: revLine.diff,
    agrees: revLine.agrees, decision: revLine.decision, approved: revLine.approved })
  rows.push(mailRow('work-done', label.work_done, cons.workDone, owner.work_done))
  const revAdjustments = cons.adjustments.filter((a) => REV_ADJ_KINDS.has(a.kind))
  revAdjustments.forEach((a, i) => rows.push(adjRow(`rev-${i}`, a)))

  // The stock adjustment folds Opening/Closing into a material-consumed figure (see
  // outcome._stock_adjustment) - shown right after Material, since that is exactly the context
  // an auditor needs before deciding that line, not a fact to go hunting for separately.
  const stockAdj = cons.opening != null && cons.closing != null ? cons.opening - cons.closing : null

  for (const ln of COMPARE_ORDER.slice(1)) {
    const l = pos.lines[ln]
    rows.push({ key: `line-${ln}`, kind: 'compare', ln, item: lineLabel[ln],
      erp: l.erp, tally: l.tally, mail: null, diff: l.diff, agrees: l.agrees,
      decision: l.decision, approved: l.approved })
    if (ln === 'material') {
      rows.push(mailRow('opening-stock', 'Opening stock', cons.opening, owner.stock))
      rows.push(mailRow('closing-stock', 'Closing stock', cons.closing, owner.stock, cons.stockRestated))
      rows.push({ key: 'stock-adjustment', kind: 'derived',
        item: 'Stock adjustment (added to cost)', mail: stockAdj })
    }
  }

  // Site staff salary - ERP's payroll register (HRM) against the site's own mailed figure, a
  // real decidable line like the four cost heads above, just ERP-vs-mail rather than
  // ERP-vs-Tally (Tally carries no payroll ledger in this system). Formwork stays a plain
  // mail-only expense, never disputed, added straight to cost.
  const salaryLine = pos.lines.salary
  rows.push({ key: 'line-salary', kind: 'salary', ln: 'salary', item: label.hr_salary,
    erp: salaryLine.erp, mail: salaryLine.mail, diff: salaryLine.diff,
    agrees: salaryLine.agrees, decision: salaryLine.decision, approved: salaryLine.approved,
    missing: salaryLine.mail === null, owner: owner.hr_salary })
  rows.push(mailRow('formwork', label.formwork, cons.formwork, owner.formwork))
  const costAdjustments = cons.adjustments.filter((a) => COST_ADJ_KINDS.has(a.kind))
  costAdjustments.forEach((a, i) => rows.push(adjRow(`cost-${i}`, a)))

  const total = {
    erp: COMPARE_ORDER.slice(1).reduce((s, ln) => s + pos.lines[ln].erp, 0),
    tally: COMPARE_ORDER.slice(1).reduce((s, ln) => s + pos.lines[ln].tally, 0),
    approved: pos.pending.filter((ln) => ln !== 'revenue').length ? null
      : COMPARE_ORDER.slice(1).reduce((s, ln) => s + pos.lines[ln].approved, 0),
  }
  rows.push({ key: 'line-total', kind: 'total', item: 'Total — cost heads',
    erp: total.erp, tally: total.tally, mail: null, diff: total.erp - total.tally,
    agrees: total.approved !== null, decision: null, approved: total.approved })

  // The real total an auditor is approving: the cost heads above (once resolved) plus
  // everything mail contributes that ERP/Tally never see - salary, formwork, the stock
  // adjustment, cost-side manual adjustments. Same formula as outcome._figures(), read back
  // from the API rather than recomputed here - `pos.provisionalCost`/`approvedCost` already
  // include every one of these pieces.
  const mailCostTotal = (salaryLine.approved || 0) + (cons.formwork || 0) + (stockAdj || 0)
    + costAdjustments.reduce((s, a) => s + a.amount, 0)
  const finalCost = pos.approvedCost !== null && pos.approvedCost !== undefined
  rows.push({ key: 'line-total-cost', kind: 'total-cost',
    item: 'Total — cost (incl. mail & stock)', mail: mailCostTotal,
    approved: finalCost ? pos.approvedCost : pos.provisionalCost, final: finalCost })

  const drillDown = (r) => {
    if (r.kind === 'mail') {
      return lineage.filter((l) => l.project === project && l.month === month
        && (l.source === 'Return' || l.source === 'Unrouted')
        && l.label === MAIL_LINEAGE_LABEL[r.slug])
    }
    if (r.kind === 'adj') {
      return lineage.filter((l) => l.project === project && l.month === month
        && (l.source === 'Return' || l.source === 'Unrouted') && l.label === 'Manual adjustments')
    }
    if (r.kind === 'salary') {
      // ERP's HRM entry and the site's own mail return, together - the two sides of this one
      // decision, same as a normal cost head shows its ERP and Tally vouchers together.
      return lineage.filter((l) => l.project === project && l.month === month
        && ((l.source === 'HRM' && l.label === 'Site staff salary')
          || ((l.source === 'Return' || l.source === 'Unrouted') && l.label === 'Site salary')))
    }
    return lineage.filter((l) => l.project === project && l.month === month
      && l.source !== 'Return' && l.source !== 'Unrouted' && l.label === lineLabel[r.ln])
  }

  // Rows with nothing to trace get plain text instead of an expand toggle that would only ever
  // open empty (a return that never arrived, a figure computed from the two rows just above it)
  // or misleading (a total row - every rupee in it already has its own row, with its own working
  // expand, directly above; re-showing all of them under the total does not add anything, and
  // for "Total - cost (incl. mail & stock)" specifically it is actively wrong, since that total
  // excludes any cost head still pending while its old expand showed all four regardless).
  const untraceable = (r) => ((r.kind === 'mail' || r.kind === 'salary') && r.missing)
    || r.kind === 'derived'
  const isTotal = (r) => r.kind === 'total' || r.kind === 'total-cost'

  return (
    <DataTable
      rows={rows.flatMap((r) => (open.has(r.key) && !untraceable(r) && !isTotal(r)
        ? [r, ...drillDown(r).map((d, i) => ({ ...d, _drill: true, key: `${r.key}-d${i}` }))]
        : [r]))}
      rowKey={(r) => r.key}
      rowClass={(r) => (r._drill ? 'row-child'
        : isTotal(r) ? 'row-total'
        : r.kind === 'mail' ? (r.missing ? 'row-flag' : undefined)
        : r.kind === 'adj' || r.kind === 'derived' ? undefined
        : !r.agrees ? 'row-flag' : undefined)}
      empty="Nothing to show."
      cols={[
        {
          key: 'item', label: 'Item', sortable: false, nowrap: true,
          render: (r) => (r._drill
            ? <span className="child-item">{r.description}{r.ref ? ` (${r.ref})` : ''}</span>
            : isTotal(r)
            ? <span>{r.item}</span>
            : untraceable(r)
            ? <span className="child-item">{r.item}</span>
            : (
              <button type="button" className="row-toggle" onClick={() => toggle(r.key)}
                      aria-expanded={open.has(r.key)}>
                <span className={`caret${open.has(r.key) ? ' open' : ''}`} aria-hidden="true">▸</span>
                {r.item}
              </button>
            )),
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
        { key: 'diff', label: 'Difference', num: true, sortable: false,
          render: (r) => (r._drill ? ''
            : r.diff === null || r.diff === undefined ? '—'
            : <span className={!r.agrees ? 'neg' : undefined}>{signed(r.diff)}</span>) },
        {
          key: 'status', label: 'Status', sortable: false,
          render: (r) => {
            if (r._drill) return null
            if (r.kind === 'mail') {
              if (r.missing) return <Pill tone="bad">Not received</Pill>
              if (r.restated) return <Pill tone="info">Restated</Pill>
              return <Pill tone="ok">Reported</Pill>
            }
            if (r.kind === 'adj') return <Pill tone={TONE[r.adjKind] || 'info'}>{r.reason}</Pill>
            if (r.kind === 'derived') return <Pill tone="info">Computed</Pill>
            if (r.kind === 'total-cost') return <Pill tone={r.final ? 'ok' : 'warn'}>{r.final ? 'Final' : 'Current'}</Pill>
            if (r.kind === 'salary' && r.missing) return <Pill tone="bad">Not received</Pill>
            return decisionPill(r)
          },
        },
        {
          key: 'decision', label: 'Auditor decision / final approved', sortable: false, wrap: true,
          render: (r) => {
            if (r._drill) return null
            if (r.kind === 'mail') {
              return r.missing
                ? <span className="dim-note">Owed by {r.owner}</span>
                : <span>{money(r.mail)} — no decision needed</span>
            }
            if (r.kind === 'adj') return <span>{signed(r.mail)} — applied automatically</span>
            if (r.kind === 'derived') {
              return <span>{r.mail === null ? '—' : signed(r.mail)} — Opening minus Closing, folded into cost automatically</span>
            }
            if (r.kind === 'total-cost') {
              return <span>{money(r.approved)} — {r.final ? 'Final' : 'Current, pending lines excluded'}</span>
            }
            if (r.kind === 'salary' && r.missing) {
              return <span className="dim-note">Owed by {r.owner}</span>
            }
            if (r.agrees) return <span>{money(r.approved)} — no decision needed</span>
            if (locked) {
              return <span>{money(r.approved)} — locked, month finalized</span>
            }
            const inFlight = busy.has(r.kind === 'total' ? 'total' : r.ln)
            if (r.kind === 'total') {
              return <span>{r.approved === null ? 'Waiting on the lines above' : money(r.approved)}</span>
            }
            // Undecided: both options stay equally prominent, since either is a live choice to
            // make. Once a choice is recorded, only the chosen side keeps the solid "approved"
            // green - the other option drops back to an outline button so the reader sees which
            // one won at a glance instead of two identical green buttons either way. Salary is
            // ERP-vs-mail rather than ERP-vs-Tally, so its second option reads "Mail" and reads
            // its value from r.mail instead of r.tally - same buttons otherwise.
            const isSalary = r.kind === 'salary'
            const secondChoice = isSalary ? 'mail' : 'tally'
            const secondLabel = isSalary ? 'Mail' : 'Tally'
            const secondValue = isSalary ? r.mail : r.tally
            const chosenErp = r.decision?.choice === 'erp'
            const chosenSecond = r.decision?.choice === secondChoice
            return (
              <span className="decide-row">
                <button type="button"
                        className={`btn btn-sm ${!r.decision || chosenErp ? 'btn-approve' : 'btn-out'}`}
                        disabled={inFlight} onClick={() => onDecide(r.ln, 'erp')}>
                  {chosenErp && <IconCheck />} Approve ERP ({money(r.erp)})
                </button>
                <button type="button"
                        className={`btn btn-sm ${!r.decision || chosenSecond ? 'btn-approve' : 'btn-out'}`}
                        disabled={inFlight} onClick={() => onDecide(r.ln, secondChoice)}>
                  {chosenSecond && <IconCheck />} Approve {secondLabel} ({money(secondValue)})
                </button>
                {r.decision && (
                  <button type="button" className="btn btn-quiet btn-xs"
                          disabled={inFlight} onClick={() => onDecide(r.ln, null)}>
                    Undo
                  </button>
                )}
              </span>
            )
          },
        },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------- page

function aggregate(rows, key) {
  const nums = rows.map((r) => r[key])
  return nums.some((v) => v === null || v === undefined) ? null : nums.reduce((s, v) => s + v, 0)
}

export default function Consolidation({ state, onStateChange, onFilterChange, filterHost,
                                         navFocus, onNavigate }) {
  const { consolidation, masters, position, cumulative, poc, lineage, unattributed, outstanding } = state
  const latest = masters.months.at(-1).key
  const [proj, setProj] = useState(() => navFocus?.project || 'all')
  const [month, setMonth] = useState(() => navFocus?.month || latest)
  const [busyKeys, setBusyKeys] = useState(() => new Set())
  const [busyAction, setBusyAction] = useState(false)
  const [finalizeAllResult, setFinalizeAllResult] = useState(null)

  // The Excel download button lives in the nav rail, outside this view - it reports its
  // filter out so that button can request a workbook scoped to what's on screen.
  useEffect(() => { onFilterChange?.(proj, month) }, [proj, month, onFilterChange])
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
                  options={[{ value: 'all', label: 'All months (this sample)' },
                    ...masters.months.map((m) => ({ value: m.key, label: m.label }))]} />
    </div>
  )

  return (
    <>
      {filterHost && createPortal(filterBar, filterHost)}

      <Section label="Financial KPI summary">
        <Tally label="Financial KPI summary" items={[
          { label: 'Contract value', value: compact(hero.tender), icon: <IconCoins /> },
          { label: 'Revenue', value: hero.provisionalRevenue === null ? '—' : compact(hero.provisionalRevenue),
            icon: <IconTrendUp /> },
          { label: 'Cost', value: compact(kpiCost), icon: <IconReceipt /> },
          {
            label: 'Profit / loss', value: kpiProfit === null ? '—' : compact(kpiProfit),
            icon: <IconScales />,
            tone: `big ${kpiProfit !== null && kpiProfit < 0 ? 'hot' : 'good'}`,
          },
          { label: 'Margin', value: kpiMargin === null ? '—' : pct(kpiMargin), icon: <IconPercent /> },
          { label: 'Status', value: STATUS_LABEL[hero.status] || hero.status,
            tone: STATUS_TALLY_TONE[hero.status] },
        ]} />
      </Section>

      {proj === 'all' ? (
        <Section label="Project outcomes"
                 count={{ text: `${heroRows.length} projects · ${month === 'all'
                   ? 'this sample' : masters.months.find((m) => m.key === month)?.label}` }}>
          <Card note="Expand a project to see the reconciliation, decide its lines, and finalize
            it right here - the same rows shown here are what the Financial outcome summary
            above is summed from.">
            <ProjectSummaryTable
              rows={heroRows} consolidation={consolidation}
              position={position} masters={masters} lineage={lineage} busyKeys={busyKeys}
              decide={decide} month={month}
              finalize={finalize} reopen={reopen} busyAction={busyAction}
            />
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
        scopedPosition.map((pos) => {
          const cons = consolidation.find((r) => r.project === pos.project && r.month === pos.month)
          return (
            <Section key={pos.month} id="cost-reconciliation"
                     label={`${pos.projectName} · ${pos.monthLabel}`}
                     count={{ text: <StatusPill status={pos.status} /> }}>
              <Card>
                {/* A one-line status note, not a second column - the waterfall has ten rows and
                    this has one sentence, so a 50/50 grid2 split just left the right side
                    mostly empty. Full width above the table instead. */}
                {pos.finalized && (
                  <p className="dim-note" style={{ marginBottom: 'var(--s2)' }}>
                    Finalized by {pos.finalized.finalizedBy || 'unknown'} on{' '}
                    {pos.finalized.finalizedAt?.slice(0, 10)}.
                    {pos.finalized.reopened && ' Since reopened.'}
                  </p>
                )}
                {!pos.finalized && pos.readyToFinalize && (
                  <p className="dim-note" style={{ marginBottom: 'var(--s2)' }}>
                    Every line is resolved — ready to finalize from the Financial outcome
                    section below.
                  </p>
                )}
                {!pos.readyToFinalize && (
                  <p className="dim-note" style={{ marginBottom: 'var(--s2)' }}>
                    {pos.pending.length} line{pos.pending.length === 1 ? '' : 's'} still
                    need{pos.pending.length === 1 ? 's' : ''} an auditor decision before
                    this month can be finalized.
                  </p>
                )}
                <div style={{ maxWidth: 560 }}>
                  <ProfitWaterfall pos={pos} cons={cons} masters={masters} />
                </div>
                <ItemTable
                  project={pos.project} month={pos.month}
                  cons={cons} pos={pos} masters={masters} lineage={lineage}
                  busy={new Set([...busyKeys].filter((k) => k.startsWith(`${pos.project}|${pos.month}|`))
                    .map((k) => k.split('|')[2]))}
                  onDecide={(line, choice) => decide(pos.project, pos.month, line, choice)}
                />
              </Card>
            </Section>
          )
        })
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

function ProjectSummaryTable({ rows, consolidation, position, masters, lineage,
                                busyKeys, decide, month, finalize, reopen, busyAction }) {
  const [open, setOpen] = useState(() => new Set())
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
            <ItemTable
              project={pos.project} month={pos.month}
              cons={cons} pos={pos} masters={masters} lineage={lineage}
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
              <span className={`caret${open.has(r.project) ? ' open' : ''}`} aria-hidden="true">▸</span>
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
