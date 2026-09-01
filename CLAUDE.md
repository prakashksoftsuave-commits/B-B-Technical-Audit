# POC 3 — Monthly Outcome, Technical Audit division (B&B Builders)

FastAPI + React. Reads live **Tally**, an **ERP stand-in** (SQLite) and a **mailbox of site
returns**, consolidates what each source states, and lists what a person still has to settle.

Requirements trace to a single client discovery session, cited inline wherever a rule or a
decision rests on it.

## Run

```bash
pip install -r backend/requirements.txt
python -m uvicorn backend.app.main:app --reload --port 8000     # API + built UI
cd frontend && npm install && npm run dev                       # http://localhost:5173
python -m backend.app.core._cli                                 # same pipeline, terminal
python -m backend.app.core.selftest                             # 11 checks, no systems
python -m backend.app.core._cli --generate                      # (re)load the demo dataset
```

Data lands in `data/`. `_old/` is a retired CLI-only build kept for reference — do not extend it.

---

## THE RULE ABOUT RULES

The run applies **exactly four rules**, and every one traces to something the division said:

| | Rule | Basis |
|---|---|---|
| R1 | Route each return to its project from the email subject line | client discovery session |
| R2 | Show the ERP figure and the Tally figure side by side, every cost head | client discovery session |
| R3 | Never resolve a difference — show both, name an owner | client discovery session |
| R4 | Capture adjustments that exist in neither system and list them | client discovery session |

`selftest.t_rules_are_all_traceable` fails if a rule is added without `origin == "asked for"`
and a cited source. That test is deliberate. Do not relax it.

**The rule list is not a screen.** There was a Rules screen showing each rule with its
citation plus a list of what the run deliberately avoids. The user removed it: the division
never asked for it, it was internal justification aimed at us, and a POC that argues for itself
does not look finished. The traceability lives here and in `README.md` instead. The Consolidation
screen's own "Basis of preparation" note was later removed too, on the same instruction, for the
same reason — the product should not be its own methodology document. The workbook's basis
sheet stood on the same reasoning for a while, until a later, separate, explicit instruction
removed it too — see "Decided: site staff salary also gets a role breakdown, and the Excel
export becomes exactly the console's own two sections." Treat that as the standing state now;
this paragraph is kept for the history, not as a rule still in force.

### Deliberately NOT done — do not "helpfully" add these back

All eight were in an earlier version and were removed on the user's instruction, because they
were our assumptions rather than the division's instructions. Five of the eight are still in
force:

1. ~~Recognise revenue on any basis~~ — reversed, see "Decided: revenue now follows
   percentage-of-completion" below.
2. ~~Turn opening/closing stock into a material consumption figure~~ — reversed, same decision.
3. Apportion head-office overhead across projects
4. Prefer one system over the other when they disagree
5. Infer a project from a voucher narration
6. Net a difference off against another month as a "timing lag"
7. Adopt a restated return silently

A cost with no cost centre is reported as *not attributed*, in full, never apportioned (item 3).

**Item 8, "compute a profit anywhere," is no longer absolute — see "Decided: an assumed profit
figure" below.** It is not reversed by discovering a citation; the user explicitly authorized
guessing at it, in these words, in order: *"they will make the decision"* (on which system
wins — unchanged, still item 4), *"most of the manual adjustments are received through the
mails"* (not actually an answer to how they fold in, just where they arrive from), and finally
*"I don't have answer you itself assume the calculation."* That third line is the authorization.

