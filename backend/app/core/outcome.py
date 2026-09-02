"""Consolidate the sources and compare them. Nothing more.

WHY THIS FILE IS SMALL
----------------------
An earlier version of this module computed the monthly profit: it recognised revenue, derived
material consumption from stock movement, apportioned head-office overhead on revenue share,
and picked ERP over Tally whenever the two disagreed. Every one of those was our invention.
The division never described any of them - "overhead" was never raised in discovery, and
neither was opening stock, closing stock or revenue recognition.

So they are gone. What is left is only what the division actually asked for, in the client's
own discovery session:

  1. Route each return to its project, from the subject line.
     Their observation: the project is named in the subject and there is a mail domain per
     project.

  2. Put the ERP figure and the Tally figure side by side, for every cost head.
     Their words: "Tally Vs ERP Comparison".

  3. Never resolve a difference. Show both figures and name an owner.
     Their constraint: finance work cannot carry a 5-10% error rate, so a person decides.

  4. Capture the adjustments that exist in neither system and list them.
     Their description: work finished but unbilled, quantity savings, rates never fixed.

Consequences of that, all deliberate:

  * There is no profit line. The division computes it once the figures are agreed - which is
    what they said they do.
  * A cost with no cost centre is reported as not attributed. It is not guessed at from the
    narration, and head-office cost is not spread across projects.
  * A difference is a difference. It is not classified as a timing lag and quietly netted off.
  * When a return is restated, both versions are shown. The later one is not silently adopted.

ground_truth.json is read only by check(), which confirms the consolidation reproduces each
source faithfully. That is a parsing check, not an opinion about the business.
"""
from collections import defaultdict

from . import config as C
from . import decisions as D
from . import erp
from . import finalization as FIN
from . import inbox as IB

# The four rules, and the basis each rests on. Not surfaced in the product - this is the
# engineering record. `fired` counts how often each actually did something in a run.
RULES = [
    ("R1", "Route each return to its project from the email subject line",
     "asked for", "Project named in the subject; a mail domain per project (client discovery session)"),
    ("R2", "Show the ERP figure and the Tally figure side by side for every cost head",
     "asked for", 'Restated by the division as "Tally Vs ERP Comparison" (client discovery session)'),
    ("R3", "Never resolve a difference - present both figures and name an owner",
     "asked for", "Finance work cannot carry a 5-10% error rate (client discovery session)"),
    ("R4", "Capture adjustments that exist in neither system and list them",
     "asked for", "Unbilled work, quantity savings, rates never fixed (client discovery session)"),
]
DESC = {r[0]: r[1] for r in RULES}
ORIGIN = {r[0]: r[2] for r in RULES}
BASIS = {r[0]: r[3] for r in RULES}


class Fired(dict):
    def hit(self, rid, n=1):
        self[rid] = self.get(rid, 0) + n


# ---------------------------------------------------------------------------- Tally

def tally_totals(vouchers, fired):
    """Bucket Tally into (project, month, line) totals.

    A line with no cost centre is NOT attributed to a project. Previously the project was
    inferred from the voucher narration; that was a guess we were making on the division's
    behalf, so it is reported instead.
    """
    totals = defaultdict(float)
    unattributed = []
    detail = []

    for v in vouchers:
        month = f"{v['date'][:4]}-{v['date'][4:6]}"
        for ln in v["lines"]:
            line = C.LEDGER_LINE.get(ln["ledger"])
            if line is None:
                continue                      # party, cash, tax - not a report line
            amt = -ln["amount"] if line != "revenue" else ln["amount"]
            if amt == 0:
                continue

            code = None
            if ln["cost_centre"]:
                p = C.BY_TALLY.get(ln["cost_centre"])
                if p:
                    code = p["code"]
            if code is None:
                unattributed.append({
                    "voucher": v["number"], "date": v["date"], "month": month,
                    "ledger": ln["ledger"], "line": line, "amount": amt,
                    "narration": C.strip_tag(v["narration"]),
                    "reason": ("no cost centre on the voucher"
                               if line != "ho_pool" else
                               "head office cost, not booked against a project")})
                continue

            totals[(code, month, line)] += amt
            detail.append({"project": code, "month": month, "line": line, "amount": amt,
                           "source": "Tally", "ledger": ln["ledger"], "ref": v["number"],
                           "description": C.strip_tag(v["narration"])})

    return dict(totals), unattributed, detail


