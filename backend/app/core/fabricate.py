r"""Builds the demo dataset: Tally vouchers, the ERP database and the mailbox of site returns.

`ground_truth.json` records what each source will SAY - Tally per ledger group, the ERP per
module, the site returns as sent. It is derived here by summing the rows actually generated,
and is read only by outcome.check(). So it verifies that the pipeline reads its sources
faithfully; it makes no claim about the business, because this project no longer computes
anything about the business.

Figures are modelled on a mid-size Tamil Nadu contractor: six live projects, material around
half of cost, and a monthly head-office pool that is deliberately NOT booked against any
project - because in real books it is not, and the division has never said how they apportion
it. Amounts are jittered deterministically, so they are not round and do not change run to run.

WHAT IS DELIBERATELY INCONSISTENT, AND WHAT THE RUN DOES WITH IT
---------------------------------------------------------------
Spread across projects and months, because that is how real books look. None of it is resolved
by the run: each is reported, and a person decides.

  Tally against the ERP
    three receipts reach Tally a month after the ERP recorded them
    three subcontractor bills keyed wrongly - two digit-transposed, one short-keyed
    one cost booked against the wrong project, so one reads high and another low
    two site establishment bills entered twice
    four purchases posted with no cost centre
    one voucher with no cost centre and nothing in the narration either
    the head-office pool, booked against no project at all
    plant kept as one WBM line but split across two Tally ledgers - same total, different shape
    revenue always agrees - the ERP's REV module is a POC addition with no client-described
    discrepancy to model, so it mirrors Tally exactly (see erp.py's module docstring)

  The site returns
    every site has its own promptness, from four days early to five days late, and stock is the
    perennial laggard because it needs a physical count
    three returns never arrive - one already filled in live during an earlier demo, two more
    (different projects, different return types) held back for the actual demo
    one closing stock arrives understated and is corrected later - both versions are kept
    subjects use site shorthand, never the cost centre name
    one site's own salary count understates HR's payroll register (HRM) for one month - the one
    ERP-vs-MAIL reconciliation in this dataset, not ERP-vs-Tally (see SALARY_MISMATCH)

Adjustments arriving by mail from the audit lead - unbilled work, quantity savings, a rate
never fixed - are listed, not applied to anything.
"""
import datetime as dt
import io
import json
import os
import random
import shutil
from collections import defaultdict
from email.message import EmailMessage
from email.utils import format_datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

from . import config as C
from . import erp
from . import tally_io as T

# ------------------------------------------------------------------ the model
# `margin` is only a device for generating plausible cost levels against a revenue. Nothing
# downstream computes or reports a margin.
PROFILE = {
    "PRJ-1041": dict(revenue=2_38_00_000, margin=0.090),
    "PRJ-1052": dict(revenue=3_16_00_000, margin=0.112),
    "PRJ-1063": dict(revenue=4_05_00_000, margin=0.048),
}
MIX = {"material": 0.500, "subcon": 0.300, "machinery": 0.130, "site": 0.070}
HO_SHARE = 0.035

MATERIALS = [
    ("Cement OPC 53 grade", "Sri Balaji Cements", "Material Purchase - Cement", "MT", 5_420,
     "25231000", 0.30),
    ("TMT bar Fe500D", "Deccan Steel Traders", "Material Purchase - Steel", "MT", 62_800,
     "72142000", 0.30),
    ("M-sand and 20mm jelly", "Kaveri Aggregates and Minerals",
     "Material Purchase - Aggregate", "cum", 1_285, "25171010", 0.14),
    ("RMC M30 pumped", "UltraTech RMC - Chennai South", "Material Purchase - RMC", "cum",
     6_240, "38245010", 0.18),
    ("Shuttering ply and props", "Coromandel Formwork Systems",
     "Material Purchase - Formwork", "sqm", 745, "44123900", 0.08),
]


def _split(total, items):
    """Split `total` across (name, ledger, share) items by share, rounded to the nearest 100
    the same way every other split in this file is - the last item pinned to the exact
    remainder so the pieces always sum to `round(total)`, never drift from it."""
    out, running = [], 0
    for i, (name, ledger, share) in enumerate(items):
        if i == len(items) - 1:
            amt = round(total) - running
        else:
            amt = round(total * share / 100) * 100
            running += amt
        out.append((name, ledger, amt))
    return out


