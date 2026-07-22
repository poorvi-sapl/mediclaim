"""Vendor dispute reminder worker — the sender behind the promises the
initial docs-required email makes.

Every pass (hourly by default, started from app startup):
  0. process_pending_vendor_notifications() — the deferred initial notice:
     claim actions whose physician undo window (vendor_notify_delay_hours,
     default 24h) closed without being undone get their vendor email +
     dispute case created here rather than at action time.
  1. escalate_overdue_disputes() — flips OPEN cases past their 15-day
     response_due_date to NON_RESPONSIVE (same call the read paths make).
  2. Day-7 / day-13 reminder emails for OPEN cases the vendor hasn't answered,
     tracked by dispute_cases.reminder_sent_day7 / reminder_sent_day13 so each
     goes out exactly once.
  3. Day-15 expiry notice for freshly NON_RESPONSIVE cases, tracked by
     dispute_cases.expiry_notice_sent (backfilled TRUE for cases that lapsed
     before this worker existed).

All sends are the same type-blind vendor wording as the initial notice.
Vendors with no contact_email on file get their flags set anyway (with a log
line) — there is nothing to deliver to, and retrying forever helps no one.
"""

import logging
import threading
import time
from datetime import datetime, timedelta

from backend.config import get_settings
from backend.database import SessionLocal
from backend.models import Action, ClaimNotification, DisputeCase, SupplierProfile
from backend.utils.email import send_vendor_expiry_email, send_vendor_reminder_email

log = logging.getLogger("rules.reminders")

REMINDER_DAYS = (13, 7)  # checked in this order — day-13 supersedes day-7


def process_pending_vendor_notifications(db) -> int:
    """Send the deferred initial vendor notifications: claim actions whose
    physician undo window (vendor_notify_delay_hours) has closed and that were
    not undone (an undo deletes the Action row, so it simply never shows up
    here). notify_vendor_from_claim_action is idempotent — an action whose
    claim already has a notification is skipped — so re-scanning is safe.

    Only actions from the last 3 days past their window are considered:
    anything older predates this deferred-send feature (or was already
    processed) and must not be retro-notified in bulk. Returns the number of
    new vendor notifications created."""
    from backend.routers.actions import VENDOR_NOTIFY_ACTION_TYPES
    from backend.rules.trigger_engine import notify_vendor_from_claim_action

    settings = get_settings()
    delay_h = settings.vendor_notify_delay_hours
    if delay_h <= 0:
        return 0  # instant mode — POST /actions notifies inline

    cutoff = datetime.utcnow() - timedelta(hours=delay_h)
    floor = cutoff - timedelta(days=3)
    actions = (
        db.query(Action)
        .filter(
            Action.action_type.in_(VENDOR_NOTIFY_ACTION_TYPES),
            Action.created_at <= cutoff,
            Action.created_at >= floor,
        )
        .all()
    )
    sent = 0
    for a in actions:
        try:
            if notify_vendor_from_claim_action(
                claim_id=str(a.claim_id), physician_npi=a.npi,
                action_type=a.action_type, db=db,
            ):
                sent += 1
                log.info(f"Deferred vendor notification sent for claim {a.claim_id} "
                         f"— action: {a.action_type} (recorded {a.created_at})")
        except Exception:
            log.exception(f"Deferred vendor notification failed for claim {a.claim_id}")
    return sent


def process_vendor_reminders(db) -> dict:
    """One reminder/expiry pass. Idempotent — flags stop repeats. Returns
    counts for logging/tests."""
    settings = get_settings()
    base_url = settings.base_url
    now = datetime.utcnow()
    counts = {"day7": 0, "day13": 0, "expiry": 0, "skipped_no_email": 0}

    def rows(*filters):
        return (
            db.query(DisputeCase, ClaimNotification, SupplierProfile)
            .join(ClaimNotification,
                  ClaimNotification.notification_id == DisputeCase.notification_id)
            .outerjoin(SupplierProfile, SupplierProfile.npi == DisputeCase.vendor_npi)
            .filter(*filters)
            .all()
        )

    # ── Day-7 / day-13 reminders (OPEN cases still inside the window) ──
    for case, notif, vendor in rows(DisputeCase.status == "OPEN"):
        if not case.opened_at:
            continue
        if case.response_due_date and case.response_due_date < now:
            continue  # past due — the escalation + expiry notice take over
        elapsed = (now - case.opened_at).days
        for day in REMINDER_DAYS:
            already = case.reminder_sent_day13 if day == 13 else case.reminder_sent_day7
            if elapsed < day or already:
                continue
            if not (vendor and vendor.contact_email):
                counts["skipped_no_email"] += 1
                log.info(f"case {case.case_id}: day-{day} reminder skipped — no vendor contact email")
            elif send_vendor_reminder_email(case, notif, vendor, base_url, day):
                counts[f"day{day}"] += 1
                log.info(f"case {case.case_id}: day-{day} reminder sent to {vendor.contact_email}")
            else:
                continue  # send failed — leave the flag unset so the next pass retries
            if day == 13:
                # A day-13 send makes the day-7 reminder moot.
                case.reminder_sent_day13 = True
                case.reminder_sent_day7 = True
            else:
                case.reminder_sent_day7 = True
            break  # at most one reminder per case per pass

    # ── Day-15 expiry notices (window closed, nothing received) ──
    for case, notif, vendor in rows(DisputeCase.status == "NON_RESPONSIVE",
                                    DisputeCase.expiry_notice_sent.is_(False)):
        if not (vendor and vendor.contact_email):
            counts["skipped_no_email"] += 1
            log.info(f"case {case.case_id}: expiry notice skipped — no vendor contact email")
        elif send_vendor_expiry_email(case, notif, vendor, base_url):
            counts["expiry"] += 1
            log.info(f"case {case.case_id}: expiry notice sent to {vendor.contact_email}")
        else:
            continue  # send failed — retry next pass
        case.expiry_notice_sent = True

    db.commit()
    return counts


def run_reminder_pass() -> dict:
    """Escalate overdue cases, then run one reminder/expiry pass — the unit the
    background thread loops on (also callable directly, e.g. from tests)."""
    from backend.rules.trigger_engine import escalate_overdue_disputes

    db = SessionLocal()
    try:
        pending = process_pending_vendor_notifications(db)
        escalate_overdue_disputes(db)
        counts = process_vendor_reminders(db)
        counts["deferred_initial"] = pending
        if any(counts.values()):
            log.info(f"Vendor reminder pass: {counts}")
        return counts
    finally:
        db.close()


_started = False


def start_reminder_worker() -> None:
    """Launch the daemon thread (once per process) that runs a reminder pass
    on an interval. Safe to call repeatedly — subsequent calls are no-ops."""
    global _started
    if _started:
        return
    _started = True
    interval = get_settings().vendor_reminder_interval_seconds

    def loop():
        while True:
            try:
                run_reminder_pass()
            except Exception:
                log.exception("Vendor reminder pass failed")
            time.sleep(interval)

    threading.Thread(target=loop, daemon=True, name="vendor-reminders").start()
    log.info(f"Vendor reminder worker started (every {interval}s)")
