"""Pipeline runner and serialiser.

Shape only - no calculation lives here, and in particular nothing here derives one figure from
another. If a number appears on a screen, some source stated it.

One run is cached in memory: reading Tally takes a few seconds, so recomputing per request
would make the console feel broken for no benefit.
"""
import datetime as dt
import json
import os
import threading

from .core import config as C
from .core import decisions, fabricate, finalization, inbox as IB, mailbox, outcome, tracker, workbook


class NotRunYet(RuntimeError):
    pass


_lock = threading.Lock()
_state = None

LINES = outcome.COMPARED       # revenue, material, subcon, machinery, site


def _d(x):
    return x.isoformat() if isinstance(x, (dt.date, dt.datetime)) else x


def _pname(code):
    p = C.BY_CODE.get(code)
    return p["tally"] if p else (code or "not attributed")


def health():
    from .core import tally_io as T
    mb = mailbox.settings()
    return {
        "tally": T.available(), "tallyUrl": C.TALLY_URL, "tallyCompany": C.TALLY_COMPANY,
        "mailbox": mb["user"] if mb["configured"] else None,
        "mailboxConfigured": mb["configured"],
        "erpDb": os.path.exists(C.ERP_DB), "inbox": os.path.isdir(C.EMAIL_DIR),
        "groundTruth": os.path.exists(C.GROUND_TRUTH),
        "snapshot": os.path.exists(C.TALLY_SNAPSHOT),
        "report": os.path.exists(C.REPORT_XLSX),
        "dataDir": C.BASE, "hasRun": _state is not None,
    }


def _load_vouchers(offline):
    from .core import tally_io as T
    if not offline and T.available():
        vs = T.fetch_vouchers(*T.WINDOW)
        if vs:
            return vs, f"live Tally ({C.TALLY_COMPANY})"
    if not os.path.exists(C.TALLY_SNAPSHOT):
        raise NotRunYet("No Tally data and no saved copy. Load the dataset first.")
    with open(C.TALLY_SNAPSHOT, encoding="utf-8") as f:
        return json.load(f), "saved copy of the Tally extract"


# ------------------------------------------------------------------ serialisation

def _masters():
    return {
        "projects": [{"code": p["code"], "name": p["tally"], "erp": p["erp"],
                      "client": p["client"], "sector": p["sector"],
                      "orderValue": p["value"], "aliases": p["aliases"]}
                     for p in C.PROJECTS],
        "months": [{"key": k, "label": lbl} for k, lbl, _f, _t in C.MONTHS],
        "inputs": [{"kind": k, "label": lbl, "owner": who} for k, lbl, who, _kw in C.INPUTS],
        "lines": [{"key": ln, "label": C.LINE_LABEL.get(ln, ln)} for ln in LINES],
        "tolerance": C.RECON_TOLERANCE,
        "bufferDays": C.CUTOFF_LEAD_DAYS,
        "org": C.ORG_NAME, "division": C.DIVISION,
    }


def _consolidation(res):
    out = []
    for (code, month), r in sorted(res["rows"].items(), key=lambda kv: (kv[0][1], kv[0][0])):
        out.append({
            "project": code, "projectName": _pname(code),
            "month": month, "monthLabel": C.month_label(month),
            "tallyRevenue": round(r["tally_revenue"]),
            "workDone": None if r["work_done"] is None else round(r["work_done"]),
            "raBill": None if r["ra_bill"] is None else round(r["ra_bill"]),
            "erp": {ln: round(r["erp"][ln]) for ln in LINES},
            "tally": {ln: round(r["tally"][ln]) for ln in LINES},
            "opening": None if r["opening"] is None else round(r["opening"]),
            "closing": None if r["closing"] is None else round(r["closing"]),
            "stockRestated": r["stock_restated"],
            "salary": None if r["salary"] is None else round(r["salary"]),
            "formwork": None if r["formwork"] is None else round(r["formwork"]),
            "adjustments": [{"kind": a["kind"], "reason": a["reason"],
                             "amount": round(a["amount"]), "sender": a["sender"]}
                            for a in r["adjustments"]],
            "returnsReceived": r["returns_received"],
            "returnsMissing": r["returns_missing"],
        })
    return out


