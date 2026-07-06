"""
NPI Watch claim notification email.

When EMAIL_ENABLED=false (default) the full email content — including all
three action links — is logged to the console. No Azure call is made.
When EMAIL_ENABLED=true, sends via Azure Communication Services.

Never raises: logs errors and returns False so a failed email never
crashes the ingest pipeline.
"""

import logging
from datetime import datetime

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import ClaimNotification, Physician
from ..utils.tokens import generate_vendor_dispute_token

log = logging.getLogger("utils.email")


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

    Returns True on success, False if Azure returns an error.
    """
    settings = get_settings()
    token = notification.response_token or ""

    confirm_url = f"{base_url}/api/v1/respond?token={token}&action=CONFIRM"
    dispute_url = f"{base_url}/api/v1/respond?token={token}&action=DISPUTE"
    fraud_url   = f"{base_url}/api/v1/respond?token={token}&action=FRAUD_REPORT"

    hcpcs_str = ", ".join(notification.hcpcs_codes) if notification.hcpcs_codes else "N/A"
    dos_str   = (
        f"{notification.dos_from} to {notification.dos_to}"
        if notification.dos_from else "N/A"
    )
    billed = float(notification.amount_billed or 0)
    paid   = float(notification.amount_paid or 0)
    dr_name = f"Dr. {physician.first_name or ''} {physician.last_name or ''}".strip()

    subject = "[NPI Alert] Your NPI was used on a Medicare claim — Action Required"

    body = (
        f"Dear {dr_name},\n\n"
        f"Your NPI ({notification.physician_npi}) has been identified on a Medicare claim "
        f"as the {notification.physician_npi_role} physician.\n"
        f"Please review the claim details below and take action.\n\n"
        f"CLAIM DETAILS\n"
        f"{'─'*50}\n"
        f"Claim Number:     {notification.claim_ccn or notification.claim_number or 'N/A'}\n"
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

    success = False

    if not settings.email_enabled:
        sep = "=" * 70
        log.info(sep)
        log.info("EMAIL_ENABLED=false — logging email to console (no Azure call)")
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
        try:
            from azure.communication.email import EmailClient  # type: ignore
            client = EmailClient.from_connection_string(
                settings.azure_communication_connection_string
            )
            message = {
                "senderAddress": settings.from_email,
                "recipients": {"to": [{"address": physician.email_primary}]},
                "content": {"subject": subject, "plainText": body},
            }
            poller = client.begin_send(message)
            result  = poller.result()
            success = str(result.get("status", "")).lower() == "succeeded"
            if not success:
                log.error(f"Azure email send failed — status: {result.get('status')}")
        except Exception as exc:
            log.error(f"send_claim_notification_email: Azure error: {exc}")
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
    Sends dispute / fraud-report notice to the billing vendor.

    Subject:
      DISPUTE      → "[URGENT] Physician Rejected Claim #{claim_number} — 15-Day Response Required"
      FRAUD_REPORT → "[FRAUD ALERT] Physician Reported Claim #{claim_number} as Fraud — Immediate Action Required"

    On True:  sets dispute_case.billing_provider_notified_at = NOW()
    EMAIL_ENABLED=false → logs to console, returns True
    EMAIL_ENABLED=true  → sends via Azure, returns True on success / False on error
    Never raises.
    """
    settings = get_settings()

    claim_number  = notification.claim_ccn or notification.claim_number or str(notification.notification_id)
    dispute_type  = dispute_case.dispute_type           # "DISPUTE" or "FRAUD_REPORT"
    contact_name  = vendor.contact_name or "Billing Department"
    contact_email = vendor.contact_email or ""

    token = generate_vendor_dispute_token(dispute_case.case_id, vendor.npi)
    portal_link = f"{base_url}/vendor/disputes/{dispute_case.case_id}?token={token}"

    due_date = dispute_case.response_due_date
    due_str  = due_date.strftime("%B %d %Y") if due_date else "within 15 days"

    billed   = float(notification.amount_billed or 0)
    dos_from = str(notification.dos_from) if notification.dos_from else "N/A"
    dos_to   = str(notification.dos_to)   if notification.dos_to   else "N/A"
    dos_str  = f"{dos_from} to {dos_to}" if notification.dos_from else "N/A"

    if dispute_type == "DISPUTE":
        subject = (
            f"[URGENT] Physician Rejected Claim #{claim_number} "
            f"— 15-Day Response Required"
        )
        action_block = (
            f"ACTION REQUIRED BY {due_str}\n"
            f"{'─'*50}\n"
            f"You have 15 days to respond to this dispute.\n\n"
            f"Option A — Respond to Medicare directly:\n"
            f"  Upload supporting documentation via your Medicare portal.\n"
            f"  Log in at: {portal_link}\n\n"
            f"Option B — Contact the physician's office directly:\n"
            f"  If this service was authorized, have the physician update\n"
            f"  their response to CONFIRM through the NPI Watch system.\n\n"
            f"Failure to respond within 15 days may result in claim recoupment\n"
            f"and referral to CMS for further review."
        )
    else:
        subject = (
            f"[FRAUD ALERT] Physician Reported Claim #{claim_number} "
            f"as Fraud — Immediate Action Required"
        )
        action_block = (
            f"IMMEDIATE ACTION REQUIRED\n"
            f"{'─'*50}\n"
            f"This case has been escalated to the compliance team.\n\n"
            f"  - An OIG referral is being prepared.\n"
            f"  - A legal hold notice has been issued on all records\n"
            f"    related to this claim and patient.\n"
            f"  - Do NOT alter, delete, or transfer any documentation\n"
            f"    related to this patient or claim.\n\n"
            f"Access the compliance portal at: {portal_link}\n\n"
            f"You will receive Day 7 and Day 13 reminders if this case\n"
            f"remains unresolved."
        )

    body = (
        f"Dear {contact_name},\n\n"
        f"A physician has responded to an NPI Watch alert regarding a claim\n"
        f"submitted by your organization. Details are below.\n\n"
        f"CLAIM DETAILS\n"
        f"{'─'*50}\n"
        f"Claim Number:     {claim_number}\n"
        f"Patient:          {notification.patient_name_partial or 'N/A'}\n"
        f"Dates of Service: {dos_str}\n"
        f"Amount Billed:    ${billed:,.2f}\n"
        f"Dispute Type:     {dispute_type}\n\n"
        f"{action_block}\n\n"
        f"This is an automated notification from the NPI Watch compliance system.\n"
        f"Do not reply to this email."
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
        try:
            from azure.communication.email import EmailClient  # type: ignore
            client = EmailClient.from_connection_string(
                settings.azure_communication_connection_string
            )
            message = {
                "senderAddress": settings.from_email,
                "recipients": {"to": [{"address": contact_email}]},
                "content": {"subject": subject, "plainText": body},
            }
            poller = client.begin_send(message)
            result  = poller.result()
            success = str(result.get("status", "")).lower() == "succeeded"
            if not success:
                log.error(f"Azure vendor email failed — status: {result.get('status')}")
        except Exception as exc:
            log.error(f"send_vendor_dispute_email: Azure error: {exc}")
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
