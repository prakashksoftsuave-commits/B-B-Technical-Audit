import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import DataTable from '../components/DataTable'
import { Card, FilterChip, Pill, Section, Tally } from '../components/Bits'
import { EvidenceDrawer } from '../components/EvidenceDrawer'
import { IconEye } from '../components/Icons'
import { CATEGORY, ITEM_STATUS, SOURCE_TONE, StatusPill, itemsForMonth } from '../reconciliation'
import { money } from '../utils'

const dash = (v) => (v === null || v === undefined ? '—' : money(v))
const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`)

// Scopes an item to one source only, for the Source filter. An item left with nothing after
// scoping is dropped by the caller rather than shown as an empty row.
function scopeToSource(item, src) {
  if (src === 'all') return item
  const records = item.records.filter((x) => CATEGORY(x.source) === src)
  return { ...item, records, sources: records.length ? [src] : [],
    consolidatedValue: records.reduce((s, x) => s + (x.amount || 0), 0) }
}

function DataItemTable({ items, onOpenDrawer }) {
  return (
    <DataTable
      rows={items}
      rowKey={(r) => r.key}
      rowClass={(r) => (r.status === 'not-received' ? 'row-flag' : undefined)}
      empty="No data items match those filters."
      cols={[
        {
          key: 'label', label: 'Data Item', sortable: false, nowrap: true,
          render: (r) => (
            <button type="button" className="row-toggle" onClick={() => onOpenDrawer(r)}>
              {r.label}
            </button>
          ),
        },
        { key: 'consolidatedValue', label: 'Consolidated Value (INR)', num: true,
          sortable: false, fmt: money },
        {
          key: 'sources', label: 'Sources', sortable: false,
          render: (r) => (r.sources.length
            ? r.sources.map((s) => <Pill key={s} tone={SOURCE_TONE[s]}>{s.toUpperCase()}</Pill>)
            : <span className="dim-note">—</span>),
        },
        {
          key: 'sourceCount', label: 'Source Count', num: true, sortable: false,
          render: (r) => (
            <button type="button" className="row-toggle" onClick={() => onOpenDrawer(r)}>
              {r.records.length}
            </button>
          ),
        },
        {
          key: 'status', label: 'Status', sortable: false,
          render: (r) => {
            const st = ITEM_STATUS[r.status]
            return st ? <Pill tone={st.tone}>{st.label}</Pill> : null
          },
        },
        {
          key: 'view', label: 'View', sortable: false,
          render: (r) => (
            <button type="button" className="row-eye" title="View source detail"
                    onClick={() => onOpenDrawer(r)}>
              <IconEye />
            </button>
          ),
        },
      ]}
    />
  )
}

// One item table per relevant month - a single table when a specific month is selected, one per
// sampled month (each under its own month banner) when "All months" is - the exact all/one-month
// duality Financial Outcome's own ProjectSummaryTable already established, reused rather than
// inventing a second way to fold many months into one row.
function ItemsBlock({ project, month, onOpenDrawer }) {
  if (!project.items.length) {
    return <p className="dim-note" style={{ padding: '10px 4px' }}>No data items for this selection.</p>
  }
  const groups = month === 'all'
    ? [...project.items.reduce((m, it) => {
        if (!m.has(it.month)) m.set(it.month, [])
        m.get(it.month).push(it)
        return m
      }, new Map()).entries()]
    : [[month, project.items]]

  return (
    <>
      {groups.map(([m, items]) => {
        const records = items.reduce((s, it) => s + it.records.length, 0)
        // Same "backed by real evidence" rule the project row's own Data Items count uses -
        // this footer would otherwise silently disagree with that number.
        const consolidated = items.filter((it) => it.records.length > 0).length
        return (
          <div key={m} className="nested-items-block">
            {month === 'all' && (
              <div className="section-banner" style={{ marginBottom: 8 }}>{items[0].monthLabel}</div>
            )}
            <div className="nested-items-card">
              <DataItemTable items={items} onOpenDrawer={onOpenDrawer} />
            </div>
            <p className="dim-note" style={{ margin: '10px 2px 0' }}>
              {consolidated} of {items.length} item{items.length === 1 ? '' : 's'} consolidated ·{' '}
              {records} source record{records === 1 ? '' : 's'}
            </p>
          </div>
        )
      })}
    </>
  )
}

export default function Lineage({ state, filterHost, navFocus }) {
  const { lineage, masters } = state
  const latest = masters.months.at(-1).key
  const [src, setSrc] = useState('all')
  const [proj, setProj] = useState(() => navFocus?.project || 'all')
  const [month, setMonth] = useState(() => navFocus?.month || latest)
  const [q, setQ] = useState(() => navFocus?.q || '')
  const [openProjects, setOpenProjects] = useState(() => {
    // One project expanded by default, to show the shape of the page - not a fixed code, since
    // a future dataset might not carry this exact project.
    const tidel = masters.projects.find((p) => p.name.includes('Tidel'))
    return new Set(tidel ? [tidel.code] : [])
  })
  const [drawer, setDrawer] = useState(null)

  const categories = useMemo(
    () => Array.from(new Set(lineage.map((r) => CATEGORY(r.source)))).sort(), [lineage],
  )
  const lineLabel = useMemo(
    () => Object.fromEntries(masters.lines.map((l) => [l.key, l.label])), [masters],
  )

  const toggleProject = (code) => setOpenProjects((prev) => {
    const next = new Set(prev)
    next.has(code) ? next.delete(code) : next.add(code)
    return next
  })

  const qq = q.trim().toLowerCase()

  // One row per project in scope, each carrying the item rows it would show if expanded -
  // computed regardless of expansion, since the Data Items/Source Records columns need the
  // real count either way, not just once a reader happens to open it.
  const projectRows = useMemo(() => {
    const projects = masters.projects.filter((p) => proj === 'all' || p.code === proj)
    return projects
      .map((p) => {
        const posEntries = month === 'all'
          ? state.position.filter((x) => x.project === p.code)
          : state.position.filter((x) => x.project === p.code && x.month === month)
        const rawItems = posEntries.flatMap((pos) => {
          const cons = state.consolidation.find((c) => c.project === p.code && c.month === pos.month)
          return itemsForMonth({ project: p.code, month: pos.month, cons, pos, masters, lineage, lineLabel })
        })
        const scoped = rawItems
          .map((it) => scopeToSource(it, src))
          .filter((it) => src === 'all' || it.records.length > 0)
        const projectMatchesQ = !qq || p.name.toLowerCase().includes(qq)
        const visibleItems = projectMatchesQ ? scoped : scoped.filter((it) => it.label.toLowerCase().includes(qq))

        const scopeFig = month === 'all'
          ? state.cumulative.find((c) => c.project === p.code)
          : state.position.find((x) => x.project === p.code && x.month === month)

        // "Consolidated" means backed by at least one real source record - a line item nobody
        // has reported or booked anything against yet (a return that never arrived) has nothing
        // to consolidate, so it doesn't count here even though it still has its own row in the
        // table below (seeing that gap is the point of that table). Real reconciliation lines
        // always number 10 per project-month by R2's own citation (revenue + 4 cost heads + the
        // mail-only returns + salary), so counting every row regardless of whether it has
        // evidence behind it would make this figure nothing more than projects x 10 - counting
        // only the ones with real evidence is what makes it move with actual data completeness
        // instead of just project count.
        const consolidatedItems = visibleItems.filter((it) => it.records.length > 0)

        return {
          code: p.code, name: p.name, hasData: posEntries.length > 0,
          tenderAmount: scopeFig?.tenderAmount ?? null,
          profit: scopeFig ? (scopeFig.profit ?? scopeFig.provisionalProfit ?? null) : null,
          margin: scopeFig ? (scopeFig.margin ?? scopeFig.provisionalMargin ?? null) : null,
          status: scopeFig?.status || 'OPEN',
          items: visibleItems,
          dataItems: consolidatedItems.length,
          sourceRecords: visibleItems.reduce((s, it) => s + it.records.length, 0),
          matchesQ: projectMatchesQ,
        }
      })
      .filter((p) => (p.hasData || proj !== 'all') && (p.matchesQ || p.dataItems > 0))
  }, [masters, proj, month, src, qq, state.position, state.consolidation, state.cumulative, lineage, lineLabel])

  const totals = useMemo(() => ({
    projects: projectRows.length,
    items: projectRows.reduce((s, p) => s + p.dataItems, 0),
    records: projectRows.reduce((s, p) => s + p.sourceRecords, 0),
  }), [projectRows])

  const tableRows = projectRows.flatMap((p) => {
    const base = { ...p, key: p.code }
    if (!openProjects.has(p.code)) return [base]
    return [base, {
      key: `${p.code}-detail`, _detail: true,
      content: (
        <ItemsBlock project={p} month={month}
                    onOpenDrawer={(item) => setDrawer({ item, projectName: p.name })} />
      ),
    }]
  })

  return (
    <div className="source-data-page">
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
            placeholder="Search data items..."
            onChange={(e) => setQ(e.target.value)}
          />
        </div>,
        filterHost,
      )}

      <Section label="Source summary">
        <Tally label="Source summary" items={[
          { label: 'Projects', value: String(totals.projects) },
          { label: 'Consolidated Items', value: String(totals.items) },
          { label: 'Source Records', value: String(totals.records), note: 'Underlying records' },
        ]} />
      </Section>

      <Section label="Projects" count={`${projectRows.length} of ${masters.projects.length}`}>
        <Card>
          <DataTable
            rows={tableRows}
            rowKey={(r) => r.key}
            rowClass={(r) => (r._detail ? 'row-section' : r.status === 'OPEN' ? 'row-flag' : undefined)}
            rowSpan={(r) => (r._detail ? r.content : null)}
            empty="No projects match those filters."
            cols={[
              {
                key: 'name', label: 'Project', sortable: false, nowrap: true,
                render: (r) => (
                  <button type="button" className="row-toggle" onClick={() => toggleProject(r.code)}
                          aria-expanded={openProjects.has(r.code)}>
                    <span className={`caret${openProjects.has(r.code) ? ' open' : ''}`} aria-hidden="true">&gt;</span>
                    {r.name}
                  </button>
                ),
              },
              { key: 'tenderAmount', label: 'Contract Value (INR)', num: true, sortable: false, fmt: dash },
              { key: 'profit', label: 'Profit / Loss (INR)', num: true, sortable: false, fmt: dash },
              { key: 'margin', label: 'Margin', num: true, sortable: false, fmt: pct },
              { key: 'dataItems', label: 'Data Items', num: true, sortable: false },
              { key: 'sourceRecords', label: 'Source Records', num: true, sortable: false },
              { key: 'status', label: 'Status', sortable: false,
                render: (r) => <StatusPill status={r.status} /> },
            ]}
          />
        </Card>
      </Section>

      {drawer && (
        <EvidenceDrawer item={drawer.item} projectName={drawer.projectName}
                         onClose={() => setDrawer(null)} />
      )}
    </div>
  )
}