# Each cost head used to post as one lump sum - technically correct, but nothing for an auditor
# to actually read when they expand it. Split into named trades/equipment/expenses instead, same
# total, same reconciliation, just shaped like a real monthly close. Shares sum to 100.
SUBCON_ITEMS = [
    ("Civil and RCC works", "Subcontractor Charges", 0.45),
    ("Labour supply - skilled and unskilled", "Labour Charges", 0.30),
    ("Shuttering and formwork labour", "Shuttering and Formwork Labour", 0.15),
    ("Steel fixing and bar bending", "Steel Fixing and Bar Bending", 0.10),
]
MACHINERY_ITEMS = [
    ("Excavator and loader hire", "Machinery Hire - Excavator/Loader", 0.40),
    ("Concrete pump hire", "Machinery Hire - Concrete Pump", 0.35),
    ("Tower crane hire", "Machinery Hire - Tower Crane", 0.25),
]
# The FBA carry-forward (FBA_CARRY_SHARE) still applies to the combined depreciable total before
# this split - only the LOCAL, non-carried portion is broken into named assets here.
SITE_ITEMS = [
    ("Site office, stores and shuttering", "Site Establishment", 0.55),
    ("Site security and watch and ward", "Site Security and Watch and Ward", 0.25),
    ("Staff welfare and safety", "Staff Welfare and Safety", 0.20),
]
# Site staff salary, split by worker category instead of one payroll lump sum - "for whom, how
# much" against outcome._salary_status's ERP-vs-mail reconciliation. Applied to the true (HRM)
# figure and, separately, to whatever the site's own mail states (SALARY_MISMATCH already
# applied to that total before this split runs) - same shares either side, since a role
# breakdown is just how the one total is read, not a second figure. Names come from
# config.SALARY_ROLES - the one canonical list service.py's lineage reads back out of the mail
# attachment, so a name typo here can't silently break that trace.
SALARY_ITEMS = list(zip(C.SALARY_ROLES, [None] * 4, [0.35, 0.30, 0.20, 0.15]))
# Revenue, split by work category on both ERP and Tally - same three categories the site's own
# Work done report claims (config.WORK_CATEGORIES), so an auditor can compare what was billed
# against what the site says was done, category for category, not just as one lump figure.
REVENUE_ITEMS = list(zip(C.WORK_CATEGORIES, [None] * 3, [0.55, 0.30, 0.15]))
# Opening/closing stock, split by material - reuses MATERIALS' own consumption shares as a
# reasonable stand-in for stock composition too. config.STOCK_MATERIALS is the canonical name
# list service.py's lineage reads back out of the mail attachment.
STOCK_ITEMS = list(zip(C.STOCK_MATERIALS, [None] * 5, [0.30, 0.30, 0.14, 0.18, 0.08]))
# Formwork hire, split by structural element instead of one lump recovery figure.
FORMWORK_ITEMS = list(zip(C.FORMWORK_CATEGORIES, [None] * 3, [0.50, 0.30, 0.20]))

# ---------------------------------------------------------------- Tally inconsistencies
# Three projects, each carrying more than one story so no single month looks like the demo's
# only example of a difference - a real close never has just one line off:
#   Riverside - purchases with no cost centre (May, Jul), a duplicated site bill (Jul), a
#               keyed-wrong bill (Aug)
#   Tidel     - a late booking (Jul) and a keyed-wrong bill (Jun)
#   ORR       - a misposted cost (May), a duplicated site bill (Jun), a keyed-wrong bill (Jul)
# None of these is resolved by the run - each is reported and a person decides.

# Receipts that reach Tally in the month AFTER the ERP recorded them.
LATE_BOOKINGS = [
    ("PRJ-1052", "2026-07", 6_84_000),
]
# Subcontractor bills keyed wrongly: (project, month, true value, as keyed in Tally)
KEYING_ERRORS = [
    ("PRJ-1052", "2026-06", 8_16_000, 6_18_000),    # digits transposed
    ("PRJ-1063", "2026-07", 9_84_000, 7_86_000),    # short-keyed
    ("PRJ-1041", "2026-08", 5_16_000, 5_61_000),    # digits transposed - Riverside's turn
]
# Site staff salary: ERP's payroll register (HRM) against the site's own mailed figure - a
# reconciliation of its own, added later (see CLAUDE.md's "Decided: site staff salary becomes a
# real ERP-vs-mail reconciliation"). Fraction of the true HRM figure the site's own mail
# understates for one project-month, standing in for a wage revision HR had already applied but
# the site's own headcount count had not yet caught up with.
SALARY_MISMATCH = {("PRJ-1052", "2026-08"): 0.91}
# Purchases posted with no cost centre: (project, month, material index)
NO_COST_CENTRE = [
    ("PRJ-1041", "2026-05", 1),
    ("PRJ-1041", "2026-07", 3),
]
# A cost booked against the WRONG project: (whose cost, whose cost centre, month, amount).
# One project reads high and another low - the kind of error a manual comparison finds late.
MISPOSTED = ("PRJ-1063", "PRJ-1052", "2026-05", 3_68_000)
# The same site establishment bill entered twice: (project, month, amount).
DUPLICATES = [
    ("PRJ-1063", "2026-06", 1_84_000),
    ("PRJ-1041", "2026-07", 1_26_000),
]
# A voucher with no cost centre and nothing in the narration to go on.
NO_HINT = ("2026-07", 2_34_500)
FUEL_SHARE = 0.28

