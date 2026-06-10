"""Document upload for registration (DEA cert, state license, W-9, PTAN letter).

Files are stored under DOCUMENT_UPLOAD_DIR/{user_id}/ and tracked in the documents
table with a pending_review status. Auth: valid claimlens_token.
"""

import os
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Request, HTTPException, UploadFile, File, Form
from jose import JWTError
from sqlalchemy.orm import Session

from ..database import get_db
from ..config import get_settings
from ..models import User, Document
from ..auth import extract_token, decode_token, is_blacklisted

router = APIRouter(prefix="/documents", tags=["documents"])
settings = get_settings()

MAX_BYTES = 10 * 1024 * 1024
ALLOWED = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}
DOC_TYPES = {"dea_certificate", "state_license", "w9", "ptan_letter"}


def _current_user(request: Request, db: Session) -> User:
    token = extract_token(request)
    if not token or is_blacklisted(token):
        raise HTTPException(status_code=401, detail={"error": "Not authenticated", "code": "NO_TOKEN"})
    try:
        claims = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail={"error": "Invalid or expired token", "code": "INVALID_TOKEN"})
    if claims.get("type", "access") != "access":
        raise HTTPException(status_code=401, detail={"error": "Invalid token", "code": "INVALID_TOKEN_TYPE"})
    user = db.query(User).filter(User.email == claims.get("email")).first()
    if not user:
        raise HTTPException(status_code=401, detail={"error": "User not found", "code": "USER_NOT_FOUND"})
    return user


@router.post("/upload")
async def upload_document(request: Request, file: UploadFile = File(...),
                          doc_type: str = Form(...), db: Session = Depends(get_db)):
    user = _current_user(request, db)

    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail={
            "error": f"Invalid doc_type. Allowed: {', '.join(sorted(DOC_TYPES))}", "code": "BAD_DOC_TYPE"})
    if file.content_type not in ALLOWED:
        raise HTTPException(status_code=400, detail={
            "error": "Unsupported file type. Allowed: PDF, JPEG, PNG.", "code": "BAD_FILE_TYPE"})

    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=400, detail={
            "error": "File too large. Maximum size is 10MB.", "code": "FILE_TOO_LARGE"})

    ext = ALLOWED[file.content_type]
    user_dir = os.path.join(settings.document_upload_dir, str(user.id))
    os.makedirs(user_dir, exist_ok=True)
    ts = int(datetime.utcnow().timestamp())
    fname = f"{doc_type}_{ts}.{ext}"
    path = os.path.join(user_dir, fname)
    with open(path, "wb") as f:
        f.write(content)

    doc = Document(user_id=user.id, doc_type=doc_type, filename=fname,
                   file_path=path, upload_status="pending_review")
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return {
        "document_id": str(doc.id),
        "doc_type": doc_type,
        "status": "pending_review",
        "message": "Document uploaded. Under review — typically 1–2 business days.",
    }


@router.get("/status")
def document_status(request: Request, db: Session = Depends(get_db)):
    user = _current_user(request, db)
    docs = db.query(Document).filter(Document.user_id == user.id).order_by(Document.created_at.desc()).all()
    return [{
        "doc_type": d.doc_type,
        "status": d.upload_status,
        "uploaded_at": d.created_at.isoformat() if d.created_at else None,
    } for d in docs]
