# Live sends for the August rehearsal

Three returns are deliberately withheld right now, one per project, all for Aug 2026. Each
shows on Home's "Evidence status" as **Not received**, with a working **Remind** button.
Sending the matching file below, live, from the site's own address, then pressing **Sync**,
clears it - the negative path becomes the happy path, live, in front of whoever you're
demoing to.

The demo clock is currently pinned (`POC_DEMO_AS_OF=2026-09-20` in `.env`) so these stay
genuinely overdue - not merely pending - no matter how many times Sync is clicked before you
send. Ask to have that removed once the rehearsal is done, to go back to the real date.

**Riverside's RA bill (the original Beat 1) is done, for real** - it was actually sent live and
fetched during rehearsal, so it's no longer withheld; Riverside's **work done report** below
took its place as the project's outstanding item instead, so every project still has exactly
one.

## Beat 1 — Riverside's work done report, Aug 2026

    From        softsuave2026+riverside.manapakkam@gmail.com
    To          bbbuilders.reports@gmail.com
    Subject     Work done report - Riverside - Aug 2026
    Attach      work_done_RVT-1041_2026-08.xlsx

Figures: work done value certified ₹2,48,79,000 (Civil ₹1,36,83,500 / MEP ₹74,63,700 /
Finishing ₹37,31,800), cumulative work done ₹43,48,84,920.

## Beat 2 — Tidel's work done report, Aug 2026

    From        softsuave2026+tidel.taramani@gmail.com
    To          bbbuilders.reports@gmail.com
    Subject     Work done report - Tidel - Aug 2026
    Attach      work_done_ITP-1052_2026-08.xlsx

Figures: work done value certified ₹3,27,64,000 (Civil ₹1,80,20,200 / MEP ₹98,29,200 /
Finishing ₹49,14,600), cumulative work done ₹33,15,71,680.

## Beat 3 — ORR's formwork report, Aug 2026

    From        softsuave2026+orrflyover.pkg3@gmail.com
    To          bbbuilders.reports@gmail.com
    Subject     Formwork report - ORR - Aug 2026
    Attach      formwork_ORR-1063_2026-08.xlsx

Figures: formwork area used 9,124 sqm, formwork hire recovered ₹4,02,696 (Slab ₹2,01,300 /
Column & beam ₹1,20,800 / Staircase & misc ₹80,596).

## Common to all three

The subject must be exactly as above - the project, the return type and the month are all
read from it. Body text does not matter. The From address is a second, independent routing
signal (rule R1's "a mail domain per project") - correct even if a subject line ever omitted
the project name.

Under the pinned demo clock, all three will land flagged **LATE** against Aug 2026's cut-off,
not "restored to on time" - worth saying out loud live: the return landed, the gap closed, and
the delay was still recorded, not hidden.

## If you need to send the same one more than once while rehearsing

    curl -X POST http://localhost:8000/api/mail/reset

That forgets which messages have been fetched, so the same mail can be pulled again. It does
NOT delete the downloaded copy in `data/inbox/_fetched/` - if you rehearse the same subject
line again, delete that specific `.eml` file afterwards so the real send doesn't land as a
second, later "restatement" of your own rehearsal.

## Where these came from

All three are the original seeded attachments for these exact returns, pulled back out of the
`.eml` files that were moved aside to `data/_demo_reset_backup/` to create this rehearsal
scenario in the first place - not fabricated fresh, so they match the pipeline's expected
figures and layout exactly.
