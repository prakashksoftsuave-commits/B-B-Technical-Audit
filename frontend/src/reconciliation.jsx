import { Pill } from './components/Bits'

/* The one reconciliation model - which lines make up a project-month, what "matched" /
   "needs review" / "reported" / "not received" mean, and which lineage rows trace back to
   which line. Financial Outcome (decisioning) and Source Data (tracing) both read this, so
   they can never quietly disagree about the same line - the exact failure mode this app's own
   history warns about (see CLAUDE.md's "one array feeds both displays" lesson). */

export const OWNER = (masters) => Object.fromEntries(masters.inputs.map((i) => [i.kind, i.owner]))
export const LABEL = (masters) => Object.fromEntries(masters.inputs.map((i) => [i.kind, i.label]))

export const STATUS_TONE = { OPEN: 'bad', AUDIT_IN_PROGRESS: 'warn', READY_FOR_FINALIZATION: 'info', FINALIZED: 'ok' }
export const STATUS_LABEL = { OPEN: 'Open', AUDIT_IN_PROGRESS: 'Audit in progress',
  READY_FOR_FINALIZATION: 'Ready for finalization', FINALIZED: 'Finalized' }
export function StatusPill({ status }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status] || status}</Pill>
}
// A company/portfolio status is the least-resolved status among its parts - one open item
// anywhere means the whole is not finalized, same logic outcome.status_of already applies
// per project-month.
export function worstStatus(statuses) {
  for (const s of ['OPEN', 'AUDIT_IN_PROGRESS', 'READY_FOR_FINALIZATION']) {
    if (statuses.includes(s)) return s
  }
  return statuses.length ? 'FINALIZED' : 'OPEN'
}

export function decisionPill(line) {
  if (line.agrees) return <Pill tone="ok">Matched</Pill>
  if (!line.decision) return <Pill tone="bad">Needs review</Pill>
  const label = line.decision.choice === 'erp' ? 'Approved — ERP'
    : line.decision.choice === 'tally' ? 'Approved — Tally'
    : line.decision.choice === 'mail' ? 'Approved — Mail' : 'Approved — adjusted'
  return <Pill tone="info">{label}</Pill>
}

export const COMPARE_ORDER = ['revenue', 'material', 'subcon', 'machinery', 'site']
// Mirrors outcome.py's ADJUSTS_REVENUE / ADJUSTS_COST exactly - which side of the ledger each
// mail-reported adjustment kind lands on, so it can sit next to the line it actually affects.
export const REV_ADJ_KINDS = new Set(['revenue_accrued'])
export const COST_ADJ_KINDS = new Set(['cost_saving', 'provisional'])
// The lineage label each mail-only row's evidence traces back to - one mail return can now
// state a real breakdown (see fabricate.py's *_ITEMS / service._lineage), so opening and
// closing each get their own label even though both come from the same stock email.
export const MAIL_LINEAGE_LABEL = {
  'work-done': 'Work done report', 'opening-stock': 'Opening stock',
  'closing-stock': 'Closing stock', 'site-salary': 'Site salary', formwork: 'Formwork report',
}

// One reconciliation, never three independent computations of it - the Financial Outcome
// view table (which adds its own ERP/Tally/Mail drill-down on top), the Exceptions & Pending tab
// and the Audit Trail tab (both just filter these same rows), and Source Data (which sums the
// same underlying lineage rows a different way) all read this one function's output.
export function buildReconciliationRows({ cons, pos, masters }) {
  const lineLabel = Object.fromEntries(masters.lines.map((l) => [l.key, l.label]))
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

  return rows
}

// A line's reconciliation status, in the same vocabulary the stat strip counts by - kept as one
// function so the strip's totals and every row's own Status pill can never read differently for
// the same row. "adj"/"derived"/total rows aren't decidable line items, so they fall out of every
// bucket (excluded from the strip's own denominator, same reasoning as outcome.py's own COMPARED/
// COST_LINES split).
export function lineStatus(r) {
  if (r.kind === 'adj' || r.kind === 'derived' || r.kind === 'total' || r.kind === 'total-cost') return null
  if (r.kind === 'mail') return r.missing ? 'not-received' : 'reported'
  if (r.missing) return 'not-received'
  // Resolved either way - naturally agreed, or an auditor already decided it - counts as
  // matched. "Needs review" means genuinely still open, the same definition the Exceptions &
  // Pending tab filters on, so a line an auditor already approved never sits in both a
  // "resolved" bucket in the strip and an "outstanding" bucket in that tab at once.
  return (r.agrees || r.decision) ? 'matched' : 'needs-review'
}

