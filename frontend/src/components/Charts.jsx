import { useEffect, useRef, useState } from 'react'
import { Bar, COST_COLORS, Legend, LOSS_COLOR, PROFIT_COLOR, useCountUp, useGrown } from './Bits'
import { compact, money, pct } from '../utils'

/* Shared, hand-rolled SVG charts - no charting library, consistent with the rest of the app.
   Both Home (portfolio-wide) and Financial Outcome (project-scoped) feed these the same row/
   point shapes so a chart never becomes a second calculation of a figure computed elsewhere. */

// Small and secondary on purpose - this communicates audit state (how many of this project's
// line items are matched/needs review/not received/reported), never a financial figure. Stacked
// circles with a stroke-dasharray offset per segment, the standard SVG donut technique - no
// charting library. Segments carry the exact counts the stat strip beside it already shows, so
// the two can never read differently for the same rows. Not just decorative: onSelect makes each
// segment a real status filter, and activeKey dims every segment but the selected one so the
// active filter reads at a glance, the same way the stat list beside it highlights its own
// selected row.
export function StatusDonut({ segments, size = 108, thickness = 15, centerValue, centerLabel,
                               onSelect, activeKey }) {
  const total = segments.reduce((s, x) => s + x.count, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const grown = useGrown()
  const hasCenterNum = typeof centerValue === 'number' && !Number.isNaN(centerValue)
  const animatedCenter = useCountUp(hasCenterNum ? centerValue : 0)
  let offset = 0
  return (
    <div className="status-donut" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img"
           aria-label={`${centerLabel}: ${segments.map((s) => `${s.label} ${s.count}`).join(', ')}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hair)" strokeWidth={thickness} />
        {total > 0 && segments.filter((s) => s.count > 0).map((s) => {
          const len = (s.count / total) * c
          const dashoffset = -offset
          offset += len
          const isActive = activeKey === s.key
          return (
            <circle key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
                    strokeWidth={isActive ? thickness * 1.15 : thickness}
                    strokeDasharray={grown ? `${len} ${c - len}` : `0 ${c}`}
                    style={{ transition: 'stroke-dasharray .8s cubic-bezier(.16,1,.3,1), '
                      + 'stroke-width .2s ease-out' }}
                    opacity={activeKey && !isActive ? 0.35 : 1}
                    strokeDashoffset={dashoffset} transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    className={onSelect ? 'donut-segment' : undefined} aria-hidden="true"
                    onClick={onSelect ? () => onSelect(s.key) : undefined} />
          )
        })}
      </svg>
      <div className="status-donut-center" aria-hidden="true">
        <b>{hasCenterNum ? Math.round(animatedCenter) : centerValue}</b>
        <span>{centerLabel}</span>
      </div>
    </div>
  )
}

// Sorted by profit, highest first, so "which project is winning" is the order you read top to
// bottom rather than a comparison you have to do yourself across nine numbers. Margin sits
// right next to the name for the same reason - the bars carry magnitude, the badge carries the
// verdict. The bars are decorative once sorted: the group's own aria-label already states
// revenue/cost/profit/margin as one sentence, so screen readers get that instead of nine
// separately-announced mini-bars.
export function PerfChart({ rows }) {
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
              <Bar label="Revenue" max={max} num={r.revenue} format={compact}
                   parts={[{ value: r.revenue || 0, color: 'var(--accent)', label: 'Revenue' }]} />
              <Bar label="Cost" max={max} num={r.cost} format={compact}
                   parts={[{ value: r.cost || 0, color: COST_COLORS.material, label: 'Cost' }]} />
              <Bar label="Profit" max={max} num={r.profit} format={compact}
                   parts={[{ value: Math.abs(r.profit || 0),
                     color: r.profit < 0 ? LOSS_COLOR : PROFIT_COLOR, label: 'Profit' }]} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Measures its own box with a ResizeObserver and builds the SVG viewBox to match it exactly, so
// the coordinate system's aspect ratio always equals the box it's drawn into - a fixed viewBox
// stretched non-uniformly onto whatever box a flex layout happens to give it is what visibly
// "bulges" a line chart whenever that box is far from the viewBox's own ratio.
function useMeasuredBox(initial) {
  const ref = useRef(null)
  const [box, setBox] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setBox({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, box]
}

// A real trend, not a sparkline invented for decoration: one point per month actually in the
// data, each computed by the same aggregation the KPI row's own "this month" figure uses. Only
// as many points as there are real months - never padded out to look like a longer history than
// the data actually has.
export function ProfitTrend({ points }) {
  const withData = points.filter((p) => p.profit !== null)
  const [wrapRef, box] = useMeasuredBox({ w: 640, h: 220 })
  const grown = useGrown()
  // Which point the pointer is over, if any - drives the vertical guide line and the readout
  // panel below. Cleared on mouse-leave so the readout never lingers once the pointer is gone.
  const [hoverIdx, setHoverIdx] = useState(null)
  if (withData.length < 2) {
    return <div className="pad"><p className="dim-note">Not enough months of data yet for a trend.</p></div>
  }
  const { w, h } = box, padL = 44, padR = 16, padT = 16, padB = 28
  const vals = withData.map((p) => p.profit)
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals)
  const span = hi - lo || 1
  const x = (i) => padL + (i / (withData.length - 1)) * (w - padL - padR)
  const y = (v) => padT + (1 - (v - lo) / span) * (h - padT - padB)
  const zeroY = y(0)
  const path = withData.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.profit)}`).join(' ')
  const area = `${path} L ${x(withData.length - 1)} ${zeroY} L ${x(0)} ${zeroY} Z`
  const active = hoverIdx !== null ? withData[hoverIdx] : null
  // Anchored to the point horizontally, clamped so a tooltip near either edge never runs past
  // the chart's own box - the card around this chart clips overflow, so an unclamped tooltip at
  // the first or last point would get cut off rather than just looking a little off-centre.
  const tipLeft = active ? Math.min(Math.max(x(hoverIdx), 78), w - 78) : 0
  return (
    <div className="pad">
      <div ref={wrapRef} className="trend-chart">
        <svg viewBox={`0 0 ${w} ${h}`} role="img"
             aria-label={`Profit trend: ${withData.map((p) => `${p.label} ${compact(p.profit)}`).join(', ')}`}>
          <line x1={padL} y1={zeroY} x2={w - padR} y2={zeroY} className="trend-zero" />
          <path d={area} className="trend-area" aria-hidden="true"
                style={{ opacity: grown ? 1 : 0, transition: 'opacity .6s ease-out .5s' }} />
          <path d={path} className="trend-line" aria-hidden="true" pathLength="1"
                style={{ strokeDasharray: 1, strokeDashoffset: grown ? 0 : 1,
                  transition: 'stroke-dashoffset 1s cubic-bezier(.16,1,.3,1)' }} />
          {hoverIdx !== null && (
            <line x1={x(hoverIdx)} y1={padT} x2={x(hoverIdx)} y2={h - padB}
                  className="trend-hover-line" aria-hidden="true" />
          )}
          {withData.map((p, i) => (
            <g key={p.key} aria-hidden="true">
              <circle cx={x(i)} cy={y(p.profit)} r={hoverIdx === i ? 5.5 : 4}
                      className={p.profit < 0 ? 'trend-dot neg' : 'trend-dot'}
                      style={{ opacity: grown ? 1 : 0, transformOrigin: `${x(i)}px ${y(p.profit)}px`,
                        transform: grown ? 'scale(1)' : 'scale(0)',
                        transition: `opacity .3s ease-out ${0.2 + i * 0.12}s, `
                          + `transform .3s cubic-bezier(.34,1.56,.64,1) ${0.2 + i * 0.12}s` }} />
              {/* A generous invisible hit-area, not just the small visible dot - a 4px circle is
                  hard to land a pointer on precisely, so hovering anywhere near a point (or the
                  guide-line column above/below it) picks it up. */}
              <rect x={x(i) - (w / withData.length) / 2} y="0" width={w / withData.length} height={h}
                    fill="transparent" style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />
              {/* Edge labels anchor outward (start/end) instead of centring on their point, so
                  the last label grows leftward from the right edge rather than overflowing past
                  the viewBox and getting clipped. */}
              <text x={x(i)} y={h - 8} className="trend-x-label"
                    textAnchor={i === 0 ? 'start' : i === withData.length - 1 ? 'end' : 'middle'}>
                {p.label}
              </text>
            </g>
          ))}
        </svg>
        {active && (
          <div className="trend-tooltip" style={{ left: tipLeft }} role="status">
            <b>{active.label}</b>
            <div><span>Revenue</span><b>{active.revenue == null ? '—' : money(active.revenue)}</b></div>
            <div><span>Cost</span><b>{money(active.cost)}</b></div>
            <div className={active.profit < 0 ? 'neg' : undefined}>
              <span>Profit</span><b>{money(active.profit)}</b>
            </div>
            {active.margin !== null && active.margin !== undefined && (
              <div><span>Margin</span><b>{pct(active.margin)}</b></div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

