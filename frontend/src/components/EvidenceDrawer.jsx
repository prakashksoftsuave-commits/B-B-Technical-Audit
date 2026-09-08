import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { Pill, Section } from './Bits'
import { CATEGORY, ITEM_STATUS, SOURCE_TONE } from '../reconciliation'
import { day, fileSize, money } from '../utils'

/* One evidence drawer, shared by Source Data and Financial Outcome's single-project view - a
   focused viewer for "what real records back this consolidated figure," never a second dashboard.
   Both callers hand it the same `item` shape reconciliation.jsx's itemsForMonth() produces:
   {label, status, records, consolidatedValue}.

   A mail record's own real email (From/To/Subject/body/attachments) is fetched once here, on
   demand - never fabricated, and never re-fetched for a record already seen this session (see
   emailCache below). pdfjs-dist is a real but sizeable dependency used by nothing else on this
   page, so DocumentViewer is loaded lazily, only once an auditor actually clicks View. */
const DocumentViewer = lazy(() => import('./DocumentViewer'))

const dash = (v) => (v === null || v === undefined ? '—' : money(v))

// A short, human label per real mime type - most subtypes are fine taken raw ("png", "pdf"),
// but Office formats' real subtype is a long vendor string, not a short word.
const MIME_LABEL = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-excel': 'XLS',
}
const mimeLabel = (mime) => MIME_LABEL[mime] || (mime.split('/').pop() || mime).toUpperCase()

const emailCache = new Map()
// Shared with Consolidation.jsx's inline drill-down rows (the all-projects view's compact
// per-project panel expands a line item's source records directly into the table rather than
// through this drawer) - same cache, same real fetch, so "view the file" works identically
// wherever a mail-sourced record is listed, not just from the drawer.
export function useMailEvidence(attachmentId) {
  const [state, setState] = useState(() => (attachmentId ? emailCache.get(attachmentId) : null) || null)
  useEffect(() => {
    if (!attachmentId || emailCache.has(attachmentId)) return undefined
    let cancelled = false
    api.mailEvidence(attachmentId)
      .then((data) => {
        const entry = { data, error: null }
        emailCache.set(attachmentId, entry)
        if (!cancelled) setState(entry)
      })
      .catch((error) => {
        const entry = { data: null, error }
        emailCache.set(attachmentId, entry)
        if (!cancelled) setState(entry)
      })
    return () => { cancelled = true }
  }, [attachmentId])
  return state
}