def _comparisons(res):
    rows = [{"project": v["project"], "projectName": _pname(v["project"]),
             "month": v["month"], "monthLabel": C.month_label(v["month"]),
             "line": v["line"], "label": C.LINE_LABEL.get(v["line"], v["line"]),
             "erp": round(v["erp"]), "tally": round(v["tally"]), "diff": round(v["diff"]),
             "verdict": v["verdict"], "owner": v["owner"]}
            for v in res["comparisons"]]
    rows.sort(key=lambda r: (0 if r["verdict"] == "differs" else 1, r["month"], r["project"]))
    return rows


def _submission(t_rows, t_sum):
    return {
        "summary": {"expected": t_sum["expected"], "onTime": t_sum["on_time"],
                    "late": t_sum["late"], "missing": t_sum["missing"],
                    "worstDelay": t_sum["worst_delay"],
                    "chronic": [{"owner": k, "occasions": v}
                                for k, v in t_sum["chronic"].items()]},
        "rows": [{"month": r["month"], "monthLabel": C.month_label(r["month"]),
                  "project": r["project"], "projectName": _pname(r["project"]),
                  "kind": r["kind"], "label": C.INPUT_LABEL[r["kind"]],
                  "owner": r["owner"], "cutoff": _d(r["cutoff"]), "due": _d(r["due"]),
                  "arrived": _d(r["arrived"]), "daysLate": r["days_late"],
                  "status": r["status"]} for r in t_rows],
    }


def _reminders(t_rows):
    return [{
        "month": key, "monthLabel": label,
        "due": _d(C.due_date(key)), "cutoff": _d(C.cutoff_date(key)),
        "schedule": [{"when": _d(s["when"]), "type": s["type"], "to": s["to"],
                      "subject": s["subject"], "note": s["note"]}
                     for s in tracker.reminder_schedule(key)],
        "chase": [{"to": c["to"], "project": c["project"],
                   "projectName": _pname(c["project"]), "label": c["label"],
                   "status": c["status"], "daysLate": c["days_late"], "line": c["line"]}
                  for c in tracker.outstanding_notices(t_rows, key)],
    } for key, label, _f, _t in C.MONTHS]


def _outstanding(res):
    return [{"kind": t["kind"], "project": t["project"],
             "projectName": _pname(t["project"]) if t["project"] else "—",
             "month": t["month"],
             "monthLabel": C.month_label(t["month"]) if t["month"] else "—",
             "what": t["what"], "detail": t["detail"],
             "amount": None if t["amount"] is None else round(t["amount"]),
             "owner": t["owner"]}
            for t in res["outstanding"]]


_MAIL_BREAKDOWN = {"hr_salary": C.SALARY_ROLES, "work_done": C.WORK_CATEGORIES,
                    "formwork": C.FORMWORK_CATEGORIES}


