"""Tally XML gateway - masters and vouchers in, vouchers out.

Every quirk handled here was found by probing this instance, not read in a manual. They are
written up in TALLY_NOTES.md; the short version:

  * educational mode accepts vouchers only on the 1st, 2nd and 31st of a month
  * the voucher collection ignores SVFROMDATE/SVTODATE, so the period is applied in Python
  * Tally auto-renumbers imported vouchers, so DATE is the only reliable month signal
  * CMPINFO counts are dependency ids, not object counts - read the data back instead
  * the Day Book export returns blank template vouchers - use a TDL collection
  * responses contain raw control bytes and refs like &#4;, both invalid XML - clean first

This company is shared with an earlier, unrelated dataset that cannot be removed. Every
voucher we post carries C.VOUCHER_TAG in its narration and `fetch_vouchers` reads only tagged
vouchers, so the two datasets never see each other. The tag is stripped before display.

There is no delete path. This instance answers a well-formed delete - correct REMOTEID,
VCHKEY and VCHTYPE - with "Voucher does not exist!" and DELETED=0. So instead of pretending to
reset, fabricate.py fingerprints the dataset and skips the push when the same one is already
loaded. Changing the figures therefore needs a manual clear in Tally.
"""
import re
import urllib.request
import xml.etree.ElementTree as ET

from . import config as C

COST_CATEGORY = "Projects"
ALLOWED_DAYS = (1, 2, 31)

_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_BADREF = re.compile(r"&#x?0*([0-9a-fA-F]+);")


class TallyDown(Exception):
    """Gateway unreachable. The caller decides whether that is fatal."""


def _clean(raw):
    def drop(m):
        body = m.group(1)
        n = int(body, 16) if m.group(0)[2] in "xX" else int(body)
        return "" if n < 0x20 and n not in (9, 10, 13) else m.group(0)
    return _BADREF.sub(drop, _CTRL.sub("", raw))


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def post(xml, timeout=180):
    req = urllib.request.Request(C.TALLY_URL, data=xml.encode("utf-8"),
                                 headers={"Content-Type": "text/xml;charset=utf-8"})
    try:
        return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
    except OSError as e:                      # URLError and socket errors both land here
        raise TallyDown(f"{C.TALLY_URL}: {e}") from e


def available():
    try:
        post("""<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC/></BODY></ENVELOPE>""",
             timeout=8)
        return True
    except TallyDown:
        return False


def _import(report, body):
    r = post(f"""<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY>
<IMPORTDATA><REQUESTDESC><REPORTNAME>{report}</REPORTNAME>
<STATICVARIABLES><SVCURRENTCOMPANY>{esc(C.TALLY_COMPANY)}</SVCURRENTCOMPANY></STATICVARIABLES>
</REQUESTDESC><REQUESTDATA>{body}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>""")
    m = re.search(r"<CREATED>(\d+)</CREATED>", r)
    return (int(m.group(1)) if m else 0), re.findall(r"<LINEERROR>(.*?)</LINEERROR>", r)


# ------------------------------------------------------------------ masters

LEDGERS = [
    ("Contract Revenue", "Sales Accounts", ""),
    ("Material Purchase - Cement", "Purchase Accounts", ""),
    ("Material Purchase - Steel", "Purchase Accounts", ""),
    ("Material Purchase - Aggregate", "Purchase Accounts", ""),
    ("Material Purchase - RMC", "Purchase Accounts", ""),
    ("Material Purchase - Formwork", "Purchase Accounts", ""),
    ("Subcontractor Charges", "Direct Expenses", ""),
    ("Labour Charges", "Direct Expenses", ""),
    ("Machinery Hire", "Direct Expenses", ""),
    ("Fuel and Lubricants", "Direct Expenses", ""),
    ("Site Establishment", "Direct Expenses", ""),
    ("HO Salaries", "Indirect Expenses", ""),
    ("Office Rent", "Indirect Expenses", ""),
    ("Professional Fees", "Indirect Expenses", ""),
]


def all_ledgers():
    """Chart of accounts plus one party ledger per client, vendor and subcontractor."""
    out = list(LEDGERS)
    for p in C.PROJECTS:
        out.append((p["client"], "Sundry Debtors", ""))
    for name in C.VENDOR_NAMES + C.SUBCON_NAMES:
        out.append((name, "Sundry Creditors", ""))
    seen, uniq = set(), []
    for name, parent, extra in out:
        if name not in seen:
            seen.add(name)
            uniq.append((name, parent, extra))
    return uniq


def import_masters():
    parts = [f"""<TALLYMESSAGE xmlns:UDF="TallyUDF">
<COSTCATEGORY NAME="{COST_CATEGORY}" ACTION="Create"><NAME>{COST_CATEGORY}</NAME>
<ALLOCATEREVENUE>Yes</ALLOCATEREVENUE><ALLOCATENONREVENUE>Yes</ALLOCATENONREVENUE>
</COSTCATEGORY></TALLYMESSAGE>"""]
    for cc in C.COST_CENTRES:
        parts.append(f"""<TALLYMESSAGE xmlns:UDF="TallyUDF">
<COSTCENTRE NAME="{esc(cc)}" ACTION="Create"><NAME>{esc(cc)}</NAME>
<CATEGORY>{COST_CATEGORY}</CATEGORY><PARENT/></COSTCENTRE></TALLYMESSAGE>""")
    for name, parent, extra in all_ledgers():
        parts.append(f"""<TALLYMESSAGE xmlns:UDF="TallyUDF">
<LEDGER NAME="{esc(name)}" ACTION="Create"><NAME>{esc(name)}</NAME>
<PARENT>{esc(parent)}</PARENT>{extra}</LEDGER></TALLYMESSAGE>""")
    # Creating something that exists is a harmless no-op here, so errors are advisory.
    return _import("All Masters", "".join(parts))


