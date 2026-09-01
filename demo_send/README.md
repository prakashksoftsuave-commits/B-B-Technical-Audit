# Live sends for the actual demo

Two returns are deliberately absent right now. Both show on Consolidation as "not received"
and on Home/Outstanding as a "chase" item. Sending each live, then pressing Refresh, clears it.

## Beat 1 — ORR's RA bill, Aug 2026

    From        softsuave2026+orrflyover.pkg3@gmail.com
    To          bbbuilders.reports@gmail.com
    Subject     RA bill certified - ORR - Aug 2026
    Attach      ra_bill_ORR-1063_2026-08.xlsx

Figures: RA bill certified ₹3,78,63,000, retention withheld ₹18,93,150 (5%) - the same numbers
the rest of ORR's August return already implies.

## Beat 2 — Tidel's formwork report, Aug 2026

    From        softsuave2026+tidel.taramani@gmail.com
    To          bbbuilders.reports@gmail.com
    Subject     Formwork report - Tidel - Aug 2026
    Attach      formwork_ITP-1052_2026-08.xlsx

Figures: formwork area used 7,895 sqm, formwork hire recovered ₹3,17,951 - computed from the
same `reality()` figures the rest of Tidel's August return is built from.

## Common to both

The subject must be exactly as above - the project, the return type and the month are all
read from it. Body text does not matter. The From address is a second, independent routing
signal (rule R1's "a mail domain per project") - correct even if a subject line ever omitted
the project name.

Both will arrive flagged LATE against Aug 2026's contributor cut-off, which is correct and
worth pointing out live: the return landed, the gap closed, and the delay was recorded, not
hidden.

## If you need to send either one more than once while rehearsing

    curl -X POST http://localhost:8000/api/mail/reset

That forgets which messages have been fetched, so the same mail can be pulled again. It does
NOT delete the downloaded copy in `data/inbox/_fetched/` - if you rehearse the real subject
line again, delete that specific `.eml` file afterwards so the real send doesn't land as a
second, later "restatement" of your own rehearsal.

## Already demonstrated, not part of this round

ORR's formwork report for Jul 2026 (`formwork_ORR-1063_2026-07.xlsx`) was the first live-send
beat, sent in an earlier demo. It is not withheld any more - the return has already arrived
and is in `data/inbox/_fetched/`.
