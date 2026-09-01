# Monthly Outcome — Technical Audit

An application for the Technical Audit division's monthly reporting. **FastAPI** backend,
**React** frontend, sharing the Purchase Division console's design system.

It reads the report's real sources — live **Tally**, an **ERP database**, and a **mailbox of
site returns** — consolidates what each one states, compares the two systems against each
other, and lists what a person still has to settle.

> Runs on a demo dataset: no client data has been supplied, so the figures, vouchers, ERP rows
> and returns are generated locally and modelled on a mid-size Tamil Nadu contractor. See
> [Open with the division](#open-with-the-division).

---

## Run it

**Two terminals.** Backend first.

```bash
pip install -r backend/requirements.txt
python -m uvicorn backend.app.main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to FastAPI, so the client uses relative
URLs and there is nothing to configure.

### One process instead of two

```bash
cd frontend && npm run build      # writes frontend/dist
cd .. && python -m uvicorn backend.app.main:app --port 8000
```

FastAPI then serves the console at **http://localhost:8000** with the API under `/api`. Swagger
is at `/docs`.

### Loading the dataset

The console never rebuilds its own figures — a control that regenerates the numbers underneath a
report someone is reviewing will eventually be pressed by accident. Loading data is a setup step:

```bash
python -m backend.app.core._cli --generate     # build the sources, push to Tally, export
python -m backend.app.core._cli                # re-read the sources, rebuild the export
python -m backend.app.core._cli --offline      # same, without touching Tally
python -m backend.app.core.selftest            # 11 assertions, no systems needed
```

The CLI exits non-zero if the figures stop matching what the sources state. It shares every
module with the API, so the console and the command line can never disagree about a figure.

### Two Windows notes

- **`npm run dev` and this path.** The folder name contains `&` (`B&B`), which npm's Windows
  `.cmd` shim splits on — `vite` resolves to a truncated path and fails. The `package.json`
  scripts call `node node_modules/vite/bin/vite.js` directly to sidestep the shim. Don't revert
  them to bare `vite`.
- **Vite binds IPv6.** Use `http://localhost:5173`, not `http://127.0.0.1:5173`.

### Without Tally

Everything runs from `data/tally_snapshot.json` if the gateway is down; the nav states which
source the figures came from. Tally itself needs the XML gateway on `localhost:9000` and a
company named `Tally Integration POC`.

### Live mail

Refresh in the console fetches new returns from a real mailbox over IMAP before rebuilding —
`core/mailbox.py`. Configure via `.env` (see `.env.example`); `POC_IMAP_USER` unset just means
the console reads only what is already on disk, which is also the automatic fallback if the
mailbox is unreachable.

Each project has its own sending identity (`config.SITE_MAILBOX` — a real, distinct From
address per site, set up as Gmail `+alias` send-as identities on one verified account, no
separate mailbox needed). Only mail from a known contributor address is accepted; anything else
is counted and named, never silently dropped.

Routing uses **two independent signals**, matching the division's own description — the
project is named in the subject, *and* there is a mail identity per project:

- `resolve_project()` — the project named in the subject line
- `resolve_sender()` — the project owning the From address

Either alone is enough to route a return; if both resolve and disagree, that is flagged rather
than silently picked. A mail that resolves neither lands as **Unrouted** on Source data with
the exact reason, rather than vanishing — proven live: a return whose subject omitted the
project name entirely still routed correctly from its sender identity alone.

---

## The three pages

**Home** — the portfolio read: a KPI strip (contract value, revenue, cost, profit, margin), a
revenue/cost/profit bar per project, the project performance table with a link straight into
Financial Outcome, four "financial risk / attention" cards (pending decisions, unassigned
costs, missing evidence, outcome status), a project risk table ranked by unresolved impact, and
one or two data-derived insight sentences (never arbitrary commentary — only a relationship
that two real extrema, e.g. lowest margin and highest revenue, actually share). No ERP/Tally
reconciliation detail lives here; that is Financial Outcome's job, one click away.

**Financial outcome** — the main product: one connected view per the flow Tender → Revenue →
ERP/Tally/Mail → Reconciliation → Auditor decision → Approved cost → Remaining tender →
Profit/Loss, not three reports stacked. A KPI summary strip sits above it for a fast read. Two
results, always shown together and never confused for each other: **Provisional** (what the
lines resolved so far support, right now — never all-or-nothing Pending just because one line
disagrees) and **Final** (only once every line is decided *and* the month is finalized — then
frozen, so a later decision cannot quietly move it). A status — `OPEN` → `AUDIT IN PROGRESS` →
`READY FOR FINALIZATION` → `FINALIZED` — tracks each project-month, with a **Finalize** button
once every line clears and a **Reopen** once it has.

Below the flow strip: with "All projects" selected, a per-project summary table (tender,
revenue, amount under review, current/approved cost, remaining, profit, margin, status — each
expandable into its month-by-month detail); with one project and month selected, that detail
directly — a profit waterfall beside the cost reconciliation table (the five compared lines and
their total, ERP/Tally/Mail side by side, each differing line carrying **Approve ERP** /
**Approve Tally** buttons — a line's Approved figure is null, shown as *Pending*, until one of
those is clicked) and a separate, compact supporting-evidence list (work done, RA bill, stock,
salary, formwork, each with a **Trace source** link into Source Data, pre-filtered). A "Key
exceptions" strip near the bottom gives the same pending/impact/unassigned/missing counts Home
shows, portfolio-wide, with shortcuts into the relevant review.

**Source data** — every source row from all three systems, filterable and searchable, so any
figure can be traced back and argued with. A source summary strip up top (total records,
visible/filtered, and every source type present); an "Unassigned costs" panel for Tally cost
with no project cost centre; selecting a row opens its detail with a **View in Financial
Outcome** action back to the project/month it feeds.

Outstanding is not a fourth page — see CLAUDE.md's "Decided: three pages, not four" for where
its content moved.

Excel export from the nav - respects whatever project/month is selected on this screen -
covering Executive Summary, Project Profitability, Cost Head Analysis, ERP vs Tally
Reconciliation, Mail/Site Data, Auditor Decisions, Audit Trail and Source Data, ending with a
basis-of-preparation sheet.

---

## The rules it applies

Four, and each traces to something the division actually asked for in discovery — not
something we assumed a good report should do:

| | Rule |
|---|---|
| R1 | Route each return to its project from the email subject line |
| R2 | Show the ERP figure and the Tally figure side by side, every cost head |
| R3 | Never resolve a difference — show both, name an owner |
| R4 | Capture adjustments that exist in neither system and list them |

`selftest.py` fails the build if a rule is added without a stated basis.

**Deliberately not done.** The division never specified a basis for any of these:

- recognise revenue on any basis
- derive material consumed from stock movement
- apportion head-office overhead across projects
- prefer one system over the other when they disagree
- infer a project from a voucher narration
- net a difference off against another month as a timing lag
- adopt a restated return silently

A cost booked without a cost centre, head office included, is reported as *not attributed*
rather than spread across projects.

**The one exception: profit, resolved through an auditor decision.** The division never
answered how the seven inputs turn into profit and loss, but the user explicitly authorized
building toward one for this POC. Rather than compute a guessed figure, a line that differs
between ERP and Tally stays **Pending** — no approved amount, no profit — until an **Approve
ERP** / **Approve Tally** action is recorded against it (`core/decisions.py`, persisted). Once
every cost line for a project-month is resolved, Approved cost = cost heads (whichever figure
was approved per line) plus cost-saving/provisional adjustments; Profit/Loss = Tender amount −
Approved cost. Head-office overhead stays excluded and stock is not converted to consumption,
so it is a resolved cost figure, not a complete one. See `CLAUDE.md`'s "Decided: profit
resolved through an actual auditor decision" for the exact mechanics.

None of this reasoning appears in the product itself — the screen just shows Pending until a
decision exists, and the resolved figure once one does. The traceability lives here and in
`CLAUDE.md`.

---

## The seven inputs

All routed off the **email subject line** — project, return type and month. Not a filename
convention, not a custom header. That is what a person reads, it still works when these are real
emails from real people, and it is the division's own observation: the project name is in the
subject and there is a mail domain per project.

`work done report` · `closing stock` · `RA bill certified` · `formwork report` ·
`site salary` · `manual adjustments` — plus the Tally and ERP extracts.

---

## Deliberate inconsistencies in the demo data

Seeded so the comparison has something real to find, and so the read check means something.

| Seeded | Reported as |
|---|---|
| A July material receipt reaches Tally in August | a difference — the run does not call it timing |
| A June subcontractor bill transposed in Tally | a difference — neither system knows it is wrong |
| A July subcontractor bill short-keyed in Tally | a difference — neither system knows it is wrong |
| A site establishment bill entered twice, two different months | a difference — neither system knows it is wrong |
| Tally splits plant across two ledgers; WBM keeps one | a structural difference, not a difference in value |
| Two vouchers with no cost centre, project named in the narration | not attributed — the narration is not acted on |
| One voucher with no cost centre and no hint anywhere | not attributed |
| The head-office pool, booked against no project | not attributed, at full value |
| Subjects use site shorthand, never the cost centre name | routed correctly by R1 |
| One store late every month; one payroll mail slips | flagged, with the repeat offender named |
| A July closing stock arrives understated, then is restated | both versions retained, change flagged |
| One formwork report never arrives | listed as a return to chase |

Current run: **118 figures reconciled to source, largest difference Rs 0**; 45 lines compared
(cost heads plus revenue) with 9 differing; ₹1,52,81,900 not attributed; 31 of 48 returns on
time.

---

## Layout

```
backend/
  requirements.txt
  app/
    main.py        FastAPI - status, run, one endpoint per screen
    service.py     runs the pipeline once, caches it, serialises it
    core/
      config.py       masters - projects, aliases, maps, calendar, contributors
      fabricate.py    builds the demo dataset; derives the answer key from what it made
      tally_io.py     Tally XML gateway
      erp.py          ERP stand-in - SQLite shaped as MMS / WBM / FBA, plus REV (a demo
                      addition for revenue, not client-named), plus extracts
      inbox.py        reads .eml, routes on the subject line, locates the header row
      tracker.py      returns expected against arrived, buffer calendar, chase list
      outcome.py      the four rules, the comparison, the consolidation, the read check,
                      the project/cumulative position (approved cost, remaining tender, profit)
      decisions.py    auditor decisions on ERP-vs-Tally differences, persisted
      finalization.py month-close - freezes final figures once every line is decided
      workbook.py     the Excel export - eight financial sheets plus Basis of preparation,
                      reads position/cumulative, computes nothing of its own
      selftest.py     11 assertions
      _cli.py         the command line
frontend/
  src/
    App.jsx        shell, floating nav, refresh and export
    views/         Home · Consolidation (Financial Outcome) · Lineage (Source Data)
    components/    DataTable (one table for every screen) · Bits · Icons
    styles/        tokens.css and base.css shared verbatim with the Purchase console
data/              generated: erp.db, inbox/, ground_truth.json, snapshot, .xlsx
_old/              an earlier CLI-only build, kept for reference
```

No calculation lives in `main.py` or `service.py`. The API is a shape adapter over `core/`.

### API

| Endpoint | |
|---|---|
| `GET /api/health` | what is reachable and what has been loaded |
| `POST /api/run` | read the sources, consolidate, build the export (caches the result) |
| `GET /api/state` | the last run, whole |
| `GET /api/consolidation` `comparisons` `unattributed` `outstanding` `submission` `reminders` `adjustments` `lineage` `rules` `check` `masters` | one slice each |
| `POST /api/selftest` | the assertions |
| `GET /api/report.xlsx` | the workbook |
| `POST /api/generate` | setup only — builds the dataset. Not wired to the console. |

---

## Open with the division

1. **One real month of their existing Excel report.** Worth more than everything else: it
   replaces the demo dataset and turns the read check into a genuine acceptance test.
2. Which system prevails when the ERP and Tally disagree, and on what basis. The product now
   has a mechanism for this — an auditor approves ERP or Tally per line, per project-month —
   but that is a case-by-case tool, not a standing policy. Worth asking whether the division
   wants a rule ("Tally always wins on labour," say) rather than a decision every time.
3. How the manual adjustments — unbilled work, quantity savings, unfixed rates — reach the
   final figure. The approved-cost figure currently guesses at this: unbilled work adds to
   revenue, quantity savings and provisional cost add to cost. Worth confirming or correcting.
4. Revenue recognition, stock treatment and overhead apportionment. Still unanswered, so
   Approved cost excludes overhead entirely and does not convert stock to a consumption
   figure — it understates true cost until these are settled.
5. The real contributor list and deadline calendar (`config.py` holds placeholders).
6. How many projects this report covers. "17" has come up twice in discovery, but only as
   *our* restatement back to them — we don't yet have the division's own confirmed answer.

## Environment

Tally runs in educational mode, which accepts vouchers only on the 1st, 2nd and 31st of a month.
Voucher deletion and company creation are both rejected, and every voucher we post carries a
marker (`config.VOUCHER_TAG`) so a regenerated dataset stays isolated from the last one.
