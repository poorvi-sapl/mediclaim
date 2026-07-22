"""
NPI Watch claim notification email.

When EMAIL_ENABLED=false (default) the full email content — including all
three action links — is logged to the console. No email is sent.
When EMAIL_ENABLED=true, sends over SMTP using the same MAIL_* creds the
login OTP uses (backend/auth/email_otp.py).

Every mail is sent as HTML (with a plain-text fallback part) using the shared
branded template in _shell() — logo + "MedClaim Analytics" header, a details
box, an optional CTA button, and a consistent footer. Table-based layout with
inline styles throughout (no external CSS, no <style> reliance) for the
widest email-client compatibility, including Outlook.

Never raises: logs errors and returns False so a failed email never
crashes the ingest pipeline.
"""

import logging
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import ClaimNotification, Physician
from ..utils.tokens import generate_vendor_dispute_token

log = logging.getLogger("utils.email")

# ─── Brand palette (matches the app's own navy/amber theme) ──────────────────
NAVY       = "#0d1f35"   # header logo chip + landing-page navbar
BUTTON_BG  = "#1B3A5C"   # matches the physician portal's primary button (ink)
INK        = "#0F172A"   # primary body text
SLATE      = "#64748B"   # secondary/label text
SLATE_LT   = "#94A3B8"   # footer text
BORDER     = "#E2E8F0"
BOX_BG     = "#F8FAFC"   # details box background
PAGE_BG    = "#F8FAFC"   # page background behind the card — slate-50, matching the vendor portal's own page bg
AMBER_TX   = "#B45309"
AMBER_BG   = "#FEF6E7"
AMBER_BD   = "#F5E1BE"
ROSE_TX    = "#9F1239"
ROSE_BG    = "#FDF1F3"
ROSE_BD    = "#F3D3DA"


def _fmt_date_long(d) -> str:
    """'August 1, 2026' — no zero-padded day, unlike strftime('%B %d, %Y')."""
    if not d:
        return "N/A"
    if hasattr(d, "strftime"):
        return f"{d.strftime('%B')} {d.day}, {d.year}"
    return str(d)


def _fmt_dos_range(dos_from, dos_to) -> str:
    """'Jun 12 – Jun 14, 2026' — short month, no year repeated when both dates
    fall in the same year."""
    if not dos_from:
        return "N/A"
    has_strftime = hasattr(dos_from, "strftime")
    if dos_to and dos_to != dos_from:
        if has_strftime and hasattr(dos_to, "strftime") and dos_from.year == dos_to.year:
            return f"{dos_from.strftime('%b')} {dos_from.day} – {dos_to.strftime('%b')} {dos_to.day}, {dos_to.year}"
        from_s = f"{dos_from.strftime('%b')} {dos_from.day}, {dos_from.year}" if has_strftime else str(dos_from)
        to_s   = f"{dos_to.strftime('%b')} {dos_to.day}, {dos_to.year}" if hasattr(dos_to, "strftime") else str(dos_to)
        return f"{from_s} – {to_s}"
    return f"{dos_from.strftime('%b')} {dos_from.day}, {dos_from.year}" if has_strftime else str(dos_from)


def _details_row(label: str, value: str) -> str:
    return f"""
        <tr>
          <td style="padding:7px 0;font-size:13px;color:{SLATE};font-family:Arial,Helvetica,sans-serif;">{label}</td>
          <td style="padding:7px 0;font-size:14px;color:{INK};font-weight:700;font-family:Arial,Helvetica,sans-serif;text-align:right;">{value}</td>
        </tr>"""


def _callout(label: str, text: str, tx: str, bg: str, bd: str) -> str:
    return f"""
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{bg};border:1px solid {bd};border-radius:10px;margin:22px 0;">
        <tr><td style="padding:14px 18px;font-size:13.5px;line-height:1.6;color:{tx};font-family:Arial,Helvetica,sans-serif;">
          <strong>{label}:</strong> {text}
        </td></tr>
      </table>"""


def _button(label: str, href: str) -> str:
    return f"""
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
        <tr><td align="center">
          <a href="{href}" style="display:inline-block;background:{BUTTON_BG};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:13px 30px;border-radius:10px;">{label}</a>
        </td></tr>
      </table>"""


