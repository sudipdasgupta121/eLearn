import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from './api'

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/auth/me').then((d) => setUser(d.user || null)).catch(() => setUser(null)).finally(() => setLoading(false))
    const expired = () => setUser(null)
    window.addEventListener('upskill:unauthorized', expired)
    return () => window.removeEventListener('upskill:unauthorized', expired)
  }, [])

  const authenticate = useCallback(async (path, body) => {
    const d = await api(path, { method: 'POST', body })
    setUser(d.user)
  }, [])

  const value = {
    user,
    loading,
    login: (email, password) => authenticate('/auth/login', { email, password }),
    register: (name, email, password) => authenticate('/auth/register', { name, email, password }),
    logout: async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null) },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
