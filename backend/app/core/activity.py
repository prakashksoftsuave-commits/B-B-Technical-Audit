"""A real, minimal activity log - what actually happened, when.

Not a fabricated feed: every entry is written at the moment a real action completes - a sync
finished, an auditor decided a line, a month was finalized or reopened, a reminder went out -
never invented display copy. Persisted as one JSON file, same reasoning as decisions.py and
finalization.py: this POC has no database, a real deployment would swap this for a table with
the same shape.

Capped to the most recent MAX_ENTRIES so the file never grows unbounded across a long-running
demo - the oldest entries are simply the ones nobody would scroll to see anyway.
"""
import datetime as dt
import json
import os
import threading

from . import config as C

_lock = threading.Lock()
MAX_ENTRIES = 200


def _load():
    if not os.path.exists(C.ACTIVITY_LOG):
        return []
    try:
        with open(C.ACTIVITY_LOG, encoding="utf-8") as f:
            return json.load(f)
    except (ValueError, OSError):
        return []


def _save(entries):
    with open(C.ACTIVITY_LOG, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=1)


def record(kind, title, detail=None, project=None, tone="info"):
    """Append one real event.

    `kind` is a short machine tag (sync/decision/finalize/reopen/reminder) - not shown as-is,
    just there for anything downstream that wants to filter or icon by type. `tone` picks the
    same ok/info/warn/bad vocabulary every status dot and pill in this console already uses, so
    an activity entry reads consistently with everything else on screen.
    """
    with _lock:
        entries = _load()
        entries.append({
            "ts": dt.datetime.now().isoformat(timespec="seconds"),
            "kind": kind, "title": title, "detail": detail,
            "project": project, "tone": tone,
        })
        entries = entries[-MAX_ENTRIES:]
        _save(entries)


def recent(limit=20):
    """Newest first - an activity feed reads top-down as "what just happened"."""
    return list(reversed(_load()))[:limit]