# ---------------------------------------------------------------------------- comparison

# COST_LINES is what "total cost" ever means in this run - revenue is never summed into it.
# COMPARED is everything shown ERP-against-Tally, cost lines plus revenue.
COST_LINES = ["material", "subcon", "machinery", "site"]
COMPARED = ["revenue"] + COST_LINES


def compare(erp_t, tally_t, fired):
    """R2 and R3. Every cost head where either system has a figure - plus revenue, on request,
    even though R2's citation was never about revenue (see COMPARED's comment).

    Two verdicts only: the figures agree, or they differ. A difference is never explained
    away - the division decides what it means.
    """
    rows = []
    for month, _lbl, _f, _t in C.MONTHS:
        for p in C.PROJECTS:
            for line in COMPARED:
                e = erp_t.get((p["code"], month, line), 0.0)
                t = tally_t.get((p["code"], month, line), 0.0)
                if not e and not t:
                    continue
                if line in COST_LINES:
                    fired.hit("R2")     # R2's citation is cost heads only
                diff = e - t
                agrees = abs(diff) <= C.RECON_TOLERANCE
                if not agrees:
                    fired.hit("R3")
                rows.append({
                    "project": p["code"], "month": month, "line": line,
                    "erp": e, "tally": t, "diff": diff,
                    "verdict": "agree" if agrees else "differs",
                    "owner": "" if agrees else "Technical Audit",
                })
    return rows


def composition_notes(erp_detail, tally_detail):
    """Where both systems carry the same head but describe it differently.

    Stated once per line, as a fact about the two systems. Not a variance and not an error.
    """
    def shape(detail):
        out = defaultdict(set)
        for d in detail:
            out[d["line"]].add(d.get("ledger") or d.get("module") or "?")
        return out

    e, t = shape(erp_detail), shape(tally_detail)
    notes = []
    for line in sorted(set(e) & set(t)):
        if len(t[line]) > len(e[line]):
            notes.append({"line": line, "label": C.LINE_LABEL.get(line, line),
                          "erp": ", ".join(sorted(e[line])),
                          "tally": ", ".join(sorted(t[line])),
                          "note": f"Tally spreads this over {len(t[line])} ledgers where the "
                                  f"ERP reports {len(e[line])}"})
    return notes


# ---------------------------------------------------------------------------- returns

def returns_received(chosen, superseded, fired):
    """R1 and R4. What each site return says, as reported - nothing derived from it.

    A restated return is not silently adopted: both versions are handed back so the division
    chooses. `chosen` is only "the latest that arrived", not "the correct one".
    """
    stock, adjustments, headline = {}, defaultdict(list), {}
    for (code, month, kind), item in chosen.items():
        fired.hit("R1")
        if kind == "stock":
            stock[(code, month)] = {
                "opening": IB.value(item, "Opening stock"),
                "closing": IB.value(item, "Closing stock"),
                "sender": item["sender"], "arrived": item["arrived"],
                "restated": item["revised"],
            }
        elif kind == "adjustment":
            for r in item["rows"]:
                kindv = str(r.get("Kind") or "").strip()
                amt = r.get("Amount")
                if not kindv or amt is None:
                    continue
                fired.hit("R4")
                adjustments[(code, month)].append({
                    "kind": kindv, "reason": str(r.get("Reason") or "").strip(),
                    "amount": float(amt), "sender": item["sender"]})
        else:
            want = {"work_done": "Work done value", "ra_bill": "RA bill certified",
                    "formwork": "Formwork hire recovered", "hr_salary": "Site staff salary"}
            v = IB.value(item, want.get(kind, ""))
            headline[(code, month, kind)] = {
                "value": v, "sender": item["sender"], "arrived": item["arrived"]}
    return dict(stock), dict(adjustments), headline


# ---------------------------------------------------------------------------- consolidation

