import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import type { Usuario } from '@/types'

const SESSION_KEY = 'wsp-isap-session'

interface AuthContextValue {
  usuario: Usuario | null
  isLoading: boolean
  isAuthenticated: boolean
  setSession: (usuario: Usuario, token?: string) => void
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const setSession = useCallback((user: Usuario) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user))
    setUsuario(user)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY)
    setUsuario(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const rawSession = localStorage.getItem(SESSION_KEY)
    if (!rawSession) {
      setUsuario(null)
      setIsLoading(false)
      return
    }

    try {
      const parsed = JSON.parse(rawSession) as Usuario
      if (!parsed?.id || !parsed?.telefono) {
        throw new Error('Sesión inválida')
      }
      setUsuario({
        ...parsed,
        beneficiarios: parsed.beneficiarios ?? [],
        beneficiariosUpdatedAt: parsed.beneficiariosUpdatedAt,
      })
    } catch {
      localStorage.removeItem(SESSION_KEY)
      setUsuario(null)
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
