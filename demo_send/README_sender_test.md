# Sender-only routing test

This ISN'T a normal return - the subject deliberately omits the project name, so the
ONLY way this can route correctly is via the sender's own mailbox identity.

    From        softsuave2026+tidel.taramani@gmail.com
    To          bbbuilders.reports@gmail.com
    Subject     Site update - Jul 2026
    Attach      stock_sender_test_TIDEL_2026-07.xlsx

If it lands on Tidel Park Block C - Taramani, the sender address did the routing -
the subject alone could not have (it has no "Tidel", "Taramani" or "ITP" in it, and
resolve_project() would return None on it by itself).

## Where to see the proof, after Refresh

Go to **Source data**, filter Source = Return, search "site update". The row's
**Routed by** column will read `sender` (not `subject`) - that's the confirmation.
Compare it to the formwork return you already sent, which shows `subject` there,
because its subject line happened to contain "ORR".

## Note on this attachment

It reuses "stock" figures for Tidel July, but is filed under a different kind marker
in this README only for clarity - the app itself does not know this is a "test" mail,
it is just another closing stock return, correctly routed.
