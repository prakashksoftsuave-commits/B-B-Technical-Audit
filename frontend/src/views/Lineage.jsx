import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import DataTable from '../components/DataTable'
import { Card, FilterChip, Pill, Section } from '../components/Bits'
import { compact, money } from '../utils'

// Three categories, not nine - MMS/WBM/FBA/REV are all the ERP stand-in, Return/Unrouted are
// both mail-sourced. The finer-grained module name is still readable in the Description column
// for anyone who needs it; the Source column and its filter only ever choose between the three
// systems this whole product reconciles: ERP, Tally, and Mail.
const CATEGORY = (source) => (source === 'Tally' ? 'Tally' : source === 'Return' || source === 'Unrouted' ? 'Mail' : 'ERP')
const TONE = { Tally: 'info', Mail: 'mute', ERP: 'ok' }
const toneFor = (source) => TONE[CATEGORY(source)]

function SourceDetail({ row, onClose, onNavigate }) {
  return (
    <Card title="Source detail"
          right={<button type="button" className="btn btn-quiet btn-xs" onClick={onClose}>Close</button>}>
      <div className="pad">
        <dl className="kvlist">
          <dt>Source</dt><dd><Pill tone={toneFor(row.source)}>{CATEGORY(row.source)}</Pill></dd>
          <dt>Project</dt><dd>{row.projectName}</dd>
          <dt>Month</dt><dd>{row.monthLabel}</dd>
          <dt>Line</dt><dd>{row.label}</dd>
          <dt>Amount</dt><dd>{row.amount === null || row.amount === undefined ? '—' : money(row.amount)}</dd>
          <dt>Reference</dt><dd>{row.ref || '—'}</dd>
          <dt>Description</dt><dd>{row.description}</dd>
          {row.routedBy && (
            <>
              <dt>Routing</dt>
              <dd>{row.senderMismatch
                ? 'Subject and sender disagreed on the project'
                : `Routed by ${row.routedBy}`}</dd>
            </>
          )}
        </dl>
        {row.project && (
          <div style={{ marginTop: 'var(--s3)' }}>
            <button type="button" className="btn btn-ink btn-sm"
                    onClick={() => onNavigate?.('consolidation', { project: row.project, month: row.month })}>
              View in Financial Outcome →
            </button>
          </div>
        )}
      </div>
    </Card>
  )
}