def _lineage(res):
    out = []
    for d in res["erp_detail"]:
        out.append({"source": d["module"], "project": d["project"],
                    "projectName": _pname(d["project"]), "month": d["month"],
                    "monthLabel": C.month_label(d["month"]),
                    "label": C.LINE_LABEL.get(d["line"], d["line"]),
                    "amount": round(d["amount"]), "ref": d["ref"],
                    "description": d["description"]})
    for d in res["tally_detail"]:
        out.append({"source": "Tally", "project": d["project"],
                    "projectName": _pname(d["project"]), "month": d["month"],
                    "monthLabel": C.month_label(d["month"]),
                    "label": C.LINE_LABEL.get(d["line"], d["line"]),
                    "amount": round(d["amount"]), "ref": d["ref"],
                    "description": f"{d['ledger']} — {d['description']}"})
    for i in res["inbox"]:
        base = {"project": i["project"], "projectName": _pname(i["project"]),
                "month": i["month"], "monthLabel": C.month_label(i["month"]),
                "ref": _d(i["arrived"]),
                # R1's two signals: which one actually identified the project for this mail,
                # and whether they disagreed when both were checkable.
                "routedBy": i.get("routedBy"), "senderMismatch": i.get("senderMismatch", False)}
        # Every return's own attachment states a breakdown now (see fabricate.py's *_ITEMS) -
        # read it back out here so the mail side traces to "what/who, how much" the same way
        # ERP's own split entries already do, instead of one row with nothing on it. Stock is
        # handled on its own since one return states both an opening and a closing figure, each
        # with its own material breakdown and its own label - "Opening stock" and "Closing
        # stock" trace to separate rows here, not one shared label for both.
        # Formwork's own attachment states "Value", not "Amount" - same fallback IB.value()
        # already uses, so its breakdown reads back out too, not just Amount-column returns.
        item_map = {r.get("Item"): r.get("Amount", r.get("Value")) for r in i["rows"]}
        if i["kind"] == "stock":
            matched = [("Opening stock", m, item_map[f"Opening - {m}"]) for m in C.STOCK_MATERIALS
                       if item_map.get(f"Opening - {m}") is not None]
            matched += [("Closing stock", m, item_map[f"Closing - {m}"]) for m in C.STOCK_MATERIALS
                        if item_map.get(f"Closing - {m}") is not None]
        else:
            categories = _MAIL_BREAKDOWN.get(i["kind"], [])
            matched = [(C.INPUT_LABEL[i["kind"]], cat, item_map[cat]) for cat in categories
                       if item_map.get(cat) is not None]
        if matched:
            for label, sub, amt in matched:
                out.append({**base, "label": label, "source": "Return", "amount": round(amt),
                            "description": f"{i['sender']} — {sub}"})
        else:
            out.append({**base, "label": C.INPUT_LABEL[i["kind"]], "source": "Return",
                        "amount": None, "description": f"{i['sender']} — {i['subject']}"})
    for u in res["unroutable"]:
        out.append({"source": "Unrouted", "project": None, "projectName": "—",
                    "month": None, "monthLabel": "—", "label": "could not be routed",
                    "amount": None, "ref": "", "description": f"{u['sender']} — "
                    f"{u['subject']} ({u['why']})", "routedBy": None,
                    "senderMismatch": False})
    return out


def _round_or_none(v):
    return None if v is None else round(v)


def _line(d):
    # Every compared line has "tally"; the one ERP-vs-mail line (salary) has "mail" instead, and
    # its diff can be None when the mail return has not arrived yet - see
    # outcome._salary_status.
    out = {"erp": round(d["erp"]), "diff": _round_or_none(d.get("diff")),
           "agrees": d["agrees"], "decision": d["decision"],
           "approved": _round_or_none(d["approved"])}
    if "tally" in d:
        out["tally"] = round(d["tally"])
    if "mail" in d:
        out["mail"] = _round_or_none(d["mail"])
    return out


def _position(res):
    # See outcome.project_position's docstring for exactly what is and is not resolved, and
    # CLAUDE.md's "Decided: profit resolved through an actual auditor decision" for the record.
    return [{"project": code, "projectName": _pname(code), "month": month,
             "monthLabel": C.month_label(month),
             "lines": {ln: _line(d) for ln, d in pos["lines"].items()},
             "differing": pos["differing"], "pending": pos["pending"],
             "tenderAmount": pos["tenderAmount"], "mailCost": round(pos["mailCost"]),
             "underReview": round(pos["underReview"]),
             "provisionalRevenue": _round_or_none(pos["provisionalRevenue"]),
             "provisionalCost": _round_or_none(pos["provisionalCost"]),
             "provisionalRemaining": _round_or_none(pos["provisionalRemaining"]),
             "provisionalProfit": _round_or_none(pos["provisionalProfit"]),
             "provisionalMargin": pos["provisionalMargin"],
             "approvedRevenue": _round_or_none(pos["approvedRevenue"]),
             "approvedCost": _round_or_none(pos["approvedCost"]),
             "remaining": _round_or_none(pos["remaining"]),
             "profit": _round_or_none(pos["profit"]), "margin": pos["margin"],
             "readyToFinalize": pos["readyToFinalize"], "status": pos["status"],
             "finalized": pos["finalized"]}
            for (code, month), pos in sorted(res["position"].items(),
                                              key=lambda kv: (kv[0][1], kv[0][0]))]