function EvidenceCard({ record, onViewDocument }) {
  const cat = CATEGORY(record.source)
  const evidence = useMailEvidence(cat === 'Mail' ? record.attachmentId : null)

  return (
    <div className="evidence-card">
      <div className="evidence-card-head">
        <Pill tone={SOURCE_TONE[cat]}>{cat.toUpperCase()}</Pill>
        <span className="evidence-card-amount">{dash(record.amount)}</span>
      </div>
      <dl>
        {cat !== 'Mail' && record.date && (<><dt>Date</dt><dd>{day(record.date)}</dd></>)}
        <dt>Reference</dt>
        <dd>{(cat === 'Mail' ? record.subject : record.ref) || '—'}</dd>
        {cat === 'Tally' && (<><dt>Ledger</dt><dd>{record.ledger || '—'}</dd></>)}
        {cat === 'ERP' && (<><dt>Module</dt><dd>{record.moduleLabel || record.source}</dd></>)}
        <dt>Description</dt><dd>{record.description}</dd>
        <dt>Project</dt><dd>{record.projectName}</dd>
        <dt>Month</dt><dd>{record.monthLabel}</dd>
        {cat === 'Mail' ? (
          <>
            <dt>Email From</dt><dd>{evidence?.data?.from || record.sender}</dd>
            {evidence?.data?.to && (<><dt>Email To</dt><dd>{evidence.data.to}</dd></>)}
            <dt>Received On</dt><dd>{record.date ? day(record.date) : '—'}</dd>
            {evidence?.data?.messageId && (
              <><dt>Message ID</dt><dd className="mono">{evidence.data.messageId}</dd></>
            )}
            {evidence?.data?.bodyText && (
              <><dt>Message</dt><dd className="evidence-body-text">{evidence.data.bodyText}</dd></>
            )}
          </>
        ) : (
          <>
            <dt>Entered by</dt>
            <dd>{cat === 'Tally' ? 'Tally Import' : 'System (ERP)'}</dd>
          </>
        )}
      </dl>
      {cat === 'Mail' ? (
        <div className="evidence-attachments">
          {!evidence && <p className="dim-note">Loading evidence…</p>}
          {evidence?.error && <p className="evidence-error">Unable to load this email's evidence.</p>}
          {evidence?.data && evidence.data.attachments.length === 0 && (
            <p className="dim-note">No supporting document attached.</p>
          )}
          {evidence?.data?.attachments.map((att) => (
            <button key={att.index} type="button" className="evidence-attachment-row"
                    onClick={() => onViewDocument({ record, attachment: att })}>
              <span className="evidence-attachment-name">{att.filename}</span>
              <span className="evidence-attachment-meta">
                {mimeLabel(att.mime)} · {fileSize(att.size)}
              </span>
              <span className="evidence-attachment-view">View →</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="dim-note" style={{ marginTop: 8 }}>No supporting document attached.</p>
      )}
    </div>
  )
}

export function EvidenceDrawer({ item, projectName, onClose }) {
  const [viewing, setViewing] = useState(null)

  // Escape closes whichever layer is on top - the Document Viewer if one is open, this drawer
  // otherwise - never both at once. Guarded on `viewing` rather than relying on listener
  // registration order, since DocumentViewer's own Escape handler (added later, when it mounts)
  // fires no earlier than this one regardless of stopPropagation tricks.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !viewing) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, viewing])

  const total = item.consolidatedValue
  const bySource = {}
  item.records.forEach((r) => {
    const cat = CATEGORY(r.source)
    bySource[cat] = (bySource[cat] || 0) + (r.amount || 0)
  })
  const st = ITEM_STATUS[item.status]

  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose}>
        <div className="drawer-panel" role="dialog" aria-modal="true"
             aria-label={`Source detail — ${item.label}`} onClick={(e) => e.stopPropagation()}>
          <div className="drawer-head">
            <div>
              <div className="drawer-title-row">
                <h3>{item.label}</h3>
                {st && <Pill tone={st.tone}>{st.label}</Pill>}
              </div>
              <p className="drawer-sub">{projectName}</p>
              <p className="drawer-amount">
                {money(total)} · {item.records.length} source record{item.records.length === 1 ? '' : 's'}
              </p>
            </div>
            <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
          </div>
          <div className="drawer-body">
            <Section label="Source breakdown">
              <div className="drawer-breakdown">
                {Object.entries(bySource).map(([cat, amt]) => (
                  <div key={cat} className="drawer-breakdown-row">
                    <Pill tone={SOURCE_TONE[cat]}>{cat.toUpperCase()}</Pill>
                    <span className="drawer-breakdown-amount">{money(amt)}</span>
                    <span className="drawer-breakdown-pct">
                      {total ? Math.round((amt / total) * 100) : 0}%
                    </span>
                  </div>
                ))}
                {!item.records.length && <div className="empty">No source records for this item.</div>}
              </div>
            </Section>
            <Section label="Underlying evidence">
              <div className="evidence-list">
                {item.records.map((r, i) => (
                  <EvidenceCard key={i} record={r} onViewDocument={setViewing} />
                ))}
              </div>
            </Section>
          </div>
        </div>
      </div>
      {viewing && (
        <Suspense fallback={null}>
          <DocumentViewer record={viewing.record} item={item} projectName={projectName}
                           attachment={viewing.attachment} onClose={() => setViewing(null)} />
        </Suspense>
      )}
    </>,
    document.body,
  )
}