export default function Lineage({ state, filterHost, navFocus, onNavigate }) {
  const { lineage, masters, unattributed } = state
  const latest = masters.months.at(-1).key
  const [src, setSrc] = useState('all')
  const [proj, setProj] = useState(() => navFocus?.project || 'all')
  const [month, setMonth] = useState(() => navFocus?.month || latest)
  const [q, setQ] = useState(() => navFocus?.q || '')
  const [selected, setSelected] = useState(null)

  const categories = useMemo(
    () => Array.from(new Set(lineage.map((r) => CATEGORY(r.source)))).sort(), [lineage]
  )

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return lineage.filter(
      (r) =>
        (src === 'all' || CATEGORY(r.source) === src) &&
        (proj === 'all' || r.project === proj) &&
        // A row with no month (mail that could not be routed) is not tied to a period, so it
        // stays visible regardless of which month is selected.
        (month === 'all' || r.month === null || r.month === month) &&
        (!needle ||
          `${r.description} ${r.label} ${r.ref} ${r.projectName}`
            .toLowerCase().includes(needle))
    )
  }, [lineage, src, proj, month, q])

  // Feeds the commented-out "Unassigned costs" section below - state.unattributed is still
  // there, just not displayed here for now.
  // const unattrTotal = unattributed.reduce((s, u) => s + u.amount, 0)

  return (
    <>
      {filterHost && createPortal(
        <div className="filter-bar">
          <FilterChip label="Source" value={src} onChange={(e) => setSrc(e.target.value)}
                      options={[{ value: 'all', label: 'All sources' },
                        ...categories.map((c) => ({ value: c, label: c }))]} />
          <FilterChip label="Project" value={proj} onChange={(e) => setProj(e.target.value)}
                      options={[{ value: 'all', label: 'All projects' },
                        ...masters.projects.map((p) => ({ value: p.code, label: p.name }))]} />
          <FilterChip label="Month" value={month} onChange={(e) => setMonth(e.target.value)}
                      options={[{ value: 'all', label: 'All months' },
                        ...masters.months.map((m) => ({ value: m.key, label: m.label }))]} />
          <input
            className="input"
            value={q}
            placeholder="Search description or reference"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>,
        filterHost,
      )}

      <Section label="Source summary">
        {/* Two plain stat cells fit the shared Tally shape; the third holds a list of pills
            rather than one figure, so it keeps its own accessible name instead. */}
        <div className="tally" role="group" aria-label="Source summary">
          <div role="group" aria-label={`Total source records: ${lineage.length}`}>
            <b aria-hidden="true">{lineage.length}</b>
            <span aria-hidden="true">Total source records</span>
          </div>
          <div role="group" aria-label={`Visible or filtered: ${rows.length} of ${lineage.length}`}>
            <b aria-hidden="true">{rows.length} of {lineage.length}</b>
            <span aria-hidden="true">Visible / filtered</span>
          </div>
          <div className="source-pill-cell" role="group" aria-label="Sources">
            <span className="source-pill-label" aria-hidden="true">Sources</span>
            <div className="source-pill-list">
              {categories.map((c) => <Pill key={c} tone={TONE[c]}>{c}</Pill>)}
            </div>
          </div>
        </div>
      </Section>

      {/* Retired for now, at the user's request - state.unattributed itself is untouched, only
          this display of it is off. To bring it back, uncomment this block.
      {unattributed.length > 0 && (
        <Section label="Unassigned costs"
                 count={{ text: `${compact(unattrTotal)} · ${unattributed.length} record${unattributed.length === 1 ? '' : 's'}`,
                   hot: true }}>
          <Card note="Tally cost with no project cost centre - mostly the head-office pool.
            Never apportioned across projects; reported here in full instead.">
            <div className="pad mini-list">
              {unattributed.map((u, i) => (
                <div key={i}>
                  <span>{u.monthLabel} · {u.ledger} — {u.reason}</span>
                  <b>{compact(u.amount)}</b>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      )}
      */}

      <div className={selected ? 'grid2' : undefined} style={selected ? { alignItems: 'start' } : undefined}>
        <Section label="Source rows" count={`${rows.length} of ${lineage.length}`}>
          <Card note="The raw row behind a Financial Outcome figure — voucher, ERP entry or
            mail return. Select a row to trace it back to the project it feeds.">
            <DataTable
              rows={rows}
              maxHeight="56vh"
              rowKey={(r, i) => `${r.source}-${r.ref}-${i}`}
              rowClass={(r) => (selected === r ? 'row-flag' : undefined)}
              empty="No source rows match those filters."
              cols={[
                {
                  key: 'source', label: 'Source', sortable: false,
                  render: (r) => (
                    <button type="button" className="row-toggle" onClick={() => setSelected(r)}
                            aria-pressed={selected === r}>
                      <Pill tone={toneFor(r.source)}>{CATEGORY(r.source)}</Pill>
                    </button>
                  ),
                },
                { key: 'projectName', label: 'Project' },
                { key: 'monthLabel', label: 'Month' },
                { key: 'label', label: 'Line' },
                {
                  key: 'amount', label: 'Amount', num: true,
                  fmt: (v) => (v === null || v === undefined ? '' : money(v)),
                },
                {
                  key: 'routedBy', label: 'Routed by', sortable: false,
                  render: (r) => {
                    if (!r.routedBy) return null
                    if (r.senderMismatch) return <Pill tone="warn">disagree</Pill>
                    return <Pill tone={r.routedBy === 'sender' ? 'info' : 'mute'}>{r.routedBy}</Pill>
                  },
                },
                { key: 'ref', label: 'Reference', mono: true },
                { key: 'description', label: 'Description', wrap: true },
              ]}
            />
          </Card>
        </Section>

        {selected && (
          <SourceDetail row={selected} onClose={() => setSelected(null)} onNavigate={onNavigate} />
        )}
      </div>
    </>
  )
}
