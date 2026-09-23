"""Pull specific returns back out of the report, so Evidence status shows them as Pending/Not
received again instead of Received - the clean starting point a live-mail demo needs before a
real send.

Searches the WHOLE inbox tree (`inbox.read_all()`) - both the seeded months
(`data/inbox/<month>/`) and anything actually fetched over IMAP (`data/inbox/_fetched/`) - not
just `_fetched/`. That matters because the same six returns this demo rehearses sending live
exist as seeded copies wherever they were never live-tested before (a fresh environment, e.g. a
newly-deployed production box), but as duplicate live-fetched copies wherever they already were
rehearsed with a real send (this dev machine's own history) - `inbox.latest()`'s restatement
rule (R8) would otherwise just keep showing the seeded copy as soon as the fetched one is gone.
Withdrawing by (project, month, kind) match, wherever the file actually lives, works the same
way on both.

Moves matched files into `data/_withdrawn_mail/` (never deleted, fully reversible with
--restore) and records exactly where each one came from in `_manifest.json` there, so restore
puts every file back to its own original folder - never guessed, never left in the wrong place.
Deliberately never touches the fetch dedup record (`fetched_message_ids.json`): with a live
mailbox actually configured, clearing dedup tells the next Sync every one of these messages is
new again, and it re-downloads a live-fetched one straight back before you ever get to demo
anything - confirmed the hard way. Leaving Message-IDs marked "seen" means Sync skips them
(already accounted for) and the return stays withdrawn until a genuinely new email (a real
send, new Message-ID) arrives - seeded copies were never fetched over IMAP in the first place,
so dedup never applied to them anyway.

    python -m backend.app.core.demo_reset             withdraw the demo rehearsal's 6 returns
    python -m backend.app.core.demo_reset --restore    undo - put them all back

After running this, click Sync in the console (or POST /api/run) - the backend recomputes on
every run, nothing needs restarting.
"""
import argparse
import json
import os
import shutil

from . import config as C
from . import inbox as IB

WITHDRAWN_DIR = os.path.join(C.BASE, "_withdrawn_mail")
MANIFEST = os.path.join(WITHDRAWN_DIR, "_manifest.json")

# The live-mail-arrives rehearsal's six returns - one project each for RA bill/work done, one
# withheld formwork per the other two projects - matching demo_send/'s prepared attachments
# exactly. Two of these are also fabricate.NEVER_ARRIVED (permanently withheld by design, no
# seeded copy ever exists for them); the other four are ordinary returns this script withdraws
# on top of the normal dataset, wherever their copy currently lives.
DEMO_TARGETS = {
    ("PRJ-1041", "2026-08", "ra_bill"),      # Riverside RA bill certified
    ("PRJ-1041", "2026-08", "work_done"),    # Riverside work done report
    ("PRJ-1052", "2026-08", "formwork"),     # Tidel formwork report (NEVER_ARRIVED)
    ("PRJ-1052", "2026-08", "work_done"),    # Tidel work done report
    ("PRJ-1063", "2026-08", "formwork"),     # ORR formwork report
    ("PRJ-1063", "2026-08", "ra_bill"),      # ORR RA bill certified (NEVER_ARRIVED)
}


def withdraw(targets=None):
    targets = targets or DEMO_TARGETS
    items, _bad = IB.read_all()
    matches = [i for i in items if (i["project"], i["month"], i["kind"]) in targets]
    if not matches:
        print("Nothing to withdraw - none of the target returns are currently in the inbox "
              "(already withdrawn, or NEVER_ARRIVED with no seeded copy to begin with).")
        return []

    os.makedirs(WITHDRAWN_DIR, exist_ok=True)
    manifest = json.load(open(MANIFEST, encoding="utf-8")) if os.path.exists(MANIFEST) else {}
    moved = []
    for i in matches:
        fn = os.path.basename(i["path"])
        dest_name = fn
        n = 1
        while os.path.exists(os.path.join(WITHDRAWN_DIR, dest_name)):
            n += 1
            dest_name = f"{n}_{fn}"
        dest = os.path.join(WITHDRAWN_DIR, dest_name)
        shutil.move(i["path"], dest)
        manifest[dest_name] = i["path"]
        moved.append(i)
        where = "seeded" if os.sep + "_fetched" + os.sep not in i["path"] else "live-fetched"
        print(f"  withdrew  {C.BY_CODE[i['project']]['tally']}  {C.month_label(i['month'])}  "
              f"{C.INPUT_LABEL.get(i['kind'], i['kind'])}  ({where}: {fn})")

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    print(f"\n{len(moved)} return(s) withdrawn. Dedup record left alone on purpose - a live "
          f"mailbox would otherwise re-fetch a previously-sent one on the very next Sync.")
    print("Click Sync in the console (or POST /api/run) to see them drop back to "
          "Pending/Not received.")
    return moved


def restore():
    if not os.path.exists(MANIFEST):
        print("Nothing withdrawn to restore.")
        return []
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    if not manifest:
        print("Nothing to restore.")
        return []
    restored = []
    for fn, original_path in manifest.items():
        src = os.path.join(WITHDRAWN_DIR, fn)
        if not os.path.exists(src):
            continue
        os.makedirs(os.path.dirname(original_path), exist_ok=True)
        shutil.move(src, original_path)
        restored.append(original_path)
        print(f"  restored  {original_path}")
    os.remove(MANIFEST)
    print(f"\n{len(restored)} return(s) restored to their original folder.")
    return restored


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--restore", action="store_true", help="undo: put withdrawn mail back")
    a = ap.parse_args()
    restore() if a.restore else withdraw()
