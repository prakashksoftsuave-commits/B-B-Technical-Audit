"""The Excel export: the official management report, not a dump of the UI tables.

Exactly the two sections Consolidation.jsx itself has - **Project outcomes** (the project
summary table, then the full cost reconciliation and the raw ERP/Tally transactions behind each
cost head, grouped and collapsible per project via Excel outline levels the same way the
website expands one) and **Financial outcome** (Contract Position / Financial Performance,
Current then Final). No Basis of Preparation sheet and no other section - scoped to whichever
project/month the console's filter was showing, never every sampled month regardless of it. See
CLAUDE.md's "Decided: the Excel export becomes a minimal final-outcome report" and its two
follow-ups for the rounds that shaped this.

Every figure comes from `outcome.project_position()` / `consolidate()` (via `res["position"]` /
`res["rows"]`, plus `res["erp_detail"]`/`res["tally_detail"]` for the transaction-level detail) -
nothing here is a second calculation of a number the API already computed. If a total looks
wrong, the bug is in outcome.py, not here.

Palette matches the console: ink navy, steel blue, cool sunken grey.
"""
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from . import config as C
from . import outcome as O

INK, ACCENT, DUST = "14202E", "2F5578", "6B7887"

H_FILL = PatternFill("solid", fgColor=INK)
H_FONT = Font(bold=True, color="FFFFFF", size=9)
ACC_FILL = PatternFill("solid", fgColor=ACCENT)
OK = PatternFill("solid", fgColor="D7ECDC")
WARN = PatternFill("solid", fgColor="F5E6C4")
BAD = PatternFill("solid", fgColor="F3DDD6")
INFO = PatternFill("solid", fgColor="DDE7F0")

TITLE = Font(bold=True, size=16, color=INK)
BIG = Font(bold=True, size=12, color=INK)
PERIOD = Font(bold=True, size=14, color=ACCENT)
SUBTITLE = Font(size=10, color=DUST)
NOTE = Font(size=9, color=DUST)
BOLD = Font(bold=True, size=10)
RULE = Border(top=Side("medium", color=INK))
# A hairline under every row - with showGridLines off (a deliberate choice, since Sheets/Excel's
# own gridlines cover the whole sheet including the blank margins around each table), rows had
# no visual separator of their own at all once the font-hierarchy work made every row's text a
# different weight - this is what actually separates one item from the next.
ROW_LINE = Border(bottom=Side("thin", color="D8DEE4"))


def _separate(ws, r, last_col):
    for col in range(1, last_col + 1):
        cell = ws.cell(row=r, column=col)
        cell.border = Border(bottom=ROW_LINE.bottom, top=cell.border.top,
                              left=cell.border.left, right=cell.border.right)

MONEY = '#,##0;[Red](#,##0)'
PCT = '0.00"%";[Red]-0.00"%"'

STATUS_LABEL = {"OPEN": "OPEN", "AUDIT_IN_PROGRESS": "AUDIT IN PROGRESS",
                "READY_FOR_FINALIZATION": "READY FOR FINALIZATION", "FINALIZED": "FINALIZED"}
STATUS_FILL = {"OPEN": BAD, "AUDIT_IN_PROGRESS": WARN,
               "READY_FOR_FINALIZATION": INFO, "FINALIZED": OK}


# ---------------------------------------------------------------------------- small helpers

def _sheet(wb, title, first=False):
    ws = wb.active if first else wb.create_sheet()
    ws.title = title[:31]
    ws.sheet_view.showGridLines = False
    return ws


_BAD_SHEET_CHARS = set('[]:*?/\\')


def _unique_sheet_title(name, used):
    """Sanitize a project (or project+month) name into a legal, unique sheet tab: Excel forbids
    `[]:*?/\\` in a title and caps it at 31 characters, and two different project names can
    truncate down to the same 31 characters - `used` is every title already claimed in this
    workbook, so a truncation collision gets a short numeric suffix instead of silently
    overwriting the earlier project's tab.
    """
    clean = "".join(c for c in name if c not in _BAD_SHEET_CHARS).strip() or "Sheet"
    base = clean[:31]
    title, n = base, 2
    while title in used:
        tail = f" ({n})"
        title = base[:31 - len(tail)] + tail
        n += 1
    used.add(title)
    return title


