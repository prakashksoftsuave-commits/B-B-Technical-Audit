/* Inline, single-stroke, currentColor. A section is found by shape before it is read. */
const s = (p) => ({ width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
  strokeLinejoin: 'round', ...p })

export const IconHome = (p) => (
  <svg {...s(p)}><path d="M4 11l8-7 8 7" /><path d="M6 9.5V20a1 1 0 001 1h10a1 1 0 001-1V9.5" />
    <path d="M10 21v-6h4v6" /></svg>
)
export const IconStatement = (p) => (
  <svg {...s(p)}><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" />
    <path d="M9 12h7M9 16h7M9 8h3" /></svg>
)
export const IconScales = (p) => (
  <svg {...s(p)}><path d="M12 4v16M7 20h10" /><path d="M4 9h6l-3 5z" />
    <path d="M14 9h6l-3 5z" /><path d="M4 9l8-3 8 3" /></svg>
)
export const IconInbox = (p) => (
  <svg {...s(p)}><path d="M4 13V6a2 2 0 012-2h12a2 2 0 012 2v7" />
    <path d="M4 13h4l1.5 3h5L16 13h4v5a2 2 0 01-2 2H6a2 2 0 01-2-2z" /></svg>
)
export const IconFlag = (p) => (
  <svg {...s(p)}><path d="M6 21V4" /><path d="M6 5h11l-2 4 2 4H6" /></svg>
)
export const IconTrace = (p) => (
  <svg {...s(p)}><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" />
    <path d="M6 8v6a4 4 0 004 4h6" /></svg>
)
export const IconGauge = (p) => (
  <svg {...s(p)}><path d="M4 18a8 8 0 1116 0" /><path d="M12 18l4-5" /></svg>
)
export const IconDown = (p) => (
  <svg {...s(p)}><path d="M12 4v11" /><path d="M8 12l4 4 4-4" /><path d="M5 20h14" /></svg>
)
export const IconRefresh = (p) => (
  <svg {...s(p)}><path d="M20 11a8 8 0 10-2.6 5.9" /><path d="M20 5v6h-6" /></svg>
)
export const IconCoins = (p) => (
  <svg {...s(p)}><ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v5c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
    <path d="M5 11v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5" /></svg>
)
export const IconReceipt = (p) => (
  <svg {...s(p)}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>
)
export const IconTrendUp = (p) => (
  <svg {...s(p)}><path d="M4 16l6-6 4 4 6-8" /><path d="M14 6h6v6" /></svg>
)
export const IconPercent = (p) => (
  <svg {...s(p)}><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" />
    <path d="M18 6L6 18" /></svg>
)
export const IconUnlink = (p) => (
  <svg {...s(p)}><path d="M10 14a4 4 0 005.5 0l2-2a4 4 0 00-5.5-5.5" />
    <path d="M14 10a4 4 0 00-5.5 0l-2 2a4 4 0 005.5 5.5" /><path d="M4 4l16 16" /></svg>
)
export const IconBuilding = (p) => (
  <svg {...s(p)}><rect x="5" y="3" width="14" height="18" rx="1" />
    <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /><path d="M10 21v-3h4v3" /></svg>
)
export const IconCheck = (p) => (
  <svg {...s(p)}><path d="M4 12.5l5 5L20 6" /></svg>
)
export const IconBell = (p) => (
  <svg {...s(p)}><path d="M6 10a6 6 0 0112 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z" />
    <path d="M10 20a2 2 0 004 0" /></svg>
)
export const IconClock = (p) => (
  <svg {...s(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
)
export const IconChevronDown = (p) => (
  <svg {...s(p)}><path d="M5 8.5l7 7 7-7" /></svg>
)
export const IconBars = (p) => (
  <svg {...s(p)}><path d="M5 19V10M12 19V5M19 19v-6" /></svg>
)
export const IconEye = (p) => (
  <svg {...s(p)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" /></svg>
)
export const IconTable = (p) => (
  <svg {...s(p)}><rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M3 10h18M3 15h18M9 4v16" /></svg>
)
export const IconChartBar = (p) => (
  <svg {...s(p)}><path d="M4 20V10M10 20V4M16 20v-7M4 20h16" /></svg>
)
