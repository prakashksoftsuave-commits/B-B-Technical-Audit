"""Checks that need no systems at all.

Assert statements and one function - not a framework. Each one guards something that would
silently produce a wrong figure rather than crash.

Several tests that used to live here are gone with the rules they covered: overhead
apportionment, revenue recognition, material consumption and preferring one source over the
other. Nothing computes those any more.

    python -m backend.app.core.selftest
"""
import datetime as dt

from . import config as C
from . import outcome as O


def t_project_resolution():
    """R1. The aliases exist because real subject lines use site shorthand."""
    assert C.resolve_project("Riverside Towers - Manapakkam")["code"] == "PRJ-1041"
    assert C.resolve_project("RVT-1041")["code"] == "PRJ-1041"
    assert C.resolve_project("Work done report - Riverside - Jun 2026")["code"] == "PRJ-1041"
    assert C.resolve_project("Formwork report - ORR - Jul 2026")["code"] == "PRJ-1063"
    # Longest match wins: the full name must beat a shorter alias it contains
    assert C.resolve_project("Tidel Park Block C - Taramani")["code"] == "PRJ-1052"
    assert C.resolve_project("Site consumables - allocation pending") is None
    assert C.resolve_project("") is None
    assert C.resolve_project(None) is None


def t_rupees():
    assert C.rupees(0) == "0"
    assert C.rupees(999) == "999"
    assert C.rupees(1234) == "1,234"
    assert C.rupees(12345678) == "1,23,45,678"
    assert C.rupees(-45000) == "-45,000"


def t_strip_tag():
    """The dataset marker must never reach a screen or a sheet."""
    assert C.strip_tag(f"Cement - Riverside {C.VOUCHER_TAG}") == "Cement - Riverside"
    assert C.strip_tag(None) == ""
    assert C.VOUCHER_TAG not in C.strip_tag(f"a {C.VOUCHER_TAG} b {C.VOUCHER_TAG}")


def t_calendar():
    """The audit team starts preparing on the 25th of the following month (user-given business
    rule); contributors are given a cut-off ten days earlier. `due_date` still clamps to the
    shorter month, kept as a safety net even though the 25th never needs it."""
    assert C.due_date("2026-05") == dt.date(2026, 6, 25)
    assert C.due_date("2026-06") == dt.date(2026, 7, 25)
    assert C.due_date("2026-07") == dt.date(2026, 8, 25)
    assert C.cutoff_date("2026-07") == dt.date(2026, 8, 15)
    assert (C.due_date("2026-07") - C.cutoff_date("2026-07")).days == C.CUTOFF_LEAD_DAYS


def t_tally_bucketing():
    """Sign handling, and that a cost with no cost centre is REPORTED, never guessed at.

    Debits are negative in Tally's XML; a cost is a positive number in the output. Getting
    that backwards would flip every figure and still look plausible.
    """
    fired = O.Fired()
    cc = C.PROJECTS[0]["tally"]
    vouchers = [
        {"date": "20260501", "number": "V1", "vtype": "Sales", "party": "x",
         "narration": "RA bill",
         "lines": [{"ledger": "Contract Revenue", "amount": 1_00_000, "cost_centre": cc}]},
        {"date": "20260501", "number": "V2", "vtype": "Purchase", "party": "y",
         "narration": f"cement - {cc}",
         "lines": [{"ledger": "Material Purchase - Cement", "amount": -40_000,
                    "cost_centre": cc}]},
        # no cost centre, project named in the narration -> still NOT attributed
        {"date": "20260501", "number": "V3", "vtype": "Purchase", "party": "z",
         "narration": "Steel received at Riverside site",
         "lines": [{"ledger": "Material Purchase - Steel", "amount": -10_000,
                    "cost_centre": None}]},
        # head office: no cost centre, and none invented
        {"date": "20260501", "number": "V4", "vtype": "Journal", "party": "z",
         "narration": "HO salaries",
         "lines": [{"ledger": "HO Salaries", "amount": -20_000, "cost_centre": None}]},
        # a ledger outside the map is ignored, not guessed at
        {"date": "20260501", "number": "V5", "vtype": "Journal", "party": "z",
         "narration": "tax",
         "lines": [{"ledger": "Output CGST", "amount": -900, "cost_centre": None}]},
    ]
    totals, unattributed, detail = O.tally_totals(vouchers, fired)
    code = C.PROJECTS[0]["code"]

    assert totals[(code, "2026-05", "revenue")] == 1_00_000
    assert totals[(code, "2026-05", "material")] == 40_000, "a debit must become a +cost"
    # the narration names a project, but nothing here may act on that
    assert (code, "2026-05", "material") in totals
    assert totals[(code, "2026-05", "material")] == 40_000, "V3 must not have been folded in"
    amounts = sorted(u["amount"] for u in unattributed)
    assert amounts == [10_000, 20_000], f"expected both unattributed lines, got {amounts}"
    assert all(u["reason"] for u in unattributed)
    assert not any(d["ledger"] == "Output CGST" for d in detail)