def consolidate(erp_t, tally_t, stock, adjustments, headline, chosen):
    """One row per project-month: what every source says, side by side.

    No figure here is derived from another. Revenue is not recognised, material is not turned
    into a consumption figure, overhead is not apportioned and no source is preferred over
    another. Those are the division's calls to make, and they have not made them yet.
    """
    rows = {}
    for month, _lbl, _f, _t in C.MONTHS:
        for p in C.PROJECTS:
            code = p["code"]
            k = (code, month)
            got = {kind: (code, month, kind) in chosen
                   for kind, *_ in C.INPUTS}
            st = stock.get(k) or {}
            adjs = adjustments.get(k, [])
            rows[k] = {
                "project": code, "month": month,
                # revenue as each source states it - three figures, not one
                "tally_revenue": tally_t.get((code, month, "revenue"), 0.0),
                "work_done": (headline.get((code, month, "work_done")) or {}).get("value"),
                "ra_bill": (headline.get((code, month, "ra_bill")) or {}).get("value"),
                # cost heads, per system
                "erp": {ln: erp_t.get((code, month, ln), 0.0) for ln in COMPARED},
                "tally": {ln: tally_t.get((code, month, ln), 0.0) for ln in COMPARED},
                # stock, as the site reported it - not combined with anything
                "opening": st.get("opening"), "closing": st.get("closing"),
                "stock_restated": bool(st.get("restated")),
                "salary": (headline.get((code, month, "hr_salary")) or {}).get("value"),
                "salary_erp": erp_t.get((code, month, "salary"), 0.0),
                "formwork": (headline.get((code, month, "formwork")) or {}).get("value"),
                "adjustments": adjs,
                "returns_received": got,
                "returns_missing": [kind for kind, *_ in C.INPUTS
                                    if kind != "adjustment" and not got[kind]],
            }
    return rows


def outstanding(rows, compare_rows, unattributed, superseded, unroutable):
    """Everything the run will not decide. One list, each line with an owner."""
    out = []
    for u in unattributed:
        out.append({
            "kind": "attribute", "project": None, "month": u["month"],
            "what": "cost not attributed to a project",
            "detail": f"{u['ledger']}: {u['narration']} — {u['reason']}",
            "amount": u["amount"], "owner": "Technical Audit + Finance"})
    for v in compare_rows:
        if v["verdict"] != "differs":
            continue
        out.append({
            "kind": "decide", "project": v["project"], "month": v["month"],
            "what": f"ERP and Tally differ — {C.LINE_LABEL.get(v['line'], v['line'])}",
            "detail": f"ERP states {C.rupees(v['erp'])}; Tally states "
                      f"{C.rupees(v['tally'])}. The correct figure has to be established.",
            "amount": v["diff"], "owner": v["owner"]})
    for (code, month), r in sorted(rows.items()):
        # Salary is ERP-vs-mail, not ERP-vs-Tally, so it never runs through compare()/COMPARED -
        # added here by hand instead, only once the mail return has actually arrived (a return
        # that has not arrived yet is already listed below, as a "chase" item, not a "decide"
        # one - there is nothing to decide between until there is a second figure to compare).
        if r.get("salary") is not None:
            diff = (r.get("salary_erp") or 0.0) - r["salary"]
            if abs(diff) > C.RECON_TOLERANCE:
                out.append({
                    "kind": "decide", "project": code, "month": month,
                    "what": f"ERP and mail differ — {C.LINE_LABEL['salary']}",
                    "detail": f"ERP states {C.rupees(r.get('salary_erp') or 0.0)}; the site's "
                              f"own mail states {C.rupees(r['salary'])}. The correct figure has "
                              f"to be established.",
                    "amount": diff, "owner": "Technical Audit"})
        for kind in r["returns_missing"]:
            out.append({
                "kind": "chase", "input_kind": kind, "project": code, "month": month,
                "what": f"{C.INPUT_LABEL[kind]} not received",
                "detail": "Not received, so its figures are absent from the "
                          "consolidation.",
                "amount": None, "owner": C.CONTRIBUTORS[code][kind]})
    for s in superseded:
        out.append({
            "kind": "restated", "project": s["project"], "month": s["month"],
            "what": f"{C.INPUT_LABEL[s['kind']]} restated",
            "detail": f"A later mail replaced an earlier one; both are retained on "
                      f"Source data. Confirm which stands. Earlier: {s['subject']}",
            "amount": None, "owner": s["sender"]})
    for u in unroutable:
        out.append({
            "kind": "route", "project": None, "month": None,
            "what": "mail could not be routed",
            "detail": f"{u['why']}: {u['subject']}", "amount": None, "owner": u["sender"]})
    return out


