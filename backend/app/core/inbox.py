"""Read the inputs that live in nobody's system: the mailbox.

Routing is done off the SUBJECT LINE - project, input kind and reporting month all come from
there, exactly as a person reads it. Not from the filename, not from a custom header. That is
the client's own observation: the project name is in the subject, and there is a mail domain
per project.

Consequence, and it is the point: this keeps working when these are real emails from real
people, because nothing about the transport had to be arranged in advance.
"""
import email
import email.utils
import io
import os
import re

from openpyxl import load_workbook

from . import config as C

_REVISED = re.compile(r"\b(revis(ed|ion)|corrected|restated|amend(ed)?)\b", re.I)


def _kind(subject):
    s = subject.lower()
    # Longest keyword first so "ra bill" does not lose to a shorter accidental match.
    for kind, kw in sorted(C.INPUT_KEYWORD.items(), key=lambda kv: -len(kv[1])):
        if kw in s:
            return kind
    return None


def _month(subject):
    s = subject.lower()
    for key, label, _f, _t in C.ALL_MONTHS:
        if label.lower() in s:
            return key
    return None


def _rows(payload):
    """Read the xlsx attachment.

    The header row is LOCATED, not assumed. Attachments carry a title and a subtitle above the
    table, and a real sender's spreadsheet will have its own preamble of some other depth - so
    anchoring on a fixed row number is a bug waiting to happen. It already was one once.

    The header is the first row with two or more cells that are all text, and at least one row
    of data beneath it.
    """
    wb = load_workbook(io.BytesIO(payload), data_only=True)
    ws = wb.active
    vals = [row for row in ws.values]

    head_at = None
    for i, row in enumerate(vals):
        cells = [c for c in (row or []) if c is not None and str(c).strip() != ""]
        if len(cells) >= 2 and all(isinstance(c, str) for c in cells) and i + 1 < len(vals):
            head_at = i
            break
    if head_at is None:
        return [], []

    headers = [str(h).strip() if h is not None else "" for h in vals[head_at]]
    out = []
    for raw in vals[head_at + 1:]:
        if raw is None or all(c is None for c in raw):
            continue
        out.append({h: v for h, v in zip(headers, raw) if h})
    return headers, out


def read_all(directory=None):
    """Every input email found, oldest first.

    Each item: kind, project, month, arrived (date), sender, subject, revised, rows, path.
    Items that cannot be routed are returned separately - they are a finding, not a crash.
    """
    directory = directory or C.EMAIL_DIR
    found, unroutable = [], []
    for root, _dirs, files in os.walk(directory):
        for fn in sorted(files):
            if not fn.lower().endswith(".eml"):
                continue
            path = os.path.join(root, fn)
            with open(path, "rb") as f:
                msg = email.message_from_binary_file(f)
            subject = (msg.get("Subject") or "").strip()
            sender = email.utils.parseaddr(msg.get("From") or "")[1]
            try:
                arrived = email.utils.parsedate_to_datetime(msg.get("Date")).date()
            except (TypeError, ValueError):
                arrived = None

            kind, month = _kind(subject), _month(subject)
            # R1, both halves: the project is named in the subject, and there is a mail
            # identity per project (client discovery session). Either signal alone can route
            # the mail; when both resolve, they should agree, and it is worth knowing if they
            # do not.
            by_subject = C.resolve_project(subject)
            by_sender = C.resolve_sender(sender)
            project = by_subject or by_sender
            sender_mismatch = bool(by_subject and by_sender
                                   and by_subject["code"] != by_sender["code"])
            payload, attach = None, None
            for part in msg.walk():
                fname = part.get_filename()
                if fname and fname.lower().endswith(".xlsx"):
                    payload, attach = part.get_payload(decode=True), fname
                    break

            item = {"kind": kind, "project": project["code"] if project else None,
                    "month": month, "arrived": arrived, "sender": sender, "subject": subject,
                    "revised": bool(_REVISED.search(subject)), "attachment": attach,
                    "path": path, "rows": [],
                    "routedBy": "subject" if by_subject else ("sender" if by_sender else None),
                    "senderMismatch": sender_mismatch}
            if not (kind and month and project and payload):
                item["why"] = ("no project in subject or sender" if not project else
                               "no input kind in subject" if not kind else
                               "no month in subject" if not month else
                               "no xlsx attachment")
                unroutable.append(item)
                continue
            _headers, item["rows"] = _rows(payload)
            found.append(item)

    found.sort(key=lambda i: (i["arrived"] or __import__("datetime").date.min, i["path"]))
    return found, unroutable


def latest(items):
    """Newest per (project, month, kind) wins. Returns (chosen, superseded).

    This is rule R8. A restatement is never silently swallowed - the superseded input is
    handed back so the report can show that a number moved and who moved it.
    """
    best, superseded = {}, []
    for i in items:
        key = (i["project"], i["month"], i["kind"])
        prev = best.get(key)
        if prev is None:
            best[key] = i
            continue
        # Later arrival wins; an explicit "REVISED" wins a same-day tie.
        newer = (i["arrived"], i["revised"]) >= (prev["arrived"], prev["revised"])
        if newer:
            best[key] = i
            superseded.append(prev)
        else:
            superseded.append(i)
    return best, superseded


def value(item, want):
    """Pull one labelled amount out of an input's rows.

    Exact match first, then a prefix match: a sender who writes "Work done value certified"
    where the master says "Work done value" is describing the same figure, and a report that
    silently loses the line because of three extra words is worse than one that accepts it.
    """
    want_l = want.strip().lower()

    def amount(row):
        for col in ("Amount", "Value"):
            if row.get(col) is not None:
                return float(row[col])
        return None

    labelled = []
    for r in item["rows"]:
        label = str(r.get("Item") or r.get("Kind") or "").strip().lower()
        if not label:
            continue
        if label == want_l:
            return amount(r)
        labelled.append((label, r))
    for label, r in labelled:
        if label.startswith(want_l) or want_l.startswith(label):
            return amount(r)
    return None


if __name__ == "__main__":
    items, bad = read_all()
    chosen, sup = latest(items)
    print(f"{len(items)} routed, {len(bad)} unroutable, "
          f"{len(chosen)} current, {len(sup)} superseded")
    for i in items[:6]:
        print(f"  {i['arrived']}  {i['project']}  {i['month']}  {i['kind']:11s} {i['subject']}")
    for s in sup:
        print(f"  SUPERSEDED  {s['project']} {s['month']} {s['kind']}  {s['subject']}")
    for b in bad:
        print(f"  UNROUTABLE  {b['why']}: {b['subject']}")
