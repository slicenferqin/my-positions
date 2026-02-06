import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthUser } from '@/types/auth'
import { storage } from '@/services'
import { fetchProfile, loginUser, registerUser } from '@/services/api'

const TOKEN_KEY = 'myPositions_token'

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  loading: boolean
  login: (payload: { email: string; password: string }) => Promise<void>
  register: (payload: { email: string; password: string; name?: string }) => Promise<void>
  logout: () => void
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [loading, setLoading] = useState(true)

  const syncScope = useCallback(
    (currentUser: AuthUser | null) => {
      storage.setScope(currentUser ? currentUser.id : null)
    },
    []
  )

  const saveToken = useCallback((value: string | null) => {
    if (value) {
      localStorage.setItem(TOKEN_KEY, value)
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
    setToken(value)
  }, [])

  const logout = useCallback(() => {
    saveToken(null)
    setUser(null)
    storage.clearCaches()
  }, [saveToken])

  const loadProfile = useCallback(async () => {
    if (!token) {
      setLoading(false)
      setUser(null)
      syncScope(null)
      return
    }
    try {
      const { user: profile } = await fetchProfile(token)
      setUser(profile)
      syncScope(profile)
    } catch (error) {
      console.warn('加载用户信息失败', error)
      logout()
    } finally {
      setLoading(false)
    }
  }, [token, logout, syncScope])

  useEffect(() => {
    loadProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const handleLogin = useCallback(
    async ({ email, password }: { email: string; password: string }) => {
      const { token: newToken, user: profile } = await loginUser({ email, password })
      saveToken(newToken)
      setUser(profile)
      syncScope(profile)
    },
    [saveToken, syncScope]
  )

  const handleRegister = useCallback(
    async ({ email, password, name }: { email: string; password: string; name?: string }) => {
      const { token: newToken, user: profile } = await registerUser({ email, password, name })
      saveToken(newToken)
      setUser(profile)
      syncScope(profile)
    },
    [saveToken, syncScope]
  )

  const refreshProfile = useCallback(async () => {
    if (!token) return
    const { user: profile } = await fetchProfile(token)
    setUser(profile)
    syncScope(profile)
  }, [token, syncScope])

  const value: AuthContextValue = useMemo(
    () => ({
      user,
      token,
      loading,
      login: handleLogin,
      register: handleRegister,
      logout,
      refreshProfile,
    }),
    [user, token, loading, handleLogin, handleRegister, logout, refreshProfile]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
