"""One command.

    python -m backend.app.core._cli --generate   build the dataset, push to Tally, export
    python -m backend.app.core._cli              re-read the sources and rebuild the export
    python -m backend.app.core._cli --offline    read the saved Tally extract instead
    python -m backend.app.core._cli --selftest   checks that need no systems

Exits non-zero if the figures stop matching what the sources state.
"""
import argparse
import datetime as dt
import json
import os
import sys

from . import config as C


def _load(offline):
    from . import tally_io as T
    if not offline and T.available():
        vs = T.fetch_vouchers(*T.WINDOW)
        if vs:
            return vs, f"live Tally ({C.TALLY_COMPANY})"
        print("! Tally is up but holds none of our vouchers - using the saved extract")
    elif not offline:
        print(f"! Tally unreachable at {C.TALLY_URL} - using the saved extract")
    if not os.path.exists(C.TALLY_SNAPSHOT):
        sys.exit("No Tally data and no saved extract. Run with --generate first.")
    with open(C.TALLY_SNAPSHOT, encoding="utf-8") as f:
        return json.load(f), "saved Tally extract"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--generate", action="store_true", help="rebuild all three sources first")
    ap.add_argument("--offline", action="store_true", help="read the saved Tally extract")
    ap.add_argument("--no-tally", action="store_true",
                    help="with --generate: build the sources but do not push to Tally")
    ap.add_argument("--as-of", default=None, help="YYYY-MM-DD, defaults to today")
    a = ap.parse_args(argv)

    from . import fabricate
    from . import outcome
    from . import tracker
    from . import workbook

    if a.generate:
        print("== building sources ==")
        fabricate.run(push_tally=not a.no_tally)
        print()

    if not os.path.exists(C.ERP_DB):
        sys.exit(f"No ERP database at {C.ERP_DB}. Run with --generate first.")

    vouchers, source = _load(a.offline or a.no_tally)
    print("== reading ==")
    print(f"Tally    : {len(vouchers)} vouchers from {source}")

    res = outcome.build(vouchers)
    print(f"ERP      : {len(res['erp_detail'])} module rows")
    print(f"Returns  : {len(res['inbox'])} received, {len(res['unroutable'])} unroutable")

    as_of = dt.date.fromisoformat(a.as_of) if a.as_of else dt.date.today()
    t_rows = tracker.status(res["chosen"], as_of=as_of)
    t_sum = tracker.summary(t_rows)
    print(f"\n== returns (as at {as_of:%d-%b-%Y}) ==")
    print(f"expected {t_sum['expected']}  on time {t_sum['on_time']}  late {t_sum['late']}  "
          f"never arrived {t_sum['missing']}  worst {t_sum['worst_delay']}d")
    for who, what in t_sum["chronic"].items():
        print(f"  late {len(what)}x: {who}")

    print("\n== ERP against Tally ==")
    agree = sum(1 for c in res["comparisons"] if c["verdict"] == "agree")
    differ = [c for c in res["comparisons"] if c["verdict"] == "differs"]
    print(f"{len(res['comparisons'])} cost heads compared: {agree} agree, {len(differ)} differ")
    for c in differ:
        print(f"  DIFFERS  {C.BY_CODE[c['project']]['tally']} {C.month_label(c['month'])} "
              f"{C.LINE_LABEL.get(c['line'], c['line'])}: "
              f"ERP {C.rupees(c['erp'])} vs Tally {C.rupees(c['tally'])}")

    print("\n== not attributed to any project ==")
    tot = sum(u["amount"] for u in res["unattributed"])
    print(f"{len(res['unattributed'])} lines, {C.rupees(tot)} - reported, not apportioned")

    print("\n== needs a person ==")
    by_kind = {}
    for t in res["outstanding"]:
        by_kind[t["kind"]] = by_kind.get(t["kind"], 0) + 1
    print("  " + ("  ".join(f"{k}: {n}" for k, n in sorted(by_kind.items()))
                  or "nothing outstanding"))

    print("\n== rules applied ==")
    for rid, desc, origin, basis in outcome.RULES:
        print(f"  {rid}  {res['fired'].get(rid, 0):5d}  {desc}")

    with open(C.GROUND_TRUTH, encoding="utf-8") as f:
        gt = json.load(f)
    chk = outcome.check(res["rows"], res["comparisons"], res["unattributed"], gt)
    path = workbook.write(res, chk, t_rows, t_sum,
                          meta={"ranAt": dt.datetime.now().isoformat()})
    print("\n== read check ==")
    print(f"{chk['checks']} figures against what the sources state, largest difference "
          f"Rs {C.rupees(chk['worst'])}: {'faithful' if chk['passed'] else 'MISREAD'}")
    for f_ in chk["failed"][:10]:
        print("   ", f_)
    print(f"\nexport: {path}")
    return 0 if chk["passed"] else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        from . import selftest
        sys.exit(selftest.run())
    sys.exit(main())
