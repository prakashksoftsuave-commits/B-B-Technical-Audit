"""Auditor decisions on ERP-vs-Tally differences.

This is the one place a difference actually gets resolved - by a person, explicitly, through
an action recorded here, never by the run picking a side on its own. That is still R3: the
run shows both figures and names an owner; this module is what happens when that owner acts.

Keyed by (project, month, line) - one decision per compared line per project-month. A decision
is {"choice": "erp" | "tally" | "mail" | "custom", "amount": number (only for "custom"), "note":
str, "decidedBy": str, "decidedAt": ISO timestamp}. "mail" only applies to the one line that is
ERP-vs-mail rather than ERP-vs-Tally (site staff salary - see outcome._salary_status). Undecided
lines are simply absent - there is no default choice, so a profit figure that depends on one
stays "pending" until someone acts.

Persisted as one JSON file because this POC has no database; a real deployment would swap this
for a table with the same key shape.
"""
import datetime as dt
import json
import os
import threading

from . import config as C

_lock = threading.Lock()


def _key(project, month, line):
    return f"{project}|{month}|{line}"


def load():
    if not os.path.exists(C.AUDIT_DECISIONS):
        return {}
    with open(C.AUDIT_DECISIONS, encoding="utf-8") as f:
        return json.load(f)


def _save(all_decisions):
    tmp = C.AUDIT_DECISIONS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(all_decisions, f, indent=1, sort_keys=True)
    os.replace(tmp, C.AUDIT_DECISIONS)


def record(project, month, line, choice, amount=None, note="", decided_by=""):
    if choice not in ("erp", "tally", "mail", "custom"):
        raise ValueError(f"unknown choice: {choice}")
    if choice == "custom" and amount is None:
        raise ValueError("a custom decision needs an amount")
    with _lock:
        all_decisions = load()
        all_decisions[_key(project, month, line)] = {
            "choice": choice, "amount": amount, "note": note, "decidedBy": decided_by,
            "decidedAt": dt.datetime.now().isoformat(timespec="seconds"),
        }
        _save(all_decisions)
        return all_decisions[_key(project, month, line)]


def clear(project, month, line):
    with _lock:
        all_decisions = load()
        all_decisions.pop(_key(project, month, line), None)
        _save(all_decisions)


def resolve(project, month, line, erp_value, tally_value):
    """The approved amount for one compared line, or None if nobody has decided yet."""
    d = load().get(_key(project, month, line))
    if d is None:
        return None
    if d["choice"] == "erp":
        return erp_value
    if d["choice"] == "tally":
        return tally_value
    return d["amount"]