// Rows with nothing to trace get plain text instead of an expand toggle that would only ever
// open empty (a return that never arrived, a figure computed from the two rows just above it)
// or misleading (a total row - every rupee in it already has its own row, with its own working
// expand, directly above).
export const untraceable = (r) => ((r.kind === 'mail' || r.kind === 'salary') && r.missing)
  || r.kind === 'derived'
export const isTotal = (r) => r.kind === 'total' || r.kind === 'total-cost'
export const canTrace = (r) => !untraceable(r) && !isTotal(r)

// Every lineage row that feeds one reconciliation row - the exact rows an "eye" toggle in
// Financial Outcome expands inline, and the exact rows the evidence drawer (Source Data,
// Financial Outcome's single-project view) lists.
export function traceLineage(r, { project, month, lineage, lineLabel }) {
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

// Three categories, not nine - MMS/WBM/FBA/REV/HRM are all the ERP stand-in, Return/Unrouted are
// both mail-sourced. The finer-grained module name is still readable in the evidence drawer for
// anyone who needs it; the Source column/filter and the drawer's own breakdown only ever choose
// between the three systems this whole product reconciles: ERP, Tally, and Mail.
export const CATEGORY = (source) => (source === 'Tally' ? 'Tally'
  : source === 'Return' || source === 'Unrouted' ? 'Mail' : 'ERP')
export const SOURCE_TONE = { Tally: 'info', Mail: 'mute', ERP: 'ok' }

// The same four states lineStatus() classifies every reconciliation line into - shared between
// Source Data's item table and the evidence drawer (wherever it's opened from), never a second
// opinion on which bucket a line is in.
export const ITEM_STATUS = {
  matched: { label: 'MATCHED', tone: 'ok' },
  'needs-review': { label: 'NEEDS REVIEW', tone: 'warn' },
  reported: { label: 'REPORTED', tone: 'info' },
  'not-received': { label: 'NOT RECEIVED', tone: 'bad' },
}

// "Contract Value (Tender)" on Source Data is the Revenue reconciliation line (ERP REV vs Tally
// Sales), relabeled - the closest real, sourced figure to "tender" this data model carries.
export const ITEM_LABEL_OVERRIDE = { revenue: 'Contract Value (Tender)' }

// The real, traceable data items for one project-month - the four ERP-vs-Tally cost heads plus
// revenue, the mail-only returns, and the ERP-vs-mail salary line. Never the derived stock
// adjustment or manual-adjustment sub-rows: those aren't data items an evidence record backs,
// they're arithmetic on top of the items that are. consolidatedValue is the SUM of every
// underlying source record (ERP + Tally + Mail) - "every rupee recorded anywhere," deliberately
// not the auditor's reconciled `approved` figure (which is null until decided) - this is what
// the evidence drawer's own header amount is built from, wherever it's opened from.
export function itemsForMonth({ project, month, cons, pos, masters, lineage, lineLabel }) {
  if (!cons || !pos) return []
  return buildReconciliationRows({ cons, pos, masters })
    .filter((r) => r.kind === 'compare' || r.kind === 'mail' || r.kind === 'salary')
    .map((r) => {
      const records = traceLineage(r, { project, month, lineage, lineLabel })
      return {
        key: `${project}|${month}|${r.key}`, project, month, monthLabel: pos.monthLabel,
        label: ITEM_LABEL_OVERRIDE[r.ln] || r.item,
        status: lineStatus(r),
        records,
        consolidatedValue: records.reduce((s, x) => s + (x.amount || 0), 0),
        sources: [...new Set(records.map((x) => CATEGORY(x.source)))],
      }
    })
}