# A depreciable asset is depreciated inside the project it was bought for; whatever share is
# not depreciated there carries to the next project the company takes on [BRD sec 5]. Modelled
# as a fixed share of the monthly site-establishment charge, booked onto the next project's FBA
# for the same month. ORR is last in this sequence and has nowhere to carry to, so it keeps
# depreciating its full charge locally, same as if the rule did not apply. Tally never learns of
# the carry - it always books the full site-establishment amount to whichever project incurred
# it - so this is a real ERP-vs-Tally difference on the site line for the two carrying projects,
# not a synthetic one layered on top.
FBA_CARRY_SHARE = 0.15
FBA_NEXT_PROJECT = {"PRJ-1041": "PRJ-1052", "PRJ-1052": "PRJ-1063"}

# ---------------------------------------------------------------- returns discipline
# How promptly each site sends paperwork, in days relative to the contributor cut-off:
# negative is early, positive is late. Real sites are not uniformly good or bad.
SITE_DISCIPLINE = {
    "PRJ-1041": -5,    # Riverside - established, well staffed
    "PRJ-1052": -2,    # Tidel - well run, occasionally late
    "PRJ-1063": +3,    # ORR flyover - large and remote
}
# Some returns are simply harder to produce than others. Stock needs a physical count, so it
# is the perennial laggard; a work-done figure is already on the QS's desk.
KIND_DISCIPLINE = {
    "work_done": -3, "ra_bill": -2, "stock": +3,
    "formwork": -1, "hr_salary": -2, "adjustment": -2,
}
# Returns that never arrive at all.
NEVER_ARRIVED = {
    ("PRJ-1063", "2026-07", "formwork"),      # the live-send beat (already demonstrated)
    ("PRJ-1063", "2026-08", "ra_bill"),       # first live-send beat for the actual demo
    ("PRJ-1052", "2026-08", "formwork"),      # second live-send beat for the actual demo
}
# The first mail understates closing stock; a later one corrects it.
RESTATED = ("PRJ-1052", "2026-07", 2_35_000)

ADJUSTMENTS = {
    ("PRJ-1041", "2026-06"): [
        ("revenue_accrued", "Tower B podium slab cast, RA bill not raised", 18_40_000)],
    ("PRJ-1052", "2026-05"): [
        ("cost_saving", "Steel reconciliation - offcut recovery credited", -3_62_000)],
    ("PRJ-1063", "2026-07"): [
        ("provisional", "Crawler crane - rate not fixed, no advance released", 5_15_000),
        ("revenue_accrued", "Approach road complete, certification pending", 12_80_000)],
}


def _jitter(parts, spread):
    r = random.Random("|".join(str(p) for p in parts))
    return 1.0 + r.uniform(-spread, spread)


def post_day(month_key, i):
    days = C.POST_DAYS[month_key]
    return f"{month_key[:4]}{month_key[5:7]}{days[i % len(days)]}"


def _tag(text):
    return f"{text} {C.VOUCHER_TAG}"


def arrival(code, month, kind, cut):
    """When a return actually turns up.

    Site discipline plus return-type difficulty plus a deterministic wobble, so lateness is
    spread the way it is in practice - most returns roughly on time, some sites persistently
    behind, stock worst of all - rather than one site being late and everything else perfect.
    """
    site = SITE_DISCIPLINE[code]
    r = random.Random(f"{code}|{month}|{kind}|arrival")
    return cut + dt.timedelta(days=site + KIND_DISCIPLINE[kind] + r.randint(-2, 3))


# ------------------------------------------------------------------ underlying figures

def reality():
    """The site-level figures every source is generated from. Never published as an answer."""
    months = [m for m, *_ in C.MONTHS]
    revenue = {}
    for code, prof in PROFILE.items():
        for mk in months:
            revenue[(code, mk)] = round(
                prof["revenue"] * _jitter([code, mk, "rev"], 0.075) / 1000) * 1000
    group = {mk: sum(v for (c, m), v in revenue.items() if m == mk) for mk in months}
    ho_pool = {mk: round(group[mk] * HO_SHARE / 1000) * 1000 for mk in months}

    out, closing_prev = {}, {}
    for code, prof in PROFILE.items():
        out[code] = {}
        for mk in months:
            rev = revenue[(code, mk)]
            ho = round(ho_pool[mk] * rev / group[mk])
            direct = rev * (1 - prof["margin"]) - ho
            parts = {k: round(direct * sh * _jitter([code, mk, k], 0.05) / 100) * 100
                     for k, sh in MIX.items()}
            consumed = parts["material"]
            closing = round(consumed * 0.14 * _jitter([code, mk, "stk"], 0.18) / 1000) * 1000
            opening = closing_prev.get(code, round(consumed * 0.13 / 1000) * 1000)
            closing_prev[code] = closing
            out[code][mk] = dict(
                revenue=rev, purchases=consumed + closing - opening,
                opening=opening, closing=closing, **parts)
    return out, ho_pool