def t_compare_two_verdicts_only():
    """R2 and R3. Agree or differ. A difference is never explained away."""
    fired = O.Fired()
    code = C.PROJECTS[0]["code"]
    month = C.MONTHS[0][0]
    other = C.MONTHS[1][0]
    erp = {(code, month, "material"): 5_00_000,
           (code, month, "subcon"): 3_00_000}
    tally = {(code, month, "material"): 5_00_300,       # inside tolerance
             (code, month, "subcon"): 2_10_000,         # differs
             (code, other, "subcon"): 90_000}           # the gap, next month - irrelevant
    rows = {(r["project"], r["month"], r["line"]): r
            for r in O.compare(erp, tally, fired)}

    assert rows[(code, month, "material")]["verdict"] == "agree"
    sub = rows[(code, month, "subcon")]
    assert sub["verdict"] == "differs", "must not be netted off against another month"
    assert sub["owner"], "a difference must name someone"
    assert set(r["verdict"] for r in rows.values()) <= {"agree", "differs"}


def t_consolidate_derives_nothing():
    """The consolidation must not invent a figure from other figures."""
    code = C.PROJECTS[0]["code"]
    month = C.MONTHS[0][0]
    erp = {(code, month, "material"): 5_00_000}
    tally = {(code, month, "revenue"): 10_00_000,
             (code, month, "material"): 4_00_000}
    rows = O.consolidate(erp, tally, {}, {}, {}, {})
    r = rows[(code, month)]

    assert r["erp"]["material"] == 5_00_000
    assert r["tally"]["material"] == 4_00_000
    assert r["tally_revenue"] == 10_00_000
    # no stock return arrived, so there is no stock figure - and nothing stands in for it
    assert r["opening"] is None and r["closing"] is None
    for banned in ("profit", "margin", "cost", "material", "ho_alloc", "revenue"):
        assert banned not in r, f"{banned} is a derived figure and must not exist"
    assert "stock" in r["returns_missing"] and "work_done" in r["returns_missing"]


def t_outstanding_names_an_owner():
    """Every open item has to be actionable by someone."""
    code = C.PROJECTS[0]["code"]
    month = C.MONTHS[0][0]
    rows = O.consolidate({}, {}, {}, {}, {}, {})
    compare_rows = [{"project": code, "month": month, "line": "subcon",
                     "erp": 3_00_000, "tally": 2_00_000, "diff": 1_00_000,
                     "verdict": "differs", "owner": "Technical Audit"}]
    unattributed = [{"month": month, "ledger": "HO Salaries", "amount": 20_000,
                     "narration": "HO salaries", "reason": "head office cost"}]
    todo = O.outstanding(rows, compare_rows, unattributed, [], [])

    assert todo, "there is work outstanding and it must be listed"
    assert all(t["owner"] for t in todo), "an item with no owner cannot be actioned"
    kinds = {t["kind"] for t in todo}
    assert "attribute" in kinds and "decide" in kinds and "chase" in kinds


