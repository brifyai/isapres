import { useMemo, useState } from 'react'
import {
  BadgeCheck,
  Building2,
  FileText,
  LogOut,
  MessageCircle,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { buildWhatsappEntryUrl } from '@/lib/whatsapp'
import { formatDate } from '@/lib/utils'
import { ISAPRES } from '@/types'

export function DashboardPage() {
  const { usuario, logout } = useAuth()
  const [error, setError] = useState<string | null>(null)

  const primaryCredential = usuario?.credenciales[0]
  const currentIsapre = useMemo(
    () => ISAPRES.find((item) => item.id === primaryCredential?.isapreId) ?? null,
    [primaryCredential?.isapreId],
  )
  const whatsappEntryUrl = useMemo(
    () => buildWhatsappEntryUrl('Hola, ya me registré en la web y quiero continuar con mi reembolso.'),
    [],
  )

  const handleOpenWhatsapp = () => {
    if (!whatsappEntryUrl) {
      setError('Falta configurar VITE_WHATSAPP_PHONE o VITE_WHATSAPP_ENTRY_URL en Vercel.')
      return
    }
    setError(null)
    window.open(whatsappEntryUrl, '_blank', 'noopener,noreferrer')
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
              Tu registro quedó guardado en Supabase. Desde aquí el usuario puede abrir WhatsApp y continuar el flujo en el sistema principal.
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
            <Button onClick={handleOpenWhatsapp}>
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

        {!whatsappEntryUrl && (
          <Banner variant="warning" title="Falta configurar WhatsApp">
            Define `VITE_WHATSAPP_PHONE` o `VITE_WHATSAPP_ENTRY_URL` en Vercel para habilitar el botón.
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
            <p className="mt-1 text-sm text-muted-foreground">Canal principal para recibir instrucciones.</p>
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
                <h2 className="text-lg font-semibold">Siguiente paso del usuario</h2>
                <p className="text-sm text-muted-foreground">
                  El front ya no depende del backend antiguo. El registro se guarda directo en Supabase y el seguimiento continúa por WhatsApp.
                </p>
              </div>
              <MessageCircle className="h-6 w-6 text-primary" />
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border bg-secondary/20 p-4">
                <p className="text-sm font-medium text-foreground">1. Registro ya completado</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Se guardaron nombre, teléfono, RUT e Isapre en la base de Supabase.
                </p>
              </div>
              <div className="rounded-xl border bg-secondary/20 p-4">
                <p className="text-sm font-medium text-foreground">2. Abrir WhatsApp</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Usa el botón para mandar al usuario al canal correcto con el mensaje inicial precargado.
                </p>
              </div>
              <div className="rounded-xl border bg-secondary/20 p-4">
                <p className="text-sm font-medium text-foreground">3. Continuar en el sistema principal</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  El backend/RPA externo puede leer la misma base y seguir el flujo desde ese entorno.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={handleOpenWhatsapp}>
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
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Resumen del enrolamiento</h2>
                <p className="text-sm text-muted-foreground">
                  Datos útiles para validar que el alta quedó completa.
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
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Sucursal virtual</p>
                <p className="mt-2 font-medium">{currentIsapre?.nombreSucursalVirtual ?? '-'}</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Estado</p>
                <p className="mt-2 font-medium text-success">Registro listo para continuar por WhatsApp</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <Banner variant="info" title="Configuración recomendada">
            Este frontend ya puede vivir solo en Vercel. Para que el registro funcione directo contra Supabase necesitas las variables públicas del proyecto y ejecutar la RPC `register_public_user` en tu base.
          </Banner>
        </section>
      </div>
    </div>
  )
}