# ------------------------------------------------------------------ Tally

def build_vouchers(real, ho_pool):
    vs, n = [], [0]

    def vch(date, vtype, party, narration, lines):
        n[0] += 1
        vs.append(dict(date=date, vtype=vtype, number=f"TA{n[0]:05d}", party=party,
                       narration=_tag(narration), lines=lines))

    for code in PROFILE:
        p = C.BY_CODE[code]
        cc = p["tally"]
        for mi, mk in enumerate(m for m, *_ in C.MONTHS):
            g = real[code][mk]

            for j, (name, _l, amt) in enumerate(_split(g["revenue"], REVENUE_ITEMS)):
                vch(post_day(mk, j), "Sales", p["client"],
                    f"RA bill {C.month_label(mk)} - {name} - {cc}",
                    [{"ledger": p["client"], "amount": -amt, "cost_centre": None},
                     {"ledger": "Contract Revenue", "amount": amt, "cost_centre": cc}])

            lag = next((amt for pc, m, amt in LATE_BOOKINGS
                        if (pc, m) == (code, mk)), 0)
            here = g["purchases"] - lag
            for i, (mat, vendor, ledger, uom, rate, hsn, share) in enumerate(MATERIALS):
                amt = round(here * share / 100) * 100
                if amt <= 0:
                    continue
                drop = (code, mk, i) in NO_COST_CENTRE
                vch(post_day(mk, i), "Purchase", vendor,
                    f"{mat} received at {p['aliases'][0]} site" if drop
                    else f"{mat} - {cc}",
                    [{"ledger": ledger, "amount": -amt,
                      "cost_centre": None if drop else cc},
                     {"ledger": vendor, "amount": amt, "cost_centre": None}])
            if lag:
                nm = C.NEXT_MONTH[0]
                vch(post_day(nm, 1), "Purchase", MATERIALS[3][1],
                    f"{MATERIALS[3][0]} - {cc} - {C.month_label(mk)} receipt booked late",
                    [{"ledger": MATERIALS[3][2], "amount": -lag, "cost_centre": cc},
                     {"ledger": MATERIALS[3][1], "amount": lag, "cost_centre": None}])

            sub = g["subcon"]
            # part of this project's subcontract cost was booked to another project's cost
            # centre, so its own vouchers are short by that amount
            if (code, mk) == (MISPOSTED[0], MISPOSTED[2]):
                sub -= MISPOSTED[3]
            keyed = next(((true, wrong) for pc, m, true, wrong in KEYING_ERRORS
                          if (pc, m) == (code, mk)), None)
            if keyed:
                # The keying error is a fact about these two lines specifically - left as a
                # plain two-way split so the hardcoded true/wrong figures above stay exactly
                # right; everywhere else, subcontractor cost is split into several named trades.
                true_amt, wrong_amt = keyed
                pairs = [("Subcontractor running bill", "Subcontractor Charges", wrong_amt,
                          C.SUBCON_NAMES[0]),
                         ("Labour charges", "Labour Charges", sub - true_amt, C.SUBCON_NAMES[1])]
            else:
                pairs = [(name, ledger, amt, C.SUBCON_NAMES[(mi + i) % 4])
                         for i, (name, ledger, amt) in enumerate(_split(sub, SUBCON_ITEMS))]
            for j, (desc, ledger, amt, party) in enumerate(pairs):
                vch(post_day(mk, j), "Journal", party, f"{desc} - {cc}",
                    [{"ledger": ledger, "amount": -amt, "cost_centre": cc},
                     {"ledger": party, "amount": amt, "cost_centre": None}])

            mach = g["machinery"]
            fuel = round(mach * FUEL_SHARE / 100) * 100
            for j, (desc, ledger, amt) in enumerate(_split(mach - fuel, MACHINERY_ITEMS)):
                vch(post_day(mk, j), "Journal", "Cash", f"{desc} - {cc}",
                    [{"ledger": ledger, "amount": -amt, "cost_centre": cc},
                     {"ledger": "Cash", "amount": amt, "cost_centre": None}])
            vch(post_day(mk, 1), "Payment", "Cash", f"Diesel and lubricants - {cc}",
                [{"ledger": "Fuel and Lubricants", "amount": -fuel, "cost_centre": cc},
                 {"ledger": "Cash", "amount": fuel, "cost_centre": None}])

            for j, (desc, ledger, amt) in enumerate(_split(g["site"], SITE_ITEMS)):
                vch(post_day(mk, j), "Journal", "Cash", f"{desc} - {cc}",
                    [{"ledger": ledger, "amount": -amt, "cost_centre": cc},
                     {"ledger": "Cash", "amount": amt, "cost_centre": None}])

            # the same bill entered twice
            dup = next((amt for pc, m, amt in DUPLICATES if (pc, m) == (code, mk)), 0)
            if dup:
                vch(post_day(mk, 0), "Journal", "Cash",
                    f"Site establishment - {cc}",
                    [{"ledger": "Site Establishment", "amount": -dup, "cost_centre": cc},
                     {"ledger": "Cash", "amount": dup, "cost_centre": None}])

    # A subcontractor bill for one site, booked against another site's cost centre. The ERP has
    # it under the project that incurred it, so one project reads high and the other low.
    _whose, _charged, _mk, _amt = MISPOSTED
    vch(post_day(_mk, 1), "Journal", C.SUBCON_NAMES[2],
        f"Subcontractor bill - {C.BY_CODE[_whose]['tally']}",
        [{"ledger": "Subcontractor Charges", "amount": -_amt,
          "cost_centre": C.BY_CODE[_charged]["tally"]},
         {"ledger": C.SUBCON_NAMES[2], "amount": _amt, "cost_centre": None}])

    # Head office: no cost centre in the books, and none invented here.
    for mk, pool in ho_pool.items():
        for i, (ledger, share) in enumerate([("HO Salaries", 0.64), ("Office Rent", 0.21),
                                             ("Professional Fees", 0.15)]):
            amt = round(pool * share / 100) * 100
            vch(post_day(mk, i), "Journal", "Cash",
                f"Head office {ledger.lower()} - {C.month_label(mk)}",
                [{"ledger": ledger, "amount": -amt, "cost_centre": None},
                 {"ledger": "Cash", "amount": amt, "cost_centre": None}])

    vch(post_day(NO_HINT[0], 1), "Journal", "Cash",
        "Site consumables - allocation pending",
        [{"ledger": "Site Establishment", "amount": -NO_HINT[1], "cost_centre": None},
         {"ledger": "Cash", "amount": NO_HINT[1], "cost_centre": None}])
    return vs


