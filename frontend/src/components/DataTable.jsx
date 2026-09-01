import { useMemo, useState } from 'react'
import { money } from '../utils'

/**
 * One table for every view. Columns declare their own alignment, formatting and cell renderer,
 * so nine screens do not need nine bespoke tables.
 *
 * col: { key, label, num?, wrap?, nowrap?, mono?, dim?, fmt?, render?, sortable?, foot? }
 *   num      right-align, tabular numerals
 *   wrap     min-width, for a column that legitimately runs long (a sentence)
 *   nowrap   never break this column's text onto a second line, even if that means the
 *            table scrolls horizontally - for a column that must stay one row tall so
 *            sibling columns keep lining up
 *   fmt      value -> string
 *   render   row -> node (wins over fmt)
 *   foot     'sum' or a function over rows
 *
 * rowSpan(row) -> node | null   a non-null result replaces the row with one cell spanning
 *   every column - a section banner between groups, not a data row.
 */
export default function DataTable({ cols, rows, empty = 'Nothing to show.', sortKey, sortDir = 'asc',
                                    rowKey, rowClass, rowSpan, footer = false, maxHeight }) {
  const [sk, setSk] = useState(sortKey || null)
  const [sd, setSd] = useState(sortDir)

  const sorted = useMemo(() => {
    if (!sk) return rows
    const col = cols.find((c) => c.key === sk)
    const dir = sd === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = a[sk], y = b[sk]
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      if (col?.num) return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  }, [rows, sk, sd, cols])

  const click = (c) => {
    if (c.sortable === false) return
    if (sk === c.key) setSd(sd === 'asc' ? 'desc' : 'asc')
    else { setSk(c.key); setSd(c.num ? 'desc' : 'asc') }
  }

  if (!rows.length) return <div className="empty">{empty}</div>

  // A 'sum' foot yields a raw number and gets the column formatter applied. A function foot
  // is responsible for its own formatting - passing its output back through fmt would mean
  // calling a number formatter on an already-formatted string.
  // A column that uses `render` (e.g. to colour a differing figure) has no `fmt` of its own,
  // so the footer falls back to a plain number formatter rather than printing the raw value.
  const foots = footer
    ? cols.map((c) => {
        if (!c.foot) return null
        const formatter = c.fmt || (c.num ? money : null)
        if (c.foot === 'sum') {
          return { v: rows.reduce((t, r) => t + (Number(r[c.key]) || 0), 0), fmt: formatter }
        }
        return { v: c.foot(rows), fmt: null }
      })
    : null

  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      <table className="data">
        <thead>
          <tr>
            {cols.map((c) => {
              const sortable = c.sortable !== false
              const sortedHere = sk === c.key
              return (
                <th
                  key={c.key}
                  className={[c.num ? 'num' : '', sortable ? 'sortable' : '']
                    .filter(Boolean).join(' ')}
                  title={c.title}
                  aria-sort={!sortable ? undefined : sortedHere ? (sd === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {sortable ? (
                    <button type="button" className="th-label th-sort" onClick={() => click(c)}>
                      {c.label}
                      {sortedHere && (
                        <span className="caret" aria-hidden="true">{sd === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </button>
                  ) : (
                    <span className="th-label">{c.label}</span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const span = rowSpan ? rowSpan(r) : null
            if (span !== null && span !== undefined) {
              return (
                <tr key={rowKey ? rowKey(r, i) : i} className={rowClass ? rowClass(r) : undefined}>
                  <td colSpan={cols.length}>{span}</td>
                </tr>
              )
            }
            return (
            <tr key={rowKey ? rowKey(r, i) : i} className={rowClass ? rowClass(r) : undefined}>
              {cols.map((c) => {
                const raw = r[c.key]
                const cls = [
                  c.num ? 'num' : '', c.wrap ? 'wrap' : '', c.mono ? 'mono' : '',
                  c.dim ? 'dim' : '', c.nowrap ? 'nowrap' : '',
                  c.num && Number(raw) < 0 ? 'neg' : '',
                ].filter(Boolean).join(' ')
                return (
                  <td key={c.key} className={cls || undefined}>
                    {c.render ? c.render(r) : c.fmt ? c.fmt(raw, r) : raw}
                  </td>
                )
              })}
            </tr>
            )
          })}
        </tbody>
        {foots && foots.some((f) => f !== null) && (
          <tfoot>
            <tr>
              {cols.map((c, i) => {
                const f = foots[i]
                let body = ''
                if (f === null) body = i === 0 ? 'Total' : ''
                else body = f.fmt ? f.fmt(f.v) : f.v
                return (
                  <td key={c.key} className={c.num ? 'num' : undefined}>{body}</td>
                )
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
