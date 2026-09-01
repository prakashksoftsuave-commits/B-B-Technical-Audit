// Indian digit grouping, to match the workbook. Intl does this natively for en-IN.
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export const money = (n) =>
  n === null || n === undefined || n === '' ? '' : inr.format(Math.round(n))

/** Money with an explicit sign - for differences, where the direction is the information. */
export const signed = (n) => {
  if (n === null || n === undefined) return ''
  const v = Math.round(n)
  if (v === 0) return '0'
  return (v > 0 ? '+' : '−') + inr.format(Math.abs(v))
}

// Matches the backend's own rounding (round(profit / revenue * 100, 2)) - two decimals, not one.
export const pct = (n) => (n === null || n === undefined ? '—' : `${n.toFixed(2)}%`)

export const day = (iso) => {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(+d)) return iso
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

/** Crore/lakh short form for headline figures, where exact rupees are noise. */
export const compact = (n) => {
  if (n === null || n === undefined) return ''
  const a = Math.abs(n)
  const s = n < 0 ? '−' : ''
  if (a >= 1e7) return `${s}${(a / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `${s}${(a / 1e5).toFixed(1)} L`
  return s + inr.format(Math.round(a))
}

/* One vocabulary for every state in the app, so a pill in a table and a dot in a
   list mean the same thing. Matches the Purchase Division console's four states. */
/* One vocabulary for every state, so a pill in a table and a dot in a list mean the same
   thing. Matches the Purchase Division console's four states. */
export const TONE = {
  agree: 'ok', differs: 'bad',
  'on time': 'ok', late: 'warn', 'not received': 'bad',
  attribute: 'bad', decide: 'bad', chase: 'warn', restated: 'info', route: 'info',
  'asked for': 'ok',
  'heads-up': 'info', 'cut-off': 'warn', escalation: 'bad',
  revenue_accrued: 'info', cost_saving: 'ok', provisional: 'warn',
}