# ---------------------------------------------------------------------------- check

def check(rows, compare_rows, unattributed, ground_truth):
    """Does the consolidation reproduce each source faithfully?

    Not a judgement about the business - a parsing check. It has caught two real regressions:
    an attachment layout change the reader did not follow, and a renamed row label.
    """
    checks, worst, failed = 0, 0.0, []
    for code, months in ground_truth["sources"].items():
        for month, truth in months.items():
            got = rows.get((code, month))
            if got is None:
                failed.append({"project": code, "month": month, "field": "row",
                               "computed": None, "expected": None})
                continue
            pairs = [("tally_revenue", got["tally_revenue"])]
            for ln in COMPARED:
                pairs.append((f"erp_{ln}", got["erp"][ln]))
                pairs.append((f"tally_{ln}", got["tally"][ln]))
            pairs += [("opening", got["opening"]), ("closing", got["closing"]),
                      ("erp_salary", got.get("salary_erp")), ("mail_salary", got.get("salary"))]
            for field, value in pairs:
                if field not in truth:
                    continue
                checks += 1
                delta = abs((value or 0) - (truth[field] or 0))
                worst = max(worst, delta)
                if delta > C.GATE_TOLERANCE:
                    failed.append({"project": code, "month": month, "field": field,
                                   "computed": value, "expected": truth[field]})
    # the unattributed pool must be reported in full, not partly swallowed
    if "unattributed_total" in ground_truth:
        checks += 1
        got = sum(u["amount"] for u in unattributed)
        delta = abs(got - ground_truth["unattributed_total"])
        worst = max(worst, delta)
        if delta > C.GATE_TOLERANCE:
            failed.append({"project": None, "month": None, "field": "unattributed total",
                           "computed": got, "expected": ground_truth["unattributed_total"]})
    return {"checks": checks, "worst": worst, "failed": failed, "passed": not failed}


# ---------------------------------------------------------------------------- project position
# Not one of the four rules. R1-R4 never resolve a difference; this is what happens once a
# person does, through decisions.record() - so an approved figure exists only as far as an
# auditor has actually decided, never further. Finalizing (finalization.py) is the further step
# of freezing that figure so later decisions or data cannot move a month already closed.
# See CLAUDE.md's "Decided: profit resolved through an actual auditor decision" for the record
# of what was requested versus inferred.
#
# Deliberately still excluded, same reason as ever: head-office overhead has no apportionment
# basis the client has ever given. Opening/closing stock IS now converted to a consumption
# figure - see _stock_adjustment() - once real percentage-of-completion accounting needed it;
# CLAUDE.md records this as a deliberate reversal, not an oversight.
ADJUSTS_REVENUE = {"revenue_accrued"}
ADJUSTS_COST = {"cost_saving", "provisional"}


def _line_status(code, month, ln, r, all_decisions):
    erp_v, tally_v = r["erp"][ln], r["tally"][ln]
    diff = erp_v - tally_v
    agrees = abs(diff) <= C.RECON_TOLERANCE
    decision = all_decisions.get(f"{code}|{month}|{ln}")
    if agrees:
        approved = tally_v
    elif decision is None:
        approved = None
    elif decision["choice"] == "erp":
        approved = erp_v
    elif decision["choice"] == "tally":
        approved = tally_v
    else:
        approved = decision["amount"]
    return {"erp": erp_v, "tally": tally_v, "diff": diff, "agrees": agrees,
            "decision": decision, "approved": approved}


def _adjustment_totals(adjustments, code, month):
    adjs = adjustments.get((code, month), [])
    rev_adj = sum(a["amount"] for a in adjs if a["kind"] in ADJUSTS_REVENUE)
    cost_adj = sum(a["amount"] for a in adjs if a["kind"] in ADJUSTS_COST)
    return rev_adj, cost_adj