# ------------------------------------------------------------------ vouchers

def voucher_xml(v):
    """v: date=YYYYMMDD, vtype, number, party, narration, lines=[{ledger, amount, cost_centre}]

    Amount sign follows Tally's convention: debit negative, credit positive.
    """
    lines = []
    for ln in v["lines"]:
        amt = ln["amount"]
        alloc = ""
        if ln.get("cost_centre"):
            alloc = (f"<CATEGORYALLOCATIONS.LIST><CATEGORY>{COST_CATEGORY}</CATEGORY>"
                     f"<ISDEEMEDPOSITIVE>{'Yes' if amt < 0 else 'No'}</ISDEEMEDPOSITIVE>"
                     f"<COSTCENTREALLOCATIONS.LIST><NAME>{esc(ln['cost_centre'])}</NAME>"
                     f"<AMOUNT>{amt:.2f}</AMOUNT></COSTCENTREALLOCATIONS.LIST>"
                     f"</CATEGORYALLOCATIONS.LIST>")
        lines.append(f"""<ALLLEDGERENTRIES.LIST><LEDGERNAME>{esc(ln['ledger'])}</LEDGERNAME>
<ISDEEMEDPOSITIVE>{'Yes' if amt < 0 else 'No'}</ISDEEMEDPOSITIVE>
<AMOUNT>{amt:.2f}</AMOUNT>{alloc}</ALLLEDGERENTRIES.LIST>""")
    return f"""<TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="{esc(v['vtype'])}" ACTION="Create"><DATE>{v['date']}</DATE>
<VOUCHERTYPENAME>{esc(v['vtype'])}</VOUCHERTYPENAME>
<VOUCHERNUMBER>{esc(v['number'])}</VOUCHERNUMBER>
<PARTYLEDGERNAME>{esc(v['party'])}</PARTYLEDGERNAME>
<NARRATION>{esc(v['narration'])}</NARRATION>{''.join(lines)}</VOUCHER></TALLYMESSAGE>"""


def import_vouchers(vouchers, batch=40):
    created, errors = 0, []
    for i in range(0, len(vouchers), batch):
        c, e = _import("Vouchers", "".join(voucher_xml(v) for v in vouchers[i:i + batch]))
        created += c
        errors += e
    return created, errors


# ------------------------------------------------------------------ read back

def _collection():
    # Sync is an interactive button, not a batch job - post()'s own 180s default is sized for
    # patient write operations (import_masters/import_vouchers during --generate), not for a
    # read a person is sitting in front of waiting on. 30s is still generous for exporting this
    # company's voucher collection; past that, Tally is genuinely stuck (or contended - see
    # TALLY_NOTES.md on this being a shared, single instance) and the caller should hear about
    # it quickly, not have the button spin for minutes with no feedback.
    return post(f"""<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE><ID>VchColl</ID></HEADER><BODY><DESC><STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>{esc(C.TALLY_COMPANY)}</SVCURRENTCOMPANY></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="VchColl" ISMODIFY="No"><TYPE>Voucher</TYPE>
<FETCH>Date,VoucherNumber,VoucherTypeName,PartyLedgerName,Narration</FETCH>
<FETCH>AllLedgerEntries</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>""",
                timeout=30)


def _txt(el, tag):
    f = el.find(tag)
    return (f.text or "").strip() if f is not None else ""


def fetch_vouchers(frm, to, tagged_only=True):
    """Our vouchers whose own DATE falls in [frm, to].

    `tagged_only` keeps the legacy dataset in this same company out of the read. It cannot be
    deleted over XML, and its cost centres are not ours, so without this filter every legacy
    voucher would land in the escalation list as an unallocatable cost. See TALLY_NOTES.md.
    """
    root = ET.fromstring(_clean(_collection()))
    out = []
    for v in root.iter("VOUCHER"):
        lines = []
        for le in v.findall("ALLLEDGERENTRIES.LIST"):
            led, amt = _txt(le, "LEDGERNAME"), _txt(le, "AMOUNT")
            if not led or not amt:
                continue
            cc = None
            cn = le.find(".//COSTCENTREALLOCATIONS.LIST/NAME")
            if cn is not None and (cn.text or "").strip():
                cc = cn.text.strip()
            lines.append({"ledger": led, "amount": float(amt), "cost_centre": cc})
        date = _txt(v, "DATE")
        narration = _txt(v, "NARRATION")
        if not lines or not (frm <= date <= to):
            continue
        if tagged_only and C.VOUCHER_TAG not in narration:
            continue
        out.append({"date": date, "number": _txt(v, "VOUCHERNUMBER"),
                    "vtype": _txt(v, "VOUCHERTYPENAME"), "party": _txt(v, "PARTYLEDGERNAME"),
                    "narration": narration, "lines": lines})
    return out


def fingerprint(vouchers):
    """A content hash that survives Tally's round trip.

    Voucher numbers are excluded on purpose: Tally auto-renumbers on import, so they never
    come back as sent. Count of vouchers, count of lines and the summed absolute value are
    enough to tell "the same dataset is already loaded" from "something changed".
    """
    lines = sum(len(v["lines"]) for v in vouchers)
    total = sum(abs(ln["amount"]) for v in vouchers for ln in v["lines"])
    return (len(vouchers), lines, round(total, 2))


WINDOW = (C.ALL_MONTHS[0][2], C.ALL_MONTHS[-1][3])


if __name__ == "__main__":
    print("gateway:", "up" if available() else "down")
    print("our window:", WINDOW, "->", len(fetch_vouchers(*WINDOW)), "vouchers")
