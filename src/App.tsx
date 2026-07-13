import { AuthProvider } from '@/context/AuthContext'
import { useAuth } from '@/context/AuthContext'
import { DashboardPage } from '@/pages/DashboardPage'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { PrivacyPolicyPage } from '@/pages/PrivacyPolicyPage'
import { TermsPage } from '@/pages/TermsPage'

/**
 * Componente raíz de la aplicación.
 *
 * Por ahora renderiza la página de Onboarding.
 * Cuando se implementen las demás vistas (Dashboard, Admin),
 * aquí se integrará el router correspondiente.
 */
function AppShell() {
  const { isAuthenticated, isLoading } = useAuth()
  const pathname = window.location.pathname.toLowerCase()

  if (pathname === '/politica-de-privacidad') {
    return <PrivacyPolicyPage />
  }

  if (pathname === '/terminos-y-condiciones') {
    return <TermsPage />
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="rounded-xl border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">
          Cargando sesión...
        </div>
      </div>
    )
  }

  return isAuthenticated ? <DashboardPage /> : <OnboardingPage />
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
