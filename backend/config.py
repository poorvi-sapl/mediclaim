from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    database_url: str
    openai_api_key: str
    secret_key: str
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://localhost:5173"]
    port: int = 8000
    environment: str = "development"
    jwt_secret_key: str = "claimlens-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expiry_hours: int = 8
    mfa_encryption_key: str = ""  # Fernet key for encrypting TOTP secrets at rest
    mfa_pending_expiry_minutes: int = 5
    mfa_max_attempts: int = 5
    mfa_lockout_minutes: int = 15
    # When true, CMS verification checks return deterministic fixtures instead of
    # calling data.cms.gov (for local/dev environments that can't reach the API).
    cms_mock: bool = False
    # --- Email OTP (login second factor) ---
    mail_username: str = ""
    mail_password: str = ""
    mail_from: str = "noreply@claimlens.com"
    mail_server: str = "smtp.gmail.com"
    mail_port: int = 587
    mail_starttls: bool = True
    mail_ssl_tls: bool = False
    otp_expiry_minutes: int = 10
    all_otp_stub: bool = True   # ALL_OTP_STUB — dev/demo only: every OTP is 123456, no email
    # --- Registration verification mock flags (drop-in: flip flag / add creds to go live) ---
    nppes_mock: bool = False          # live — local NPPES snapshot query
    oig_mock: bool = False            # live — local OIG table query
    dea_mock: bool = True             # no live API; checksum validation runs regardless
    state_license_mock: bool = True   # no generic live API; per-state in STATE_LICENSE_APIS
    ptan_mock: bool = True            # no live API; always manual review
    sam_mock: bool = True             # set false + SAM_API_KEY to go live
    uei_mock: bool = True             # set false + SAM_API_KEY (same key) to go live
    sam_api_key: str = ""
    document_upload_dir: str = "uploads"
    volume_spike_multiplier: float = 2.0
    geographic_anomaly_miles: float = 30.0
    cross_npi_threshold: int = 3
    new_supplier_days_lookback: int = 30
    new_supplier_amount_threshold: float = 500.00
    weight_volume_spike: int = 25
    weight_geo_anomaly: int = 15
    weight_cross_npi: int = 30
    weight_oig_hit: int = 35
    weight_new_supplier: int = 10
    weight_per_physician_flag: int = 5
    weight_did_not_order: int = 10
    weight_duplicate_billing: int = 20
    weight_identity_reuse: int = 20
    weight_hospice_duration: int = 15
    weight_upcoding: int = 20
    weight_unbundling: int = 15
    # thresholds for the new rules
    identity_reuse_min_npis: int = 3
    hospice_duration_days: int = 180
    upcoding_amount_multiplier: float = 3.0
    upcoding_amount_floor: float = 500.0
    unbundling_min_codes: int = 3
    max_physician_flag_contribution: int = 20
    sse_keepalive_seconds: int = 15
    # --- risk score shaping (blended severity curve + continuous signals) ---
    # Rule/action "risk points" are mapped through a smooth saturating curve into
    # [0, score_severity_max]; continuous signals (volume, $, breadth, % flagged)
    # add up to score_continuous_max. The two together give a realistic 0-100 spread
    # instead of a saturating sum that pins offenders at exactly 100.
    score_severity_max: float = 80.0
    score_continuous_max: float = 20.0
    score_curve_k: float = 50.0          # larger K = gentler curve / more spread
    score_w_volume: float = 0.30         # continuous-component weights (sum to 1.0)
    score_w_amount: float = 0.30
    score_w_breadth: float = 0.20        # distinct suppliers (NPI) / distinct NPIs (supplier)
    score_w_flagged: float = 0.20        # fraction of the entity's claims that are OIG-flagged
    alert_action_types: list = [
        'flag_supplier',
        'unknown_patient',
        'did_not_order'
    ]
    escalation_action_types: list = [
        'did_not_order'
    ]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings() -> Settings:
    return Settings()