# ------------------------------------------------------------------ ERP

def build_erp_rows(real):
    mms, wbm, fba, rev, hrm = [], [], [], [], []
    for code in PROFILE:
        p = C.BY_CODE[code]
        for mi, mk in enumerate(m for m, *_ in C.MONTHS):
            g = real[code][mk]
            mid = f"{mk}-15"
            for i, (mat, vendor, _l, uom, rate, hsn, share) in enumerate(MATERIALS):
                amt = round(g["purchases"] * share / 100) * 100
                if amt <= 0:
                    continue
                mms.append(dict(erp_code=p["erp"], txn_date=f"{mk}-{4 + i * 5:02d}",
                                po_no=f"PO/{p['erp']}/{mk[5:7]}/{i + 1:02d}", vendor=vendor,
                                material=mat, hsn=hsn, qty=round(amt / rate, 2), uom=uom,
                                rate=rate, amount=amt))
            for i, (name, _ledger, amt) in enumerate(_split(g["subcon"], SUBCON_ITEMS)):
                wbm.append(dict(erp_code=p["erp"], txn_date=mid, category="work",
                                party=C.SUBCON_NAMES[(mi + i) % 4], description=name, amount=amt))
            for name, _ledger, amt in _split(g["machinery"], MACHINERY_ITEMS):
                wbm.append(dict(erp_code=p["erp"], txn_date=mid, category="hire",
                                party="Plant division", description=name, amount=amt))
            svc = round(g["site"] * 0.58 / 100) * 100
            for name, _l, amt in _split(svc, [("Security and watch and ward", None, 0.55),
                                               ("Water and power charges", None, 0.45)]):
                wbm.append(dict(erp_code=p["erp"], txn_date=mid, category="service",
                                party="Site services", description=name, amount=amt))

            site_bucket = g["site"] - svc
            next_code = FBA_NEXT_PROJECT.get(code)
            carried = round(site_bucket * FBA_CARRY_SHARE) if next_code else 0
            local = site_bucket - carried
            for name, _l, amt in _split(local, [("Site office, stores and shuttering", None, 0.70),
                                                 ("Staff welfare and safety facilities", None, 0.30)]):
                fba.append(dict(erp_code=p["erp"], txn_date=mid, asset=name,
                                charge_type="depreciation", amount=amt))
            if carried:
                fba.append(dict(erp_code=C.BY_CODE[next_code]["erp"], txn_date=mid,
                                asset=f"Site office, stores and shuttering - carried from "
                                      f"{p['tally']}",
                                charge_type="depreciation", amount=carried))
            # No named discrepancy here - the client never described what, if anything, this
            # module's revenue should look like against Tally, so it is not given one either.
            for name, _l, amt in _split(g["revenue"], REVENUE_ITEMS):
                rev.append(dict(erp_code=p["erp"], txn_date=mid,
                                ra_bill_no=f"RA/{p['erp']}/{mk[5:7]}",
                                description=f"{name} certified", amount=amt))
            # HRM books the true payroll figure, split by worker category - same total the mail
            # return would state absent SALARY_MISMATCH below, since here HR is the
            # authoritative side, not the one that slips.
            for name, _l, amt in _split(round(g["site"] * 0.44), SALARY_ITEMS):
                hrm.append(dict(erp_code=p["erp"], txn_date=mid,
                                description=f"{name} - {p['aliases'][0]}", amount=amt))
    return {"mms": mms, "wbm": wbm, "fba": fba, "rev": rev, "hrm": hrm}


