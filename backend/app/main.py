"""FastAPI app for the monthly outcome POC.

Thin on purpose. Every endpoint either reports status, triggers a run, or hands back the
cached run. No calculation happens here - that all lives in app/core, unchanged from the CLI,
so the API and the command line can never disagree about a figure.

    uvicorn backend.app.main:app --reload --port 8000

If frontend/dist exists it is served at / so the whole thing runs from one process. In
development the Vite server on :5173 talks to this over CORS instead.
"""
import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import service
from .core import config as C

app = FastAPI(title="Monthly Outcome", version="1.0.0",
              description="Technical Audit - monthly outcome and profitability reporting.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["status"])
def get_health():
    """What is reachable and what has been built. Cheap - safe to poll."""
    return service.health()


@app.post("/api/run", tags=["pipeline"])
def post_run(offline: bool = Query(False, description="read the voucher snapshot, not Tally"),
             as_of: str | None = Query(None, description="YYYY-MM-DD; the date the report is "
                                                         "being produced")):
    """Read the three sources, reconcile, build the report. Caches the result."""
    try:
        return service.run(offline=offline, as_of=as_of)
    except service.NotRunYet as e:
        raise HTTPException(409, str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(409, f"Missing source data: {e}. Generate the dataset first.") from e


@app.post("/api/generate", tags=["setup"])
def post_generate(push_tally: bool = Query(True, description="push vouchers to live Tally")):
    """Build the demo dataset, then run. A setup action, not part of the console.

    Deliberately not wired to any button: loading data is an operations task done once, and a
    control that rebuilds the figures underneath a report being reviewed is a control that will
    eventually be pressed by accident.

    Refuses if Tally already holds a different dataset in our window - this Tally cannot
    delete vouchers over XML, so a second import would double every figure.
    """
    try:
        log, state = service.generate(push_tally=push_tally)
        return {"log": log, "state": state}
    except SystemExit as e:
        raise HTTPException(409, str(e)) from e


@app.post("/api/mail/fetch", tags=["pipeline"])
def post_mail_fetch():
    """Pull new returns from the mailbox without rebuilding the report."""
    from .core import mailbox
    try:
        return mailbox.fetch()
    except mailbox.MailboxError as e:
        raise HTTPException(502, str(e)) from e


@app.post("/api/mail/reset", tags=["setup"])
def post_mail_reset():
    """Forget which messages have been fetched, so the next fetch re-downloads them.

    For rehearsing: send, fetch, reset, send the same mail again.
    """
    from .core import mailbox
    mailbox.forget()
    return {"reset": True}


@app.get("/api/state", tags=["pipeline"])
def get_state():
    """The last run. 409 if nothing has run yet."""
    try:
        return service.state()
    except service.NotRunYet as e:
        raise HTTPException(409, str(e)) from e


def _slice(name):
    try:
        return service.state()[name]
    except service.NotRunYet as e:
        raise HTTPException(409, str(e)) from e


@app.get("/api/consolidation", tags=["report"])
def get_consolidation():
    """What every source states, per project-month. Nothing derived, nothing combined."""
    return {"rows": _slice("consolidation"), "totals": _slice("totals")}


@app.get("/api/comparisons", tags=["report"])
def get_comparisons():
    """ERP against Tally per cost head, plus differences that are structural rather than real."""
    return {"rows": _slice("comparisons"), "composition": _slice("composition")}


@app.get("/api/unattributed", tags=["report"])
def get_unattributed():
    """Costs booked with no cost centre. Reported, never apportioned."""
    return _slice("unattributed")


@app.get("/api/outstanding", tags=["report"])
def get_outstanding():
    """Everything the run would not decide, each line with an owner."""
    return _slice("outstanding")


@app.get("/api/submission", tags=["report"])
def get_submission():
    return _slice("submission")


@app.get("/api/reminders", tags=["report"])
def get_reminders():
    """The chase schedule and chase list. GET sends nothing - see POST /api/reminders/send."""
    return _slice("reminders")


class ReminderSendIn(BaseModel):
    project: str
    month: str
    sentBy: str = ""


@app.post("/api/reminders/send", tags=["pipeline"])
def post_send_reminder(body: ReminderSendIn):
    """Mail one project's site contact everything still outstanding for one month.

    One real email, over SMTP, using the same account mailbox.py already reads live returns
    from. Refuses (404) if that project-month has nothing outstanding, and (502) if the
    mailbox isn't configured or the send itself fails.
    """
    from .core import remind
    try:
        return service.send_reminder(body.project, body.month, body.sentBy or None)
    except service.NotRunYet as e:
        raise HTTPException(409, str(e)) from e
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    except remind.ReminderError as e:
        raise HTTPException(502, str(e)) from e


@app.get("/api/adjustments", tags=["report"])
def get_adjustments():
    return _slice("adjustments")


@app.get("/api/lineage", tags=["report"])
def get_lineage():
    return _slice("lineage")


@app.get("/api/rules", tags=["report"])
def get_rules():
    """The four rules, each with the basis it traces to."""
    return _slice("rules")


@app.get("/api/check", tags=["report"])
def get_check():
    """Whether the figures match what the sources state - a read check, not a judgement."""
    return _slice("check")


@app.get("/api/masters", tags=["status"])
def get_masters():
    return _slice("masters")


@app.get("/api/position", tags=["report"])
def get_position():
    """Per project-month: every compared line, its reconciliation status, the auditor's
    decision if any, and what that leaves for approved cost, remaining tender and profit."""
    return {"rows": _slice("position"), "cumulative": _slice("cumulative")}


class DecisionIn(BaseModel):
    project: str
    month: str
    line: str
    choice: str          # "erp" | "tally" | "mail" | "custom"
    amount: float | None = None
    note: str = ""
    decidedBy: str = ""


@app.post("/api/decisions", tags=["pipeline"])
def post_decision(body: DecisionIn):
    """Record an auditor's decision on one differing line and recompute the cached run - no
    network calls, since the sources have not changed, only what a person decided about a
    difference already found in them."""
    try:
        return service.apply_decision(body.project, body.month, body.line, body.choice,
                                       body.amount, body.note, body.decidedBy)
    except service.NotRunYet as e:
        raise HTTPException(409, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.delete("/api/decisions", tags=["pipeline"])
def delete_decision(project: str = Query(...), month: str = Query(...),
                     line: str = Query(...)):
    """Undo a decision, back to pending."""
    try:
        return service.clear_decision(project, month, line)
    except service.NotRunYet as e:
        raise HTTPException(409, str(e)) from e


class FinalizeIn(BaseModel):
    project: str
    month: str
    finalizedBy: str = ""


@app.post("/api/finalize", tags=["pipeline"])
def post_finalize(body: FinalizeIn):
    """Close one project-month: freeze its approved cost/revenue/remaining/profit/margin.
    Refuses (400) if a compared line is still unresolved."""
    try:
        return service.finalize_month(body.project, body.month, body.finalizedBy)
    except service.NotRunYet as e:
        raise HTTPException(409, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


class ReopenIn(BaseModel):
    project: str
    month: str
    reopenedBy: str = ""


@app.post("/api/reopen", tags=["pipeline"])
def post_reopen(body: ReopenIn):
    """Reopen a finalized project-month. The prior snapshot is kept in its history, not erased."""
    try:
        return service.reopen_month(body.project, body.month, body.reopenedBy)
    except service.NotRunYet as e:
        raise HTTPException(409, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


class FinalizeAllIn(BaseModel):
    month: str
    finalizedBy: str = ""


@app.post("/api/finalize-all", tags=["pipeline"])
def post_finalize_all(body: FinalizeAllIn):
    """Close every project that is ready to finalize for one month, in one action. Never errors
    on a project that isn't ready - it's just skipped, and reported back as such."""
    try:
        return service.finalize_all_ready(body.month, body.finalizedBy)
    except service.NotRunYet as e:
        raise HTTPException(409, str(e)) from e


@app.post("/api/selftest", tags=["status"])
def post_selftest():
    """The checks that need no systems at all."""
    return service.selftest()


@app.get("/api/report.xlsx", tags=["report"])
def get_report(project: str | None = Query(None, description="one project code, or all"),
               month: str | None = Query(None, description="YYYY-MM, or the latest sampled")):
    if project or month:
        try:
            path = service.filtered_report(project, month)
        except service.NotRunYet as e:
            raise HTTPException(409, str(e)) from e
        return FileResponse(
            path, filename="Monthly_Outcome_Report.xlsx",
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    if not os.path.exists(C.REPORT_XLSX):
        raise HTTPException(404, "No workbook yet. Run the pipeline first.")
    return FileResponse(
        C.REPORT_XLSX, filename="Monthly_Outcome_Report.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ---------------------------------------------------------------- built frontend

_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..",
                                     "frontend", "dist"))
if os.path.isdir(_DIST):
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="ui")
else:
    @app.get("/", include_in_schema=False)
    def _no_ui():
        return {"message": "API is up. The UI is not built - run `npm run dev` in frontend/, "
                           "or `npm run build` to serve it from here.",
                "docs": "/docs", "health": "/api/health"}