def _cumulative(res):
    return [{"project": code, "projectName": _pname(code),
             "tenderAmount": pos["tenderAmount"], "monthsSampled": pos["monthsSampled"],
             "mailCost": round(pos["mailCost"]), "underReview": round(pos["underReview"]),
             "pending": [{"month": m, "monthLabel": C.month_label(m), "line": ln,
                          "label": C.LINE_LABEL.get(ln, ln)} for m, ln in pos["pending"]],
             "provisionalRevenue": _round_or_none(pos["provisionalRevenue"]),
             "provisionalCost": _round_or_none(pos["provisionalCost"]),
             "provisionalRemaining": _round_or_none(pos["provisionalRemaining"]),
             "provisionalProfit": _round_or_none(pos["provisionalProfit"]),
             "provisionalMargin": pos["provisionalMargin"],
             "approvedCost": _round_or_none(pos["approvedCost"]),
             "remaining": _round_or_none(pos["remaining"]),
             "profit": _round_or_none(pos["profit"]), "margin": pos["margin"],
             "status": pos["status"], "finalizedMonths": pos["finalizedMonths"]}
            for code, pos in sorted(res["cumulative"].items())]


def _poc(res):
    # See outcome.poc_position's docstring/comments for the budget-placeholder and
    # sampled-months caveats - these figures are read straight from that layer, nothing
    # recomputed here.
    return [{"project": code, "projectName": _pname(code), "month": month,
             "monthLabel": C.month_label(month),
             "budget": _round_or_none(fig["budget"]),
             "pctComplete": None if fig["pctComplete"] is None else round(fig["pctComplete"] * 100, 1),
             "costToDate": round(fig["costToDate"]), "monthCost": round(fig["monthCost"]),
             "revenueToDate": _round_or_none(fig["revenueToDate"]),
             "revenueThisMonth": _round_or_none(fig["revenueThisMonth"]),
             "profit": _round_or_none(fig["profit"]), "margin": fig["margin"],
             "foreseeableLoss": round(fig["foreseeableLoss"])}
            for (code, month), fig in sorted(res["poc"].items(),
                                              key=lambda kv: (kv[0][1], kv[0][0]))]


def _totals(cons, res):
    """Group figures, per source. Never added across sources."""
    t = {"tallyRevenue": 0, "workDone": 0, "raBill": 0,
         "erp": {ln: 0 for ln in LINES}, "tally": {ln: 0 for ln in LINES},
         "adjustments": 0, "unattributed": 0}
    for r in cons:
        t["tallyRevenue"] += r["tallyRevenue"]
        t["workDone"] += r["workDone"] or 0
        t["raBill"] += r["raBill"] or 0
        for ln in LINES:
            t["erp"][ln] += r["erp"][ln]
            t["tally"][ln] += r["tally"][ln]
        t["adjustments"] += sum(a["amount"] for a in r["adjustments"])
    t["unattributed"] = round(sum(u["amount"] for u in res["unattributed"]))
    # Cost lines only - revenue is income, never summed into a cost total.
    t["erpTotal"] = sum(t["erp"][ln] for ln in outcome.COST_LINES)
    t["tallyTotal"] = sum(t["tally"][ln] for ln in outcome.COST_LINES)
    return t


# The last-loaded sources, cached so an auditor decision can be applied without re-reading
# Tally/ERP/mail - decisions.record() writes to disk, then this replays outcome.build() (all
# local computation, no network) against what was already fetched.
_cached = None


