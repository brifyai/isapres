import { useMemo, useState } from 'react'
import {
  BadgeCheck,
  Building2,
  FileText,
  KeyRound,
  LogOut,
  MessageCircle,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { buildWhatsappEntryUrl } from '@/lib/whatsapp'
import { formatDate } from '@/lib/utils'
import { getBeneficiariosStatus, syncBeneficiarios } from '@/services/beneficiarios'
import { ISAPRES } from '@/types'

export function DashboardPage() {
  const { usuario, logout, setSession } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [syncAction, setSyncAction] = useState<'sync' | 'verify' | 'resend' | 'check' | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationSessionId, setVerificationSessionId] = useState<string | null>(null)
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null)

  const primaryCredential = usuario?.credenciales[0]
  const currentIsapre = useMemo(
    () => ISAPRES.find((item) => item.id === primaryCredential?.isapreId) ?? null,
    [primaryCredential?.isapreId],
  )
  const whatsappEntryUrl = useMemo(
    () => buildWhatsappEntryUrl('Hola, ya sincronizamos beneficiarios y quiero continuar con mi reembolso.'),
    [],
  )
  const beneficiarios = usuario?.beneficiarios ?? []
  const canSyncBeneficiarios = currentIsapre?.id === 'banmedica'
  const hasBeneficiarios = beneficiarios.length > 0
  const hasVerificationChallenge = Boolean(verificationSessionId)
  const canOpenWhatsapp = hasBeneficiarios && Boolean(whatsappEntryUrl)
  const isSyncingBeneficiarios = syncAction === 'sync'
  const isSubmittingVerification = syncAction === 'verify'
  const isResendingVerification = syncAction === 'resend'
  const isCheckingBeneficiarios = syncAction === 'check'

  const resetVerificationState = () => {
    setVerificationCode('')
    setVerificationSessionId(null)
    setVerificationMessage(null)
  }

  const applySyncSuccess = (message: string, nextUsuario: typeof usuario | undefined) => {
    resetVerificationState()
    if (nextUsuario) {
      setSession(nextUsuario)
    }
    setSuccessMessage(message)
  }

  const buildSyncSuccessMessage = (count: number) => (
    count === 1
      ? 'Se sincronizó 1 beneficiario y el botón de WhatsApp quedó habilitado.'
      : `Se sincronizaron ${count} beneficiarios y el botón de WhatsApp quedó habilitado.`
  )

  const handleSyncBeneficiarios = async () => {
    if (!usuario) {
      setError('No hay sesión activa para sincronizar.')
      return
    }

    setSyncAction('sync')
    setError(null)
    setSuccessMessage(null)

    const response = await syncBeneficiarios({
      id: usuario.id,
      telefono: usuario.telefono,
      rut: usuario.rut,
    })

    if (!response.success || !response.data) {
      setError(response.error ?? 'No se pudieron sincronizar los beneficiarios.')
      setSyncAction(null)
      return
    }

    if (response.data.requiresVerification && response.data.verificationSessionId) {
      setVerificationSessionId(response.data.verificationSessionId)
      setVerificationMessage(response.data.verificationMessage ?? 'Banmédica pidió un código de verificación.')
      setVerificationCode('')
      if (response.data.usuario) {
        setSession(response.data.usuario)
      }
      setSyncAction(null)
      return
    }

    const syncedBeneficiarios = response.data.beneficiarios ?? []
    applySyncSuccess(buildSyncSuccessMessage(syncedBeneficiarios.length), response.data.usuario)
    setSyncAction(null)
  }

  const handleSubmitVerification = async () => {
    if (!usuario || !verificationSessionId) {
      setError('La verificación ya no está activa. Vuelve a iniciar la sincronización.')
      return
    }

    if (!verificationCode.trim()) {
      setError('Ingresa el código de verificación para continuar.')
      return
    }

    setSyncAction('verify')
    setError(null)
    setSuccessMessage(null)

    const response = await syncBeneficiarios(
      {
        id: usuario.id,
        telefono: usuario.telefono,
        rut: usuario.rut,
      },
      {
        verificationCode: verificationCode.trim(),
        verificationSessionId,
      },
    )

    if (!response.success || !response.data) {
      setError(response.error ?? 'No se pudo validar el código de verificación.')
      setSyncAction(null)
      return
    }

    if (response.data.requiresVerification && response.data.verificationSessionId) {
      setVerificationSessionId(response.data.verificationSessionId)
      setVerificationMessage(response.data.verificationMessage ?? verificationMessage)
      setSyncAction(null)
      return
    }

    const syncedBeneficiarios = response.data.beneficiarios ?? []
    applySyncSuccess(buildSyncSuccessMessage(syncedBeneficiarios.length), response.data.usuario)
    setSyncAction(null)
  }

  const handleResendVerification = async () => {
    if (!usuario || !verificationSessionId) {
      setError('La verificación ya no está activa. Vuelve a iniciar la sincronización.')
      return
    }

    setSyncAction('resend')
    setError(null)
    setSuccessMessage(null)

    const response = await syncBeneficiarios(
      {
        id: usuario.id,
        telefono: usuario.telefono,
        rut: usuario.rut,
      },
      {
        verificationSessionId,
        resendVerification: true,
      },
    )

    if (!response.success || !response.data) {
      setError(response.error ?? 'No se pudo reenviar el código de verificación.')
      setSyncAction(null)
      return
    }

    if (response.data.requiresVerification && response.data.verificationSessionId) {
      setVerificationSessionId(response.data.verificationSessionId)
      setVerificationMessage(response.data.verificationMessage ?? verificationMessage)
      setVerificationCode('')
      setSuccessMessage('Solicitamos un nuevo código de verificación en Banmédica.')
      setSyncAction(null)
      return
    }

    const syncedBeneficiarios = response.data.beneficiarios ?? []
    applySyncSuccess(buildSyncSuccessMessage(syncedBeneficiarios.length), response.data.usuario)
    setSyncAction(null)
  }

  const handleOpenWhatsapp = () => {
    if (!hasBeneficiarios) {
      setError('Primero debes sincronizar beneficiarios para habilitar WhatsApp.')
      return
    }

    if (!whatsappEntryUrl) {
      setError('Falta configurar VITE_WHATSAPP_PHONE o VITE_WHATSAPP_ENTRY_URL en Vercel.')
      return
    }

    setError(null)
    setSuccessMessage(null)
    window.open(whatsappEntryUrl, '_blank', 'noopener,noreferrer')
  }

  const handleCheckBeneficiarios = async () => {
    if (!usuario) {
      setError('No hay sesión activa para revisar beneficiarios.')
      return
    }

    setSyncAction('check')
    setError(null)
    setSuccessMessage(null)

    const response = await getBeneficiariosStatus({
      id: usuario.id,
      telefono: usuario.telefono,
      rut: usuario.rut,
    })

    if (!response.success || !response.data) {
      setError(response.error ?? 'No se pudo revisar el estado de beneficiarios.')
      setSyncAction(null)
      return
    }

    if (response.data.usuario) {
      setSession(response.data.usuario)
    }

    setSuccessMessage(
      response.data.hasBeneficiarios
        ? 'Supabase ya tiene beneficiarios guardados. WhatsApp quedó habilitado.'
        : 'Aún no tienes beneficiarios guardados.',
    )
    setSyncAction(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-secondary/30 to-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-primary">Portal de enrolamiento</p>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Hola, {usuario?.nombre ?? 'Usuario'}
            </h1>
            <p className="text-sm text-muted-foreground">
              Antes de abrir WhatsApp vamos a sincronizar los beneficiarios de la sucursal virtual. Para este MVP el scraping está habilitado primero para Banmédica.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => window.open('/politica-de-privacidad', '_blank', 'noopener,noreferrer')}
            >
              <ShieldCheck className="h-4 w-4" />
              Política de Privacidad
            </Button>
            <Button
              variant="outline"
              onClick={() => window.open('/terminos-y-condiciones', '_blank', 'noopener,noreferrer')}
            >
              <FileText className="h-4 w-4" />
              Términos
            </Button>
            <Button
              onClick={handleOpenWhatsapp}
              disabled={!canOpenWhatsapp}
            >
              <MessageCircle className="h-4 w-4" />
              Abrir WhatsApp
            </Button>
            <Button variant="outline" onClick={logout}>
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </Button>
          </div>
        </header>

        {error && (
          <Banner variant="destructive" title="No se pudo completar la acción">
            {error}
          </Banner>
        )}

        {successMessage && (
          <Banner variant="success" title="Sincronización completada">
            {successMessage}
          </Banner>
        )}

        {hasVerificationChallenge && verificationMessage && (
          <Banner variant="warning" title="Verificación requerida">
            {verificationMessage}
          </Banner>
        )}

        {!whatsappEntryUrl && (
          <Banner variant="warning" title="Falta configurar WhatsApp">
            Define `VITE_WHATSAPP_PHONE` o `VITE_WHATSAPP_ENTRY_URL` en Vercel para habilitar el botón.
          </Banner>
        )}

        {!canSyncBeneficiarios && (
          <Banner variant="warning" title="Sincronización aún no disponible">
            Por ahora este MVP solo implementa scraping de beneficiarios para Banmédica.
          </Banner>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <UserRound className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Titular registrado</p>
            </div>
            <p className="mt-3 text-xl font-bold">{usuario?.nombre ?? '-'}</p>
            <p className="mt-1 text-sm text-muted-foreground">RUT: {usuario?.rut ?? '-'}</p>
          </div>
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">WhatsApp enrolado</p>
            </div>
            <p className="mt-3 text-xl font-bold">{usuario?.telefono ?? '-'}</p>
            <p className="mt-1 text-sm text-muted-foreground">Canal principal para iniciar el flujo asistido.</p>
          </div>
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Isapre vinculada</p>
            </div>
            <p className="mt-3 text-xl font-bold">{currentIsapre?.nombre ?? 'Sin Isapre'}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              RUT sucursal virtual: {primaryCredential?.rut ?? '-'}
            </p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Paso previo obligatorio</h2>
                <p className="text-sm text-muted-foreground">
                  Primero sincronizamos beneficiarios desde la sucursal virtual. Recién después se habilita el botón de WhatsApp.
                </p>
              </div>
              <Users className="h-6 w-6 text-primary" />
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border bg-secondary/20 p-4">
                <p className="text-sm font-medium text-foreground">1. Registro web</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ya quedó completo: nombre, teléfono, RUT y credenciales de Isapre guardadas en Supabase.
                </p>
              </div>
              <div className="rounded-xl border bg-secondary/20 p-4">
                <p className="text-sm font-medium text-foreground">2. Sincronizar beneficiarios</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  El botón ejecuta un scraping controlado en Banmédica usando las credenciales del usuario desde una función serverless en Vercel. Si la Isapre pide un código adicional, lo validamos aquí mismo antes de continuar.
                </p>
              </div>
              <div className="rounded-xl border bg-secondary/20 p-4">
                <p className="text-sm font-medium text-foreground">3. Habilitar WhatsApp</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Cuando detectamos y guardamos beneficiarios en la columna `beneficiarios`, el CTA de WhatsApp queda activo.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={handleSyncBeneficiarios}
                isLoading={isSyncingBeneficiarios}
                disabled
              >
                <RefreshCw className="h-4 w-4" />
                Próximamente
              </Button>
              <Button
                variant="outline"
                onClick={handleCheckBeneficiarios}
                isLoading={isCheckingBeneficiarios}
                disabled={hasVerificationChallenge || isSyncingBeneficiarios}
              >
                <BadgeCheck className="h-4 w-4" />
                Revisar beneficiarios guardados
              </Button>
              <Button
                onClick={handleOpenWhatsapp}
                disabled={!canOpenWhatsapp}
                variant={canOpenWhatsapp ? 'primary' : 'outline'}
              >
                <MessageCircle className="h-4 w-4" />
                Abrir WhatsApp
              </Button>
              {currentIsapre?.urlSucursalVirtual && (
                <Button
                  variant="outline"
                  onClick={() => window.open(currentIsapre.urlSucursalVirtual, '_blank', 'noopener,noreferrer')}
                >
                  <Building2 className="h-4 w-4" />
                  Ver sucursal virtual
                </Button>
              )}
            </div>

            {hasVerificationChallenge && (
              <div className="mt-5 rounded-xl border border-warning/30 bg-warning/5 p-4">
                <div className="flex items-start gap-3">
                  <KeyRound className="mt-0.5 h-5 w-5 text-warning" />
                  <div className="w-full space-y-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">Código de verificación Banmédica</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Ingresa el código que recibió el usuario para retomar la sesión y terminar la sincronización.
                      </p>
                    </div>

                    <Input
                      label="Código"
                      name="verificationCode"
                      value={verificationCode}
                      onChange={(event) => setVerificationCode(event.target.value)}
                      placeholder="Ej: 123456"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={8}
                    />

                    <div className="flex flex-wrap gap-3">
                      <Button
                        onClick={handleSubmitVerification}
                        isLoading={isSubmittingVerification}
                        disabled={!verificationCode.trim() || isResendingVerification}
                      >
                        <KeyRound className="h-4 w-4" />
                        Validar código
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleResendVerification}
                        isLoading={isResendingVerification}
                        disabled={isSubmittingVerification}
                      >
                        <RefreshCw className="h-4 w-4" />
                        Reenviar código
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Resumen del enrolamiento</h2>
                <p className="text-sm text-muted-foreground">
                  Estado real del prerequisito antes de WhatsApp.
                </p>
              </div>
              <BadgeCheck className="h-5 w-5 text-primary" />
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Creado el</p>
                <p className="mt-2 font-medium">{usuario?.createdAt ? formatDate(usuario.createdAt) : '-'}</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Última sincronización</p>
                <p className="mt-2 font-medium">
                  {usuario?.beneficiariosUpdatedAt ? formatDate(usuario.beneficiariosUpdatedAt) : 'Aún no sincronizada'}
                </p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Estado</p>
                <p
                  className={`mt-2 font-medium ${
                    hasBeneficiarios
                      ? 'text-success'
                      : hasVerificationChallenge
                        ? 'text-primary'
                        : 'text-warning'
                  }`}
                >
                  {hasBeneficiarios
                    ? 'Beneficiarios sincronizados. WhatsApp habilitado.'
                    : hasVerificationChallenge
                      ? 'Verificación pendiente antes de sincronizar beneficiarios.'
                      : 'Falta sincronizar beneficiarios.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Beneficiarios sincronizados</h2>
                <p className="text-sm text-muted-foreground">
                  Lista persistida en Supabase para usarla luego en el flujo de reembolsos.
                </p>
              </div>
              <Users className="h-5 w-5 text-primary" />
            </div>

            <div className="space-y-3">
              {beneficiarios.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Aún no hay beneficiarios guardados para este usuario.
                </p>
              )}

              {beneficiarios.map((beneficiario) => (
                <div key={`${beneficiario.rut}-${beneficiario.nombre}`} className="rounded-xl border p-4">
                  <p className="font-medium text-foreground">{beneficiario.nombre}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{beneficiario.rut}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <Banner variant="info" title="Configuración MVP">
              Esta versión usa una función serverless en Vercel con `SCRAPINGBEE_API_KEY`,
              `SUPABASE_SERVICE_ROLE_KEY` y `EMAIL_ENCRYPTION_KEY`. El objetivo es validar
              el flujo rápido; después lo podemos mover al RPA o backend definitivo.
            </Banner>
          </div>
        </section>
      </div>
    </div>
  )
}
