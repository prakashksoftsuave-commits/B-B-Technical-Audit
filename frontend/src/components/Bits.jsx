import { useEffect, useRef, useState } from 'react'
import { money, compact, TONE } from '../utils'

const REDUCE_MOTION = typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const easeOutCubic = (t) => 1 - (1 - t) ** 3

/** Counts from wherever it last landed to `target` over `duration`ms, easing out - the "figure
    arriving" feel a KPI or chart value should have instead of appearing fully formed the
    instant data loads. Starts at 0 rather than at `target` itself, specifically so the very
    first render (page load) actually counts up instead of arriving pre-settled - only a later
    change in `target` (a re-sync) animates from wherever the previous count landed. Skips
    straight to the target when the viewer has asked for reduced motion, or when `target` isn't
    a real number (the caller is expected to guard that case). */
export function useCountUp(target, duration = 800) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  const rafRef = useRef(null)

  useEffect(() => {
    if (REDUCE_MOTION || typeof target !== 'number' || Number.isNaN(target)) {
      setDisplay(target)
      fromRef.current = target
      return undefined
    }
    const from = fromRef.current
    if (from === target) return undefined
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      setDisplay(from + (target - from) * easeOutCubic(t))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return display
}

/** True on every render after the first - flips a value from its "just mounted" starting state
    (0 width, 0 dasharray) to its real one a frame later, so a CSS transition on that property
    actually has something to animate between instead of painting the end state immediately. */
export function useGrown() {
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    if (REDUCE_MOTION) { setGrown(true); return undefined }
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return grown
}

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

export function Section({ label, count, right, children, id, className }) {
  return (
    <section className={className ? `section ${className}` : 'section'} id={id}>
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
    are real text (read normally); only the proportional fill is decorative and hidden. Grows in
    from empty and its value label counts up on mount (and again on any real change) - pass
    `num` (the raw figure the label represents) alongside `value`/`format` to drive that count;
    without it the label is static text, same as before. */
export function Bar({ label, parts, max, value, num, format }) {
  const total = parts.reduce((t, p) => t + Math.max(0, p.value), 0)
  const scale = max || total || 1
  const grown = useGrown()
  const hasNum = typeof num === 'number' && !Number.isNaN(num)
  const animated = useCountUp(hasNum ? num : 0)
  const shown = hasNum ? (format || compact)(animated)
    : value !== undefined ? value : compact(total)
  return (
    <div className="bar">
      <div className="lab" title={label}>{label}</div>
      <div className="track" aria-hidden="true">
        {parts.map((p, i) => (
          <i
            key={i}
            style={{ width: grown ? `${(Math.max(0, p.value) / scale) * 100}%` : '0%',
                     background: p.color }}
            title={`${p.label}: ${money(p.value)}`}
          />
        ))}
      </div>
      <div className="val">{shown}</div>
    </div>
  )
}

/** Icon-in-a-tinted-square, figure, label, optional qualifier - the KPI card shape shared by
    Home's portfolio strip and Financial Outcome's own summary, so the two never drift into two
    different visual languages for the same kind of figure. Pass `num` (the raw figure) with
    `format` (e.g. `compact`, `pct`) to have the headline count up on load; `num: null` renders
    "—" the same way the old inline ternaries at each call site used to. A plain `value` (a
    status label, say) still renders as static text exactly as before. */
export function KpiCard({ icon, tone, value, num, format, valueTone, label, sub, subTone }) {
  const usesNum = num !== undefined
  const hasNum = usesNum && typeof num === 'number' && !Number.isNaN(num)
  const animated = useCountUp(hasNum ? num : 0)
  const shown = hasNum ? (format || Math.round)(animated) : usesNum ? '—' : value
  return (
    <div className="kpi-card">
      <span className={`kpi-icon kpi-icon-${tone}`} aria-hidden="true">{icon}</span>
      <div className="kpi-text">
        <b className={valueTone ? `t-${valueTone}` : undefined}>{shown}</b>
        <span className={subTone === 'accent-label' ? 'kpi-label-accent' : undefined}>{label}</span>
        {sub && <em className={sub.tone ? `t-${sub.tone}` : undefined}>{sub.text}</em>}
      </div>
    </div>
  )
}

/** A row of segmented buttons switching which of several views is shown below - one active tab
    at a time, each optionally carrying a count badge (e.g. how many rows that view holds). */
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key}
                className={`tab${active === t.key ? ' active' : ''}`}
                onClick={() => onChange(t.key)}>
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
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
