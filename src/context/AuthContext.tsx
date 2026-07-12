import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import type { Usuario } from '@/types'
import { getCurrentUser } from '@/services/api'

const TOKEN_KEY = 'wsp-isap-token'

interface AuthContextValue {
  usuario: Usuario | null
  isLoading: boolean
  isAuthenticated: boolean
  setSession: (usuario: Usuario, token: string) => void
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const setSession = useCallback((user: Usuario, token: string) => {
    localStorage.setItem(TOKEN_KEY, token)
    setUsuario(user)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setUsuario(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      setIsLoading(false)
      return
    }
    try {
      const response = await getCurrentUser()
      if (response.success && response.data) {
        setUsuario(response.data)
      } else {
        localStorage.removeItem(TOKEN_KEY)
      }
    } catch {
      localStorage.removeItem(TOKEN_KEY)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Carga inicial: verifica si hay sesión activa
  useEffect(() => {
    void refreshUser()
  }, [refreshUser])

  const value: AuthContextValue = {
    usuario,
    isLoading,
    isAuthenticated: !!usuario,
    setSession,
    logout,
    refreshUser,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un <AuthProvider>')
  }
  return context
}