"""The ERP stand-in: a SQLite database shaped like the three modules the client named.

No ERP code or database was made available, so this stands in for it. The shape is what
matters - MMS gives purchase transactions, WBM gives labour split into work / hire / service,
FBA gives fixed-asset and indirect charges. When a real extract arrives, `extract()` is the
only function that has to change.

These three were named while the division described how expenditure gets reconciled against
Tally [01:38:27, 01:38:59] - that is not the same as being told this is every module their ERP
has. Whether the ERP separately records revenue was never asked.

A fourth table, `rev_billing`, was added on request so revenue compares ERP against Tally the
same way the cost heads do. It is not client-confirmed like the other three - there is no
citation for it, and none should be added. If a real extract arrives without a revenue module,
this table is the one to drop.

A fifth, `hrm_salary`, was added the same way - the payroll register HR fixes the site's salary
cost in. Unlike the other four, it is never compared against Tally (Tally has no payroll ledger
at all in this system) - it is compared against the site's own mailed salary figure instead. See
CLAUDE.md's "Decided: site staff salary becomes a real ERP-vs-mail reconciliation".

Populated by fabricate.py, which also documents what is deliberately
inconsistent between this and Tally and why.
"""
import os
import sqlite3
from collections import defaultdict

from . import config as C

SCHEMA = """
CREATE TABLE project (
    erp_code    TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    client      TEXT NOT NULL,
    sector      TEXT NOT NULL,
    order_value INTEGER NOT NULL,
    months_run  INTEGER NOT NULL,
    duration    INTEGER NOT NULL
);
-- MMS: purchase transactions. One row per material receipt against a PO.
CREATE TABLE mms_purchase (
    id         INTEGER PRIMARY KEY,
    erp_code   TEXT NOT NULL REFERENCES project(erp_code),
    txn_date   TEXT NOT NULL,              -- YYYY-MM-DD
    po_no      TEXT,
    vendor     TEXT NOT NULL,
    material   TEXT NOT NULL,
    hsn        TEXT,
    qty        REAL NOT NULL,
    uom        TEXT NOT NULL,
    rate       REAL NOT NULL,
    amount     REAL NOT NULL
);
-- WBM: work / hire / service. The three-way split described on the call.
CREATE TABLE wbm_transaction (
    id         INTEGER PRIMARY KEY,
    erp_code   TEXT NOT NULL REFERENCES project(erp_code),
    txn_date   TEXT NOT NULL,
    category   TEXT NOT NULL CHECK (category IN ('work','hire','service')),
    party      TEXT NOT NULL,
    description TEXT,
    amount     REAL NOT NULL
);
-- FBA: fixed assets and indirect expenditure charged to a project.
CREATE TABLE fba_charge (
    id          INTEGER PRIMARY KEY,
    erp_code    TEXT NOT NULL REFERENCES project(erp_code),
    txn_date    TEXT NOT NULL,
    asset       TEXT NOT NULL,
    charge_type TEXT NOT NULL CHECK (charge_type IN ('depreciation','direct')),
    amount      REAL NOT NULL
);
-- REV: billing / revenue. Not a client-named module - see the module docstring.
CREATE TABLE rev_billing (
    id          INTEGER PRIMARY KEY,
    erp_code    TEXT NOT NULL REFERENCES project(erp_code),
    txn_date    TEXT NOT NULL,
    ra_bill_no  TEXT,
    description TEXT,
    amount      REAL NOT NULL
);
-- HRM: the payroll register - what HR fixed the site's salary cost at. Not a client-named
-- module either, same footing as REV - see the module docstring.
CREATE TABLE hrm_salary (
    id          INTEGER PRIMARY KEY,
    erp_code    TEXT NOT NULL REFERENCES project(erp_code),
    txn_date    TEXT NOT NULL,
    description TEXT,
    amount      REAL NOT NULL
);
CREATE INDEX ix_mms ON mms_purchase(erp_code, txn_date);
CREATE INDEX ix_wbm ON wbm_transaction(erp_code, txn_date);
CREATE INDEX ix_fba ON fba_charge(erp_code, txn_date);
CREATE INDEX ix_rev ON rev_billing(erp_code, txn_date);
CREATE INDEX ix_hrm ON hrm_salary(erp_code, txn_date);
"""


