// All calls are relative: Vite proxies /api to FastAPI in dev, and the built bundle is served
// by FastAPI itself. Nothing here needs to know which it is.

async function call(path, opts) {
  const r = await fetch(path, opts)
  const text = await r.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { detail: text } }
  if (!r.ok) throw Object.assign(new Error(body?.detail || r.statusText), { status: r.status, body })
  return body
}

export const api = {
  health: () => call('/api/health'),
  state: () => call('/api/state'),
  run: (offline = false) => call(`/api/run?offline=${offline}`, { method: 'POST' }),
  selftest: () => call('/api/selftest', { method: 'POST' }),
  fetchMail: () => call('/api/mail/fetch', { method: 'POST' }),
  reportUrl: '/api/report.xlsx',
  decide: (project, month, line, choice, opts = {}) => call('/api/decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, month, line, choice, ...opts }),
  }),
  undecide: (project, month, line) => call(
    `/api/decisions?project=${encodeURIComponent(project)}&month=${encodeURIComponent(month)}`
      + `&line=${encodeURIComponent(line)}`,
    { method: 'DELETE' }),
  finalize: (project, month, finalizedBy = '') => call('/api/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, month, finalizedBy }),
  }),
  reopen: (project, month, reopenedBy = '') => call('/api/reopen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, month, reopenedBy }),
  }),
  finalizeAll: (month, finalizedBy = '') => call('/api/finalize-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month, finalizedBy }),
  }),
}