def _build_state(vouchers, source, mail, as_of_date, write_workbook):
    global _state
    res = outcome.build(vouchers)

    t_rows = tracker.status(res["chosen"], as_of=as_of_date)
    t_sum = tracker.summary(t_rows)

    with open(C.GROUND_TRUTH, encoding="utf-8") as f:
        gt = json.load(f)
    chk = outcome.check(res["rows"], res["comparisons"], res["unattributed"], gt)

    ran_at = dt.datetime.now().isoformat(timespec="seconds")
    cons = _consolidation(res)
    comparisons = _comparisons(res)
    sub = _submission(t_rows, t_sum)
    todo = _outstanding(res)

    if write_workbook:
        workbook.write(res, chk, t_rows, t_sum, meta={"ranAt": ran_at})

    _state = {
        "meta": {"ranAt": ran_at, "source": source, "vouchers": len(vouchers),
                 "erpRows": len(res["erp_detail"]), "returns": len(res["inbox"]),
                 "asOf": _d(as_of_date), "mail": mail},
        "masters": _masters(),
        "totals": _totals(cons, res),
        "counts": {
            "compared": len(comparisons),
            "agree": sum(1 for c in comparisons if c["verdict"] == "agree"),
            "differs": sum(1 for c in comparisons if c["verdict"] == "differs"),
            "outstanding": len(todo),
            "toAttribute": sum(1 for t in todo if t["kind"] == "attribute"),
            "toDecide": sum(1 for t in todo if t["kind"] == "decide"),
            "toChase": sum(1 for t in todo if t["kind"] == "chase"),
            "restated": sum(1 for t in todo if t["kind"] == "restated"),
            "expected": sub["summary"]["expected"], "onTime": sub["summary"]["onTime"],
            "late": sub["summary"]["late"], "missing": sub["summary"]["missing"],
        },
        "consolidation": cons,
        "comparisons": comparisons,
        "composition": res["composition"],
        "unattributed": [{"month": u["month"], "monthLabel": C.month_label(u["month"]),
                          "ledger": u["ledger"],
                          "label": C.LINE_LABEL.get(u["line"], u["line"]),
                          "amount": round(u["amount"]), "narration": u["narration"],
                          "reason": u["reason"], "ref": u["voucher"]}
                         for u in res["unattributed"]],
        "outstanding": todo,
        "adjustments": [{"project": code, "projectName": _pname(code), "month": month,
                         "monthLabel": C.month_label(month), "kind": a["kind"],
                         "reason": a["reason"], "amount": round(a["amount"]),
                         "sender": a["sender"]}
                        for (code, month), items in sorted(res["adjustments"].items())
                        for a in items],
        "submission": sub,
        "reminders": _reminders(t_rows),
        "lineage": _lineage(res),
        "position": _position(res),
        "cumulative": _cumulative(res),
        "poc": _poc(res),
        "rules": [{"id": rid, "description": desc, "origin": origin, "basis": basis,
                   "fired": res["fired"].get(rid, 0)}
                  for rid, desc, origin, basis in outcome.RULES],
        "check": {"checks": chk["checks"], "worst": round(chk["worst"]),
                  "tolerance": C.GATE_TOLERANCE, "passed": chk["passed"],
                  "failed": chk["failed"]},
    }
    return _state


def run(offline=False, as_of=None, write_workbook=True, fetch_mail=True):
    global _cached
    with _lock:
        # Pull anything new from the mailbox first, so one Refresh does the whole job. A
        # mailbox that is not configured, or unreachable, is not an error - the folder alone
        # still produces a complete run, which is the fallback if the network fails mid-demo.
        mail = {"configured": False, "fetched": 0}
        if fetch_mail:
            try:
                mail = mailbox.fetch()
            except Exception as e:
                # Deliberately broad. Reading the mailbox is a convenience; the report is
                # built from the returns already on file and must never fail because a mail
                # server had a bad moment. The failure is reported on screen, not raised.
                mail = {"configured": True, "fetched": 0,
                        "error": f"{type(e).__name__}: {e}"}

        vouchers, source = _load_vouchers(offline)
        as_of_date = dt.date.fromisoformat(as_of) if as_of else dt.date.today()
        _cached = {"vouchers": vouchers, "source": source, "mail": mail,
                   "as_of_date": as_of_date, "write_workbook": write_workbook}
        return _build_state(vouchers, source, mail, as_of_date, write_workbook)


def apply_decision(project, month, line, choice, amount=None, note="", decided_by=""):
    """Record an auditor decision and recompute the cached run to reflect it - no network
    calls, since the sources themselves have not changed, only what a person decided about
    a difference already found in them.
    """
    if _cached is None:
        raise NotRunYet("Nothing has been read yet.")
    with _lock:
        decisions.record(project, month, line, choice, amount, note, decided_by)
        c = _cached
        return _build_state(c["vouchers"], c["source"], c["mail"], c["as_of_date"],
                             c["write_workbook"])