def connect(path=None):
    con = sqlite3.connect(path or C.ERP_DB)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def create(path=None, rows=None):
    """Build the database from scratch. `rows` is what fabricate.py produced."""
    path = path or C.ERP_DB
    if os.path.exists(path):
        os.remove(path)
    con = connect(path)
    con.executescript(SCHEMA)
    for p in C.PROJECTS:
        con.execute("INSERT INTO project VALUES (?,?,?,?,?,?,?)",
                    (p["erp"], p["tally"], p["client"], p["sector"], p["value"],
                     p["months_run"], p["duration"]))
    rows = rows or {}
    con.executemany(
        "INSERT INTO mms_purchase"
        " (erp_code,txn_date,po_no,vendor,material,hsn,qty,uom,rate,amount)"
        " VALUES (:erp_code,:txn_date,:po_no,:vendor,:material,:hsn,:qty,:uom,:rate,:amount)",
        rows.get("mms", []))
    con.executemany(
        "INSERT INTO wbm_transaction (erp_code,txn_date,category,party,description,amount)"
        " VALUES (:erp_code,:txn_date,:category,:party,:description,:amount)",
        rows.get("wbm", []))
    con.executemany(
        "INSERT INTO fba_charge (erp_code,txn_date,asset,charge_type,amount)"
        " VALUES (:erp_code,:txn_date,:asset,:charge_type,:amount)",
        rows.get("fba", []))
    con.executemany(
        "INSERT INTO rev_billing (erp_code,txn_date,ra_bill_no,description,amount)"
        " VALUES (:erp_code,:txn_date,:ra_bill_no,:description,:amount)",
        rows.get("rev", []))
    con.executemany(
        "INSERT INTO hrm_salary (erp_code,txn_date,description,amount)"
        " VALUES (:erp_code,:txn_date,:description,:amount)",
        rows.get("hrm", []))
    con.commit()
    counts = {t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
              for t in ("mms_purchase", "wbm_transaction", "fba_charge", "rev_billing",
                        "hrm_salary")}
    con.close()
    return counts


# ------------------------------------------------------------------ extracts

def _month_of(d):
    return d[:7]


def extract(path=None):
    """The three module extracts, as the audit team would pull them.

    Returns:
      totals[(project_code, month, line)] = amount
      detail  - every row, tagged with module and line, for the Lineage sheet
    """
    con = connect(path)
    totals = defaultdict(float)
    detail = []

    def add(code, month, line, amount, module, desc, ref, date):
        totals[(code, month, line)] += amount
        detail.append({"project": code, "month": month, "line": line, "amount": amount,
                       "module": module, "description": desc, "ref": ref, "date": date})

    for r in con.execute("SELECT * FROM mms_purchase ORDER BY txn_date, id"):
        p = C.BY_ERP.get(r["erp_code"])
        if not p:
            continue
        add(p["code"], _month_of(r["txn_date"]), "material", r["amount"], "MMS",
            f"{r['material']} {r['qty']:g}{r['uom']} @ {r['rate']:g} - {r['vendor']}",
            r["po_no"] or "", r["txn_date"])

    for r in con.execute("SELECT * FROM wbm_transaction ORDER BY txn_date, id"):
        p = C.BY_ERP.get(r["erp_code"])
        if not p:
            continue
        line = C.WBM_CATEGORY[r["category"]]
        add(p["code"], _month_of(r["txn_date"]), line, r["amount"], f"WBM/{r['category']}",
            f"{r['description'] or r['category']} - {r['party']}", "", r["txn_date"])

    for r in con.execute("SELECT * FROM fba_charge ORDER BY txn_date, id"):
        p = C.BY_ERP.get(r["erp_code"])
        if not p:
            continue
        add(p["code"], _month_of(r["txn_date"]), "site", r["amount"], "FBA",
            f"{r['asset']} ({r['charge_type']})", "", r["txn_date"])

    for r in con.execute("SELECT * FROM rev_billing ORDER BY txn_date, id"):
        p = C.BY_ERP.get(r["erp_code"])
        if not p:
            continue
        add(p["code"], _month_of(r["txn_date"]), "revenue", r["amount"], "REV",
            r["description"] or "Certified RA bill", r["ra_bill_no"] or "", r["txn_date"])

    for r in con.execute("SELECT * FROM hrm_salary ORDER BY txn_date, id"):
        p = C.BY_ERP.get(r["erp_code"])
        if not p:
            continue
        add(p["code"], _month_of(r["txn_date"]), "salary", r["amount"], "HRM",
            r["description"] or "Site staff salary", "", r["txn_date"])

    con.close()
    return dict(totals), detail


def module_summary(path=None):
    """Row counts and value per module - shown on the report so the source is visible."""
    con = connect(path)
    out = []
    for table, module in (("mms_purchase", "MMS"), ("wbm_transaction", "WBM"),
                          ("fba_charge", "FBA"), ("rev_billing", "REV"),
                          ("hrm_salary", "HRM")):
        r = con.execute(f"SELECT count(*) n, coalesce(sum(amount),0) v FROM {table}").fetchone()
        out.append({"module": module, "label": C.ERP_MODULES[module]["label"],
                    "rows": r["n"], "value": r["v"]})
    con.close()
    return out


if __name__ == "__main__":
    for m in module_summary():
        print(f"{m['module']:4s} {m['rows']:4d} rows  {C.rupees(m['value']):>15s}  {m['label']}")
