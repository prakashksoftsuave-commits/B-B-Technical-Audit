// All calls are relative: Vite proxies /api to FastAPI in dev, and the built bundle is served
// by FastAPI itself. Nothing here needs to know which it is.

// A ceiling, not a target - the backend's own Tally/mailbox calls are bounded well under this
// (30s and 20s respectively, each with one retry), so a real request finishes in well under a
// minute. This exists purely as a last-resort safety net so a button can never again be stuck
// on "Syncing..." with zero feedback the way it was when the underlying network calls had no
// timeout of their own - see mailbox.py/tally_io.py for the actual fix.
const REQUEST_TIMEOUT_MS = 90000

async function call(path, opts) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let r
  try {
    r = await fetch(path, { ...opts, signal: controller.signal })
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`Timed out waiting for a response (${REQUEST_TIMEOUT_MS / 1000}s). `
        + 'The server may be stuck talking to Tally or the mailbox - try again in a moment.')
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
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
  sendReminder: (project, month, sentBy = '') => call('/api/reminders/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, month, sentBy }),
  }),
  reportUrl: '/api/report.xlsx',
  attachmentUrl: (id) => `/api/mail/attachment?id=${encodeURIComponent(id)}`,
  mailEvidence: (id) => call(`/api/evidence/mail?id=${encodeURIComponent(id)}`),
  evidenceAttachmentUrl: (id, index = 0, download = false) =>
    `/api/evidence/mail/attachment?id=${encodeURIComponent(id)}&index=${index}`
      + (download ? '&download=true' : ''),
  evidenceSpreadsheetUrl: (id, index = 0) =>
    `/api/evidence/mail/spreadsheet?id=${encodeURIComponent(id)}&index=${index}`,
  mailSpreadsheet: (id, index = 0) => call(
    `/api/evidence/mail/spreadsheet?id=${encodeURIComponent(id)}&index=${index}`),
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