# Site staff salary: ERP's payroll register (HRM) against the site's own mailed figure - kept
# out of COMPARED/COST_LINES deliberately, since it is not an ERP-vs-Tally line (Tally has no
# payroll ledger in this system) and R2's citation was never about it. A later, separate
# authorization added this as a real, decidable line rather than an always-accepted mail expense
# - see CLAUDE.md's "Decided: site staff salary becomes a real ERP-vs-mail reconciliation".
SALARY_LINE = "salary"


def _salary_status(code, month, r, all_decisions):
    erp_v = r.get("salary_erp") or 0.0
    mail_v = r.get("salary")
    if mail_v is None:
        # The return has not arrived - nothing to compare yet, so nothing is guessed at. Counted
        # as differing/pending below, same as any other unresolved line, until it arrives.
        return {"erp": erp_v, "mail": None, "diff": None, "agrees": False,
                "decision": None, "approved": None}
    diff = erp_v - mail_v
    agrees = abs(diff) <= C.RECON_TOLERANCE
    decision = all_decisions.get(f"{code}|{month}|{SALARY_LINE}")
    if agrees:
        approved = mail_v
    elif decision is None:
        approved = None
    elif decision["choice"] == "erp":
        approved = erp_v
    elif decision["choice"] == "mail":
        approved = mail_v
    else:
        approved = decision["amount"]
    return {"erp": erp_v, "mail": mail_v, "diff": diff, "agrees": agrees,
            "decision": decision, "approved": approved}


def _stock_adjustment(r):
    """Material actually CONSUMED this month, not just purchased: Opening + Purchases minus
    Closing. The reconciled "Material consumed" cost head above is a purchases figure (that is
    what both ERP and Tally book); the gap between purchases and consumption is Opening minus
    Closing, added here as a separate layer - never by changing the ERP/Tally comparison itself,
    which stays exactly what R2 asked for. Zero whenever either figure is missing - a return not
    received is excluded, not guessed at, same rule as everywhere else in this file."""
    if r.get("opening") is None or r.get("closing") is None:
        return 0.0
    return r["opening"] - r["closing"]


def status_of(differing, pending, finalized):
    if finalized:
        return "FINALIZED"
    if not differing:
        return "READY_FOR_FINALIZATION"
    if len(pending) == len(differing):
        return "OPEN"
    if not pending:
        return "READY_FOR_FINALIZATION"
    return "AUDIT_IN_PROGRESS"


_STATUS_RANK = ["OPEN", "AUDIT_IN_PROGRESS", "READY_FOR_FINALIZATION", "FINALIZED"]


def worst_status(statuses):
    """The least-resolved status among several project-months - one open line anywhere means
    the whole selection is not finalized. The one Python copy of this rule; workbook.py's
    Executive Summary calls it directly. Consolidation.jsx has its own `worstStatus()` for the
    same rule, since JS cannot call this - keep the two in sync by hand if this one changes.
    """
    statuses = list(statuses)
    if not statuses:
        return "OPEN"
    return min(statuses, key=_STATUS_RANK.index)


