"""Admin endpoints for activating pending (payer) accounts. API-only for the MVP.

Auth: a logged-in plan_investigator whose email ends in @claimlens.com (demo admin).
"""

from fastapi import APIRouter, Depends, Request, HTTPException
from jose import JWTError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..auth import extract_token, decode_token, is_blacklisted

router = APIRouter(prefix="/admin", tags=["admin"])


def _admin_user(request: Request, db: Session) -> User:
    token = extract_token(request)
    if not token or is_blacklisted(token):
        raise HTTPException(status_code=401, detail={"error": "Not authenticated", "code": "NO_TOKEN"})
    try:
        claims = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail={"error": "Invalid or expired token", "code": "INVALID_TOKEN"})
    email = (claims.get("email") or "").lower()
    if claims.get("role") != "plan_investigator" or not email.endswith("@claimlens.com"):
        raise HTTPException(status_code=403, detail={"error": "Admin access required", "code": "NOT_ADMIN"})
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=401, detail={"error": "User not found", "code": "USER_NOT_FOUND"})
    return user


@router.get("/users/pending")
def pending_users(request: Request, db: Session = Depends(get_db)):
    _admin_user(request, db)
    rows = db.query(User).filter(User.is_active.is_(False)).order_by(User.created_at.desc()).all()
    return [{
        "id": str(u.id),
        "email": u.email,
        "role": u.role,
        "organization_name": u.organization_name,
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "verification_results": u.verification_results,
    } for u in rows]


@router.post("/users/{user_id}/activate")
def activate_user(user_id: str, request: Request, db: Session = Depends(get_db)):
    _admin_user(request, db)
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail={"error": "User not found", "code": "USER_NOT_FOUND"})
    target.is_active = True
    db.commit()
    return {"activated": True, "user_id": str(target.id)}
