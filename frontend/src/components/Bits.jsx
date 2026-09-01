import { money, compact, TONE } from '../utils'

/** Filled pill = a state you scan a column for. Outlined = secondary metadata. */
export function Pill({ children, tone }) {
  return <span className={`pill s-${tone || TONE[children] || 'mute'}`}>{children}</span>
}

export function TypePill({ children }) {
  return <span className="pill pill-type">{children}</span>
}

/** A filter control shaped like the nav's connection chips, so "what am I looking at" reads as
    one family of pill across the header regardless of which page is asking. */
export function FilterChip({ label, value, onChange, options, width }) {
  return (
    <label className="filter-chip">
      <span>{label}</span>
      <select value={value} onChange={onChange} style={width ? { width } : undefined}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Section({ label, count, right, children, id }) {
  return (
    <section className="section" id={id}>
      {(label || right) && (
        <div className="section-head">
          {label && <span className="eyebrow">{label}</span>}
          {count !== undefined && (
            <span className={`tag${count.hot ? ' hot' : ''}`}>
              {count.text ?? count}
            </span>
          )}
          <div className="spacer" />
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function Card({ title, note, right, children, pad = false, accent, wash }) {
  const style = {}
  if (accent) style.borderLeft = `4px solid ${accent}`
  if (wash) style.background = wash
  return (
    <div className="card" style={Object.keys(style).length ? style : undefined}>
      {(title || right) && (
        <header>
          <div>
            {title && <h3>{title}</h3>}
            {note && <p>{note}</p>}
          </div>
          <div className="spacer" />
          {right}
        </header>
      )}
      {pad ? <div className="pad">{children}</div> : children}
    </div>
  )
}

/** Figure first, label under. Optional third line for the qualifier. The number and label are
    hidden from assistive tech and restated once, cleanly, as the cell's own accessible name -
    otherwise a screen reader reads the figure and the label as two disconnected fragments. */
export function Tally({ items, label }) {
  return (
    <div className="tally" role="group" aria-label={label || 'Key figures'}>
      {items.map((it) => (
        <div key={it.label} className={it.tone || ''} role="group"
             aria-label={`${it.label}: ${it.value}${it.note ? `, ${it.note}` : ''}`}>
          {it.icon && <span className="tally-icon" aria-hidden="true">{it.icon}</span>}
          <b aria-hidden="true">{it.value}</b>
          <span aria-hidden="true">{it.label}</span>
          {it.note && <em aria-hidden="true">{it.note}</em>}
        </div>
      ))}
    </div>
  )
}

/** `parts` is [{value, color, label}] so one bar can carry a composition. The label and value
    are real text (read normally); only the proportional fill is decorative and hidden. */
export function Bar({ label, parts, max, value }) {
  const total = parts.reduce((t, p) => t + Math.max(0, p.value), 0)
  const scale = max || total || 1
  return (
    <div className="bar">
      <div className="lab" title={label}>{label}</div>
      <div className="track" aria-hidden="true">
        {parts.map((p, i) => (
          <i
            key={i}
            style={{ width: `${(Math.max(0, p.value) / scale) * 100}%`, background: p.color }}
            title={`${p.label}: ${money(p.value)}`}
          />
        ))}
      </div>
      <div className="val">{value !== undefined ? value : compact(total)}</div>
    </div>
  )
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <i style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/* Cost composition, stepping down the steel-blue ramp so the biggest line is
   the darkest. Adjustments break the ramp because they are not a cost head. */
export const COST_COLORS = {
  material: '#14202e',
  subcon: '#2f5578',
  machinery: '#527a9f',
  site: '#8ba4bd',
  hoAlloc: '#c2cfda',
  adjCost: '#7c4c08',
}
export const PROFIT_COLOR = '#1f5c34'
export const LOSS_COLOR = '#9e2b1f'