def t_check_catches_drift():
    """The check has to fail when a figure is misread, or it is decoration."""
    code, month = C.PROJECTS[0]["code"], C.MONTHS[0][0]
    truth = {"sources": {code: {month: {"tally_revenue": 100, "erp_material": 50,
                                        "tally_material": 50, "opening": 10,
                                        "closing": 20}}},
             "unattributed_total": 0}
    good = O.consolidate({(code, month, "material"): 50},
                         {(code, month, "revenue"): 100,
                          (code, month, "material"): 50},
                         {(code, month): {"opening": 10, "closing": 20}}, {}, {}, {})
    r = O.check(good, [], [], truth)
    assert r["passed"], f"a faithful read must pass: {r['failed']}"

    bad = O.consolidate({(code, month, "material"): 50 + 5_000},
                        {(code, month, "revenue"): 100,
                         (code, month, "material"): 50},
                        {(code, month): {"opening": 10, "closing": 20}}, {}, {}, {})
    r = O.check(bad, [], [], truth)
    assert not r["passed"] and r["worst"] == 5_000
    # a missing row must fail rather than pass silently
    assert O.check({}, [], [], truth)["failed"]
    # so must a partly swallowed unattributed pool
    r = O.check(good, [], [{"amount": 9_999}], truth)
    assert not r["passed"]


def t_restatement_is_reported_not_adopted():
    """A later return wins for display, but the earlier one is handed back, never dropped."""
    from . import inbox as IB
    a = {"project": "P", "month": "M", "kind": "stock", "arrived": dt.date(2026, 8, 20),
         "revised": False, "subject": "first"}
    b = {"project": "P", "month": "M", "kind": "stock", "arrived": dt.date(2026, 8, 22),
         "revised": True, "subject": "REVISED"}
    for order in ([a, b], [b, a]):
        chosen, superseded = IB.latest(order)
        assert chosen[("P", "M", "stock")]["subject"] == "REVISED"
        assert len(superseded) == 1 and superseded[0]["subject"] == "first"


def t_pending_becomes_overdue_at_cutoff():
    """A return not yet due is PENDING, not MISSING - the automatic Pending -> Overdue rule
    the division's process needs. Same slot, nothing ever arrives; only `as_of` moves across
    its cut-off."""
    from . import tracker as T
    month = C.MONTHS[0][0]
    kind = C.INPUTS[0][0]
    cut = C.cutoff_date(month)

    def row(as_of):
        rows = T.status({}, as_of=as_of)
        return next(r for r in rows if r["month"] == month and r["kind"] == kind)

    assert row(cut - dt.timedelta(days=1))["status"] == T.PENDING
    assert row(cut)["status"] == T.MISSING, "due today already counts as overdue"
    assert row(cut + dt.timedelta(days=1))["status"] == T.MISSING

    # a pending item is not yet a problem - it must never reach the chase list
    still_pending = T.status({}, as_of=cut - dt.timedelta(days=1))
    notices = T.outstanding_notices(still_pending, month)
    assert not any(n["label"] == C.INPUT_LABEL[kind] for n in notices)


def t_rules_are_all_traceable():
    """Every rule left in the run must trace to something the division actually said."""
    assert len(O.RULES) == 4, "a rule was added without a basis"
    for rid, desc, origin, basis in O.RULES:
        assert origin == "asked for", f"{rid} is not something the division asked for"
        assert "(" in basis and ")" in basis, f"{rid} cites no source"


TESTS = [t_project_resolution, t_rupees, t_strip_tag, t_calendar, t_tally_bucketing,
         t_compare_two_verdicts_only, t_consolidate_derives_nothing,
         t_outstanding_names_an_owner, t_check_catches_drift,
         t_restatement_is_reported_not_adopted, t_pending_becomes_overdue_at_cutoff,
         t_rules_are_all_traceable]


def run():
    failed = 0
    for t in TESTS:
        try:
            t()
            print(f"  ok    {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL  {t.__name__}: {e}")
        except Exception as e:
            failed += 1
            print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(TESTS) - failed}/{len(TESTS)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(run())
