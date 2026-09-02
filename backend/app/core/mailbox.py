"""Fetch site returns from a real mailbox over IMAP.

This is the only new piece needed to run on live mail. `inbox.py` already parses real MIME and
routes on the subject line, so it does not change: the fetcher simply drops the messages it
pulls into the directory that reader already walks. The seeded months and the live arrivals then
look identical to everything downstream.

Credentials come from the environment and are never written to disk or logged:

    POC_IMAP_HOST      default imap.gmail.com
    POC_IMAP_PORT      default 993
    POC_IMAP_USER      the intake mailbox
    POC_IMAP_PASSWORD  a Gmail App Password (needs 2-Step Verification on the account)
    POC_IMAP_FOLDER    default INBOX
    POC_IMAP_SINCE     optional IMAP date, e.g. 01-Aug-2026, to bound the search
    POC_IMAP_SENDERS   optional extra allowed senders, comma separated

If POC_IMAP_USER is unset the mailbox is simply "not configured" - the pipeline runs from the
folder alone, which is also the fallback if the network fails during a demo.
"""
import email
import email.utils
import imaplib
import json
import os
import re
import threading

from . import config as C
from . import inbox as IB

FETCH_DIR = os.path.join(C.EMAIL_DIR, "_fetched")

# fetch() reads the dedup record, may spend seconds talking to Gmail, then writes the dedup
# record back - all unlocked, it used to be. Two overlapping calls (the 45s background poll and
# the tab-refocus poll can race each other if a tab is switched away and back near the time mail
# arrives) would both read the same "not yet seen" state before either saved it, so both would
# independently download and report the same single email as new - one real return, several
# duplicate arrivals on screen. This lock serialises fetch() so the second of any two overlapping
# calls always sees what the first one just saved.
_lock = threading.Lock()
SEEN_FILE = os.path.join(C.BASE, "fetched_message_ids.json")

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


class MailboxError(RuntimeError):
    """Something went wrong talking to the mailbox. Never carries the password."""


def allowed_senders():
    """Who this mailbox accepts returns from.

    The contributor master, plus anything in POC_IMAP_SENDERS. A real intake mailbox trusts
    its known contributors; without this the mailbox's own traffic - account notices, security
    alerts, spam - arrives as returns that cannot be routed and clutters the outstanding list
    with items nobody can action.

    Mail from an unknown sender is counted and reported, never silently dropped.
    """
    allowed = {addr.lower()
               for per_project in C.CONTRIBUTORS.values()
               for addr in per_project.values()}
    extra = os.environ.get("POC_IMAP_SENDERS", "")
    allowed |= {a.strip().lower() for a in extra.split(",") if a.strip()}
    return allowed


def settings():
    user = os.environ.get("POC_IMAP_USER", "").strip()
    return {
        "configured": bool(user and os.environ.get("POC_IMAP_PASSWORD", "").strip()),
        "host": os.environ.get("POC_IMAP_HOST", "imap.gmail.com").strip(),
        "port": int(os.environ.get("POC_IMAP_PORT", "993")),
        "user": user,
        "folder": os.environ.get("POC_IMAP_FOLDER", "INBOX").strip() or "INBOX",
        "since": os.environ.get("POC_IMAP_SINCE", "").strip(),
        "senders": sorted(allowed_senders()),
    }


def _seen():
    if not os.path.exists(SEEN_FILE):
        return set()
    try:
        with open(SEEN_FILE, encoding="utf-8") as f:
            return set(json.load(f))
    except (ValueError, OSError):
        return set()


def _remember(ids):
    with open(SEEN_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted(ids), f, indent=1)


def _filename(msg, n):
    """A stable name per message, so a re-fetch overwrites rather than duplicates."""
    mid = (msg.get("Message-ID") or f"no-id-{n}").strip("<> ")
    try:
        d = email.utils.parsedate_to_datetime(msg.get("Date"))
        stamp = d.strftime("%Y%m%d")
    except (TypeError, ValueError):
        stamp = "00000000"
    return f"{stamp}_{_SAFE.sub('-', mid)[:80]}.eml"


def fetch(limit=None):
    """Pull messages from the mailbox into FETCH_DIR. See `_lock` above for why this holds one -
    without it, two overlapping calls could each report the same single arrival as new."""
    with _lock:
        return _fetch_locked(limit)