def _shell(eyebrow: str, eyebrow_color: str, title: str, greeting: str,
           intro: str, details_rows: str, callout_html: str = "",
           button_html: str = "", extra_html: str = "", footer_note: str = "") -> str:
    """The shared branded wrapper every vendor/physician email renders through —
    logo header, title block, a details box, an optional callout/button, and a
    consistent gray footer note."""
    return f"""\
<!doctype html>
<html>
<body style="margin:0;padding:0;background:{PAGE_BG};font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAGE_BG};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="padding:22px 32px 18px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                  <td style="background:{NAVY};width:34px;height:34px;border-radius:9px;text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:16px;line-height:34px;">M</span>
                  </td>
                  <td style="padding-left:10px;font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:17px;color:{INK};">MedClaim Analytics</td>
                </tr></table>
              </td>
              <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:{SLATE};white-space:nowrap;">Compliance Notification</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="border-top:1px solid {BORDER};"></td></tr>

        <!-- Body -->
        <tr><td style="padding:26px 32px 30px 32px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:{eyebrow_color};margin-bottom:8px;">{eyebrow}</div>
          <h1 style="margin:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-size:23px;font-weight:800;color:{INK};line-height:1.3;">{title}</h1>
          <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:{INK};">{greeting}</p>
          <p style="margin:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:{INK};">{intro}</p>

          {f'''<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{BOX_BG};border-radius:10px;">
            <tr><td style="padding:16px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{details_rows}</table>
            </td></tr>
          </table>''' if details_rows else ''}

          {callout_html}
          {button_html}
          {extra_html}

          <p style="margin:26px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:{SLATE_LT};">{footer_note}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _send_smtp(to_email: str, subject: str, text_body: str, html_body: str = None) -> bool:
    """Send via the same SMTP server/creds as the login OTP mail (MAIL_* in
    .env). HTML with a plain-text fallback part when html_body is given, plain
    text only otherwise. Synchronous on purpose — every caller is a sync
    request thread or the ingest pipeline, not the event loop. Never raises."""
    settings = get_settings()
    if not to_email:
        log.error("SMTP send skipped — recipient email is blank")
        return False
    if not (settings.mail_username and settings.mail_password):
        log.error("EMAIL_ENABLED=true but MAIL_USERNAME/MAIL_PASSWORD are blank — cannot send")
        return False

    if html_body:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))
    else:
        msg = MIMEText(text_body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = settings.mail_from
    msg["To"] = to_email
    try:
        if settings.mail_ssl_tls:
            server = smtplib.SMTP_SSL(settings.mail_server, settings.mail_port, timeout=30)
        else:
            server = smtplib.SMTP(settings.mail_server, settings.mail_port, timeout=30)
        with server:
            if settings.mail_starttls:
                server.starttls()
            server.login(settings.mail_username, settings.mail_password)
            server.sendmail(settings.mail_from, [to_email], msg.as_string())
        return True
    except Exception as exc:
        log.error(f"SMTP send failed to {to_email}: {exc}")
        return False


def send_claim_notification_email(
    notification: ClaimNotification,
    physician: Physician,
    base_url: str,
    db: Session,
) -> bool:
    """
    Sends (or console-logs) the NPI alert email for a single ClaimNotification.

    On success (real send or mock):
      - Sets notification.email_sent = True
      - Sets notification.notification_sent_at = NOW()
      - Commits to DB

    Returns True on success, False if the SMTP send fails.
    """
    settings = get_settings()
    token = notification.response_token or ""

    confirm_url = f"{base_url}/api/v1/respond?token={token}&action=CONFIRM"
    dispute_url = f"{base_url}/api/v1/respond?token={token}&action=DISPUTE"
    fraud_url   = f"{base_url}/api/v1/respond?token={token}&action=FRAUD_REPORT"

    hcpcs_str = ", ".join(notification.hcpcs_codes) if notification.hcpcs_codes else "N/A"
    dos_str   = _fmt_dos_range(notification.dos_from, notification.dos_to)
    billed = float(notification.amount_billed or 0)
    paid   = float(notification.amount_paid or 0)
    dr_name = f"Dr. {physician.first_name or ''} {physician.last_name or ''}".strip()
    claim_number = notification.claim_ccn or notification.claim_number or "N/A"

    subject = "[NPI Alert] Your NPI was used on a Medicare claim — Action Required"

    body = (
        f"Dear {dr_name},\n\n"
        f"Your NPI ({notification.physician_npi}) has been identified on a Medicare claim "
        f"as the {notification.physician_npi_role} physician.\n"
        f"Please review the claim details below and take action.\n\n"
        f"CLAIM DETAILS\n"
        f"{'─'*50}\n"
        f"Claim Number:     {claim_number}\n"
        f"Vendor Name:      {notification.vendor_name or 'N/A'}\n"
        f"Vendor Type:      {notification.vendor_type or 'N/A'}\n"
        f"Vendor NPI:       {notification.vendor_npi or 'N/A'}\n"
        f"Patient:          {notification.patient_name_partial or 'N/A'}\n"
        f"Patient MBI:      {notification.patient_mbi or 'N/A'}\n"
        f"Dates of Service: {dos_str}\n"
        f"Service:          {notification.service_description or 'N/A'}\n"
        f"HCPCS Codes:      {hcpcs_str}\n"
        f"Amount Billed:    ${billed:,.2f}\n"
        f"Amount Paid:      ${paid:,.2f}\n"
        f"Your Role:        {notification.physician_npi_role}\n\n"
        f"ACTION REQUIRED — click one link below:\n\n"
        f"  CONFIRM (I ordered/authorized this service):\n"
        f"  {confirm_url}\n\n"
        f"  DISPUTE (I did not order/authorize this service):\n"
        f"  {dispute_url}\n\n"
        f"  REPORT FRAUD (This is fraudulent — I never saw this patient):\n"
        f"  {fraud_url}\n\n"
        f"If you do not respond within 72 hours, this claim will be flagged "
        f"for compliance review.\n\n"
        f"This is an automated notification from the NPI Watch system. "
        f"Do not reply to this email."
    )

    details_rows = (
        _details_row("Claim number", claim_number)
        + _details_row("Vendor", notification.vendor_name or "N/A")
        + _details_row("Patient", notification.patient_name_partial or "N/A")
        + _details_row("Dates of service", dos_str)
        + _details_row("Amount billed", f"${billed:,.2f}")
        + _details_row("Your role", notification.physician_npi_role or "N/A")
    )
    actions_html = f"""
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 0 0;">
        <tr><td align="center" style="padding:6px 0;">
          <a href="{confirm_url}" style="display:inline-block;background:#2E6B4F;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;font-weight:700;text-decoration:none;padding:11px 22px;border-radius:9px;margin:4px;">Confirm</a>
          <a href="{dispute_url}" style="display:inline-block;background:{AMBER_TX};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;font-weight:700;text-decoration:none;padding:11px 22px;border-radius:9px;margin:4px;">Dispute</a>
          <a href="{fraud_url}" style="display:inline-block;background:{ROSE_TX};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;font-weight:700;text-decoration:none;padding:11px 22px;border-radius:9px;margin:4px;">Report Fraud</a>
        </td></tr>
      </table>"""
    html = _shell(
        eyebrow="Action Required", eyebrow_color=AMBER_TX,
        title="Your NPI was used on a Medicare claim",
        greeting=f"Dear {dr_name},",
        intro=(f"Your NPI has been identified on a Medicare claim as the "
               f"{(notification.physician_npi_role or '').lower()} physician. "
               f"Please review the details below and choose a response."),
        details_rows=details_rows,
        extra_html=actions_html,
        footer_note=("If you do not respond within 72 hours, this claim will be flagged for "
                      "compliance review. This is an automated notification — do not reply to this email."),
    )

    success = False

    if not settings.email_enabled:
        sep = "=" * 70
        log.info(sep)
        log.info("EMAIL_ENABLED=false — logging email to console (no SMTP send)")
        log.info(f"TO:      {physician.email_primary}")
        log.info(f"SUBJECT: {subject}")
        log.info("BODY:")
        for line in body.splitlines():
            log.info(line)
        log.info(f"CONFIRM link:      {confirm_url}")
        log.info(f"DISPUTE link:      {dispute_url}")
        log.info(f"FRAUD_REPORT link: {fraud_url}")
        log.info(sep)
        success = True

    else:
        success = _send_smtp(physician.email_primary, subject, body, html)
        if not success:
            return False

    if success:
        try:
            notification.email_sent = True
            notification.notification_sent_at = datetime.utcnow()
            db.commit()
            db.refresh(notification)
        except Exception as exc:
            log.error(f"Failed to update email_sent flag on notification "
                      f"id={notification.notification_id}: {exc}")

    return success


def send_vendor_dispute_email(
    dispute_case,
    notification,
    vendor,
    base_url: str,
) -> bool:
    """
    Sends a documents-required notice to the billing vendor when a dispute
    case opens. Type-blind by design: the same neutral wording regardless of
    dispute_type (DISPUTE / FRAUD_REPORT / DECEASED_PATIENT) — the vendor only
    learns that documentation is due, never what the physician alleged.

    On True:  sets dispute_case.billing_provider_notified_at = NOW()
    EMAIL_ENABLED=false → logs to console, returns True
    EMAIL_ENABLED=true  → sends via SMTP, returns True on success / False on error
    Never raises.
    """
    settings = get_settings()

    claim_number  = notification.claim_ccn or notification.claim_number or str(notification.notification_id)
    contact_name  = vendor.contact_name or "Billing Department"
    contact_email = vendor.contact_email or ""

    # Still generated and stored even though the emailed link below no longer
    # uses it — the token-gated standalone page (/vendor/disputes/:case_id,
    # VendorDisputePage.jsx) stays reachable for anyone who has this token, and
    # dispute_case.vendor_token is otherwise-unused bookkeeping of "last token
    # issued for this case" (see backend/routers/vendor.py's separate
    # token-auth endpoints for where it'd be validated).
    token = generate_vendor_dispute_token(dispute_case.case_id, vendor.npi)
    # The link vendors actually get: the logged-in portal, deep-linked straight
    # to this case. Session-gated (Protected role="vendor" in App.jsx) rather
    # than token-gated — an unauthenticated hit bounces to /login and back here
    # once signed in (see Protected's POST_LOGIN_REDIRECT_KEY handoff). Frontend
    # origin, not the backend's (base_url) — this must land on the React app,
    # not the API server.
    portal_link = f"{settings.frontend_base_url}/vendor/portal?case={dispute_case.case_id}"

    due_date = dispute_case.response_due_date
    due_str_long = _fmt_date_long(due_date) if due_date else "within 15 days"

    billed  = float(notification.amount_billed or 0)
    dos_str = _fmt_dos_range(notification.dos_from, notification.dos_to)

    # Deliberately type-blind: the vendor is never told WHY documents are
    # required (dispute vs fraud report vs deceased patient) — only that a
    # review is underway and proof-of-work documents are due. The full reason
    # is visible to the physician and payer/compliance portals only.
    subject = (
        f"[ACTION REQUIRED] Supporting Documents Needed for Claim #{claim_number} "
        f"— Respond by {due_str_long}"
    )
    action_block = (
        f"ACTION REQUIRED BY {due_str_long}\n"
        f"{'─'*50}\n"
        f"Supporting documentation is required for this claim as part of a\n"
        f"payer review. Please upload proof-of-work documents (delivery\n"
        f"confirmations, signed orders, service records) via your portal:\n\n"
        f"  {portal_link}\n\n"
        f"Failure to respond by the deadline may result in claim recoupment,\n"
        f"escalation to compliance, and referral to CMS for further review.\n"
        f"You will receive Day 7 and Day 13 reminders if this case remains\n"
        f"unresolved."
    )

    body = (
        f"Dear {contact_name},\n\n"
        f"A claim submitted by your organization requires supporting\n"
        f"documentation. Details are below.\n\n"
        f"CLAIM DETAILS\n"
        f"{'─'*50}\n"
        f"Claim Number:     {claim_number}\n"
        f"Patient:          {notification.patient_name_partial or 'N/A'}\n"
        f"Dates of Service: {dos_str}\n"
        f"Amount Billed:    ${billed:,.2f}\n\n"
        f"{action_block}\n\n"
        f"This is an automated notification from the NPI Watch compliance system.\n"
        f"Do not reply to this email."
    )

    details_rows = (
        _details_row("Claim number", claim_number)
        + _details_row("Patient", notification.patient_name_partial or "N/A")
        + _details_row("Dates of service", dos_str)
        + _details_row("Amount billed", f"${billed:,.2f}")
    )
    callout = _callout(
        "Deadline", f"{due_str_long} — documentation must be received by this date to avoid claim recoupment or escalation.",
        AMBER_TX, AMBER_BG, AMBER_BD,
    )
    docs_list = f"""
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:{SLATE};margin:22px 0 8px 0;">Acceptable Documentation</div>
      <ul style="margin:0;padding:0 0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.9;color:{INK};">
        <li>Delivery confirmation</li>
        <li>Signed order</li>
        <li>Service records</li>
      </ul>"""
    html = _shell(
        eyebrow="Action Required", eyebrow_color=AMBER_TX,
        title="Supporting documentation needed for a claim",
        greeting=f"Dear {contact_name},",
        intro=("As part of a routine payer review, we need supporting documentation for the "
               "claim below. Please review the details and upload the requested documents "
               "before the deadline."),
        details_rows=details_rows,
        callout_html=callout,
        button_html=_button("Upload documentation", portal_link),
        extra_html=docs_list,
        footer_note=("If this case remains unresolved, you will receive automatic reminders on "
                     "day 7 and day 13. Continued non-response after the deadline may result in "
                     "claim recoupment, escalation to compliance, and referral to CMS for further review."),
    )

    success = False

    if not settings.email_enabled:
        sep = "=" * 70
        log.info(sep)
        log.info("EMAIL_ENABLED=false — logging vendor dispute email to console")
        log.info(f"TO:      {contact_email}")
        log.info(f"SUBJECT: {subject}")
        log.info("BODY:")
        for line in body.splitlines():
            log.info(line)
        log.info(f"PORTAL:  {portal_link}")
        log.info(sep)
        success = True

    else:
        success = _send_smtp(contact_email, subject, body, html)
        if not success:
            return False

    if success:
        try:
            from datetime import datetime as _dt
            dispute_case.billing_provider_notified_at = _dt.utcnow()
            dispute_case.vendor_token = token
        except Exception as exc:
            log.error(
                f"Failed to set billing_provider_notified_at on case "
                f"id={dispute_case.case_id}: {exc}"
            )

    return success


def _log_or_send(contact_email: str, subject: str, body: str, label: str, html: str = None) -> bool:
    """Shared EMAIL_ENABLED gate for the reminder/expiry mails — console log in
    dev mode, real SMTP otherwise. Never raises."""
    settings = get_settings()
    if not settings.email_enabled:
        sep = "=" * 70
        log.info(sep)
        log.info(f"EMAIL_ENABLED=false — logging {label} email to console")
        log.info(f"TO:      {contact_email}")
        log.info(f"SUBJECT: {subject}")
        for line in body.splitlines():
            log.info(line)
        log.info(sep)
        return True
    return _send_smtp(contact_email, subject, body, html)


def send_vendor_reminder_email(dispute_case, notification, vendor, base_url: str, day: int) -> bool:
    """Day-7 / day-13 reminder for an OPEN dispute case the vendor hasn't
    answered. Same type-blind wording and branded template as the initial
    notice — the vendor is never told why documents are required, only that
    the deadline is closing. Never raises."""
    claim_number  = notification.claim_ccn or notification.claim_number or str(notification.notification_id)
    contact_name  = vendor.contact_name or "Billing Department" if vendor else "Billing Department"
    contact_email = (vendor.contact_email or "") if vendor else ""

    # Still generated/stored for the standalone token page — see the note in
    # send_vendor_dispute_email above. The emailed link itself goes to the
    # session-gated portal instead (same note).
    token = generate_vendor_dispute_token(dispute_case.case_id, dispute_case.vendor_npi)
    frontend_base_url = get_settings().frontend_base_url
    portal_link = f"{frontend_base_url}/vendor/portal?case={dispute_case.case_id}"

    due_date = dispute_case.response_due_date
    due_str_long = _fmt_date_long(due_date) if due_date else "the response deadline"
    days_left = max(0, (due_date - datetime.utcnow()).days) if due_date else 15 - day
    final = day >= 13

    subject = (
        f"[{'FINAL REMINDER' if final else 'REMINDER'}] Supporting Documents Still Needed "
        f"for Claim #{claim_number} — {days_left} day{'s' if days_left != 1 else ''} left"
    )
    body = (
        f"Dear {contact_name},\n\n"
        f"This is a {'final ' if final else ''}reminder: supporting documentation for\n"
        f"Claim #{claim_number} has not yet been received. Your response is due by\n"
        f"{due_str_long}.\n\n"
        f"Please upload proof-of-work documents (delivery confirmations, signed\n"
        f"orders, service records) via your portal:\n\n"
        f"  {portal_link}\n\n"
        f"Failure to respond by the deadline may result in claim recoupment,\n"
        f"escalation to compliance, and referral to CMS for further review.\n\n"
        f"This is an automated notification from the NPI Watch compliance system.\n"
        f"Do not reply to this email."
    )

    details_rows = (
        _details_row("Claim number", claim_number)
        + _details_row("Days remaining", str(days_left))
    )
    callout = _callout(
        "Deadline", f"{due_str_long} — documentation must be received by this date to avoid claim recoupment or escalation.",
        AMBER_TX, AMBER_BG, AMBER_BD,
    )
    html = _shell(
        eyebrow="Final Reminder" if final else "Reminder", eyebrow_color=AMBER_TX,
        title=f"Supporting documentation still needed{' — final notice' if final else ''}",
        greeting=f"Dear {contact_name},",
        intro=(f"This is a {'final ' if final else ''}reminder that supporting documentation "
               f"for the claim below has not yet been received."),
        details_rows=details_rows,
        callout_html=callout,
        button_html=_button("Upload documentation", portal_link),
        footer_note=("Failure to respond by the deadline may result in claim recoupment, "
                     "escalation to compliance, and referral to CMS for further review. "
                     "This is an automated notification — do not reply to this email."),
    )

    ok = _log_or_send(contact_email, subject, body, f"day-{day} reminder", html)
    if ok:
        dispute_case.vendor_token = token
    return ok


def send_vendor_expiry_email(dispute_case, notification, vendor, base_url: str) -> bool:
    """Day-15 notice: the response window closed with no documents received and
    the case has been escalated. Type-blind like every other vendor mail.
    Never raises."""
    claim_number  = notification.claim_ccn or notification.claim_number or str(notification.notification_id)
    contact_name  = (vendor.contact_name or "Billing Department") if vendor else "Billing Department"
    contact_email = (vendor.contact_email or "") if vendor else ""

    due_date = dispute_case.response_due_date
    due_str_long = _fmt_date_long(due_date) if due_date else "the deadline"

    subject = f"[NOTICE] Response Window Closed for Claim #{claim_number} — Case Escalated"
    body = (
        f"Dear {contact_name},\n\n"
        f"The 15-day response window for Claim #{claim_number} closed on {due_str_long}\n"
        f"with no supporting documentation received.\n\n"
        f"This case has been escalated for compliance review. The claim may be\n"
        f"subject to recoupment and referral to CMS. If you believe this is in\n"
        f"error or have documentation to provide, contact the plan's compliance\n"
        f"team referencing case #{dispute_case.case_id}.\n\n"
        f"This is an automated notification from the NPI Watch compliance system.\n"
        f"Do not reply to this email."
    )

    details_rows = (
        _details_row("Claim number", claim_number)
        + _details_row("Case reference", f"#{dispute_case.case_id}")
        + _details_row("Window closed", due_str_long)
    )
    callout = _callout(
        "Escalated", "This case has been referred for compliance review. The claim may be subject to recoupment and referral to CMS.",
        ROSE_TX, ROSE_BG, ROSE_BD,
    )
    html = _shell(
        eyebrow="Case Escalated", eyebrow_color=ROSE_TX,
        title="Response window closed — no documentation received",
        greeting=f"Dear {contact_name},",
        intro=("The 15-day response window for the claim below closed with no supporting "
               "documentation received."),
        details_rows=details_rows,
        callout_html=callout,
        footer_note=(f"If you believe this is in error or have documentation to provide, contact "
                     f"the plan's compliance team referencing case #{dispute_case.case_id}. "
                     f"This is an automated notification — do not reply to this email."),
    )

    return _log_or_send(contact_email, subject, body, "expiry notice", html)