def _figures(code, r, adjustments_for_month, all_decisions, month):
    """Everything needed for one project-month: line-level reconciliation, the provisional
    position computable right now from whatever is already resolved, and the fully-resolved
    ("ready to finalize") position, which stays None until every compared line has one.
    """
    lines = {ln: _line_status(code, month, ln, r, all_decisions) for ln in COMPARED}
    lines[SALARY_LINE] = _salary_status(code, month, r, all_decisions)
    rev_adj, cost_adj = _adjustment_totals(adjustments_for_month, code, month)
    formwork_cost = r.get("formwork") or 0.0
    stock_adj = _stock_adjustment(r)

    differing = [ln for ln in COMPARED if not lines[ln]["agrees"]]
    pending = [ln for ln in differing if lines[ln]["decision"] is None]
    cost_pending = [ln for ln in pending if ln in COST_LINES]

    # Salary is cost-side but not in COST_LINES (ERP-vs-mail, not ERP-vs-Tally) - folded into the
    # same differing/pending/cost_pending lists by hand so an unresolved salary line blocks
    # finalization exactly like any other undecided cost line, without ever being counted toward
    # R2/R3's citation-scoped totals or "Total - cost heads".
    if not lines[SALARY_LINE]["agrees"]:
        differing = differing + [SALARY_LINE]
        if lines[SALARY_LINE]["decision"] is None:
            pending = pending + [SALARY_LINE]
            cost_pending = cost_pending + [SALARY_LINE]

    # Provisional: sum whatever cost lines ARE resolved (agreed, or already decided) plus the
    # cost that was never in dispute (formwork, cost-side adjustments, the stock-consumption
    # adjustment) plus salary once IT is resolved. Lines still pending are excluded, not guessed
    # at - "under review" states how much that leaves open.
    resolved_cost_lines = [ln for ln in COST_LINES if lines[ln]["approved"] is not None]
    salary_contribution = lines[SALARY_LINE]["approved"] or 0.0
    mail_cost = formwork_cost + salary_contribution
    provisional_cost = (sum(lines[ln]["approved"] for ln in resolved_cost_lines)
                         + mail_cost + cost_adj + stock_adj)
    under_review = sum(abs(lines[ln]["diff"] or 0) for ln in cost_pending)

    provisional_revenue = None if lines["revenue"]["approved"] is None \
        else lines["revenue"]["approved"] + rev_adj

    tender = C.BY_CODE[code]["value"]
    # Remaining CONTRACT value is against revenue recognised, not cost incurred - those are two
    # different questions ("how much of the award is still unbilled" vs "did we make money on
    # what we did bill"). Tender minus cost was requested, then explicitly corrected.
    remaining_contract = None if provisional_revenue is None else tender - provisional_revenue
    provisional_profit = None if provisional_revenue is None \
        else provisional_revenue - provisional_cost
    provisional_margin = None if not provisional_profit or not provisional_revenue \
        else round(provisional_profit / provisional_revenue * 100, 2)

    fully_resolved = not cost_pending and lines["revenue"]["approved"] is not None
    approved_cost = provisional_cost if fully_resolved else None
    approved_revenue = provisional_revenue if fully_resolved else None
    remaining = remaining_contract if fully_resolved else None
    profit = provisional_profit if fully_resolved else None
    margin = provisional_margin if fully_resolved else None

    return {
        "lines": lines, "differing": differing, "pending": pending, "tenderAmount": tender,
        "mailCost": mail_cost, "stockAdjustment": stock_adj, "underReview": under_review,
        "provisionalRevenue": provisional_revenue, "provisionalCost": provisional_cost,
        "provisionalRemaining": remaining_contract, "provisionalProfit": provisional_profit,
        "provisionalMargin": provisional_margin,
        "approvedRevenue": approved_revenue, "approvedCost": approved_cost,
        "remaining": remaining, "profit": profit, "margin": margin,
        "readyToFinalize": fully_resolved,
    }


def project_position(rows, adjustments):
    """Per project-month: every compared line's reconciliation status and the auditor's
    decision if any, the provisional position computable from whatever is resolved so far, the
    fully-resolved position once every line is decided, and - if this project-month has been
    finalized - the frozen snapshot in place of all of the above, so a closed month cannot move.
    """
    all_decisions = D.load()
    out = {}
    for (code, month), r in rows.items():
        fig = _figures(code, r, adjustments, all_decisions, month)
        frozen = FIN.get(code, month)
        status = status_of(fig["differing"], fig["pending"], frozen is not None)
        if frozen is not None:
            # A closed month reports the snapshot taken at close, not a live recompute - that
            # is the entire point of finalizing. Lines/provisional figures stay live so the
            # screen keeps making sense, but these five never move again without reopening.
            fig = {**fig, "approvedCost": frozen["approvedCost"],
                   "approvedRevenue": frozen["approvedRevenue"], "remaining": frozen["remaining"],
                   "profit": frozen["profit"], "margin": frozen["margin"]}
        out[(code, month)] = {**fig, "status": status, "finalized": frozen}
    return out