def clear_decision(project, month, line):
    if _cached is None:
        raise NotRunYet("Nothing has been read yet.")
    with _lock:
        decisions.clear(project, month, line)
        c = _cached
        return _build_state(c["vouchers"], c["source"], c["mail"], c["as_of_date"],
                             c["write_workbook"])


def finalize_month(project, month, finalized_by=""):
    """Close one project-month: freeze its approved cost/revenue/remaining/profit/margin so
    later decisions or a re-fetched data source cannot move them. Raises ValueError (surfaced
    as a 400) if a line is still unresolved - the same check outcome.snapshot_for_finalization
    makes, kept here too since this is the one place that is actually allowed to write it.
    """
    if _cached is None:
        raise NotRunYet("Nothing has been read yet.")
    with _lock:
        c = _cached
        res = outcome.build(c["vouchers"])
        snapshot = outcome.snapshot_for_finalization(res["rows"], res["adjustments"],
                                                       project, month)
        finalization.finalize(project, month, snapshot, finalized_by)
        return _build_state(c["vouchers"], c["source"], c["mail"], c["as_of_date"],
                             c["write_workbook"])


def reopen_month(project, month, reopened_by=""):
    if _cached is None:
        raise NotRunYet("Nothing has been read yet.")
    with _lock:
        finalization.reopen(project, month, reopened_by)
        c = _cached
        return _build_state(c["vouchers"], c["source"], c["mail"], c["as_of_date"],
                             c["write_workbook"])


def finalize_all_ready(month, finalized_by=""):
    """Close every project that is ready to finalize for one month, in one action - the
    portfolio-wide equivalent of finalize_month, for when every project's lines are already
    decided and clicking Finalize once per project is pure repetition. Skips (does not error on)
    anything not actually ready or already finalized, and reports both lists back so the caller
    knows exactly what happened rather than assuming "all of them."
    """
    if _cached is None:
        raise NotRunYet("Nothing has been read yet.")
    with _lock:
        c = _cached
        res = outcome.build(c["vouchers"])
        finalized, skipped = [], []
        for code in sorted(C.BY_CODE):
            pos = res["position"].get((code, month))
            if pos is None or pos["status"] == "FINALIZED" or not pos["readyToFinalize"]:
                skipped.append(code)
                continue
            snapshot = outcome.snapshot_for_finalization(res["rows"], res["adjustments"],
                                                           code, month)
            finalization.finalize(code, month, snapshot, finalized_by)
            finalized.append(code)
        state = _build_state(c["vouchers"], c["source"], c["mail"], c["as_of_date"],
                              c["write_workbook"])
        return {**state, "finalizedProjects": finalized, "skippedProjects": skipped}


def filtered_report(project=None, month=None):
    """A workbook scoped to one project and/or month, for the Excel download to respect
    whatever the Consolidation screen's filter is showing - built fresh from the cached sources
    (no network) rather than reusing the always-unfiltered file the last full run wrote.
    """
    if _cached is None:
        raise NotRunYet("Nothing has been read yet.")
    res = outcome.build(_cached["vouchers"])
    ran_at = dt.datetime.now().isoformat(timespec="seconds")
    path = os.path.join(C.BASE, "_report_filtered.xlsx")
    return workbook.write(res, None, [], {}, path=path, meta={"ranAt": ran_at},
                           project=project, month=month)


def generate(push_tally=True):
    import contextlib
    import io
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fabricate.run(push_tally=push_tally)
    return buf.getvalue().strip().splitlines(), run(offline=not push_tally)


def state():
    if _state is None:
        raise NotRunYet("Nothing has been read yet.")
    return _state


def selftest():
    import contextlib
    import io
    from .core import selftest as st
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = st.run()
    lines = buf.getvalue().strip().splitlines()
    return {"passed": code == 0, "total": len(st.TESTS),
            "results": [{"name": l.split()[1], "ok": l.strip().startswith("ok")}
                        for l in lines if l.strip().startswith(("ok", "FAIL", "ERROR"))]}
