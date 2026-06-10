import logging
from datetime import datetime
from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from .config import get_settings
from .database import engine, get_db, Base
from .models import Claim, RulesFlag
from jose import JWTError
from .auth import extract_token, decode_token, is_blacklisted
from .routers import claims as claims_router
from .routers import actions as actions_router
from .routers import dashboard as dashboard_router
from .routers import alerts as alerts_router
from .routers import auth as auth_router
from .routers import mfa as mfa_router
from .routers import documents as documents_router
from .routers import admin as admin_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

# Create all 5 ClaimLens tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="ClaimLens API",
    version="1.0.0",
    description="NPI Intelligence Platform — Backend API",
)

# --- JWT auth guard ------------------------------------------------------
# Public paths need no token; everything else requires a valid JWT (from the
# Authorization: Bearer header OR the claimlens_token cookie). /physician/* and
# /actions require the physician role; /plan/* requires plan_investigator.
_PUBLIC = ("/health", "/", "/openapi.json")


def _is_public(path: str) -> bool:
    return (path in _PUBLIC or path.startswith("/auth")
            or path.startswith("/docs") or path.startswith("/redoc"))


def _required_role(path: str):
    if path.startswith("/physician") or path == "/actions":
        return "physician"
    if path.startswith("/plan"):
        return "plan_investigator"
    return None


class AuthMiddleware:
    """Pure-ASGI guard — inspects headers/cookies only, so it never buffers the
    SSE response body."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request = Request(scope, receive)
        path = scope["path"]
        if request.method == "OPTIONS" or _is_public(path):
            return await self.app(scope, receive, send)

        token = extract_token(request)
        err = None
        payload = None
        if not token or is_blacklisted(token):
            err = (401, {"error": "Not authenticated", "code": "NO_TOKEN"})
        else:
            try:
                payload = decode_token(token)
            except JWTError:
                err = (401, {"error": "Invalid or expired token",
                             "code": "INVALID_TOKEN"})
        if err is None:
            # Only fully-authenticated "access" tokens may reach protected routes.
            # An mfa_pending token (type="mfa_pending") is rejected here so it can never
            # be used to load a dashboard. Legacy tokens issued before MFA carried no
            # "type" claim, so a missing type is treated as "access" for backward compat.
            if (payload or {}).get("type", "access") != "access":
                err = (401, {"error": "Invalid or expired token",
                             "code": "INVALID_TOKEN_TYPE"})
        if err is None:
            # Inactive accounts (e.g. payer registrations awaiting admin activation)
            # cannot reach protected routes. Missing claim -> active (backward compat).
            if (payload or {}).get("is_active", True) is False:
                err = (403, {"error": "Account pending activation. You will be notified by email.",
                             "code": "ACCOUNT_INACTIVE"})
        if err is None:
            required = _required_role(path)
            if required and (payload or {}).get("role") != required:
                err = (403, {"error": "You do not have access to this area",
                             "code": "FORBIDDEN_ROLE"})
        if err is not None:
            return await JSONResponse(status_code=err[0], content=err[1])(
                scope, receive, send)
        return await self.app(scope, receive, send)


# Auth added FIRST (inner); CORS added LAST so it stays the OUTERMOST layer and
# still attaches CORS headers to 401/403 responses.
app.add_middleware(AuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(mfa_router.router)
app.include_router(mfa_router.otp_router)  # ACTIVE email-OTP login factor
app.include_router(documents_router.router)
app.include_router(admin_router.router)
app.include_router(claims_router.router)
app.include_router(actions_router.router)
app.include_router(dashboard_router.router)
app.include_router(alerts_router.router)

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        claim_count = db.query(func.count(Claim.id)).scalar()
        flag_count  = db.query(func.count(RulesFlag.id)).scalar()
        return {
            "status":        "ok",
            "database":      "connected",
            "total_claims":  claim_count,
            "total_flags":   flag_count,
            "timestamp":     datetime.utcnow().isoformat(),
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(
            status_code=503,
            content={"error": "Database unavailable", "code": "DB_UNAVAILABLE"}
        )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "code": "INTERNAL_ERROR"}
    )