# ------------------------------------------------------------------ mailbox

_TITLE = Font(bold=True, size=12, color="14202E")
_HEAD = Font(bold=True, size=9, color="FFFFFF")
_HFILL = PatternFill("solid", fgColor="2F5578")


def _sheet(title, subtitle, headers, rows):
    wb = Workbook()
    ws = wb.active
    ws.title = title[:31]
    ws["A1"] = title
    ws["A1"].font = _TITLE
    ws["A2"] = subtitle
    ws["A2"].font = Font(size=9, color="6B7887")
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=4, column=i, value=h)
        c.font, c.fill = _HEAD, _HFILL
        c.alignment = Alignment(horizontal="center")
        ws.column_dimensions[c.column_letter].width = max(15, len(str(h)) + 4)
    for ri, r in enumerate(rows, 5):
        for ci, v in enumerate(r, 1):
            cell = ws.cell(row=ri, column=ci, value=v)
            if isinstance(v, (int, float)):
                cell.number_format = "#,##0"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _eml(path, sender, subject, sent, body, name, payload):
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = sender, C.AUDIT_TEAM, subject
    m["Date"] = format_datetime(dt.datetime.combine(sent, dt.time(11, 30)))
    m.set_content(body)
    m.add_attachment(payload, maintype="application", filename=name,
                     subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    with open(path, "wb") as f:
        f.write(bytes(m))


def build_inbox(real):
    """Writes the mailbox. Returns the stock and salary figures as finally stated, per
    project-month - both feed a real calculation now, so both get their own ground truth."""
    # Only the generated months are rebuilt. Anything fetched from the live mailbox stays -
    # regenerating the seeded history must not destroy real mail.
    for name in os.listdir(C.EMAIL_DIR) if os.path.isdir(C.EMAIL_DIR) else []:
        if not name.startswith("_"):
            shutil.rmtree(os.path.join(C.EMAIL_DIR, name), ignore_errors=True)
    os.makedirs(C.EMAIL_DIR, exist_ok=True)
    stated, salary_stated, count = {}, {}, 0

    for mk, mlabel, _f, _t in C.MONTHS:
        mdir = os.path.join(C.EMAIL_DIR, mk)
        os.makedirs(mdir, exist_ok=True)
        cut = C.cutoff_date(mk)
        seq = 0

        for code in PROFILE:
            p = C.BY_CODE[code]
            g = real[code][mk]
            alias = p["aliases"][0]

            def emit(kind, rows, headers, note=None, tag="", sent=None):
                """Write one return. Skipped entirely if it never arrived."""
                nonlocal seq, count
                if (code, mk, kind) in NEVER_ARRIVED:
                    return
                sent = sent or arrival(code, mk, kind, cut)
                seq += 1
                count += 1
                label = C.INPUT_LABEL[kind]
                _eml(os.path.join(mdir, f"{seq:02d}_{code}_{kind}.eml"),
                     C.CONTRIBUTORS[code][kind],
                     f"{label} - {alias} - {mlabel}{tag}", sent,
                     note or (f"Dear Sir,\n\nPlease find attached the {label.lower()} for "
                              f"{p['tally']} for {mlabel}.\n\nRegards\n"
                              f"{C.CONTRIBUTORS[code][kind].split('@')[0]}"),
                     f"{kind}_{p['erp']}_{mk}.xlsx",
                     _sheet(label, f"{p['tally']}  |  {mlabel}", headers, rows))

            work_rows = [[p["tally"], mlabel, name, amt]
                         for name, _l, amt in _split(g["revenue"], REVENUE_ITEMS)]
            emit("work_done",
                 [[p["tally"], mlabel, "Work done value certified", g["revenue"]],
                  *work_rows,
                  [p["tally"], mlabel, "Cumulative work done",
                   round(g["revenue"] * p["months_run"] * 0.92)]],
                 ["Project", "Month", "Item", "Amount"])

            emit("ra_bill",
                 [[p["tally"], mlabel, "RA bill certified", g["revenue"]],
                  [p["tally"], mlabel, "Retention withheld", round(g["revenue"] * 0.05)]],
                 ["Project", "Month", "Item", "Amount"])

            # The first mail understates closing stock; a later one corrects it.
            understate = RESTATED[2] if (code, mk) == (RESTATED[0], RESTATED[1]) else 0
            closing = g["closing"] - understate
            opening_rows = [[p["tally"], mlabel, f"Opening - {name}", amt]
                            for name, _l, amt in _split(g["opening"], STOCK_ITEMS)]
            closing_rows = [[p["tally"], mlabel, f"Closing - {name}", amt]
                            for name, _l, amt in _split(closing, STOCK_ITEMS)]
            emit("stock",
                 [[p["tally"], mlabel, "Opening stock", g["opening"]],
                  [p["tally"], mlabel, "Closing stock", closing],
                  *opening_rows, *closing_rows],
                 ["Project", "Month", "Item", "Amount"])
            if (code, mk, "stock") not in NEVER_ARRIVED:
                stated[(code, mk)] = {"opening": g["opening"], "closing": closing}

            hire_total = round(g["site"] * 0.17)
            formwork_rows = [[p["tally"], mlabel, name, amt]
                             for name, _l, amt in _split(hire_total, FORMWORK_ITEMS)]
            emit("formwork",
                 [[p["tally"], mlabel, "Formwork area used (sqm)",
                   round(g["revenue"] / 4_150)],
                  [p["tally"], mlabel, "Formwork hire recovered", hire_total],
                  *formwork_rows],
                 ["Project", "Month", "Item", "Value"])

            # HR's payroll register (HRM, see build_erp_rows) books the true figure; the site's
            # own mailed count is what SALARY_MISMATCH deliberately misstates for one project-
            # month, giving the ERP-vs-mail salary reconciliation a real story to show, not one
            # that always happens to agree.
            true_salary = round(g["site"] * 0.44)
            site_salary = round(true_salary * SALARY_MISMATCH.get((code, mk), 1.0))
            if (code, mk, "hr_salary") not in NEVER_ARRIVED:
                salary_stated[(code, mk)] = site_salary
            role_rows = [[p["tally"], mlabel, name, amt]
                         for name, _l, amt in _split(site_salary, SALARY_ITEMS)]
            emit("hr_salary",
                 [[p["tally"], mlabel, "Site staff salary (total)", site_salary],
                  *role_rows,
                  [p["tally"], mlabel, "Headcount at site",
                   max(6, round(g["revenue"] / 22_00_000))]],
                 ["Project", "Month", "Item", "Amount"])

            adjs = ADJUSTMENTS.get((code, mk), [])
            if adjs:
                emit("adjustment",
                     [[p["tally"], mlabel, k, l, a] for k, l, a in adjs],
                     ["Project", "Month", "Kind", "Reason", "Amount"],
                     note=("Dear Sir,\n\nAdjustments for the month. These are not captured in "
                           "the ERP or in Tally and need to be considered while finalising.\n\n"
                           "Regards\nAudit lead"))

        # E3: the correction
        if mk == RESTATED[1]:
            code = RESTATED[0]
            p, g = C.BY_CODE[code], real[code][mk]
            seq += 1
            count += 1
            _eml(os.path.join(mdir, f"{seq:02d}_{code}_stock_revised.eml"),
                 C.CONTRIBUTORS[code]["stock"],
                 f"{C.INPUT_LABEL['stock']} - {p['aliases'][0]} - {mlabel} - REVISED",
                 arrival(code, mk, "stock", cut) + dt.timedelta(days=3),
                 "Dear Sir,\n\nPlease ignore the earlier mail. Cement and steel counts were "
                 "restated after physical verification at site.\n\nRegards\nStore in-charge",
                 f"stock_{p['erp']}_{mk}_rev.xlsx",
                 _sheet(C.INPUT_LABEL["stock"], f"{p['tally']}  |  {mlabel}  |  Revised",
                        ["Project", "Month", "Item", "Amount"],
                        [[p["tally"], mlabel, "Opening stock", g["opening"]],
                         [p["tally"], mlabel, "Closing stock", g["closing"]]]))
            stated[(code, mk)] = {"opening": g["opening"], "closing": g["closing"]}

    return stated, salary_stated, count


# ------------------------------------------------------------------ answer key

def derive_ground_truth(erp_rows, vouchers, stock_stated, salary_stated):
    """What each source says, by summing what was generated.

    Deliberately independent of outcome.py: simple sums over the in-memory rows, while the
    pipeline arrives at the same numbers by reading Tally over XML, SQLite and .eml files. A
    mismatch therefore means a read or parse fault, which is the only thing this check claims
    to police.
    """
    reported = {m for m, *_ in C.MONTHS}
    src = defaultdict(dict)

    def add(code, month, field, amount):
        if month not in reported:
            return
        d = src[code].setdefault(month, {})
        d[field] = d.get(field, 0) + amount

    for r in erp_rows["mms"]:
        add(C.BY_ERP[r["erp_code"]]["code"], r["txn_date"][:7], "erp_material", r["amount"])
    for r in erp_rows["wbm"]:
        add(C.BY_ERP[r["erp_code"]]["code"], r["txn_date"][:7],
            f"erp_{C.WBM_CATEGORY[r['category']]}", r["amount"])
    for r in erp_rows["fba"]:
        add(C.BY_ERP[r["erp_code"]]["code"], r["txn_date"][:7], "erp_site", r["amount"])
    for r in erp_rows["rev"]:
        add(C.BY_ERP[r["erp_code"]]["code"], r["txn_date"][:7], "erp_revenue", r["amount"])
    for r in erp_rows["hrm"]:
        add(C.BY_ERP[r["erp_code"]]["code"], r["txn_date"][:7], "erp_salary", r["amount"])

    unattributed = 0.0
    for v in vouchers:
        month = f"{v['date'][:4]}-{v['date'][4:6]}"
        for ln in v["lines"]:
            line = C.LEDGER_LINE.get(ln["ledger"])
            if line is None:
                continue
            amt = -ln["amount"] if line != "revenue" else ln["amount"]
            if amt == 0:
                continue
            if not ln["cost_centre"]:
                unattributed += amt
                continue
            add(C.BY_TALLY[ln["cost_centre"]]["code"], month,
                "tally_revenue" if line == "revenue" else f"tally_{line}", amt)

    for (code, month), st in stock_stated.items():
        if month in reported:
            src[code].setdefault(month, {})
            src[code][month]["opening"] = st["opening"]
            src[code][month]["closing"] = st["closing"]

    for (code, month), amt in salary_stated.items():
        if month in reported:
            src[code].setdefault(month, {})
            src[code][month]["mail_salary"] = amt

    return {"sources": dict(src), "unattributed_total": round(unattributed, 2)}


# ------------------------------------------------------------------ driver

def run(push_tally=True):
    real, ho_pool = reality()

    erp_rows = build_erp_rows(real)
    counts = erp.create(rows=erp_rows)
    print(f"ERP database   : {counts}")

    stock_stated, salary_stated, mails = build_inbox(real)
    print(f"mailbox        : {mails} returns across {len(C.MONTHS)} months")

    vouchers = build_vouchers(real, ho_pool)
    with open(C.TALLY_SNAPSHOT, "w", encoding="utf-8") as f:
        json.dump(vouchers, f, indent=1)
    print(f"vouchers built : {len(vouchers)}")

    gt = derive_ground_truth(erp_rows, vouchers, stock_stated, salary_stated)
    with open(C.GROUND_TRUTH, "w", encoding="utf-8") as f:
        json.dump(gt, f, indent=1)
    print(f"source totals  : {sum(len(m) for m in gt['sources'].values())} project-months, "
          f"{C.rupees(gt['unattributed_total'])} not attributed")

    if not push_tally:
        print("Tally          : skipped")
        return gt, vouchers
    if not T.available():
        print(f"Tally          : unreachable at {C.TALLY_URL} - snapshot only")
        return gt, vouchers

    existing = T.fetch_vouchers(*T.WINDOW)
    if existing:
        if T.fingerprint(existing) == T.fingerprint(vouchers):
            print(f"Tally          : identical dataset already loaded "
                  f"({len(existing)}) - push skipped")
            return gt, vouchers
        raise SystemExit(
            f"REFUSING TO PUSH: {len(existing)} of our vouchers already sit in "
            f"{T.WINDOW[0]}-{T.WINDOW[1]} and are not the ones just built. A second import "
            f"would double every figure, and this Tally rejects deletion over XML (see "
            f"TALLY_NOTES.md). Clear them by hand - Gateway > Display > Day Book, select the "
            f"range, Alt+D - then rerun.")

    created, errors = T.import_masters()
    print(f"masters        : {created} created" + (f", {len(errors)} notes" if errors else ""))
    created, errors = T.import_vouchers(vouchers)
    print(f"vouchers       : {created} created" + (f", {len(errors)} errors" if errors else ""))
    for e in errors[:5]:
        print("   !", e)
    back = T.fetch_vouchers(*T.WINDOW)
    print(f"read back      : {len(back)}")
    if len(back) != len(vouchers):
        print(f"   ! expected {len(vouchers)} - investigate before trusting the output")
    return gt, vouchers


if __name__ == "__main__":
    import sys
    run(push_tally="--no-tally" not in sys.argv)
