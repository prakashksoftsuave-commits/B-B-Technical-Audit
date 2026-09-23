import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { CATEGORY } from '../reconciliation'
import { fileSize, triggerDownload } from '../utils'

/* Every real byte behind an attachment is served by one endpoint
   (api.evidenceAttachmentUrl), generic over mime type - so Download, Open in new tab, and every
   viewer below all point at the same real URL, never a fabricated stand-in. Only `xlsx` is ever
   exercised by this system's real data today (see CLAUDE.md's Source Data evidence-viewer
   notes); the PDF and image branches are real, working code, just dormant until a real PDF or
   image return ever arrives. */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])

function DocFallback({ message, downloadUrl }) {
  return (
    <div className="doc-fallback">
      <p>{message}</p>
      <a className="btn btn-ink btn-sm" href={downloadUrl} download>Download Original</a>
    </div>
  )
}

function SpreadsheetView({ attachmentId, index, downloadUrl }) {
  const [sheets, setSheets] = useState(null)
  const [error, setError] = useState(false)
  const [sheetIdx, setSheetIdx] = useState(0)
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancelled = false
    setSheets(null); setError(false)
    api.mailSpreadsheet(attachmentId, index)
      .then((s) => { if (!cancelled) setSheets(s) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [attachmentId, index])

  if (error) return <DocFallback message="Unable to preview this document." downloadUrl={downloadUrl} />
  if (!sheets) return <div className="doc-loading">Loading…</div>

  const sheet = sheets[sheetIdx]
  const qq = q.trim().toLowerCase()
  const rows = qq ? sheet.rows.filter((r) => r.some((c) => String(c).toLowerCase().includes(qq))) : sheet.rows
  const cols = Math.max(0, ...sheet.rows.map((r) => r.length))

  return (
    <div className="doc-sheet">
      {sheets.length > 1 && (
        <div className="doc-sheet-tabs">
          {sheets.map((s, i) => (
            <button key={s.name} type="button" className={`doc-sheet-tab${i === sheetIdx ? ' active' : ''}`}
                    onClick={() => setSheetIdx(i)}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="doc-sheet-toolbar">
        <input className="input" placeholder="Search this sheet…" value={q}
               onChange={(e) => setQ(e.target.value)} />
        <span className="dim-note">{rows.length} of {sheet.rows.length} rows</span>
      </div>
      <div className="doc-sheet-scroll">
        <table className="doc-sheet-table">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {Array.from({ length: cols }).map((_, c) => <td key={c}>{r[c] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">No rows match that search.</div>}
      </div>
    </div>
  )
}

function PdfView({ url, downloadUrl }) {
  const canvasRef = useRef(null)
  const [doc, setDoc] = useState(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.4)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      .then(([pdfjsLib, workerUrl]) => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.default
        return pdfjsLib.getDocument(url).promise
      })
      .then((loaded) => { if (!cancelled) { setDoc(loaded); setPage(1) } })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [url])

  useEffect(() => {
    if (!doc) return undefined
    let cancelled = false
    doc.getPage(page).then((p) => {
      if (cancelled) return
      const viewport = p.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      p.render({ canvasContext: canvas.getContext('2d'), viewport })
    })
    return () => { cancelled = true }
  }, [doc, page, scale])

  if (error) return <DocFallback message="Unable to preview this document." downloadUrl={downloadUrl} />
  if (!doc) return <div className="doc-loading">Loading…</div>

  return (
    <div className="doc-pdf">
      <div className="doc-pdf-toolbar">
        <button type="button" className="btn btn-quiet btn-xs" disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
        <span className="dim-note">Page {page} / {doc.numPages}</span>
        <button type="button" className="btn btn-quiet btn-xs" disabled={page >= doc.numPages}
                onClick={() => setPage((p) => p + 1)}>Next ›</button>
        <span className="spacer" />
        <button type="button" className="btn btn-quiet btn-xs" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>−</button>
        <span className="dim-note">{Math.round(scale * 100)}%</span>
        <button type="button" className="btn btn-quiet btn-xs" onClick={() => setScale((s) => Math.min(3, s + 0.2))}>+</button>
      </div>
      <div className="doc-pdf-canvas-wrap"><canvas ref={canvasRef} /></div>
    </div>
  )
}

// Browsers have no native viewer for a spreadsheet mime type - pointing "Open in new tab"
// straight at the raw xlsx bytes just downloads it (that's the real, in-browser behaviour, not
// a bug in the endpoint), which reads as "Open in new tab is broken" even though it's simply
// what every browser does with this mime type. Real fix: build the same real sheet data this
// viewer already renders into an actual HTML page and hand THAT to the browser to open - still
// every real row/cell, never a fabricated preview, just a real page instead of a raw binary.
function openSpreadsheetTab(attachmentId, index, filename, downloadUrl) {
  const win = window.open('', '_blank')
  api.mailSpreadsheet(attachmentId, index)
    .then((sheets) => {
      if (!win) return
      const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const body = sheets.map((sheet) => `
        <h2>${esc(sheet.name)}</h2>
        <table>${sheet.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? '')}</td>`).join('')}</tr>`).join('')}</table>
      `).join('')
      win.document.write(`<!doctype html><html><head><meta charset="utf-8">
        <title>${esc(filename)}</title>
        <style>
          body { font-family: system-ui, sans-serif; padding: 24px; color: #14202e; }
          h2 { font-size: 14px; margin: 24px 0 8px; }
          table { border-collapse: collapse; font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
          td { border: 1px solid #d8dee4; padding: 5px 10px; white-space: nowrap; }
        </style></head><body>${body}</body></html>`)
      win.document.close()
    })
    .catch(() => {
      if (win) win.close()
      triggerDownload(downloadUrl)
    })
}

function ImageView({ url }) {
  const [fit, setFit] = useState(true)
  return (
    <div className="doc-image">
      <div className="doc-image-toolbar">
        <button type="button" className="btn btn-quiet btn-xs" onClick={() => setFit((f) => !f)}>
          {fit ? 'Actual size' : 'Fit to screen'}
        </button>
      </div>
      <div className="doc-image-scroll">
        <img src={url} alt="" className={fit ? 'doc-image-fit' : undefined} />
      </div>
    </div>
  )
}

export default function DocumentViewer({ record, item, projectName, attachment, onClose,
                                          basePath = 'Source Data' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const url = api.evidenceAttachmentUrl(record.attachmentId, attachment.index)
  const downloadUrl = api.evidenceAttachmentUrl(record.attachmentId, attachment.index, true)

  let body
  if (attachment.mime === XLSX_MIME) {
    body = <SpreadsheetView attachmentId={record.attachmentId} index={attachment.index} downloadUrl={downloadUrl} />
  } else if (attachment.mime === 'application/pdf') {
    body = <PdfView url={url} downloadUrl={downloadUrl} />
  } else if (IMAGE_MIMES.has(attachment.mime)) {
    body = <ImageView url={url} />
  } else {
    body = <DocFallback message="Preview unavailable for this file type." downloadUrl={downloadUrl} />
  }

  return createPortal(
    <div className="doc-viewer-backdrop" onClick={onClose}>
      <div className="doc-viewer" role="dialog" aria-modal="true"
           aria-label={`${attachment.filename} — document viewer`} onClick={(e) => e.stopPropagation()}>
        <div className="doc-viewer-head">
          <div>
            <div className="doc-breadcrumb">
              {basePath} / {projectName} / {item.label} / {CATEGORY(record.source).toUpperCase()} Evidence
            </div>
            <div className="doc-filename">{attachment.filename}</div>
            <div className="dim-note">{fileSize(attachment.size)}</div>
          </div>
          <div className="doc-viewer-actions">
            <a className="btn btn-quiet btn-sm" href={downloadUrl} download>Download</a>
            {attachment.mime === XLSX_MIME ? (
              <button type="button" className="btn btn-quiet btn-sm"
                      onClick={() => openSpreadsheetTab(record.attachmentId, attachment.index,
                        attachment.filename, downloadUrl)}>
                Open in new tab ↗
              </button>
            ) : (
              <a className="btn btn-quiet btn-sm" href={url} target="_blank" rel="noreferrer">Open in new tab ↗</a>
            )}
            <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="doc-viewer-body">{body}</div>
      </div>
    </div>,
    document.body,
  )
}
