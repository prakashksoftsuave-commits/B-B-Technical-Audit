"""Pull already-fetched live returns back out of the report, so Evidence status shows them as
Pending again instead of Received - the clean starting point a live-mail demo needs before a
real send.

`data/inbox/_fetched/` only ever holds mail actually pulled over IMAP - the four seeded months
live directly under `data/inbox/<month>/` and are never touched by this. A rehearsal send
already sitting in `_fetched/` is exactly the trap CLAUDE.md's "Rehearsal vs the real demo"
section warns about: leave it in place and the real send just becomes a second, later-arriving
version instead of the first live arrival a demo wants to show. `POST /api/mail/reset`
(`mailbox.forget()`) does not fix this on its own - it only clears the fetch dedup record, the
already-fetched .eml files stay right where inbox.py will still find them.

This moves everything currently in `_fetched/` into `data/_withdrawn_mail/` (never deleted,
fully reversible with --restore). It deliberately leaves the fetch dedup record
(`fetched_message_ids.json`) untouched: with a live mailbox actually configured, clearing dedup
tells the next Sync every one of these messages is new again, and it re-downloads them straight
back into `_fetched/` before you ever get to demo anything - confirmed the hard way. Leaving
the Message-IDs marked "seen" means Sync will skip them (they're already accounted for) and the
return stays Pending until a genuinely new email (a real send, new Message-ID) arrives.

    python -m backend.app.core.demo_reset             withdraw every fetched return
    python -m backend.app.core.demo_reset --restore    undo - put them back

After running this, click Sync in the console (or POST /api/run) - the backend recomputes on
every run, nothing needs restarting.
"""
import argparse
import os
import shutil

from . import config as C
from . import mailbox

FETCH_DIR = mailbox.FETCH_DIR                            # data/inbox/_fetched
# Kept OUTSIDE data/inbox - inbox.read_all() walks that directory recursively, so a backup
# folder underneath it would still be read straight back in as if nothing had moved.
WITHDRAWN_DIR = os.path.join(C.BASE, "_withdrawn_mail")


def withdraw():
    if not os.path.isdir(FETCH_DIR):
        print("Nothing fetched yet - _fetched/ does not exist.")
        return []
    files = [f for f in os.listdir(FETCH_DIR) if f.lower().endswith(".eml")]
    if not files:
        print("Nothing to withdraw - _fetched/ is already empty.")
        return []
    os.makedirs(WITHDRAWN_DIR, exist_ok=True)
    for fn in files:
        shutil.move(os.path.join(FETCH_DIR, fn), os.path.join(WITHDRAWN_DIR, fn))
        print(f"  withdrew  {fn}")
    print(f"\n{len(files)} fetched return(s) withdrawn. Dedup record left alone on purpose - "
          f"a live mailbox would otherwise re-fetch them on the very next Sync.")
    print("Click Sync in the console (or POST /api/run) to see them drop back to Pending.")
    return files


def restore():
    if not os.path.isdir(WITHDRAWN_DIR):
        print("Nothing withdrawn to restore.")
        return []
    files = [f for f in os.listdir(WITHDRAWN_DIR) if f.lower().endswith(".eml")]
    if not files:
        print("Nothing to restore.")
        return []
    os.makedirs(FETCH_DIR, exist_ok=True)
    for fn in files:
        shutil.move(os.path.join(WITHDRAWN_DIR, fn), os.path.join(FETCH_DIR, fn))
        print(f"  restored  {fn}")
    print(f"\n{len(files)} return(s) restored.")
    return files


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--restore", action="store_true", help="undo: put withdrawn mail back")
    a = ap.parse_args()
    restore() if a.restore else withdraw()
