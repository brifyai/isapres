import { OnboardingForm } from '@/components/onboarding/OnboardingForm'

/**
 * Página de Onboarding mobile-first.
 * Se abre desde un link en WhatsApp para enrolar al usuario.
 *
 * Lee el teléfono inicial desde query params (ej: ?t=56912345678).
 */
export function OnboardingPage() {
  // Leer teléfono desde query param si viene desde WhatsApp
  const params = new URLSearchParams(window.location.search)
  const telefonoInicial = params.get('t') ?? params.get('telefono') ?? ''

  return (
    <div className="min-h-screen bg-gradient-to-b from-secondary/30 to-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
        {/* Header */}
        <header className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7"
            >
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Reembolsos Isapres
            </h1>
            <p className="text-sm text-muted-foreground">
              Enrólate para solicitar reembolsos directamente desde WhatsApp
            </p>
          </div>
        </header>

        {/* Formulario */}
        <main className="flex-1">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <OnboardingForm telefonoInicial={telefonoInicial} />
          </div>
        </main>

        {/* Footer */}
        <footer className="mt-6 flex flex-col items-center gap-3 text-center">
          <p className="text-xs text-muted-foreground">
            Tus datos están protegidos con cifrado AES-256
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
            <a
              href="/politica-de-privacidad"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              Política de Privacidad
            </a>
            <a
              href="/terminos-y-condiciones"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              Términos y Condiciones
            </a>
          </div>
        </footer>
      </div>
    </div>
  )
}