def cumulative_position(rows, adjustments):
    """Same figures as project_position, summed across every month in this dataset, per
    project - NOT lifetime spend against the tender (this dataset samples a few months out of
    a longer-running contract), only this sample's total. A project counts as finalized here
    only when every one of its sampled months is.
    """
    all_decisions = D.load()
    by_project = defaultdict(list)
    for (code, month), r in rows.items():
        by_project[code].append((month, r))

    out = {}
    for code, months in by_project.items():
        totals = {"provisionalCost": 0.0, "underReview": 0.0, "mailCost": 0.0}
        differing_all, pending_all = [], []
        revenue_total, revenue_ready = 0.0, True
        cost_ready = True
        finalized_count = 0
        for month, r in months:
            fig = _figures(code, r, adjustments, all_decisions, month)
            frozen = FIN.get(code, month)
            if frozen is not None:
                # This month is closed - its contribution to the cumulative is the frozen
                # figure, not a live recompute, for the same reason project_position freezes it.
                finalized_count += 1
                totals["provisionalCost"] += frozen["approvedCost"]
                totals["mailCost"] += fig["mailCost"]
                revenue_total += frozen["approvedRevenue"]
            else:
                totals["provisionalCost"] += fig["provisionalCost"]
                totals["underReview"] += fig["underReview"]
                totals["mailCost"] += fig["mailCost"]
                if fig["provisionalRevenue"] is None:
                    revenue_ready = False
                else:
                    revenue_total += fig["provisionalRevenue"]
                if not fig["readyToFinalize"]:
                    cost_ready = False
            differing_all += [(month, ln) for ln in fig["differing"]]
            pending_all += [(month, ln) for ln in fig["pending"]]

        tender = C.BY_CODE[code]["value"]
        # Remaining CONTRACT value is against revenue recognised, not cost incurred - same
        # correction as _figures(). See the comment there for why.
        remaining_contract = (tender - revenue_total) if revenue_ready else None
        provisional_profit = (revenue_total - totals["provisionalCost"]) if revenue_ready else None
        provisional_margin = (round(provisional_profit / revenue_total * 100, 2)
                               if provisional_profit and revenue_total else None)

        fully_resolved = cost_ready and revenue_ready
        finalized = finalized_count == len(months)
        status = status_of(differing_all, pending_all, finalized)

        out[code] = {
            "tenderAmount": tender, "monthsSampled": len(months), "pending": pending_all,
            "mailCost": totals["mailCost"], "underReview": totals["underReview"],
            "provisionalRevenue": revenue_total if revenue_ready else None,
            "provisionalCost": totals["provisionalCost"],
            "provisionalRemaining": remaining_contract, "provisionalProfit": provisional_profit,
            "provisionalMargin": provisional_margin,
            "approvedCost": totals["provisionalCost"] if fully_resolved else None,
            "remaining": remaining_contract if fully_resolved else None,
            "profit": provisional_profit if fully_resolved else None,
            "margin": provisional_margin if fully_resolved else None,
            "status": status, "finalizedMonths": finalized_count,
        }
    return out


# ---------------------------------------------------------------------------- percentage of completion
# A real tender-based contractor does not recognise revenue as "whatever was billed this month" -
# it recognises Contract Value x (cost incurred to date / total estimated cost), and this
# month's revenue is the CHANGE in that cumulative figure since last month. That needs a Total
# Estimated Cost per project, which the client has never given us - C.BY_CODE[...]["budget"] is
# an explicit, documented placeholder for it (see config.py), not a confirmed figure.
#
# This is layered entirely on top of project_position()'s own reconciled cost - never a second
# cost calculation, only a different way of recognising revenue against the same cost. R1-R4 and
# consolidate()'s traceable core do not move; this sits exactly where the auditor-decision layer
# already sits, structurally apart from them.
#
# One real limitation, stated plainly rather than hidden: "cost to date" here only ever means
# cost within the months this system has data for (this sample), not the project's full history
# back to its actual start - config.py's own months_run says these projects are already 11-19
# months in, but this system has no source records for any of those earlier months. Cost to
# date is therefore underestimated for every project here, which means % complete - and the
# revenue recognised against it - are both understated too. A real deployment reading a real
# ERP from project inception would not have this gap.


