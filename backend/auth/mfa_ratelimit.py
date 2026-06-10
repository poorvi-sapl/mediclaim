"""In-memory MFA rate limiter.

Tracks failed TOTP/backup-code attempts per user and locks the account for a cooldown
window after too many failures.

TODO(production): this state lives in a process-local dict, so it does NOT survive a
restart and is NOT shared across multiple workers/instances. For production, back this
with Redis (e.g. INCR + EXPIRE per user_id) so limits hold across the whole fleet.
"""

from datetime import datetime, timedelta
from typing import Optional

from ..config import get_settings

settings = get_settings()


class MFARateLimiter:
    def __init__(self, max_attempts: Optional[int] = None,
                 lockout_minutes: Optional[int] = None):
        self._state: dict[str, dict] = {}
        self.max_attempts = max_attempts or settings.mfa_max_attempts
        self.lockout_minutes = lockout_minutes or settings.mfa_lockout_minutes

    def check_locked(self, user_id: str) -> bool:
        """True if the user is currently in a lockout window."""
        entry = self._state.get(str(user_id))
        if not entry:
            return False
        locked_until = entry.get("locked_until")
        if locked_until and datetime.utcnow() < locked_until:
            return True
        # Lockout expired — clear it so the user can try again.
        if locked_until and datetime.utcnow() >= locked_until:
            self.reset(user_id)
        return False

    def record_attempt(self, user_id: str) -> None:
        """Count a failed attempt; trip the lockout once max_attempts is reached."""
        uid = str(user_id)
        entry = self._state.setdefault(uid, {"attempts": 0, "locked_until": None})
        entry["attempts"] += 1
        if entry["attempts"] >= self.max_attempts:
            entry["locked_until"] = datetime.utcnow() + timedelta(minutes=self.lockout_minutes)
            entry["attempts"] = 0

    def reset(self, user_id: str) -> None:
        """Clear all attempt/lockout state for a user (called on success)."""
        self._state.pop(str(user_id), None)


# Single process-wide limiter instance.
mfa_limiter = MFARateLimiter()
