"""Send a reminder email to a project's site mailbox for this month's outstanding returns.

Shares the audit mailbox's own credentials with mailbox.py's IMAP intake - same account,
sending as itself, no separate mailbox to configure. POC_IMAP_USER/POC_IMAP_PASSWORD do double
duty as the SMTP identity; POC_SMTP_HOST/POC_SMTP_PORT exist only in case a different account
is ever used to send than to receive.

One mail per project-month, listing everything still outstanding for that site - not one mail
per missing item - the same "replaces the individual chasing" shape tracker.py's own escalation
mail already describes.
"""
import os
import smtplib
from email.message import EmailMessage

from . import config as C


class ReminderError(RuntimeError):
    """Something went wrong sending the reminder. Never carries the password."""


def configured():
    user = os.environ.get("POC_IMAP_USER", "").strip()
    return bool(user and os.environ.get("POC_IMAP_PASSWORD", "").strip())


def send(to_addr, project_name, month_label, lines, sent_by=None):
    if not configured():
        raise ReminderError(
            "no mailbox configured - set POC_IMAP_USER/POC_IMAP_PASSWORD in .env")

    user = os.environ["POC_IMAP_USER"].strip()
    password = os.environ["POC_IMAP_PASSWORD"].replace(" ", "")
    host = os.environ.get("POC_SMTP_HOST", "smtp.gmail.com").strip()
    port = int(os.environ.get("POC_SMTP_PORT", "465"))

    msg = EmailMessage()
    msg["Subject"] = f"Reminder: outstanding {month_label} inputs - {project_name}"
    msg["From"] = user
    msg["To"] = to_addr
    body = (
        f"This is a reminder from {C.ORG_NAME} {C.DIVISION} that the following {month_label} "
        f"inputs for {project_name} have not yet been received:\n\n"
        + "\n".join(f"  - {line}" for line in lines)
        + "\n\nPlease send these at the earliest so the month's outcome can be finalized."
        + (f"\n\n(sent by {sent_by})" if sent_by else "")
    )
    msg.set_content(body)

    try:
        with smtplib.SMTP_SSL(host, port, timeout=20) as s:
            s.login(user, password)
            s.send_message(msg)
    except smtplib.SMTPAuthenticationError as e:
        raise ReminderError(
            f"login failed for {user}: {e}. Check the App Password.") from e
    except smtplib.SMTPException as e:
        raise ReminderError(f"send failed for {to_addr}: {e}") from e
    except OSError as e:
        raise ReminderError(f"cannot reach {host}:{port} - {e}") from e

    return {"to": to_addr, "subject": msg["Subject"]}