**Items 1 and 2 are no longer absolute either — see "Decided: revenue now follows
percentage-of-completion" below.** Reversed on a later, separate authorization
(*"I need this system to resemble the real percentage of completion so fix whatever needed for
that"*), not by discovering a citation for either item. Absent a similarly explicit instruction
for a *different* exclusion, treat items 3-7 the normal way: say what basis is missing, ask for
it, do not pick one.

### Decided: profit resolved through an actual auditor decision, not guessed at a second time

The first version of this (`outcome.assumed_profit()`) showed both bases side by side and
never resolved them - honest, but the user's next ask was explicit: an auditor's decision must
actually change the final cost and profit, not just get logged next to two unresolved figures.
That is a different, larger thing: it needs somewhere to *record* a decision, not just compute
around its absence. Built as real, persisted state, not a mock:

- `core/decisions.py` - one JSON file (`data/audit_decisions.json`), keyed by
  `project|month|line`. A decision is `{choice: "erp"|"tally"|"custom", amount, note,
  decidedBy, decidedAt}`. No default choice exists anywhere - a line with no recorded decision
  has no approved amount, full stop.
- `outcome.project_position()` / `outcome.cumulative_position()` - per project-month and
  summed-across-the-sample-per-project respectively. Every compared line (revenue + the four
  cost heads) carries `{erp, tally, diff, agrees, decision, approved}`. A line that agrees
  needs no decision, since there is only one figure - `approved` is set automatically. A line
  that differs stays `approved: null` (pending) until `decisions.record()` has been called for
  it. `approvedCost` for a project-month is `null`, not a guess, if *any* of its cost lines are
  still pending - so "the auditor's decision changed the profit" is literally true: nothing
  downstream had a value until they acted.
- `POST /api/decisions` / `DELETE /api/decisions` (`service.apply_decision` /
  `clear_decision`) - record or undo a decision and recompute the whole cached run against it.
  No network calls: `service.run()` now caches the last-fetched vouchers/mail/as-of date, and a
  decision only ever replays `outcome.build()` against what was already read, never re-reads
  Tally/ERP/mail. Still excludes head-office overhead (item 3 stands) and does not convert
  stock to a consumption figure (item 2 stands) - `approvedCost` is a resolved cost figure, not
  a complete one, for the same reasons as before.
- The product does not narrate any of this as an assumption on screen (the user was explicit:
  "assume it, don't show it as assumed"). The Consolidation screen just shows Pending until a
  decision exists, and the resolved figure once one does. The honest accounting of what is and
  is not assumed lives here, not in a banner.

Kept structurally apart from `consolidate()` / `build()`'s traceable core, same as before:
`t_consolidate_derives_nothing` still holds because the row dict it inspects never gained a
profit key - `project_position`/`cumulative_position` are separate functions layered on top. If
the division answers §6d/§7 of `POC3_Technical_Audit_Spec.md` with a real reconciliation
policy, these are the functions to change; R1-R4 do not move.

### Decided: provisional vs final, and a real month-close

Showing every project-month as flatly "Pending" the moment one line disagreed was rejected as
not useful - so `outcome._figures()` (called by both `project_position` and
`cumulative_position`) now computes two positions side by side, never conflated:

- **Provisional** - sums whatever cost lines are already resolved (agreed, or already
  decided), plus mail/site expenses and adjustments, which are never in dispute. Lines still
  pending are excluded, not guessed at; `underReview` states the sum of their differences
  separately, so nothing is hidden, only left out of the total until decided.
- **Final** (`approvedCost`/`remaining`/`profit`/`margin`) - stays `None` until every compared
  line (including revenue) has a decision. Identical formula to Provisional at that point;
  the distinction is only ever "how much is still missing," never a different calculation.

`core/finalization.py` is the actual month-close: once every line is resolved,
`POST /api/finalize` snapshots the final five figures plus every decision that produced them
into `data/finalizations.json`, keyed by `project|month`. From then on, `project_position`
reads that snapshot back instead of recomputing - a later decision change, a re-fetched
mailbox, or a regenerated dataset cannot move a month already closed. `POST /api/reopen` flips
`reopened: true` on the record (never deletes it) and computation goes live again until
finalized a second time, which keeps the prior snapshot in `history`. Verified directly: changed
a decision after finalizing and confirmed the frozen `approvedCost`/`profit` did not move, then
reopened and confirmed they did.

`outcome.status_of()` derives one of `OPEN` / `AUDIT_IN_PROGRESS` / `READY_FOR_FINALIZATION` /
`FINALIZED` from how many of a project-month's differing lines are still pending, or whether a
non-reopened finalization record exists. A portfolio-level status (all projects, or all months
of one project) is the least-resolved status among its parts - one open line anywhere means the
whole is not finalized.

**Bug found and fixed: the company summary and the project table were reading two different
scopes.** The backend was never wrong - `project_position()` (one month) and
`cumulative_position()` (every sampled month, summed) each independently satisfy
company-total = sum(their own rows), verified directly against the API. The bug was in
`Consolidation.jsx`: the flow-strip hero already switched between them correctly on the Month
filter (`heroRows = month === 'all' ? scopedCumulative : scopedPosition`), but
`ProjectSummaryTable` was hard-wired to `scopedCumulative` regardless of the filter - so with
one month selected, the hero showed that month's total while the table beside it silently
showed the full 3-month sum. Fix: `ProjectSummaryTable` now receives `heroRows`, the exact same
array the hero sums - one array feeds both displays, so they cannot diverge by construction.
Lesson for next time: when two displays are supposed to agree, derive them from one shared
value, not two calls that are expected to happen to match.

**Bug found and fixed: Remaining was computed against cost, not revenue.** `Remaining
contract value` and `Profit/Loss` answer two different questions - how much of the tender is
still unbilled, versus whether what was billed made money - and had been conflated into one
`tender - cost` figure. Corrected in `outcome._figures()` and `cumulative_position()`:
`remaining = tender - revenue`, `profit = revenue - cost`, computed independently. The
frontend had its own copy of the old (wrong) formula in `Consolidation.jsx`'s `hero` calc,
recomputing `tender - provisionalCost` instead of aggregating the backend's own
`provisionalRemaining` field - fixed to use the same tender/revenue aggregates instead of
re-deriving from cost. **Contract position** (Tender → Revenue recognized → Remaining contract
value) and **Financial performance** (Revenue → Cost → Profit/Margin) are now visually and
numerically separate sections in the flow strip, never combined into one chain.

---

## Live mail

The console reads a real mailbox. `core/mailbox.py` fetches over IMAP into `data/inbox/_fetched/`;
`inbox.py` is unchanged and walks that alongside the seeded months, so live and seeded returns
are indistinguishable downstream.

- Credentials live in `.env` (gitignored), loaded by `config._load_dotenv`. Never read or echo
  the password. `.env.example` is the template.
- **Only known contributors are accepted.** `mailbox.allowed_senders()` = the `CONTRIBUTORS`
  master plus `POC_IMAP_SENDERS`. Without it, Google's own account and security mails arrive as
  returns that cannot be routed. Ignored senders are counted and named, never silently dropped.
- Deduped on `Message-ID`. A re-fetch would otherwise register as a restatement of itself and
  put a phantom item on Outstanding.
- Wired to the **Refresh** button, no background poller - a timer firing mid-demo is worse than
  a click.
- An unconfigured or unreachable mailbox is not an error: the run completes from the folder
  alone, which is the fallback if the network fails.
- `POST /api/mail/reset` forgets what has been fetched, for rehearsing the same send twice.
- Contributors are six real Softsuave addresses mapped by role (QS A/B, Store A/B, central,
  audit lead). The seeded history uses them too, so history and live arrivals are consistent.
- `demo_send/` holds the pre-formatted attachment and the exact subject line for the live send.

## Conventions

- **No "fabricated" / "sample data" / watermark language** in the UI or the Excel export. The
  caveat lives in `README.md` only. The product's basis-of-preparation note states
  the treatment, not the provenance of the figures.
- **No "regenerate data" control in the UI.** Loading data is a CLI setup step; a button that
  rebuilds figures under a report being reviewed gets pressed by accident.
- **Design system is shared, not copied loosely.** `frontend/src/styles/tokens.css` and
  `base.css` are taken **verbatim** from `../Purchase-Division-POC/FE/src/styles/`. Keep them
  in sync; put only this app's additions in `app.css`.
- **No calculation in `main.py` or `service.py`.** They are shape adapters over `core/`. The CLI
  and the API share `core/`, so they can never disagree about a figure.
- Money uses Indian digit grouping and tabular numerals everywhere.

## Environment traps

- **`&` in the path breaks npm's Windows shim.** The folder is `B&B`; `cmd` splits on `&` and
  `vite` resolves to a truncated path. `package.json` scripts call
  `node node_modules/vite/bin/vite.js` directly. **Do not revert them to bare `vite`.**
- **Vite binds IPv6 only** here — use `http://localhost:5173`, not `127.0.0.1`.
- **The IDE clobbers files.** A file open in the VS Code editor has overwritten agent edits
  with its stale buffer twice (both times `core/fabricate.py`). If an edit seems to vanish,
  check the file rather than re-applying blindly, and ask the user to close the tab.
- **Tally** (`localhost:9000`, company `Tally Integration POC`), educational mode:
  - vouchers accepted only on the **1st, 2nd and 31st** of a month
  - the voucher collection **ignores** `SVFROMDATE`/`SVTODATE` — filter in Python on `DATE`
  - Tally **auto-renumbers** imports; `DATE` is the only reliable month signal
  - `CMPINFO` counts are dependency ids, not object counts — read the data back
  - `Day Book` export returns blank template vouchers — use a TDL collection
  - responses contain raw control bytes and refs like `&#4;` — clean before parsing
  - **voucher deletion is rejected** (`"Voucher does not exist!"` on a well-formed delete)
  - **company creation is rejected** (`"The Base Currency Symbol is required!"`, any payload)
  - the company holds **two older datasets** that cannot be removed, so every voucher we post
    carries `config.VOUCHER_TAG` in its narration and `fetch_vouchers` reads only tagged
    vouchers. Currently `[TA4]`. **Bump the marker when the dataset changes** rather than
    trying to delete - that is how a regenerated dataset stays isolated from the last one.
    `config.strip_tag` removes it before display. Full notes in `TALLY_NOTES.md`.

## Verification habits that have paid off

- `outcome.check()` compares every figure against what the sources state. It is a **read**
  check, not a judgement — and it has caught two real faults (an attachment layout the reader
  did not follow, and a renamed row label). Keep it passing.
- Frontend changes are verified by SSR-rendering each view against live API state via esbuild +
  `react-dom/server`. That caught a crash in the shared table footer before the user saw it.
- When writing a text-scanning check, use **word boundaries**. `/nan/i` matches real words and
  `/margin/i` matches `margin-top:` — both produced false alarms.
- Prefer the `Write` tool over bash heredocs for JSX and for Python containing `\n` escapes.
  Heredoc quoting has mangled both repeatedly.

## Open with the division — the real blockers

1. **One real month of their existing Excel report.** Worth more than everything else: it
   replaces the demo dataset and turns the read check into a genuine acceptance test.
2. Which system prevails when ERP and Tally disagree, and on what basis. There is now a
   mechanism for this (an auditor approves ERP or Tally per line, per project-month, via
   `POST /api/decisions`) but it is case-by-case, not a standing policy - worth asking whether
   the division wants a rule instead of a decision every time.
3. How the manual adjustments (unbilled work, quantity savings, unfixed rates) reach the final
   figure. Approved cost currently guesses: unbilled work adds to revenue, quantity savings and
   provisional cost add to cost.
4. **Overhead apportionment is still unanswered and still excluded** - Approved cost has no
   head-office overhead in it, so it understates true cost even once every line is decided.
   Revenue recognition and stock treatment are no longer open in the same way: both are now
   implemented (percentage-of-completion, see "Decided: revenue now follows
   percentage-of-completion") on the user's explicit authorization - but that implementation
   runs on a `budget` (Total Estimated Cost to Complete) per project that B&B has never
   confirmed. If a real QS estimate arrives, replace `config.py`'s placeholder `budget` values;
   nothing else about the calculation needs to change.
5. The real contributor list and deadline calendar (`config.py` holds placeholders).
6. How many projects this report actually covers. "17" has come up twice in discovery but only
   as **our** restatement; we don't yet have the division's own confirmed answer.
7. Whether the ERP records revenue at all, and if so, where. MMS/WBM/FBA were named while
   describing expenditure reconciliation against Tally (client discovery session) — that is not
   the same as a complete module list, and revenue was never asked about. `core/erp.py` now carries
   a fourth module, REV, purely so the product can show revenue ERP-against-Tally like the cost
   heads — a demo-completeness choice the user made explicitly, not an answer to this question.
   REV has no citation and should never be given one; if the division says the ERP has no
   revenue module, REV is the one thing to remove.

### Decided: the Excel export is the auditor's report, not a table dump

`core/workbook.py` was rebuilt from a nine-sheet raw-data dump into an eight-sheet management
report - Executive Summary, Project Profitability, Cost Head Analysis, ERP vs Tally
Reconciliation, Mail/Site Data, Auditor Decisions, Audit Trail, Source Data - plus the standing
closing Basis of Preparation sheet every report from this product ends with (see "THE RULE
ABOUT RULES" above). It computes nothing - every figure is read from `res["position"]`/`res["cumulative"]` (the same
`outcome.project_position()`/`cumulative_position()` output the API serialises for the
console), `decisions.load()` and `finalization.load()`. `workbook._aggregate()` sums those
project rows into one company row using the same rules the frontend's `hero` memo uses
(company = sum of projects; Remaining = Tender − Revenue; Final only when every project is
fully resolved) - a second, independent sum of the same canonical rows, not a second formula.
Respects whatever project/month is selected: `GET /api/report.xlsx?project=&month=` builds a
scoped workbook on demand from the cached sources (`service.filtered_report`); with no query
params it serves the last full run's file, unchanged behaviour. Verified end-to-end against a
live run: company totals in the Executive Summary and the Project Profitability Total row
match `outcome._aggregate()` computed independently, and the Total row on a live download
matches the live API's own cumulative sum to the rupee. Returns/reminders tracking (who's late
submitting a return) stayed out of this workbook on purpose - it's a different question from
this workbook's now-singular financial-reconciliation story, not something this rebuild forgot.

### Decided: three pages, not four

The console was redesigned around three pages - **Home** (portfolio position, which project
needs attention), **Financial Outcome** (the main product: reconcile, decide, finalize) and
**Source Data** (traceability) - and Outstanding was removed as a fourth top-level page. Its
content was not deleted, it was placed where each piece is actually used: pending-decision and
unassigned-cost counts became Home's "Financial risk / attention" cards and Financial Outcome's
"Key exceptions" strip; the per-project pending/impact ranking became Home's "Project risk /
exceptions" table; unassigned (not-attributed) cost got a home of its own on Source Data, next
to the source records it is a fact about. Nothing here is a second calculation - every figure
on Home and in Key exceptions is read from the same `position`/`cumulative`/`unattributed`/
`outstanding` fields Financial Outcome already reads, just aggregated at the portfolio level
instead of per project-month. `Outstanding.jsx` was deleted rather than kept unreferenced.

Financial Outcome also gained a "Trace source" action on each supporting-evidence line
(work done, RA bill, stock, salary, formwork) instead of the raw drill-down that used to sit
inline in the same table as the ERP-vs-Tally comparison - that comparison table now shows only
the five compared lines and their total, matching the "Cost reconciliation" shape asked for.
Trace source hands off to Source Data pre-filtered to that project/month/description via a
one-shot `navFocus` handoff (App.jsx), the same mechanism Home's "View outcome" and Source
Data's "View in Financial Outcome" use to land on the other page already filtered instead of
making the reader re-select a project.

### Decided: two gaps closed against the BRD - depreciation carry-forward, evidence status

A reconciliation against the client's BRD (Business Requirements Document, derived from the
discovery session) turned up two gaps worth closing at POC level; everything else it found
either needs a client answer first
(fragmented reports, "material reconciliation," the WhatsApp/SOP fragment - all flagged as
unclear in the BRD's own Open Questions) or is more than a POC needs (MD-facing login/approval).

- **FBA depreciation carry-forward** [BRD §5]: "a depreciable asset bought within a project is
  depreciated inside that project; the non-depreciated remainder carries to the next project."
  `fabricate.py`'s FBA generator now actually splits the monthly site-establishment charge: the
  carrying project depreciates 85% locally, the other 15% is booked as a second FBA line onto
  the *next* project's books for the same month (`FBA_NEXT_PROJECT`: Riverside → Tidel → ORR;
  ORR is last in sequence and has nowhere to carry to, so it still depreciates its full charge
  locally, unchanged). Tally never learns of the carry - it always books the full site charge to
  whichever project incurred it - so this now produces a real ERP-vs-Tally difference on the
  site-establishment line for Riverside and Tidel, not a synthetic one layered on top. No new
  UI: the figure just flows through the existing cost reconciliation table on Financial Outcome,
  and Source Data's existing FBA description already names the carry
  ("...carried from Riverside Towers - Manapakkam") with zero frontend changes. Rebuilt with
  `_cli.py --generate --no-tally` - Tally's own vouchers are untouched by this, only `erp.db`
  and `ground_truth.json` needed rebuilding, so nothing needed re-pushing to the live company.
