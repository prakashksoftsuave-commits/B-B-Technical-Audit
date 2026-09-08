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

/** "5.2 KB" - real file sizes in the evidence viewer, never rupees. */
export const fileSize = (n) => {
  if (n === null || n === undefined) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
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

// "9m ago" - relative, so the caller must re-render on a tick (its own setInterval) for this
// to stay live; the function itself is a pure read of (iso, now).
export const timeAgo = (iso, now) => {
  if (!iso) return null
  const secs = Math.max(0, Math.floor((now - new Date(iso)) / 1000))
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// Triggers a file save without ever navigating the tab. `window.location.href = url` looks
// equivalent - the server's Content-Disposition: attachment header stops the page from actually
// changing - but browsers still record that scripted assignment as a real history entry, so a
// later click on the Forward button replays the same navigation and re-fires the download. A
// temporary <a download> element is a pure save action with no navigation/history footprint at
// all - the fix for exactly that bug (found live: Forward button re-downloading a file).
export function triggerDownload(url) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
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
