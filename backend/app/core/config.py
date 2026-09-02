"""Masters and calendar. Imported by both the dataset builder and the pipeline.

What lives here is what an analyst maintains by hand: the project list and its aliases, the
ledger and module maps, who owes which document, and the monthly calendar. None of it is an
answer key - that is ground_truth.json, read only by the reconciliation gate.
"""
import calendar
import datetime as dt
import os


def _load_dotenv():
    """Read .env from the project root into os.environ.

    Hand-rolled to avoid a dependency for twenty lines. Values already present in the
    environment win, so a real deployment can set them properly and ignore the file.
    """
    root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        "..", "..", ".."))
    path = os.path.join(root, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and value and key not in os.environ:
                os.environ[key] = value


_load_dotenv()

# Everything generated lands in one directory so the API has a single place to serve from.
# Override with POC_DATA_DIR when running from somewhere else.
_HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get(
    "POC_DATA_DIR",
    os.path.abspath(os.path.join(_HERE, "..", "..", "..", "data")))
os.makedirs(BASE, exist_ok=True)

EMAIL_DIR = os.path.join(BASE, "inbox")
ERP_DB = os.path.join(BASE, "erp.db")
TALLY_SNAPSHOT = os.path.join(BASE, "tally_snapshot.json")
GROUND_TRUTH = os.path.join(BASE, "ground_truth.json")
REPORT_XLSX = os.path.join(BASE, "Monthly_Outcome_Report.xlsx")
AUDIT_DECISIONS = os.path.join(BASE, "audit_decisions.json")
FINALIZATIONS = os.path.join(BASE, "finalizations.json")

TALLY_URL = "http://localhost:9000"
TALLY_COMPANY = "Tally Integration POC"

# This Tally company cannot be cleared over XML (see TALLY_NOTES.md) and already holds older
# datasets. Every voucher we post carries this marker in its narration and the reader accepts
# only marked vouchers, so each generation stays isolated from the last. Bump the marker when
# the dataset changes rather than trying to delete. Stripped before anything is displayed.
VOUCHER_TAG = "[TA5]"

# ---------------------------------------------------------------- calendar
# August is now the live/rehearsal month too: its own ERP-vs-Tally difference (Riverside's
# subcontractor bill, keyed wrong in Tally - fabricate.py's KEYING_ERRORS) and one deliberately
# withheld return (ORR's RA bill certified - fabricate.py's NEVER_ARRIVED) meant to arrive live,
# by real email, during a demo. Aug was previously the fetched-but-never-reported look-ahead
# month; Sep now plays that role, same reason as before - it exists only to catch a bill Tally
# books a month late.
MONTHS = [
    ("2026-05", "May 2026", "20260501", "20260531"),
    ("2026-06", "Jun 2026", "20260601", "20260630"),
    ("2026-07", "Jul 2026", "20260701", "20260731"),
    ("2026-08", "Aug 2026", "20260801", "20260831"),
]
NEXT_MONTH = ("2026-09", "Sep 2026", "20260901", "20260930")
ALL_MONTHS = MONTHS + [NEXT_MONTH]

# Tally is in educational mode: only the 1st, 2nd and 31st of a month accept vouchers.
POST_DAYS = {"2026-05": ["01", "02", "31"], "2026-06": ["01", "02"],
             "2026-07": ["01", "02", "31"], "2026-08": ["01", "02", "31"],
             "2026-09": ["01", "02", "31"]}

# The Technical Audit division starts preparing a month's report on the 25th of the following
# month - a business rule the user gave directly, not derived. Contributors are given a
# cut-off ten days earlier so the audit team is not left working in the last few days.
DUE_DAY = 25
CUTOFF_LEAD_DAYS = 10

# Rehearsal aid only: pins "today" for Pending/Overdue classification so a live demo survives
# repeated Sync clicks without the clock silently reverting mid-walkthrough. Unset (the normal
# state) means the real date, same as ever. Set POC_DEMO_AS_OF=YYYY-MM-DD in .env to freeze it;
# remove the line to go back to real time. Touches only tracker.status()'s as_of - decision and
# finalization timestamps stay on the real clock regardless.
DEMO_AS_OF = os.environ.get("POC_DEMO_AS_OF", "").strip()

# ---------------------------------------------------------------- projects
# `tally` is the cost centre. `erp` is the ERP's own code. `aliases` are what people type in
# email subjects - the mismatch between the three is what rule R1 exists for.
# Three projects, chosen so each carries one demonstration on its own:
#   Riverside - the ERP-vs-Tally difference (material consumed disagrees)
#   Tidel     - the restated-return story (closing stock corrected after first submission)
#   ORR       - the missing-return story (formwork report absent; the live-mail send fills it)
#
# `budget` is the Total Estimated Cost to Complete each project - a QS/BOQ figure a real
# percentage-of-completion calculation needs (see outcome.py's poc_position). The client was
# never asked for this and has never given it - unlike `value` (the tender/contract amount,
# which comes from the actual award), this is a placeholder assumption, in the same spirit as
# the assumed-profit authorization already recorded in CLAUDE.md. Replace with the real QS
# estimate the moment one exists; nothing else needs to change.
PROJECTS = [
    {"code": "PRJ-1041", "tally": "Riverside Towers - Manapakkam", "erp": "RVT-1041",
     "client": "Riverside Developers Pvt Ltd",
     "aliases": ["Riverside", "Riverside Towers", "Manapakkam", "RVT"],
     "sector": "Residential", "value": 41_80_00_000, "budget": 37_60_00_000,
     "months_run": 19, "duration": 30},
    {"code": "PRJ-1052", "tally": "Tidel Park Block C - Taramani", "erp": "ITP-1052",
     "client": "Tidel Infrastructure Ltd",
     "aliases": ["Tidel", "Block C", "Taramani", "ITP"],
     "sector": "Commercial", "value": 63_40_00_000, "budget": 55_80_00_000,
     "months_run": 11, "duration": 28},
    {"code": "PRJ-1063", "tally": "ORR Flyover Package 3", "erp": "ORR-1063",
     "client": "Tamil Nadu Highways Department",
     "aliases": ["ORR", "Flyover", "Package 3", "Ring Road"],
     "sector": "Infrastructure", "value": 88_60_00_000, "budget": 83_30_00_000,
     "months_run": 14, "duration": 36},
]
BY_CODE = {p["code"]: p for p in PROJECTS}
BY_TALLY = {p["tally"]: p for p in PROJECTS}
BY_ERP = {p["erp"]: p for p in PROJECTS}
COST_CENTRES = [p["tally"] for p in PROJECTS]


def resolve_project(text):
    """Find a project from free text - a cost centre, an ERP code, an alias, a subject line.

    This is rule R1. Longest match first, so "Tidel Park Block C - Taramani" is not decided by
    the shorter alias "Tidel" when the full name is present.
    """
    if not text:
        return None
    t = str(text).lower()
    best = None
    for p in PROJECTS:
        for name in [p["tally"], p["code"], p["erp"]] + p["aliases"]:
            if name.lower() in t and (best is None or len(name) > best[0]):
                best = (len(name), p)
    return best[1] if best else None


def resolve_sender(address):
    """Find a project from a sender's own mail address - the domain/identity signal, not the
    subject.

    Also rule R1, its second half: the division's own observation was "there is a mail domain
    per project" (client discovery session), not only that the project is named in the subject.
    `SITE_MAILBOX` is looked up directly rather than substring-matched, because a mailbox belongs
    to exactly one project - unlike a subject line, there is no case here where a longer name
    should beat a shorter one.
    """
    if not address:
        return None
    address = address.strip().lower()
    for code, mailbox in SITE_MAILBOX.items():
        if mailbox.lower() == address:
            return BY_CODE[code]
    return None


# ---------------------------------------------------------------- chart of accounts
VENDORS = [
    ("Sri Balaji Cements", "33AABCS1429P1ZK"),
    ("Deccan Steel Traders", "33AACFD8817Q1Z8"),
    ("Kaveri Aggregates and Minerals", "33AAGCK2204R1ZM"),
    ("UltraTech RMC - Chennai South", "33AAACL6442L1ZC"),
    ("Coromandel Formwork Systems", "33AADCC5591H1ZG"),
    ("Perungudi Hardware and Tools", "33AAKFP3067N1ZB"),
]
SUBCONS = [
    ("Anand Civil Works", "33AAJFA9012K1Z4"),
    ("RKS Labour Contractors", "33AALFR1188M1ZP"),
    ("Vetri Structures and Erectors", "33AAGFV7743J1ZT"),
    ("Sakthi Finishing Contractors", "33AAEFS2260L1ZQ"),
]
VENDOR_NAMES = [v[0] for v in VENDORS]
SUBCON_NAMES = [s[0] for s in SUBCONS]
GSTIN = dict(VENDORS + SUBCONS)

# Tally ledger -> report line. Anything absent is out of the report's scope by construction.
LEDGER_LINE = {
    "Contract Revenue": "revenue",
    "Material Purchase - Cement": "material",
    "Material Purchase - Steel": "material",
    "Material Purchase - Aggregate": "material",
    "Material Purchase - RMC": "material",
    "Material Purchase - Formwork": "material",
    "Subcontractor Charges": "subcon",
    "Labour Charges": "subcon",
    "Shuttering and Formwork Labour": "subcon",
    "Steel Fixing and Bar Bending": "subcon",
    "Machinery Hire": "machinery",
    "Machinery Hire - Excavator/Loader": "machinery",
    "Machinery Hire - Concrete Pump": "machinery",
    "Machinery Hire - Tower Crane": "machinery",
    "Fuel and Lubricants": "machinery",
    "Site Establishment": "site",
    "Site Security and Watch and Ward": "site",
    "Staff Welfare and Safety": "site",
    "HO Salaries": "ho_pool",
    "Office Rent": "ho_pool",
    "Professional Fees": "ho_pool",
}

COST_LINES = ["material", "subcon", "machinery", "site"]
LINE_LABEL = {
    "revenue": "Contract revenue",
    "material": "Material consumed",
    "subcon": "Subcontractor and labour",
    "machinery": "Machinery and fuel",
    "site": "Site establishment",
    "salary": "Site staff salary",
    "ho_alloc": "Head office overhead",
    "adj_revenue": "Revenue accrued - unbilled work",
    "adj_cost": "Cost adjustments",
}

# ---------------------------------------------------------------- ERP modules
# MMS/WBM/FBA are the modules the division named [01:38:27, 01:38:59]. REV is a POC addition,
# not a client-named module - see erp.py's module docstring. HRM is a later addition too, on the
# same footing as REV: the client was never asked whether payroll sits in this ERP - see
# CLAUDE.md's "Decided: site staff salary becomes a real ERP-vs-mail reconciliation".
ERP_MODULES = {
    "MMS": {"label": "MMS - Purchase transactions", "line": "material"},
    "WBM": {"label": "WBM - Labour, hire and service", "line": None},
    "FBA": {"label": "FBA - Fixed assets and indirect", "line": "site"},
    "REV": {"label": "REV - Billing (POC addition, not client-named)", "line": "revenue"},
    "HRM": {"label": "HRM - Payroll (POC addition, not client-named)", "line": "salary"},
}
# WBM splits three ways: work, hire and service.
WBM_CATEGORY = {"work": "subcon", "hire": "machinery", "service": "site"}

# ---------------------------------------------------------------- the seven inputs
# The subject keyword is how a mail is routed. Matching on the subject rather than a filename
# convention is deliberate: it is what a person does, and it still works when these are real
# emails from real people.
INPUTS = [
    ("work_done",  "Work done report",   "Site QS",              "work done"),
    ("stock",      "Closing stock",      "Site store in-charge", "closing stock"),
    ("ra_bill",    "RA bill certified",  "Site QS",              "ra bill"),
    ("formwork",   "Formwork report",    "Formwork department",  "formwork"),
    ("hr_salary",  "Site salary",        "HR payroll",           "site salary"),
    ("adjustment", "Manual adjustments", "Technical Audit",      "adjustment"),
]
INPUT_LABEL = {k: lbl for k, lbl, _, _ in INPUTS}
INPUT_OWNER = {k: who for k, _, who, _ in INPUTS}
INPUT_KEYWORD = {k: kw for k, _, _, kw in INPUTS}

# Worker categories the site salary return itself is broken down by - the one canonical list,
# shared by fabricate.py (writes these as rows in the mail attachment and splits HRM's figure
# the same way) and service.py's lineage (reads them back out of the attachment so the site's
# own mail return traces to "who, how much" the same way ERP's HRM entries already do).
SALARY_ROLES = ["Skilled labour", "Unskilled labour", "Supervisory staff", "Site engineers"]

# Same idea for the other single-line items - a canonical breakdown fabricate.py writes and
# service.py's lineage reads back out, so expanding any of them shows real detail instead of one
# row with nothing under it. Revenue and Work done share WORK_CATEGORIES deliberately: ERP/Tally
# bill by these categories and the site claims work done in the same ones, so an auditor can
# compare "site says X for Civil works" against "billed Y for Civil works" directly.
WORK_CATEGORIES = ["Civil works", "MEP works", "Finishing and other works"]
STOCK_MATERIALS = ["Cement", "Steel", "Aggregate", "RMC", "Shuttering material"]
FORMWORK_CATEGORIES = ["Slab formwork", "Column and beam formwork",
                       "Staircase and miscellaneous formwork"]

# Who sends each input, per project. One mailbox per SITE, not per role - the site sends
# everything about itself, which is how B&B actually described it: "SSPDL Navalur" (or here,
# Riverside / Tidel / ORR) has its own mail identity and sends its own weekly and monthly
# figures from it. This is also what rule R1 rests on: the division said there is "a mail
# domain per project" (client discovery session) - so the sender's own address is a second,
# independent signal for which project a return belongs to, not just the subject line.
#
# These are Gmail "+alias" identities on one verified account (send-as, no separate mailbox
# needed) - real, distinct From addresses, not a naming convention layered on top.
SITE_MAILBOX = {
    "PRJ-1041": "softsuave2026+riverside.manapakkam@gmail.com",
    "PRJ-1052": "softsuave2026+tidel.taramani@gmail.com",
    "PRJ-1063": "softsuave2026+orrflyover.pkg3@gmail.com",
}

CONTRIBUTORS = {
    p["code"]: {kind: SITE_MAILBOX[p["code"]] for kind, *_ in INPUTS}
    for p in PROJECTS
}

AUDIT_TEAM = "bbbuilders.reports@gmail.com"      # the intake mailbox
ESCALATE_TO = AUDIT_TEAM
ORG_NAME = "B&B Builders"
DIVISION = "Technical Audit Division"

# ---------------------------------------------------------------- tolerances
RECON_TOLERANCE = 500          # below this an ERP-vs-Tally difference is rounding
GATE_TOLERANCE = 1_000         # ground-truth gate, per project-month figure


# ---------------------------------------------------------------- calendar helpers

def last_day(month_key):
    y, m = int(month_key[:4]), int(month_key[5:7])
    return calendar.monthrange(y, m)[1]


def due_date(month_key):
    """The report on `month_key` is due at the end of the following month."""
    y, m = int(month_key[:4]), int(month_key[5:7])
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return dt.date(y, m, min(DUE_DAY, calendar.monthrange(y, m)[1]))


def cutoff_date(month_key):
    """What contributors are told: the due date less the buffer."""
    return due_date(month_key) - dt.timedelta(days=CUTOFF_LEAD_DAYS)


def month_label(key):
    for k, lbl, _f, _t in ALL_MONTHS:
        if k == key:
            return lbl
    return key or ""


def rupees(n):
    """Indian grouping, no decimals. 12345678 -> 1,23,45,678"""
    n = int(round(n or 0))
    sign = "-" if n < 0 else ""
    s = str(abs(n))
    if len(s) <= 3:
        return sign + s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return sign + ",".join(parts) + "," + tail


def strip_tag(text):
    """Remove the dataset marker before anything reaches a screen or a sheet."""
    return (text or "").replace(VOUCHER_TAG, "").strip()
