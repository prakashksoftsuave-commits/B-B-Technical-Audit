"""Component A - stop the chasing.

The client's loudest complaint was not the arithmetic, it was the follow-up: ask for inputs by
the 20th, get them on the 31st, then produce the report in the few days that are left.

This module answers three questions without anyone opening a mailbox:

  who owes what        - the expected matrix, from the contributor master
  what has landed      - matched against the inbox, by arrival date
  who needs chasing    - outstanding now, and late when it did arrive

It also emits the reminder schedule that would have prevented the problem: every contributor
told a date that sits CUTOFF_LEAD_DAYS before the real deadline.

Reminders are GENERATED, NOT SENT. Nothing here opens an SMTP connection. For a POC that is
the right call - a demo that mails live people is a demo that goes wrong once.
"""
import datetime as dt

from . import config as C

PENDING, ON_TIME, LATE, MISSING = "pending", "on time", "late", "not received"


def expected():
    """Every (project, month, kind) that someone owes. Adjustments are not compulsory:
    a month with nothing to adjust legitimately has no adjustment mail."""
    out = []
    for key, _label, _f, _t in C.MONTHS:
        for p in C.PROJECTS:
            for kind, _lbl, _who, _kw in C.INPUTS:
                out.append({"project": p["code"], "month": key, "kind": kind,
                            "owner": C.CONTRIBUTORS[p["code"]][kind],
                            "optional": kind == "adjustment"})
    return out


def status(chosen, as_of=None):
    """Match the expected matrix against what actually arrived.

    `chosen` is inbox.latest()[0]. `as_of` is the date the report is being run: nothing
    received and still inside the cut-off is PENDING, not a problem yet; nothing received once
    the cut-off has passed becomes MISSING - the automatic Pending -> Overdue transition.
    """
    as_of = as_of or dt.date.today()
    rows = []
    for e in expected():
        cut = C.cutoff_date(e["month"])
        got = chosen.get((e["project"], e["month"], e["kind"]))
        if got is None:
            if e["optional"]:
                continue
            rows.append({**e, "cutoff": cut, "due": C.due_date(e["month"]), "arrived": None,
                         "days_late": None, "status": PENDING if as_of < cut else MISSING})
            continue
        late_by = (got["arrived"] - cut).days
        rows.append({**e, "cutoff": cut, "due": C.due_date(e["month"]),
                     "arrived": got["arrived"], "days_late": max(0, late_by),
                     "status": LATE if late_by > 0 else ON_TIME,
                     "revised": got["revised"], "subject": got["subject"]})
    rows.sort(key=lambda r: (r["month"], r["project"], r["kind"]))
    return rows


def summary(rows):
    on_time = [r for r in rows if r["status"] == ON_TIME]
    late = [r for r in rows if r["status"] == LATE]
    missing = [r for r in rows if r["status"] == MISSING]
    pending = [r for r in rows if r["status"] == PENDING]
    return {"expected": len(rows), "on_time": len(on_time),
            "late": len(late), "missing": len(missing), "pending": len(pending),
            "worst_delay": max((r["days_late"] or 0 for r in rows), default=0),
            "chronic": _chronic(rows)}


def _chronic(rows):
    """Contributors late in more than one month - the ones worth a conversation."""
    tally = {}
    for r in rows:
        if r["status"] in (LATE, MISSING):
            tally.setdefault(r["owner"], []).append(f"{r['month']} {r['kind']}")
    return {k: v for k, v in sorted(tally.items()) if len(v) > 1}


def reminder_schedule(month_key):
    """What would go out, and when, for one reporting month.

    Three touches: a heads-up a week before cut-off, the cut-off reminder itself, and an
    escalation the day after for anything still outstanding.
    """
    cut, due = C.cutoff_date(month_key), C.due_date(month_key)
    return [
        {"when": cut - dt.timedelta(days=7), "type": "heads-up",
         "to": "every contributor",
         "subject": f"Inputs due {cut:%d-%b} - {C.month_label(month_key)} outcome report",
         "note": f"Report is due {due:%d-%b}. Your cut-off is {cut:%d-%b}, "
                 f"{C.CUTOFF_LEAD_DAYS} days earlier, so the audit team has time to work."},
        {"when": cut, "type": "cut-off", "to": "anyone outstanding",
         "subject": f"Due today - {C.month_label(month_key)} inputs",
         "note": "Sent only to contributors whose document has not arrived."},
        {"when": cut + dt.timedelta(days=1), "type": "escalation",
         "to": C.ESCALATE_TO,
         "subject": f"Outstanding inputs - {C.month_label(month_key)}",
         "note": "One mail listing what is missing and who owes it. "
                 "Replaces the individual chasing."},
    ]


def outstanding_notices(rows, month_key):
    """The actual chase list for a month: one line per person per missing document.

    This is the artefact that replaces the manual follow-up - it is what the cut-off reminder
    and the escalation mail would contain. PENDING is deliberately excluded alongside ON_TIME -
    the cut-off has not passed yet, so there is nothing to chase, only something to wait for.
    """
    out = []
    for r in rows:
        if r["month"] != month_key or r["status"] in (ON_TIME, PENDING):
            continue
        out.append({"to": r["owner"], "project": r["project"], "kind": r["kind"],
                    "label": C.INPUT_LABEL[r["kind"]], "cutoff": r["cutoff"],
                    "status": r["status"], "days_late": r["days_late"],
                    "line": (f"{C.INPUT_LABEL[r['kind']]} for "
                             f"{C.BY_CODE[r['project']]['tally']} "
                             f"({C.month_label(r['month'])}) - "
                             + (f"{r['days_late']} days late"
                                if r["status"] == LATE else "not received"))})
    return out


if __name__ == "__main__":
    from . import inbox
    items, _bad = inbox.read_all()
    chosen, _sup = inbox.latest(items)
    rows = status(chosen, as_of=dt.date(2027, 1, 15))
    s = summary(rows)
    print(f"expected {s['expected']}  on time {s['on_time']}  late {s['late']}  "
          f"missing {s['missing']}  pending {s['pending']}  worst {s['worst_delay']}d")
    for r in rows:
        if r["status"] != ON_TIME:
            print(f"  {r['month']}  {r['project']}  {r['kind']:11s} {r['status']:13s} "
                  f"{'' if r['days_late'] is None else str(r['days_late']) + 'd'}  {r['owner']}")
    print("chronic:", s["chronic"])