def _poc_month(code, cost_to_date, revenue_to_date_before):
    budget = C.BY_CODE[code]["budget"]
    tender = C.BY_CODE[code]["value"]
    pct_complete = min(1.0, cost_to_date / budget) if budget else None
    revenue_to_date = tender * pct_complete if pct_complete is not None else None
    revenue_this_month = (revenue_to_date - revenue_to_date_before
                           if revenue_to_date is not None else None)
    # A foreseeable loss (budget already exceeds the tender) is recognised in full, immediately -
    # never spread across the remaining months the way earned revenue is. Shown separately, never
    # folded into cost or profit above, for the same reason Remaining Contract Value is kept
    # apart from Profit: two different questions, never one blended figure.
    foreseeable_loss = max(0.0, budget - tender) if budget else 0.0
    return {"budget": budget, "pctComplete": pct_complete, "revenueToDate": revenue_to_date,
            "revenueThisMonth": revenue_this_month, "foreseeableLoss": foreseeable_loss}


def poc_position(position):
    """Percentage-of-completion revenue and profit for every project-month already in
    `position` - processed in calendar order per project, since % complete is inherently
    cumulative and cannot be computed for one month in isolation.
    """
    by_project = defaultdict(list)
    for (code, month), pos in position.items():
        by_project[code].append((month, pos))

    out = {}
    for code, months in by_project.items():
        months.sort(key=lambda m: m[0])
        cost_to_date = 0.0
        revenue_to_date = 0.0
        for month, pos in months:
            # The same "best available" cost every other screen already uses: the frozen figure
            # once finalized, the resolved-so-far figure otherwise. Never a second cost figure.
            month_cost = pos["approvedCost"] if pos["approvedCost"] is not None else pos["provisionalCost"]
            cost_to_date += month_cost
            fig = _poc_month(code, cost_to_date, revenue_to_date)
            revenue_to_date = fig["revenueToDate"] if fig["revenueToDate"] is not None else revenue_to_date
            profit = (fig["revenueThisMonth"] - month_cost
                      if fig["revenueThisMonth"] is not None else None)
            margin = (round(profit / fig["revenueThisMonth"] * 100, 2)
                      if profit and fig["revenueThisMonth"] else None)
            out[(code, month)] = {**fig, "costToDate": cost_to_date, "monthCost": month_cost,
                                   "profit": profit, "margin": margin}
    return out


def snapshot_for_finalization(rows, adjustments, project, month):
    """The exact figures to freeze for one project-month. Refuses if it is not actually
    resolved yet - service.finalize_month checks status first, but this is the last line of
    defense against freezing a month that still has an open line.
    """
    all_decisions = D.load()
    r = rows[(project, month)]
    fig = _figures(project, r, adjustments, all_decisions, month)
    if not fig["readyToFinalize"]:
        raise ValueError("Every line must be resolved before this month can be finalized.")
    return {"approvedCost": fig["approvedCost"], "approvedRevenue": fig["approvedRevenue"],
            "remaining": fig["remaining"], "profit": fig["profit"], "margin": fig["margin"],
            "decisions": {ln: fig["lines"][ln]["decision"] for ln in COMPARED
                          if fig["lines"][ln]["decision"]}}


# ---------------------------------------------------------------------------- driver

def build(vouchers):
    fired = Fired()

    items, unroutable = IB.read_all()
    chosen, superseded = IB.latest(items)
    stock, adjustments, headline = returns_received(chosen, superseded, fired)

    t_totals, unattributed, t_detail = tally_totals(vouchers, fired)
    e_totals, e_detail = erp.extract()

    comparisons = compare(e_totals, t_totals, fired)
    comps = composition_notes(e_detail, t_detail)
    rows = consolidate(e_totals, t_totals, stock, adjustments, headline, chosen)
    todo = outstanding(rows, comparisons, unattributed, superseded, unroutable)
    position = project_position(rows, adjustments)
    cumulative = cumulative_position(rows, adjustments)
    poc = poc_position(position)

    return {"rows": rows, "comparisons": comparisons, "composition": comps,
            "unattributed": unattributed, "outstanding": todo,
            "superseded": superseded, "unroutable": unroutable, "fired": fired,
            "inbox": items, "chosen": chosen, "adjustments": adjustments,
            "stock": stock, "headline": headline,
            "erp_detail": e_detail, "tally_detail": t_detail,
            "erp_totals": e_totals, "tally_totals": t_totals,
            "position": position, "cumulative": cumulative, "poc": poc}