def _fetch_locked(limit=None):
    """Deduplicates on Message-ID. Without that a re-fetch of the same mail would arrive as a
    second copy of a return and register as a restatement of itself - harmless to the figures,
    but it would put a phantom item on the Outstanding screen mid-demo.

    Returns a summary dict; raises MailboxError if the mailbox is unreachable.
    """
    cfg = settings()
    if not cfg["configured"]:
        return {"configured": False, "fetched": 0, "skipped": 0, "total": 0,
                "note": "no mailbox configured - reading the folder only"}

    password = os.environ["POC_IMAP_PASSWORD"].replace(" ", "")
    allowed = allowed_senders()
    seen = _seen()
    os.makedirs(FETCH_DIR, exist_ok=True)
    fetched, skipped, not_a_return, subjects, arrivals, failed = 0, 0, [], [], [], []

    try:
        conn = imaplib.IMAP4_SSL(cfg["host"], cfg["port"])
    except OSError as e:
        raise MailboxError(f"cannot reach {cfg['host']}:{cfg['port']} - {e}") from e

    try:
      try:
        try:
            conn.login(cfg["user"], password)
        except imaplib.IMAP4.error as e:
            # Gmail says "Invalid credentials" for a bad App Password and names IMAP
            # explicitly if IMAP is off. Either way, do not echo the password.
            raise MailboxError(
                f"login failed for {cfg['user']}: {e}. Check the App Password and that "
                f"2-Step Verification is on.") from e

        status, _ = conn.select(cfg["folder"], readonly=True)
        if status != "OK":
            raise MailboxError(f"cannot open folder {cfg['folder']!r}")

        criteria = ["ALL"] if not cfg["since"] else ["SINCE", cfg["since"]]
        status, data = conn.search(None, *criteria)
        if status != "OK":
            raise MailboxError("search failed")
        uids = data[0].split()
        if limit:
            uids = uids[-int(limit):]

        for n, uid in enumerate(uids):
            # Gmail intermittently answers a FETCH with "System Error", which imaplib raises
            # as an abort. One retry clears it; a second failure skips that message rather
            # than losing the whole batch.
            parts = None
            for attempt in (1, 2):
                try:
                    status, parts = conn.fetch(uid, "(RFC822)")
                    break
                except imaplib.IMAP4.error as e:
                    if attempt == 2:
                        failed.append(f"{uid.decode(errors='replace')}: {e}")
                        parts = None
                    continue
            if not parts or not isinstance(parts[0], tuple):
                continue
            raw = parts[0][1]
            msg = email.message_from_bytes(raw)
            mid = (msg.get("Message-ID") or "").strip()
            if mid and mid in seen:
                skipped += 1
                continue
            sender = email.utils.parseaddr(msg.get("From") or "")[1].lower()
            if sender not in allowed:
                not_a_return.append(sender or "(no sender)")
                if mid:
                    seen.add(mid)          # do not re-examine it on every refresh
                continue
            path = os.path.join(FETCH_DIR, _filename(msg, n))
            with open(path, "wb") as f:
                f.write(raw)
            if mid:
                seen.add(mid)
            fetched += 1
            subject = (msg.get("Subject") or "").strip()
            subjects.append(subject)
            # Parsed the same way inbox.py itself will parse it once this file is read for
            # real - so the bell can say what actually arrived (project, return type, month),
            # not just repeat the raw subject line back.
            kind = IB._kind(subject)
            month = IB._month(subject)
            project = C.resolve_project(subject) or C.resolve_sender(sender)
            arrivals.append({
                "subject": subject,
                "project": project["tally"] if project else None,
                "kind": C.INPUT_LABEL.get(kind, kind),
                "month": C.month_label(month) if month else None,
            })
      except imaplib.IMAP4.error as e:
        # includes IMAP4.abort. Whatever the mailbox did, it must not surface as an
        # unhandled exception - the caller decides whether a mail failure matters.
        raise MailboxError(f"mailbox error: {e}") from e
    finally:
        try:
            conn.logout()
        except Exception:
            pass

    _remember(seen)
    return {"configured": True, "fetched": fetched, "skipped": skipped,
            "ignored": len(not_a_return), "ignoredFrom": sorted(set(not_a_return)),
            "failed": len(failed), "failedDetail": failed,
            "total": len(uids), "mailbox": cfg["user"], "folder": cfg["folder"],
            "subjects": subjects, "arrivals": arrivals}


def forget():
    """Clear the dedupe record, so the next fetch re-downloads everything.

    Useful when rehearsing: send, fetch, reset, send again.
    """
    if os.path.exists(SEEN_FILE):
        os.remove(SEEN_FILE)
    return True


if __name__ == "__main__":
    cfg = settings()
    if not cfg["configured"]:
        raise SystemExit("POC_IMAP_USER / POC_IMAP_PASSWORD not set - see .env.example")
    print(f"connecting to {cfg['host']} as {cfg['user']} ({cfg['folder']})")
    print(f"accepting returns from {len(cfg['senders'])} sender(s)")
    r = fetch()
    print(f"{r['total']} in mailbox, {r['fetched']} new, {r['skipped']} already seen, "
          f"{r['ignored']} not from a contributor")
    for s in r["subjects"]:
        print("   +", s)
    for a in r["ignoredFrom"]:
        print("   -", a, "(not a known contributor)")