- **Evidence status on Home** [BRD §3 step 5, §5 bullet 3]: the buffer/notify-date rule and
  late-submission tracking were always fully computed (`tracker.py`, still served at
  `/api/submission`/`/api/reminders`, still printed by the CLI) but had no UI since Outstanding
  was folded away - the "Missing evidence" card on Home showed a bare count with nothing behind
  it. It's now "Evidence status": the figure covers both not-yet-received *and* received-late
  (the client's actual complaint was the late follow-up, not just the missing report), and
  clicking "View details" expands the card in place into the real list - project, report,
  owner, days late - reusing the same expand/collapse pattern already used elsewhere rather than
  navigating away. No new page, no new API - `state.submission.rows` was already there.

### Decided: August is a real month now, staged for a live-mail demo rehearsal

August was "fetched but never reported" (a look-ahead window for one late Tally posting) - it is
now a fourth entry in `MONTHS`, with the same look-ahead role handed to September instead. Two
things needed generating (`fabricate.py`), everything else came free since every generator
already loops over `C.MONTHS` generically:

- **One ERP-vs-Tally story**: Riverside's subcontractor bill for August, keyed wrong in Tally
  (`KEYING_ERRORS`) - the same mechanism June's Tidel and July's ORR already use, just Riverside's
  turn.
- **Two deliberately withheld returns**: ORR's "RA bill certified" and Tidel's "Formwork report",
  both for August (`NEVER_ARRIVED`) - each meant to arrive live, by a real email sent during the
  actual demo, the same way ORR's July formwork report already did in an earlier demo. Two
  different projects and return types, so the two live sends don't collide. Ready-to-send
  attachments sit at `demo_send/ra_bill_ORR-1063_2026-08.xlsx` (₹3,78,63,000 RA bill, ₹18,93,150
  retention) and `demo_send/formwork_ITP-1052_2026-08.xlsx` (7,895 sqm, ₹3,17,951 hire
  recovered) - both built from the same `reality()` figures the rest of each project's August
  return already implies. `demo_send/README.md` has the exact subject/sender/attachment triple
  for each.

The live Tally company had 113 vouchers already sitting under the previous marker (`[TA4]`) and
cannot have them deleted (see TALLY_NOTES.md) - the August-inclusive rebuild is a different
dataset, so the marker was bumped to `[TA5]` and the fresh 149-voucher set pushed under that,
exactly the "bump, don't delete" pattern this file already documents elsewhere. A full
`config.py` + `data/` backup was taken first (this is not a git repo), so the whole August
addition - config, generated data, and the live Tally push - can be undone by restoring it,
independent of anything above.

**Rehearsal vs the real demo, for whoever reads this next:** rehearsing the live-mail send with
the *real* subject/sender format (rather than a deliberately unroutable test subject) is the
only way to actually exercise the real routing path - but it leaves a `.eml` file in
`data/inbox/_fetched/`. Delete that specific file before the real send and nothing carries over;
leave it and the real send just becomes a second, later-arriving version (reported as a
restatement, not an error - R1/R4's own mechanism, never a crash).

**Decided, not open:** the ERP side was a genuine gap — no ERP code or database was ever made
available — but the user explicitly decided to accept `core/erp.py`'s SQLite stand-in **as**
the ERP database for this POC, rather than treat it as pending. Do not re-raise "no real ERP
access" as an open item; if a real extract arrives later, `erp.extract()` is the one function
that changes. All three integration legs — Tally, the accepted ERP stand-in, and live mail
(IMAP, proven with both subject- and sender-based routing) — are complete for this POC.

### Decided: revenue now follows percentage-of-completion, reversing "deliberately NOT done" items 1 and 2

The user's own words authorized this, explicitly, in this order: given the analysis that this
product's revenue and cost figures don't resemble how a tender-basis construction company
actually recognizes revenue monthly, the instruction was *"I need this system to resemble the
real percentage of completion so fix whatever needed for that."* That reopens exactly two of the
eight "deliberately NOT done" items above - **item 1** ("Recognise revenue on any basis") and
**item 2** ("Turn opening/closing stock into a material consumption figure") - and no others.
Item 3 (head-office overhead apportionment) was never asked about here and stays excluded.

What changed, in `core/outcome.py` and `core/config.py`:

- **Material consumption** (`_stock_adjustment`) - `opening stock − closing stock`, folded into
  `provisional_cost`/`approvedCost` alongside the existing cost heads, zero if either figure is
  missing. This is the ordinary accounting identity (Opening + Purchases − Closing = Consumed;
  purchases already sit in the cost heads, so the adjustment is just the opening/closing delta),
  not a new assumption - it makes `_figures()`'s "cost" line finally mean *cost of work
  consumed* rather than *cost of material bought*.
- **Percentage of completion** (`_poc_month` / `poc_position`) - `% complete = cost to date ÷
  total estimated cost to complete`, `revenue to date = tender × % complete`, this month's
  revenue = the incremental difference from last month's revenue-to-date. Layered strictly on
  top of `project_position()`'s already-reconciled `approvedCost`/`provisionalCost` - never a
  second cost calculation, same discipline as `project_position`/`cumulative_position`
  themselves. A foreseeable loss (`budget > tender`) is recognized in full immediately, never
  spread - the field is wired and returned for every project-month but is `0` for all three
  current projects, since none of their placeholder budgets exceed their tenders yet.

**The one placeholder this depends on:** `config.py`'s new `budget` field ("Total Estimated Cost
to Complete") per project - a number no one at B&B has given us, invented the same way the
assumed-profit figure was invented earlier in this file, under the same kind of authorization.
It is *not* the same number as `value` (the real tender/contract amount). If a real QS estimate
arrives, `config.PROJECTS[...]["budget"]` is the one place to put it - nothing else changes.

**Two honest limitations, both inherent to the sample, not bugs:** (1) "cost to date" only sums
the sampled months (May-Aug), not the project's full history since inception, despite
`months_run` showing 11-19 months already elapsed for these projects - so % complete and POC
revenue are understated versus a real deployment that had cost data from day one. (2) Because
revenue-to-date is linear in cost-to-date for a fixed budget/tender pair, POC margin comes out
constant per project across months in this sample - that is the correct behavior of the
cost-to-cost method absent a budget revision, not a computation error.

**Surfaced on screen, not narrated as an assumption**, per the same standing instruction as the
assumed-profit feature ("assume it, don't show it as assumed"): a new "Percentage of completion
(estimated)" table on Financial Outcome, reading `poc_position`'s output via `service._poc`,
kept structurally and visually separate from the Current/Final auditor-decided tables above it -
never merged in, since these are two different questions (what a person has actually approved,
vs. what the cost-to-cost method estimates should be recognized). Not added to Home's portfolio
KPIs - those remain the auditor-approved figures, which is what a dashboard headline should show.

### Decided: site staff salary becomes a real ERP-vs-mail reconciliation

The user's own framing authorized this: HR fixes the salary figure in the ERP, and the site
separately reports its own salary figure by mail - "now the auditor need to open it and compare
them and approve them," explicitly calling it an assumption they were introducing, the same way
the assumed-profit and POC-budget assumptions were. Before this, `_mail_cost()` treated site
salary exactly like formwork - a mail-only expense with nothing to dispute, always added
straight to cost. That is no longer true for salary specifically.

What changed:

- **A fifth ERP module, HRM** (`erp.py`'s `hrm_salary` table, `config.py`'s `ERP_MODULES["HRM"]`)
  - on the same footing as REV: not client-named, no citation, and the one to drop if a real
  extract arrives without a payroll module. It books the *true* payroll figure every month.
- **`outcome._salary_status()`** - the same agree/differ/decide/approve shape as the four
  ERP-vs-Tally cost heads (`_line_status`), but comparing `salary_erp` (HRM) against `salary`
  (the site's own mailed figure) instead. Kept deliberately OUT of `COMPARED`/`COST_LINES` -
  those stay exactly what R2's citation means (ERP-vs-Tally only) - and folded into
  `differing`/`pending`/`cost_pending` by hand in `_figures()` instead, so an unresolved salary
  line blocks finalization exactly like an unresolved cost head, without ever being counted
  toward R2/R3's fired totals or "Total - cost heads."
- **`decisions.py`** gained one more valid `choice`: `"mail"`, alongside `"erp"`/`"tally"`/
  `"custom"` - the store itself is fully generic on the line and choice strings, so nothing else
  about it needed to change.
- **One deliberate story, not a permanent gap**: `fabricate.py`'s `SALARY_MISMATCH` understates
  Tidel's August mail-reported salary by 9% against HRM's true figure - a wage revision HR had
  already applied that the site's own headcount count had not caught up with yet. Every other
  project-month has the mail and ERP salary figures agree, same discipline as every other
  reconciliation in this dataset: a difference is a *named* mechanism, never unexplained noise.
  Both sides now have their own ground-truth check too (`erp_salary`/`mail_salary` in
  `ground_truth.json`, verified by `outcome.check()`), matching the precedent stock's
  opening/closing figures already set.
- **On screen**: "Site staff salary" is a real row in Financial Outcome's cost reconciliation
  table now, not a plain "Reported, no decision needed" line - ERP in the ERP column, the site's
  mail figure in the Mail/Site column (Tally stays dashed, since Tally has no payroll ledger),
  and when they disagree, "Approve ERP" / "Approve Mail" buttons exactly like the four cost
  heads' "Approve ERP" / "Approve Tally" ones. Expanding the row traces to both sources together
  - the HRM entry and the site's own mail return - the same "see both sides at once" pattern the
  four cost heads already use.

### Decided: the Excel export becomes a minimal final-outcome report

"The current excel file has too many slides and too many data, I need clean and clear excel
report with minimal sheet which contains the data of the final outcome." The eight/nine-sheet
version (Cost Head Analysis, ERP vs Tally Reconciliation, Mail-Site Data, Auditor Decisions,
Audit Trail, Source Data, on top of Executive Summary and Project Profitability) duplicated
detail the console's own Financial Outcome and Source Data pages already carry in full, with
working drill-downs - the workbook does not need to be a second copy of that.

Cut down to three sheets: **Executive Summary** (company headline), **Project Profitability**
(the same, broken out per project - the one supporting breakdown kept, since "per-project final
figures" is still squarely "the final outcome," not raw reconciliation detail) and **Basis of
Preparation**, which stays regardless of how minimal the report gets, per "THE RULE ABOUT RULES"
above. Computes nothing new - both surviving sheets already read straight from
`res["position"]`/`res["cumulative"]` via `_scope()`/`_aggregate()`, unchanged. Company totals
verified against the live API after the cut: Executive Summary and Project Profitability's Total
row both match `position` scoped to the same month, to the rupee.

The Basis of Preparation text was also corrected while in there - it still said revenue
recognition and stock consumption had "no basis" and were excluded, which stopped being true
once percentage-of-completion was added (see above); it now says overhead apportionment is the
one thing still excluded, and names the POC estimate and its budget assumption instead of
pretending the older exclusion still stands.

### Decided: the Excel export mirrors Financial Outcome

The cut above went too far: "minimal" was read as "sheet count," but the user's actual ask on
the very next round was that the report carry "exactly the same detailed information" as the
Financial Outcome page - the full cost reconciliation, not just the two summary sheets. Added
back as a fourth sheet, **Cost Reconciliation** (`workbook._cost_reconciliation`), which mirrors
`Consolidation.jsx`'s `ItemTable` row for row: revenue and its mail evidence, material and the
stock detail behind it, the remaining cost heads, site staff salary (ERP-vs-mail, same as the
console), formwork, adjustments, and the two totals - for every sampled project-month. Still
computes nothing - reads `res["rows"]` (`consolidate()`) and `res["position"]`
(`project_position()`) directly, same source the console's own API reads. Verified line for
line against the live API for three project-months (including the two with a pending line -
ORR's missing RA bill, Tidel's salary mismatch) before calling it done. What stayed cut: the
raw ERP/Tally/mail source rows and the decision/finalization audit trail - those are Source
Data's job, with working drill-downs the console already has, not this report's.

### Decided: every cost head gets real transaction-level detail, not one lump sum

Same round, a second ask: expanding a cost head on Financial Outcome showed only 1-3 underlying
vouchers for Subcontractor, Machinery and Site establishment (Material already had 10, from its
five materials × two systems) - not enough to read as a real monthly close. `fabricate.py` now
splits each of those three cost heads into several named trades/equipment/expenses instead of
one bulk figure, on both ERP and Tally, via a new `_split()` helper that shares the total across
items by weight and pins the last one to the exact remainder - the reconciled total per cost
head, and every ground-truth figure, is unchanged to the rupee; only what is underneath it
changed. `SUBCON_ITEMS` (civil works, labour supply, shuttering labour, steel fixing),
`MACHINERY_ITEMS` (excavator/loader, concrete pump, tower crane) and inline splits for site's
service/depreciation portions. One exception, deliberate: the months `KEYING_ERRORS` already
names keep the exact two-line Tally split that mechanism's hardcoded true/wrong figures depend
on - richer detail everywhere else, untouched where a specific story already exists. Verified:
selftest 11/11, the read-check still faithful, and every DIFFERS figure in the CLI output
identical before and after - confirming the split changed row counts only, never a total.
Result: Subcontractor and Machinery now show 6-8 lines when expanded, Site establishment 7-8,
Material still 9-10 - up from 1-3 before. Salary was left at ERP + one mail return (2 lines) at
the time - see the next round below for why that changed too.

### Bug found and fixed: the transaction-detail split was 100x off on every individual line

The round above computed the reconciled TOTAL per cost head correctly (which is all
`outcome.check()`, `selftest`, and the CLI's own DIFFERS output verify), but every individual
transaction beneath it was wrong by two orders of magnitude - discovered only once something
actually looked at the detail rows the very next round asked for. `_split()`'s rounding formula
(`round(total * share / 100) * 100`) was copied from `MATERIALS`, which uses a *fractional*
share (0.30 meaning 30%) - but `SUBCON_ITEMS`/`MACHINERY_ITEMS`/`SITE_ITEMS` were written with
*percentage-point* shares (30 meaning 30%), inflating every one of the first N-1 items 100x and
dumping the entire compounding error onto the last item as a huge negative to bring the sum back
to the correct total. The aggregate reconciliation never moved, so nothing that already existed
caught it - a genuine blind spot in "verify the total" as a sufficient check once the total stops
being the only thing on screen. Fixed by converting every one of those share lists to fractions,
matching `MATERIALS`' own convention exactly, and re-verified the individual amounts this time,
not just the sum they roll up to.

### Decided: site staff salary also gets a role breakdown, and the Excel export becomes exactly the console's own two sections

Two asks in one round: "for whom, how much" on salary specifically (matching what was just done
for the other cost heads), and the Excel report should show "exactly the same detailed
information" as the console - not a set of report-shaped sheets invented for the workbook, but
literally the two sections `Consolidation.jsx` itself has, "Project outcomes" and "Financial
outcome," pivoted/grouped the way the page presents them, scoped to whichever month is actually
selected.

- **Salary role breakdown**: `SALARY_ITEMS` (skilled labour, unskilled labour, supervisory
  staff, site engineers) splits HRM's true payroll figure the same way the other cost heads
  split theirs - same total, `_split()`, same fractional-share fix as above. The mail
  attachment's own content was enriched with the same role breakdown too, for realism, even
  though the mailbox still only produces one trackable source record per email - a mail return
  is one attachment, and splitting the *lineage record* would mean tracking sub-lines within a
  single email, which nothing else in this project does. What changed is the number an auditor
  can read once they open that attachment, not how many source records this system tracks for it.
- **The Excel export is now exactly two sheets**: **Project outcomes** (the project summary
  table, then - grouped and collapsible per project via real Excel outline levels, the same way
  the console expands one - the full cost reconciliation plus the raw ERP/Tally transaction
  detail behind every cost head) and **Financial outcome** (Contract Position / Financial
  Performance, Current then Final - "Current" now, not "Provisional," matching the site-wide
  wording change already made elsewhere). Executive Summary, Project Profitability and Cost
  Reconciliation (all three from the last two rounds) were merged/renamed into these two;
  nothing was recomputed, the same `res["position"]`/`res["rows"]`/`res["erp_detail"]`/
  `res["tally_detail"]` feed both, just reorganized and regrouped.
- **Basis of Preparation is gone, on direct instruction** - this reverses "THE RULE ABOUT
  RULES"'s own standing line above ("The workbook's basis sheet stays"). That line was true
  until this explicit request superseded it for this workbook; the underlying principle (state
  the caveat where it belongs, not as a badge on the deliverable) still lives in this file and
  in README.md, just not as a sheet inside the report itself.
- **Scoping bug fixed**: the two previous rounds' reconciliation sheet ignored `_scope()`
  entirely and always iterated every sampled month regardless of the console's month filter, so
  exporting while viewing one month still produced all four. `_project_outcomes` now takes the
  same `rows`/`month` `_executive_summary` (now `_financial_outcome`) already used correctly -
  verified by requesting `?month=2026-05` directly and confirming the sheet's own note names
  only that month, not all of them.

### Decided: every remaining single-line item gets a real breakdown too - revenue, work done, stock, formwork

Material/Subcontractor/Machinery/Site/Salary all show real detail when expanded; five items
still showed one line with nothing under it - Contract revenue, Work done report, Opening
stock, Closing stock, Formwork report. Same treatment, same `_split()` helper, same discipline
(the reconciled total is unchanged to the rupee, only what is underneath it changed):

- **Revenue** (ERP REV + Tally Sales) splits into `config.WORK_CATEGORIES` (Civil works, MEP
  works, Finishing and other works) - on both sides, so a real ERP-vs-Tally comparison exists
  per category, not just the total. `rev_billing` gained a `description` column to carry the
  category name (it only ever said "Certified RA bill" before, regardless of row).
- **Work done report** (mail) states the *same three categories*, deliberately - the site's own
  work-done claim and what got billed are now expressed in the same language, so an auditor can
  compare "site says Civil works = X" against "billed Civil works = Y" directly instead of two
  unrelated lump sums.
- **Opening/closing stock** (mail) splits by `config.STOCK_MATERIALS` (Cement, Steel, Aggregate,
  RMC, Shuttering material) - the same five materials `MATERIALS` already tracks for the
  Material consumed cost head, just restated as a stock position instead of a purchase.
  Opening and Closing were previously two UI rows sharing one lineage label ("Closing stock",
  an existing quirk since a stock return states both figures) - they now carry distinct labels
  (`Opening stock` / `Closing stock`) so expanding one never shows the other's breakdown mixed
  in; `MAIL_LINEAGE_LABEL` on the frontend was updated to match.
- **Formwork report** (mail) splits "Formwork hire recovered" by `config.FORMWORK_CATEGORIES`
  (Slab, Column and beam, Staircase and miscellaneous formwork).

**Bug found and fixed while wiring this up**: Formwork's own attachment has always used a
"Value" column header, not "Amount" (`IB.value()`'s own `amount()` helper already checks both,
for exactly this reason) - the new extraction code in `service._lineage()` and
`workbook._sub_detail()`/`_mail_sub_detail()` only checked "Amount", so every formwork
breakdown row silently came back with no figure on it until this was caught and fixed the same
way `IB.value()` already handles it: check "Amount", fall back to "Value".

All four mail-only breakdowns (`_MAIL_BREAKDOWN` for work_done/hr_salary/formwork, plus stock's
own opening/closing handling) are read back out of `res["inbox"]`'s own parsed attachment rows -
the same rows the return actually stated - independently in `service.py` (for the console) and
`workbook.py` (for the Excel export, via `_mail_sub_detail`/`_stock_sub_detail`), so both trace
to the same figures without one importing the other. Revenue's ERP/Tally split needed no new
plumbing at all - `_sub_detail`/the console's own drill-down already read `erp_detail`/
`tally_detail` generically by `line`, so simply generating more rows tagged `line: "revenue"`
was enough. Verified across all three projects: every one of these five items now shows real
figures under it (Riverside/Tidel/ORR all checked directly against the API), except Tidel's
August formwork, which is the one return deliberately withheld for the live-mail demo and
correctly shows zero detail rows rather than a fabricated one.

**Bug found and fixed: the two total rows could say "Matched"/"Final" while contradicting the
numbers right next to them.** "Total — cost heads" set its status from `heads_pending` alone -
once every line had a decision it said "MATCHED" even when the raw ERP and Tally totals were
still genuinely apart (an auditor had picked a side, which does not make the two systems agree)
- visibly wrong once a real difference sat in red in the very next column. Same row's "approved"
figure was also naively `erp_heads`, correct only by coincidence whenever every decided line
happened to choose ERP; a line decided in Tally's favour would have made it wrong outright. Now:
`MATCHED` only when the raw totals actually match, `RESOLVED` when every line is decided but
they never did, and the shown total is the sum of each line's own `approved` value, not an
assumed side. Separately, "Total — cost (incl. mail & stock)" called a month "Final" the moment
`approvedCost` was non-null - true once every line is decided, but that is
`READY_FOR_FINALIZATION`, not `FINALIZED`; ORR showed "Final" here while its own Status column
two sections up still read "READY FOR FINALIZATION," the two statements contradicting each
other in the same sheet. Now `FINAL` is reserved for `pos["status"] == "FINALIZED"` specifically,
with `RESOLVED` ("resolved, not yet finalized") for the in-between state. Verified against live
data for both Riverside (genuinely `FINALIZED`) and ORR (`READY_FOR_FINALIZATION`) before and
after - the labels now agree with the Status column instead of contradicting it.

### Decided: the site mailboxes are no longer tied to a personal name

The three site identities were `prakashk.softsuave+<site>@gmail.com` - a real person's name on
every "From" address and, on real sends, as the Gmail account's own display name too (nothing in
this codebase ever set that name; it comes from the sending account's own profile). On explicit
instruction, `config.SITE_MAILBOX` now reads `softsuave2026+<site>@gmail.com` for all three -
same structure, same three site suffixes, new base account. The user set up the real Gmail side
first (a `softsuave2026@gmail.com` account with "Send mail as" configured for all three "+site"
aliases, display name "Softsuave") before asking for the code change, so both sides went live
together rather than one waiting on the other.

Regenerated the seeded May-Aug mail history so the old address doesn't linger in fabricated
data either. One real, expected side effect: two *already-fetched* live emails sent during
earlier rehearsal from the old address - Tidel's July stock-restatement test and the
sender-only-routing test (`demo_send/README_sender_test.md`) - now show up as "could not be
routed," since the sender they were sent from is no longer in `SITE_MAILBOX`. This is R1 working
correctly, not a bug (an unroutable mail is a finding, not a crash) - left as-is rather than
deleted, since they are historical rehearsal artifacts, not part of the live August demo
scenario. `demo_send/README.md` and `README_sender_test.md` updated to the new addresses so the
instructions for the actual demo match what will really go out. Verified: selftest 11/11, every
DIFFERS figure and the read-check identical before and after - confirming this only touched
sender identities, never a reconciled number.

### Decided: Finalize works from the "all projects" view too, plus a portfolio-wide Finalize all

Finalize/Reopen only ever lived in the single-project view's `FinancialFlow` - resolve every
line for a project while looking at "All projects" (the `ProjectSummaryTable` expand), and there
was nowhere to click Finalize without first re-filtering down to that one project. Two additions,
both reusing the exact same backend action nothing new was invented for the single case:

- **Per-project Finalize/Reopen inline**: `ProjectSummaryTable`'s expanded month view now shows
  the same Approve & Finalize / Reopen buttons `FinancialFlow` already had, right under that
  project's own `ItemTable`, gated on the same `readyToFinalize`/`status` fields.
- **`POST /api/finalize-all`** (`service.finalize_all_ready`) - closes every project that is
  ready for one month in a single call, skipping (never erroring on) anything not ready or
  already finalized, and reporting both lists back so the console can say exactly what happened
  rather than assuming "all of them." One new endpoint, not a loop of the existing one, so it is
  one state rebuild instead of N. Surfaced as "Finalize all ready (N)" in the Project outcomes
  card, shown only when a specific month is selected and at least one project actually qualifies.

Verified live: with Riverside already finalized and Tidel still open, calling this for August
finalized only ORR (the one that was ready), left the other two alone, and reported both lists
correctly - confirmed against `/api/state` before and after, and selftest still 11/11.

## Repo map

```
backend/app/main.py        FastAPI - status, run, one endpoint per screen
backend/app/service.py     runs the pipeline once, caches it, serialises it
backend/app/core/
  config.py       masters - projects, aliases, ledger and module maps, calendar, contributors
  fabricate.py    builds the demo dataset; derives ground_truth.json by summing what it made
  tally_io.py     Tally XML gateway
  erp.py          ERP stand-in - SQLite shaped as MMS / WBM / FBA, plus REV and HRM (demo
                  additions for revenue and payroll, not client-named), plus extracts
  inbox.py        reads .eml, routes on the subject line, locates the header row
  tracker.py      returns expected vs arrived, buffer calendar, chase list
  outcome.py      the four rules, the comparison, the consolidation, the read check, the
                  ERP-vs-mail salary reconciliation, the project/cumulative position (approved
                  cost, remaining tender, profit)
  decisions.py    auditor decisions on a differing line - ERP-vs-Tally for the four cost heads,
                  ERP-vs-mail for salary - the one place one gets resolved, by a person, never
                  automatically
  finalization.py month-close: snapshots final figures once every line is decided, so a
                  closed month cannot move; reopen keeps the prior snapshot in history
  workbook.py     two sheets, exactly the console's own "Project outcomes" / "Financial
                  outcome" sections, grouped/collapsible per project via Excel outline levels -
                  reads position/rows/erp_detail/tally_detail, computes nothing
  selftest.py     11 assertions
  _cli.py         the command line
frontend/src/views/         Home · Consolidation (Financial Outcome) · Lineage (Source Data)
                            (3 pages - see below re: no Rules screen, and "Decided: three
                            pages, not four" for why Outstanding is not a fourth one)
frontend/src/components/    DataTable (one table for every screen) · Bits · Icons
data/                       generated: erp.db, inbox/, ground_truth.json, snapshot, .xlsx
```