def _head(ws, row, headers, widths=None, fill=H_FILL):
    for i, h in enumerate(headers, 1):
        right = h.startswith("~")
        c = ws.cell(row=row, column=i, value=h[1:] if right else h)
        c.fill, c.font = fill, H_FONT
        c.alignment = Alignment(wrap_text=True, vertical="center",
                                horizontal="right" if right else "left")
    for i, w in enumerate(widths or [], 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[row].height = 26
    ws.freeze_panes = ws.cell(row=row + 1, column=1)


def _money(ws, r, c, v, pending_label="PENDING"):
    if v is None:
        cell = ws.cell(row=r, column=c, value=pending_label)
        cell.font = Font(italic=True, color=DUST, size=9)
        return cell
    cell = ws.cell(row=r, column=c, value=round(v))
    cell.number_format = MONEY
    return cell


def _pct(ws, r, c, v):
    if v is None:
        cell = ws.cell(row=r, column=c, value="PENDING")
        cell.font = Font(italic=True, color=DUST, size=9)
        return cell
    cell = ws.cell(row=r, column=c, value=v)
    cell.number_format = PCT
    return cell


def _status_cell(ws, r, c, status):
    cell = ws.cell(row=r, column=c, value=STATUS_LABEL.get(status, status))
    cell.fill = STATUS_FILL.get(status, INFO)
    cell.font = Font(bold=True, size=9)
    return cell


def _pname(code):
    p = C.BY_CODE.get(code)
    return p["tally"] if p else (code or "—")


# ---------------------------------------------------------------------------- scope

def _scope(res, project, month):
    """Every project-month result matching the filter, and the aggregate across them - the one
    place that turns (project, month) filters into a set of canonical position rows. Falls back
    to the most recent sampled month when none is given, matching the console's own default.
    """
    if month is None:
        month = sorted({mk for _c, mk in res["position"]})[-1]
    codes = [project] if project else sorted(C.BY_CODE)
    rows = [(code, res["position"][(code, month)]) for code in codes
            if (code, month) in res["position"]]
    return month, rows


def _month_range(res, month_from, month_to):
    """Every sampled month from `month_from` to `month_to`, inclusive, in order - a single month
    when the two match or `month_to` is omitted (unchanged single-month behaviour), falling back
    to the most recent sampled month when neither is given, matching the console's own default.
    Swapped ends are tolerated rather than rejected, same spirit as the console's own filters.
    """
    all_months = sorted({mk for _c, mk in res["position"]})
    if not all_months:
        return []
    if month_from is None and month_to is None:
        return [all_months[-1]]
    lo = month_from or (month_to or all_months[0])
    hi = month_to or lo
    if hi < lo:
        lo, hi = hi, lo
    return [m for m in all_months if lo <= m <= hi]


def _aggregate(rows):
    """Sum a list of (code, position) pairs into one company-shaped position dict - the exact
    company = sum(projects) identity the console enforces, computed once here too.
    """
    tender = sum(p["tenderAmount"] for _c, p in rows)
    mail_cost = sum(p["mailCost"] for _c, p in rows)
    under_review = sum(p["underReview"] for _c, p in rows)
    prov_cost = sum(p["provisionalCost"] for _c, p in rows)
    prov_rev_parts = [p["provisionalRevenue"] for _c, p in rows]
    prov_revenue = None if any(v is None for v in prov_rev_parts) else sum(prov_rev_parts)
    prov_remaining = None if prov_revenue is None else tender - prov_revenue
    prov_profit = None if prov_revenue is None else prov_revenue - prov_cost
    prov_margin = round(prov_profit / prov_revenue * 100, 2) if prov_profit and prov_revenue else None

    approved_parts = [p["approvedCost"] for _c, p in rows]
    all_final = all(v is not None for v in approved_parts) and bool(rows)
    approved_cost = sum(approved_parts) if all_final else None
    approved_rev_parts = [p["approvedRevenue"] for _c, p in rows]
    approved_revenue = sum(approved_rev_parts) if all_final else None
    remaining = (tender - approved_revenue) if all_final else None
    profit = (approved_revenue - approved_cost) if all_final else None
    margin = round(profit / approved_revenue * 100, 2) if all_final and profit and approved_revenue else None

    status = O.worst_status([p["status"] for _c, p in rows])
    return {"tenderAmount": tender, "mailCost": mail_cost, "underReview": under_review,
            "provisionalRevenue": prov_revenue, "provisionalCost": prov_cost,
            "provisionalRemaining": prov_remaining, "provisionalProfit": prov_profit,
            "provisionalMargin": prov_margin, "approvedCost": approved_cost,
            "approvedRevenue": approved_revenue, "remaining": remaining, "profit": profit,
            "margin": margin, "status": status}


# ---------------------------------------------------------------------------- 2. Financial outcome

def _financial_outcome(wb, res, month, rows, company, meta, project, sheet_title="Financial outcome"):
    """Mirrors Consolidation.jsx's "Financial outcome" section - Contract Position and Financial
    Performance, Current then Final - same two questions, same wording ("Current", not
    "Provisional") as the console now uses everywhere else.
    """
    ws = _sheet(wb, sheet_title)
    ws["A1"] = C.ORG_NAME
    ws["A1"].font = TITLE
    ws["A2"] = "MONTHLY FINANCIAL OUTCOME REPORT"
    ws["A2"].font = Font(bold=True, size=12, color=ACCENT)
    ws["A3"] = C.month_label(month)
    ws["A3"].font = PERIOD
    ws["A4"] = _pname(project) if project else "All Projects"
    ws["A4"].font = Font(bold=True, size=11, color=DUST)
    ws["A5"] = f"Prepared {meta.get('ranAt', '')[:19].replace('T', ' ')}    ·    Draft for review"
    ws["A5"].font = NOTE
    for col, w in ((1, 34), (2, 22)):
        ws.column_dimensions[get_column_letter(col)].width = w

    def section(r, title):
        c = ws.cell(row=r, column=1, value=title)
        c.font = Font(bold=True, size=10, color="FFFFFF")
        c.fill = ACC_FILL
        ws.cell(row=r, column=2).fill = ACC_FILL
        return r + 1

    def line(r, label, value_fn):
        c = ws.cell(row=r, column=1, value=label)
        c.font = Font(bold=True, size=10.5, color=INK)
        value_fn(r)
        _separate(ws, r, 2)
        return r + 1

    r = 7
    r = section(r, "CONTRACT POSITION")
    r = line(r, "Contract Value / Tender", lambda rr: _money(ws, rr, 2, company["tenderAmount"]))
    r = line(r, "Revenue Recognized",
             lambda rr: _money(ws, rr, 2, company["provisionalRevenue"]))
    r = line(r, "Remaining Contract Value",
             lambda rr: _money(ws, rr, 2, company["provisionalRemaining"]))
    r += 1

    r = section(r, "FINANCIAL PERFORMANCE (CURRENT)")
    r = line(r, "Revenue Recognized",
             lambda rr: _money(ws, rr, 2, company["provisionalRevenue"]))
    r = line(r, "Current Cost", lambda rr: _money(ws, rr, 2, company["provisionalCost"]))
    r = line(r, "Current Profit / Loss",
             lambda rr: _money(ws, rr, 2, company["provisionalProfit"]))
    r = line(r, "Current Margin", lambda rr: _pct(ws, rr, 2, company["provisionalMargin"]))
    r = line(r, "Audit Impact (cost still under review)",
             lambda rr: _money(ws, rr, 2, company["underReview"]))
    r += 1

    finalized = company["status"] == "FINALIZED"
    r = section(r, "FINAL FINANCIAL POSITION")
    if finalized:
        r = line(r, "Final Approved Cost", lambda rr: _money(ws, rr, 2, company["approvedCost"]))
        r = line(r, "Final Profit / Loss", lambda rr: _money(ws, rr, 2, company["profit"]))
        r = line(r, "Final Margin", lambda rr: _pct(ws, rr, 2, company["margin"]))
        r = line(r, "Finalization Status", lambda rr: _status_cell(ws, rr, 2, company["status"]))
    else:
        c = ws.cell(row=r, column=1,
                     value="FINAL RESULT: PENDING AUDIT / NOT FINALIZED")
        c.font = Font(bold=True, color="7C4C08")
        c.fill = WARN
        ws.cell(row=r, column=2).fill = WARN
        _separate(ws, r, 2)
        r += 1
        r = line(r, "Current Status", lambda rr: _status_cell(ws, rr, 2, company["status"]))
    r += 2

    ws.cell(row=r, column=1, value="Answers this report gives directly").font = BOLD
    r += 1
    best = max(rows, key=lambda cp: (cp[1]["provisionalProfit"] or -1e18)) if rows else None
    costliest = max(rows, key=lambda cp: cp[1]["provisionalCost"]) if rows else None
    if finalized:
        # A finalized scope is closed - the audit is over, so "current/under review" language
        # (which describes a month still being worked through) has nothing left to say. Fewer,
        # settled facts only - the same discipline as _project_outcomes dropping the working
        # detail below for a finalized report.
        facts = [
            f"Total tender value: {C.rupees(company['tenderAmount'])}",
            f"Final revenue recognized: {C.rupees(company['approvedRevenue'])}",
            f"Final cost: {C.rupees(company['approvedCost'])}",
            f"Final profit: {C.rupees(company['profit'])}",
            f"Most profitable project shown: {_pname(best[0])}" if best else "No projects in scope",
            f"Highest cost project shown: {_pname(costliest[0])}" if costliest else "",
        ]
    else:
        facts = [
            f"Total tender value: {C.rupees(company['tenderAmount'])}",
            f"Revenue recognized this period: {C.rupees(company['provisionalRevenue'] or 0)}",
            f"Cost incurred (current): {C.rupees(company['provisionalCost'])}",
            f"Current profit: {C.rupees(company['provisionalProfit'] or 0)}"
            + (" — pending revenue" if company["provisionalRevenue"] is None else ""),
            f"Under auditor review: {C.rupees(company['underReview'])}",
            "Final profit: not yet - month is "
            + STATUS_LABEL.get(company["status"], company["status"]).lower(),
            f"Most profitable project shown: {_pname(best[0])}" if best else "No projects in scope",
            f"Highest cost project shown: {_pname(costliest[0])}" if costliest else "",
        ]
    for f in facts:
        if f:
            ws.cell(row=r, column=1, value=f"• {f}")
            r += 1
    return ws


# ---------------------------------------------------------------------------- 1. Project outcomes

# Mirrors Consolidation.jsx: the project summary table it shows first, then each project's own
# cost reconciliation (or, once finalized, its clean settled breakdown) - the full detail behind
# every cost head, the same way the website expands a project then a cost head. Scoped to
# whatever project/month the console's own filter was showing (`rows`), never every sampled
# month regardless of filter. See CLAUDE.md's "Decided: the Excel export mirrors Financial
# Outcome" for why this sheet carries this much - the earlier minimal cut removed real content
# the console shows, not just noise.
#
# One project in scope keeps its detail inline, right below the summary table, same as always.
# More than one project gets its own dedicated sheet per project, named for the project - see
# "Decided: one sheet per project once more than one is in scope" in CLAUDE.md for why: a
# finalized project's clean breakdown was getting lost - and a still-open project's full working
# detail was crowding it out - when every project shared one sheet. Each project's own status
# decides its own presentation now too (`pos["status"] == "FINALIZED"`), not the whole scope's
# worst status, so one open project no longer forces every other, already-finalized project in
# the same download back into full working detail.

def _line_decision(line, second_label):
    if line["agrees"]:
        return "MATCHED", OK, f"{C.rupees(line['approved'])} - no decision needed"
    d = line["decision"]
    if d is None:
        return "NEEDS REVIEW", BAD, "PENDING"
    if d["choice"] == "erp":
        label = "APPROVED - ERP"
    elif d["choice"] in ("tally", "mail"):
        label = f"APPROVED - {second_label.upper()}"
    else:
        label = "APPROVED - ADJUSTED"
    return label, OK, C.rupees(line["approved"])


DETAIL_FONT = Font(size=9.5, color=DUST)
TOTAL_RULE = Border(top=Side("medium", color=INK), bottom=Side("medium", color=INK))


def _final_row(ws, r, item, amount, bold=False, pct=False, detail=False):
    """One line of the finalized breakdown - an item and the single figure it was settled at,
    nothing else. No ERP/Tally/Mail columns and no Status/Decision commentary: a finalized
    report is meant to go straight to the MD for sign-off, not read like an audit working paper.

    `detail=True` is the supporting transaction/vendor/material line underneath one of those
    items (matching `_detail_row`'s own small-grey-indented convention in the working-paper
    view) - the same real figures, just without the ERP/Tally/Mail source columns that would
    make no sense once only one settled amount is being shown per item.
    """
    c = ws.cell(row=r, column=1, value=item)
    if detail:
        c.font = DETAIL_FONT
        c.alignment = Alignment(indent=1)
    else:
        c.font = Font(bold=True, size=11 if bold else 10.5, color=INK)
    fmt = _pct if pct else _money
    cell = fmt(ws, r, 2, amount)
    cell.font = DETAIL_FONT if detail else Font(bold=True, size=11 if bold else 10.5)
    if bold:
        for col in (1, 2):
            ws.cell(row=r, column=col).border = TOTAL_RULE
    else:
        _separate(ws, r, 2)
    return r + 1


def _dash(ws, r, c, font=None):
    """A placeholder for "not applicable here" - right-aligned like the numbers it sits among,
    so it doesn't read as misaligned the way a plain left-aligned text dash does next to a
    column of right-aligned money."""
    cell = ws.cell(row=r, column=c, value="—")
    cell.alignment = Alignment(horizontal="right")
    if font:
        cell.font = font
    return cell


def _recon_row(ws, r, item, erp=None, tally=None, mail=None, diff=None,
               status=None, fill=None, decision="", bold=False, level=1):
    """A real reconciliation line - a cost head, revenue, or a piece of mail evidence an auditor
    actually reads and acts on. Always bold, so it stands out at a glance from the raw
    transaction rows (_detail_row) nested under it - the outline arrow alone is easy to miss
    once a sheet runs to hundreds of rows."""
    ws.row_dimensions[r].outlineLevel = level
    c = ws.cell(row=r, column=1, value=item)
    c.alignment = Alignment(wrap_text=True, vertical="top")
    c.font = Font(bold=True, size=11, color=INK) if bold else Font(bold=True, size=10, color=INK)
    for col, v in ((2, erp), (3, tally), (4, mail)):
        cell = _dash(ws, r, col) if v is None else _money(ws, r, col, v)
        cell.font = Font(bold=True, size=10)
    if diff is None:
        _dash(ws, r, 5).font = Font(bold=True, size=10)
    else:
        cell = _money(ws, r, 5, diff)
        cell.font = Font(bold=True, size=10)
        if abs(diff) > C.RECON_TOLERANCE:
            cell.fill = BAD
    if status is not None:
        s = ws.cell(row=r, column=6, value=status)
        s.fill = fill or INFO
        s.font = Font(bold=True, size=9)
    dc = ws.cell(row=r, column=7, value=decision)
    dc.alignment = Alignment(wrap_text=True, vertical="top")
    dc.font = Font(bold=True, size=10)
    if bold:
        for col in range(1, 8):
            ws.cell(row=r, column=col).border = TOTAL_RULE
    else:
        _separate(ws, r, 7)


def _detail_row(ws, r, item, erp=None, tally=None, mail=None, level=2):
    """A raw transaction line, not a reconciliation line - one source, one amount, shown smaller
    and in grey with a slight indent so it visually reads as supporting detail under the bold
    line above it, not a peer of it. Every other cell still gets a dash, same convention as the
    rest of the sheet, so an empty cell always reads as "not applicable here" rather than
    "something's missing"."""
    ws.row_dimensions[r].outlineLevel = level
    c = ws.cell(row=r, column=1, value=item)
    c.alignment = Alignment(wrap_text=True, vertical="top", indent=1)
    c.font = DETAIL_FONT
    for col, v in ((2, erp), (3, tally), (4, mail)):
        cell = _dash(ws, r, col, DETAIL_FONT) if v is None else _money(ws, r, col, v)
        if v is not None:
            cell.font = DETAIL_FONT
    for col in (5, 6, 7):
        _dash(ws, r, col, DETAIL_FONT)
    _separate(ws, r, 7)


def _short(description, project_name):
    """Vouchers and ERP rows often end with " - {project name}" - redundant once the row is
    already sitting inside that project's own block, and the single biggest reason these
    descriptions were running too long for the column to hold. Dropped only for display here;
    the underlying description (used by the console's own drill-down) is untouched."""
    suffix = f" - {project_name}"
    return description[:-len(suffix)] if description.endswith(suffix) else description


def _sub_detail(ws, r, res, code, month, line):
    """The raw ERP-then-Tally transactions behind one cost head, one row each - "what, how
    much" - same source (res["erp_detail"]/res["tally_detail"]) and same order the console's
    own drill-down reads, one level deeper than the reconciliation line they sit under.

    Salary also has a mail side to it - the site's own return states the same role breakdown
    its attachment carries (see fabricate.py's SALARY_ITEMS), read back out of res["inbox"] the
    same way service._lineage() does, so "for whom, how much" shows on both sides here too.
    """
    pname = _pname(code)
    for d in res["erp_detail"]:
        if d["project"] == code and d["month"] == month and d["line"] == line:
            _detail_row(ws, r, _short(d["description"], pname), erp=d["amount"])
            r += 1
    for d in res["tally_detail"]:
        if d["project"] == code and d["month"] == month and d["line"] == line:
            _detail_row(ws, r, _short(d["description"], pname), tally=d["amount"])
            r += 1
    if line == "salary":
        r = _mail_sub_detail(ws, r, res, code, month, "hr_salary")
    return r


# Category/role breakdown per mail return kind, read straight out of the return's own
# attachment (res["inbox"]) - same source and same names service._lineage() reads, so the
# console and this report trace to the same rows. Stock is handled separately below since one
# return states both an opening and a closing figure, each with its own breakdown.
_MAIL_BREAKDOWN = {"hr_salary": C.SALARY_ROLES, "work_done": C.WORK_CATEGORIES,
                   "formwork": C.FORMWORK_CATEGORIES}


def _mail_sub_detail(ws, r, res, code, month, kind):
    categories = _MAIL_BREAKDOWN.get(kind, [])
    for i in res["inbox"]:
        if i["kind"] != kind or i["project"] != code or i["month"] != month:
            continue
        item_map = {row.get("Item"): row.get("Amount", row.get("Value")) for row in i["rows"]}
        for cat in categories:
            v = item_map.get(cat)
            if v is not None:
                _detail_row(ws, r, f"{i['sender']} — {cat}", mail=v)
                r += 1
    return r


def _stock_sub_detail(ws, r, res, code, month, prefix):
    """`prefix` is "Opening" or "Closing" - the material breakdown behind that one figure."""
    for i in res["inbox"]:
        if i["kind"] != "stock" or i["project"] != code or i["month"] != month:
            continue
        item_map = {row.get("Item"): row.get("Amount", row.get("Value")) for row in i["rows"]}
        for m in C.STOCK_MATERIALS:
            v = item_map.get(f"{prefix} - {m}")
            if v is not None:
                _detail_row(ws, r, f"{i['sender']} — {m}", mail=v)
                r += 1
    return r


# The finalized breakdown's own versions of the three functions above - same source, same
# filter, same order (a finalized report should never disagree with the working one about what
# the underlying transactions/vendors/materials actually were), just rendered one settled amount
# per row via `_final_row(detail=True)` instead of `_detail_row`'s ERP/Tally/Mail columns, since
# a finalized report shows what was decided, not which system it came from.

def _final_sub_detail(ws, r, res, code, month, line):
    pname = _pname(code)
    for d in res["erp_detail"]:
        if d["project"] == code and d["month"] == month and d["line"] == line:
            r = _final_row(ws, r, _short(d["description"], pname), d["amount"], detail=True)
    for d in res["tally_detail"]:
        if d["project"] == code and d["month"] == month and d["line"] == line:
            r = _final_row(ws, r, _short(d["description"], pname), d["amount"], detail=True)
    if line == "salary":
        r = _final_mail_sub_detail(ws, r, res, code, month, "hr_salary")
    return r


def _final_mail_sub_detail(ws, r, res, code, month, kind):
    categories = _MAIL_BREAKDOWN.get(kind, [])
    for i in res["inbox"]:
        if i["kind"] != kind or i["project"] != code or i["month"] != month:
            continue
        item_map = {row.get("Item"): row.get("Amount", row.get("Value")) for row in i["rows"]}
        for cat in categories:
            v = item_map.get(cat)
            if v is not None:
                r = _final_row(ws, r, f"{i['sender']} — {cat}", v, detail=True)
    return r


def _final_stock_sub_detail(ws, r, res, code, month, prefix):
    for i in res["inbox"]:
        if i["kind"] != "stock" or i["project"] != code or i["month"] != month:
            continue
        item_map = {row.get("Item"): row.get("Amount", row.get("Value")) for row in i["rows"]}
        for m in C.STOCK_MATERIALS:
            v = item_map.get(f"{prefix} - {m}")
            if v is not None:
                r = _final_row(ws, r, f"{i['sender']} — {m}", v, detail=True)
    return r


def _write_final_breakdown(ws, r, res, month, code, pos):
    """One project's clean, settled breakdown - every cost head and revenue at the figure it was
    settled at, each with the real vendor/material/trade detail underneath it (via
    `_final_sub_detail`/`_final_mail_sub_detail`/`_final_stock_sub_detail`), but never the
    ERP/Tally/Mail source columns or the Status/Decision commentary those functions' working-
    paper counterparts carry. See `_final_row`'s own docstring for why: a finalized report is
    meant to go straight to the MD for sign-off, not read like an audit working paper - "no
    detail" and "no audit trail" are two different things, and this drops only the second one.
    Returns the next free row.
    """
    cons = res["rows"][(code, month)]
    ws.cell(row=r, column=1, value="Final breakdown").font = BIG
    r += 1
    detail_head = r + 1
    _head(ws, detail_head, ["Item", "~Final Amount"], [50, 22])
    r = detail_head + 1

    head = ws.cell(row=r, column=1, value=_pname(code))
    head.font = Font(bold=True, size=12, color="FFFFFF")
    head.fill = ACC_FILL
    ws.cell(row=r, column=2).fill = ACC_FILL
    r += 1

    r = _final_row(ws, r, C.LINE_LABEL["revenue"], pos["lines"]["revenue"]["approved"])
    r = _final_sub_detail(ws, r, res, code, month, "revenue")
    for a in cons["adjustments"]:
        if a["kind"] in O.ADJUSTS_REVENUE:
            r = _final_row(ws, r, a["kind"].replace("_", " ").title(), a["amount"])
    r = _final_row(ws, r, "Total revenue", pos["approvedRevenue"], bold=True)
    r += 1

    r = _final_row(ws, r, C.LINE_LABEL["material"], pos["lines"]["material"]["approved"])
    r = _final_sub_detail(ws, r, res, code, month, "material")
    r = _final_row(ws, r, "Opening stock", cons["opening"] or 0)
    r = _final_stock_sub_detail(ws, r, res, code, month, "Opening")
    r = _final_row(ws, r, "Closing stock", cons["closing"] or 0)
    r = _final_stock_sub_detail(ws, r, res, code, month, "Closing")
    stock_adj = (cons["opening"] - cons["closing"]
                 if cons["opening"] is not None and cons["closing"] is not None else 0)
    r = _final_row(ws, r, "Stock adjustment (Opening − Closing)", stock_adj)
    for ln in ("subcon", "machinery", "site"):
        r = _final_row(ws, r, C.LINE_LABEL[ln], pos["lines"][ln]["approved"])
        r = _final_sub_detail(ws, r, res, code, month, ln)
    r = _final_row(ws, r, C.LINE_LABEL["salary"], pos["lines"]["salary"]["approved"])
    r = _final_sub_detail(ws, r, res, code, month, "salary")
    r = _final_row(ws, r, "Formwork hire recovered", cons["formwork"] or 0)
    r = _final_mail_sub_detail(ws, r, res, code, month, "formwork")
    for a in cons["adjustments"]:
        if a["kind"] in O.ADJUSTS_COST:
            r = _final_row(ws, r, a["kind"].replace("_", " ").title(), a["amount"])
    r = _final_row(ws, r, "Total cost", pos["approvedCost"], bold=True)
    r += 1

    r = _final_row(ws, r, "Profit / Loss", pos["profit"], bold=True)
    r = _final_row(ws, r, "Margin", pos["margin"], bold=True, pct=True)
    return r + 1


def _write_reconciliation(ws, r, res, month, code, pos):
    """One project's full ERP/Tally/Mail cost reconciliation, plus the raw transaction detail
    behind every cost head - exactly what Consolidation.jsx's own drill-down shows. Sets this
    sheet's one AutoFilter range over just this project's own rows (a sheet can only carry one),
    since this is always the only project reconciliation this sheet holds - see
    `_project_outcomes`, which gives each project its own sheet once more than one is in scope.
    Returns the next free row.
    """
    cons = res["rows"][(code, month)]
    status_label = STATUS_LABEL.get(pos["status"], pos["status"])

    ws.cell(row=r, column=1, value="Cost reconciliation").font = BIG
    r += 1
    detail_head = r + 1
    # Sized off the actual longest item text in the data (the FBA depreciation-carry
    # description runs to ~95 characters) rather than a guess - wrap_text is still set as a
    # defensive backstop, but Google Sheets does not reliably auto-expand row height for
    # wrapped text on an XLSX import, so the column itself has to be wide enough on its own.
    _head(ws, detail_head, ["Item", "~ERP", "~Tally", "~Mail/Site", "~Difference",
                            "Status", "Decision"], [95, 16, 16, 16, 16, 16, 30])
    r = detail_head + 1

    head = ws.cell(row=r, column=1, value=f"{_pname(code)} — {status_label}")
    head.font = Font(bold=True, size=12, color="FFFFFF")
    head.fill = ACC_FILL
    for col in range(2, 8):
        ws.cell(row=r, column=col).fill = ACC_FILL
    ws.row_dimensions[r].outlineLevel = 0
    r += 1

    rev = pos["lines"]["revenue"]
    status, fill, decision = _line_decision(rev, "tally")
    _recon_row(ws, r, C.LINE_LABEL["revenue"], rev["erp"], rev["tally"], cons["ra_bill"],
               rev["diff"], status, fill, decision)
    r += 1
    r = _sub_detail(ws, r, res, code, month, "revenue")
    _recon_row(ws, r, "Work done report", mail=cons["work_done"],
               status="RECEIVED" if cons["work_done"] is not None else "NOT RECEIVED",
               fill=OK if cons["work_done"] is not None else BAD,
               decision="Revenue evidence")
    r += 1
    r = _mail_sub_detail(ws, r, res, code, month, "work_done")
    for a in cons["adjustments"]:
        if a["kind"] not in O.ADJUSTS_REVENUE:
            continue
        _recon_row(ws, r, a["kind"].replace("_", " ").title(), mail=a["amount"],
                   status="RECEIVED", fill=OK,
                   decision=f"{a['reason']} - applied automatically")
        r += 1

    mat = pos["lines"]["material"]
    status, fill, decision = _line_decision(mat, "tally")
    _recon_row(ws, r, C.LINE_LABEL["material"], mat["erp"], mat["tally"],
               diff=mat["diff"], status=status, fill=fill, decision=decision)
    r += 1
    r = _sub_detail(ws, r, res, code, month, "material")
    _recon_row(ws, r, "Opening stock", mail=cons["opening"],
               status="RECEIVED" if cons["opening"] is not None else "NOT RECEIVED",
               fill=OK if cons["opening"] is not None else BAD, decision="Stock")
    r += 1
    r = _stock_sub_detail(ws, r, res, code, month, "Opening")
    restated = cons.get("stock_restated")
    _recon_row(ws, r, "Closing stock", mail=cons["closing"],
               status=("RESTATED" if restated else "RECEIVED")
               if cons["closing"] is not None else "NOT RECEIVED",
               fill=(INFO if restated else OK) if cons["closing"] is not None else BAD,
               decision="Stock")
    r += 1
    r = _stock_sub_detail(ws, r, res, code, month, "Closing")
    stock_adj = (cons["opening"] - cons["closing"]
                 if cons["opening"] is not None and cons["closing"] is not None else None)
    _recon_row(ws, r, "Stock adjustment (added to cost)", mail=stock_adj,
               status="COMPUTED", fill=INFO,
               decision="Opening minus Closing, folded into cost automatically")
    r += 1

    for ln in ("subcon", "machinery", "site"):
        line = pos["lines"][ln]
        status, fill, decision = _line_decision(line, "tally")
        _recon_row(ws, r, C.LINE_LABEL[ln], line["erp"], line["tally"],
                   diff=line["diff"], status=status, fill=fill, decision=decision)
        r += 1
        r = _sub_detail(ws, r, res, code, month, ln)

    sal = pos["lines"]["salary"]
    if sal["mail"] is None:
        _recon_row(ws, r, C.LINE_LABEL["salary"], sal["erp"],
                   status="NOT RECEIVED", fill=BAD, decision="Owed by site")
    else:
        status, fill, decision = _line_decision(sal, "mail")
        _recon_row(ws, r, C.LINE_LABEL["salary"], sal["erp"], mail=sal["mail"],
                   diff=sal["diff"], status=status, fill=fill, decision=decision)
    r += 1
    r = _sub_detail(ws, r, res, code, month, "salary")
    _recon_row(ws, r, "Formwork report", mail=cons["formwork"],
               status="RECEIVED" if cons["formwork"] is not None else "NOT RECEIVED",
               fill=OK if cons["formwork"] is not None else BAD, decision="Expense")
    r += 1
    r = _mail_sub_detail(ws, r, res, code, month, "formwork")
    for a in cons["adjustments"]:
        if a["kind"] not in O.ADJUSTS_COST:
            continue
        _recon_row(ws, r, a["kind"].replace("_", " ").title(), mail=a["amount"],
                   status="RECEIVED", fill=OK,
                   decision=f"{a['reason']} - applied automatically")
        r += 1

    # "Matched" only when the raw ERP/Tally totals actually agree - once every line has a
    # decision but the two systems never agreed in the first place (an auditor picked a side),
    # the totals stay genuinely apart and calling that "Matched" would contradict the non-zero
    # Difference sitting right next to it. The resolved figure itself is the sum of what was
    # actually approved per line - never assumed to be the ERP side, since a line can just as
    # well be decided in Tally's favour.
    heads = ("material", "subcon", "machinery", "site")
    erp_heads = sum(pos["lines"][ln]["erp"] for ln in heads)
    tally_heads = sum(pos["lines"][ln]["tally"] for ln in heads)
    heads_pending = [ln for ln in heads if pos["lines"][ln]["approved"] is None]
    if heads_pending:
        heads_status, heads_fill = "NEEDS REVIEW", BAD
        heads_decision = "Waiting on the lines above"
    else:
        resolved_heads = sum(pos["lines"][ln]["approved"] for ln in heads)
        heads_status = "MATCHED" if erp_heads == tally_heads else "RESOLVED"
        heads_fill = OK
        heads_decision = f"{C.rupees(resolved_heads)} - no decision needed"
    _recon_row(ws, r, "Total — cost heads", erp_heads, tally_heads,
               diff=erp_heads - tally_heads, status=heads_status, fill=heads_fill,
               decision=heads_decision, bold=True)
    r += 1

    # "Final" is reserved for a month that has actually been through the finalize action
    # (pos["status"] == "FINALIZED") - every line being individually decided (approvedCost is
    # not None) only means READY_FOR_FINALIZATION, a different, earlier state, and labelling it
    # "Final" would contradict the Status column in the summary table above.
    proj_final = pos["status"] == "FINALIZED"
    proj_resolved = pos["approvedCost"] is not None
    cost_total = pos["approvedCost"] if proj_resolved else pos["provisionalCost"]
    if proj_final:
        total_status, total_fill, total_tag = "FINAL", OK, "Final"
    elif proj_resolved:
        total_status, total_fill, total_tag = "RESOLVED", OK, "Resolved, not yet finalized"
    else:
        total_status, total_fill, total_tag = "CURRENT", WARN, "Current, pending lines excluded"
    _recon_row(ws, r, "Total — cost (incl. mail & stock)", mail=pos["mailCost"],
               status=total_status, fill=total_fill,
               decision=f"{C.rupees(cost_total)} - {total_tag}", bold=True)
    r += 1

    # A sheet can only carry one AutoFilter range - put it on the detail table, since filtering
    # by Status is the one an auditor actually needs on tens of rows, not the two-row summary
    # banner above it.
    ws.auto_filter.ref = f"A{detail_head}:G{r - 1}"
    return r


def _write_project_block(ws, r, res, month, code, pos):
    """One project's own detail, in whichever shape its own status earns it - a finalized
    project gets the clean settled breakdown, anything else gets the full working
    reconciliation. Decided per project, not per scope - see `_project_outcomes`.
    """
    if pos["status"] == "FINALIZED":
        return _write_final_breakdown(ws, r, res, month, code, pos)
    return _write_reconciliation(ws, r, res, month, code, pos)


_SUMMARY_HEAD = (["Project", "~Tender / Contract Value", "~Revenue Recognized", "~Cost",
                  "~Profit / Loss", "~Margin", "~Remaining Contract Value", "Status"],
                 [32, 20, 20, 20, 20, 12, 20, 22])


def _summary_row(ws, r, code, p):
    """One project's own row of the summary table - Tender/Revenue/Cost/Profit/Margin/
    Remaining/Status - exactly as the website's "Project outcomes" table shows it. Shared by
    the single-project sheet's company-wide table and each project's own mini-header in the
    multi-project case, so the two never drift into two different formats for the same numbers.
    """
    final = p["approvedCost"] is not None
    ws.cell(row=r, column=1, value=_pname(code)).font = Font(bold=True, size=10.5)
    _money(ws, r, 2, p["tenderAmount"])
    _money(ws, r, 3, p["provisionalRevenue"])
    cost = p["approvedCost"] if final else p["provisionalCost"]
    cc = _money(ws, r, 4, cost)
    profit = p["profit"] if final else p["provisionalProfit"]
    pc = _money(ws, r, 5, profit)
    margin = p["margin"] if final else p["provisionalMargin"]
    _pct(ws, r, 6, margin)
    remaining = p["remaining"] if final else p["provisionalRemaining"]
    _money(ws, r, 7, remaining)
    if not final:
        cc.font = Font(italic=True, color=DUST)
        pc.font = Font(italic=True, color=DUST)
    _status_cell(ws, r, 8, p["status"])
    _separate(ws, r, 8)
    return r + 1


def _project_outcomes(wb, res, rows, company, month, month_suffix="", first=False,
                       used_titles=None):
    """One project in scope: a single "Project outcomes" sheet, its own summary row (plus a
    TOTAL row - identical to that one row, kept for consistency with how this sheet has always
    looked) then its detail inline, same as always.

    More than one project: no shared overview sheet - the company-wide totals already live in
    "Financial outcome" (kept last in the workbook), so a second copy of them here would just be
    a portfolio table nobody asked to see twice. Each project gets its own sheet instead, named
    for the project, carrying its own one-row summary at the top and its own detail below - a
    reader jumps straight to the one they care about, and a finalized project's clean breakdown
    never shares a sheet with another project's full working detail (see the block comment above
    `_write_final_breakdown`/`_write_reconciliation`).
    """
    used_titles = used_titles if used_titles is not None else set()
    headers, widths = _SUMMARY_HEAD

    if len(rows) <= 1:
        ws = _sheet(wb, f"Project outcomes{month_suffix}", first=first)
        used_titles.add(ws.title)
        ws.sheet_properties.outlinePr.summaryBelow = False
        ws["A1"] = "Project outcomes"
        ws["A1"].font = TITLE
        ws["A2"] = C.month_label(month)
        ws["A2"].font = PERIOD

        _head(ws, 4, headers, widths)
        r = 5
        for code, p in rows:
            r = _summary_row(ws, r, code, p)

        final = company["approvedCost"] is not None
        ws.cell(row=r, column=1, value="TOTAL").font = Font(bold=True, size=11, color=INK)
        ws.cell(row=r, column=1).border = TOTAL_RULE
        for col, key, fmt in ((2, "tenderAmount", _money), (3, "provisionalRevenue", _money)):
            cell = fmt(ws, r, col, company[key])
            cell.font, cell.border = BOLD, TOTAL_RULE
        cost_total = company["approvedCost"] if final else company["provisionalCost"]
        c1 = _money(ws, r, 4, cost_total); c1.font, c1.border = BOLD, TOTAL_RULE
        profit_total = company["profit"] if final else company["provisionalProfit"]
        c2 = _money(ws, r, 5, profit_total); c2.font, c2.border = BOLD, TOTAL_RULE
        margin_total = company["margin"] if final else company["provisionalMargin"]
        c3 = _pct(ws, r, 6, margin_total); c3.font, c3.border = BOLD, TOTAL_RULE
        remaining_total = company["remaining"] if final else company["provisionalRemaining"]
        c4 = _money(ws, r, 7, remaining_total); c4.font, c4.border = BOLD, TOTAL_RULE
        s = _status_cell(ws, r, 8, company["status"]); s.border = TOTAL_RULE
        r += 3

        if rows:
            code, pos = rows[0]
            _write_project_block(ws, r, res, month, code, pos)
        return ws

    # Multiple projects - one sheet per project, no shared overview.
    last_ws = None
    for i, (code, pos) in enumerate(rows):
        pws = _sheet(wb, _unique_sheet_title(f"{_pname(code)}{month_suffix}", used_titles),
                     first=(first and i == 0))
        pws.sheet_properties.outlinePr.summaryBelow = False
        pws["A1"] = _pname(code)
        pws["A1"].font = TITLE
        pws["A2"] = C.month_label(month)
        pws["A2"].font = PERIOD

        _head(pws, 4, headers, widths)
        r = _summary_row(pws, 5, code, pos)
        r += 2

        _write_project_block(pws, r, res, month, code, pos)
        last_ws = pws
    return last_ws


# ---------------------------------------------------------------------------- driver

def write(res, chk, tracker_rows, tracker_summary, path=None, meta=None, project=None,
          month=None, month_to=None):
    """Build the workbook for one scope (a project, or all of them; one month, a range of
    months, or the most recent sampled). A range repeats this same, already-verified
    single-month pair of sheets once per month in it - never a second aggregation across months
    invented here - so a multi-month download carries exactly what N separate single-month
    downloads would, bundled into one file with each month's own sheet pair labelled by month.
    `chk` and the tracker args are accepted for API compatibility with the caller in service.py
    but no longer drive a sheet here - the follow-up/reminder schedule is the console's concern,
    not this financial report's.
    """
    meta = meta or {"ranAt": ""}
    months = _month_range(res, month, month_to)
    multi = len(months) > 1

    wb = Workbook()
    # Shared across every month in the range, not reset per month - two different months each
    # needing a same-project sheet still get titles like "Riverside Towers - Manapakkam — May
    # 2026" / "...— Jun 2026", which already differ, but this is also the one guard against two
    # *different* project names truncating down to the same 31 characters within one month.
    used_titles = set()
    for i, m in enumerate(months):
        m, rows = _scope(res, project, m)
        company = _aggregate(rows)
        suffix = f" — {C.month_label(m)}" if multi else ""
        _project_outcomes(wb, res, rows, company, m, month_suffix=suffix, first=(i == 0),
                           used_titles=used_titles)
        fo_ws = _financial_outcome(wb, res, m, rows, company, meta, project,
                                    sheet_title=f"Financial outcome{suffix}")
        used_titles.add(fo_ws.title)

    path = path or C.REPORT_XLSX
    wb.save(path)
    return path
