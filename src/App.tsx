import { AuthProvider } from '@/context/AuthContext'
import { OnboardingPage } from '@/pages/OnboardingPage'

/**
 * Componente raíz de la aplicación.
 *
 * Por ahora renderiza la página de Onboarding.
 * Cuando se implementen las demás vistas (Dashboard, Admin),
 * aquí se integrará el router correspondiente.
 */
export default function App() {
  return (
    <AuthProvider>
      <OnboardingPage />
    </AuthProvider>
  )
}