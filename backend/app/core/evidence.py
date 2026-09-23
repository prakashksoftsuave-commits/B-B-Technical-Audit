"""Real evidence extraction for Source Data's document/email viewer.

Reads what is actually inside a fetched `.eml` on disk - the same file `inbox.py` already reads
to route a return, parsed the same way (stdlib `email`, no new dependency). An ERP or Tally
source record has no file behind it at all; this module is never asked to conjure one for those
- see CLAUDE.md's standing rule against fabricated data. `service.py` calls this as a thin
adapter, per the "no calculation in main.py or service.py" convention the rest of this project
already follows.
"""
import email
import email.utils
import hashlib
import io
import os

from openpyxl import load_workbook

from . import config as C

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def resolve(attachment_id):
    """The one place a client-supplied string is allowed to touch the filesystem - the same
    check service.mail_attachment already applied, shared here so every function below gets it
    for free instead of repeating it."""
    real = os.path.realpath(attachment_id)
    root = os.path.realpath(C.EMAIL_DIR)
    if not (real == root or real.startswith(root + os.sep)) or not os.path.isfile(real):
        raise ValueError("not a known attachment")
    return real


def _load(path):
    with open(path, "rb") as f:
        return email.message_from_binary_file(f)


def _attachments(msg):
    out = []
    for part in msg.walk():
        fn = part.get_filename()
        if not fn:
            continue
        payload = part.get_payload(decode=True) or b""
        out.append({"filename": fn, "mime": part.get_content_type(), "payload": payload})
    return out


def _body_text(msg):
    for part in msg.walk():
        if part.get_content_type() == "text/plain" and not part.get_filename():
            payload = part.get_payload(decode=True) or b""
            charset = part.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="replace").strip()
    return ""


def read_email(path):
    """Every real header/body/attachment fact in one .eml - nothing inferred, nothing padded.
    checksum is a real SHA-256 of the real attachment bytes, not a placeholder."""
    msg = _load(path)
    date = None
    if msg.get("Date"):
        try:
            date = email.utils.parsedate_to_datetime(msg.get("Date")).isoformat()
        except (TypeError, ValueError):
            date = None
    return {
        "from": email.utils.parseaddr(msg.get("From", ""))[1],
        "to": email.utils.parseaddr(msg.get("To", ""))[1],
        "subject": msg.get("Subject", ""),
        "date": date,
        "messageId": msg.get("Message-ID"),
        "bodyText": _body_text(msg),
        "attachments": [
            {"index": i, "filename": a["filename"], "mime": a["mime"], "size": len(a["payload"]),
             "checksum": hashlib.sha256(a["payload"]).hexdigest()}
            for i, a in enumerate(_attachments(msg))
        ],
    }


def read_attachment_bytes(path, index):
    atts = _attachments(_load(path))
    if index < 0 or index >= len(atts):
        raise ValueError("no such attachment")
    return atts[index]


def read_spreadsheet(payload):
    """A real sheet/row/cell grid for the evidence drawer's spreadsheet viewer - straight from
    openpyxl, the same library this project already uses for every other Excel touch-point.
    Nothing recomputed - these are the workbook's own cell values."""
    wb = load_workbook(io.BytesIO(payload), data_only=True)
    return [
        {"name": ws.title,
         "rows": [["" if c is None else c for c in row] for row in ws.iter_rows(values_only=True)]}
        for ws in wb.worksheets
    ]
