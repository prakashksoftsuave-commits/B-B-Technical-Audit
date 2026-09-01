"""Month-close for one project-month: the point where a provisional position becomes a final
one, and stays that way.

Finalizing snapshots the resolved figures - final revenue, final approved cost, remaining
tender, profit, margin, and every decision that fed them - into this file, keyed by
`project|month`. Once written, `outcome.project_position()` reads the snapshot back instead of
recomputing live, so a later change to a decision, an adjustment, or the underlying data (a
regenerated dataset, a re-fetched mailbox) cannot silently move a month that was already closed.

Reopening does not delete the snapshot - it flips `reopened` and stamps who/when, so the
history of "this was final, then someone reopened it" is itself part of the audit trail, not
erased by it. A reopened month goes back to live computation until finalized again, which
records a fresh snapshot (the old one stays in `history`).
"""
import datetime as dt
import json
import os
import threading

from . import config as C

_lock = threading.Lock()


def _key(project, month):
    return f"{project}|{month}"


def load():
    if not os.path.exists(C.FINALIZATIONS):
        return {}
    with open(C.FINALIZATIONS, encoding="utf-8") as f:
        return json.load(f)


def _save(all_final):
    tmp = C.FINALIZATIONS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(all_final, f, indent=1, sort_keys=True)
    os.replace(tmp, C.FINALIZATIONS)


def get(project, month):
    """The active snapshot for one project-month, or None if never finalized or reopened."""
    rec = load().get(_key(project, month))
    if rec is None or rec.get("reopened"):
        return None
    return rec


def finalize(project, month, snapshot, finalized_by=""):
    with _lock:
        all_final = load()
        key = _key(project, month)
        history = all_final.get(key, {}).get("history", [])
        if key in all_final:
            history = history + [all_final[key]]
        all_final[key] = {**snapshot, "finalizedAt": dt.datetime.now().isoformat(timespec="seconds"),
                           "finalizedBy": finalized_by, "reopened": False, "history": history}
        _save(all_final)
        return all_final[key]


def reopen(project, month, reopened_by=""):
    with _lock:
        all_final = load()
        key = _key(project, month)
        if key not in all_final:
            raise ValueError("this project-month was never finalized")
        all_final[key]["reopened"] = True
        all_final[key]["reopenedAt"] = dt.datetime.now().isoformat(timespec="seconds")
        all_final[key]["reopenedBy"] = reopened_by
        _save(all_final)
        return all_final[key]
