import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { authLogin, authLogout, authMe, setAuthErrorHandler } from '../api'

const AuthContext = createContext(null)

// Where each role lands after login / on a bare visit.
export const DASHBOARD_PATH = {
  physician: '/physician/dashboard',
  plan_investigator: '/plan/dashboard',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)     // { email, role, npi, full_name } | null
  const [loading, setLoading] = useState(true)

  // Restore session from the cookie on first load, and register the global
  // 401 handler so an expired token anywhere clears the session.
  useEffect(() => {
    setAuthErrorHandler(() => setUser(null))
    let cancelled = false
    authMe()
      .then((u) => { if (!cancelled) setUser(u) })
      .catch(() => { if (!cancelled) setUser(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Re-hydrate the session from the cookie (after the OTP step sets claimlens_token,
  // or for demo accounts that get a cookie straight from /auth/login).
  const refreshUser = useCallback(async () => {
    const u = await authMe()
    setUser(u)
    return u
  }, [])

  const login = useCallback(async (email, password, remember) => {
    const res = await authLogin(email, password, remember)
    // Email OTP: the password step alone grants no session — the caller routes to
    // /otp/login with res.otp_pending_token. Demo accounts (@claimlens.com) come back
    // with otp_required:false and a cookie already set, so hydrate the user now.
    if (res.otp_required) return res
    await refreshUser()
    return res   // caller uses res.redirect / res.role to choose the destination
  }, [refreshUser])

  const logout = useCallback(async () => {
    await authLogout()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
