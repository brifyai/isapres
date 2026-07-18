import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  LogOut,
  MessageCircle,
  Paperclip,
  RefreshCw,
  SendHorizontal,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import {
  createBanmedicaDemo,
  getConversationSnapshot,
  getDashboardKPIs,
  getDemoOverview,
  getDemoProcesoById,
  getDemoProcesos,
  getReembolsos,
  sendWebConversationMessage,
} from '@/services/api'
import type {
  ConversationSnapshot,
  DashboardKPIs,
  DemoBanmedicaPayload,
  DemoOverview,
  DemoProcess,
  Reembolso,
  WebConversationMessagePayload,
} from '@/types'
import { ESTADO_PROCESO_DEMO_META, ESTADO_SOLICITUD_META, ISAPRES } from '@/types'
import { cn, formatCLP, formatDate } from '@/lib/utils'

const defaultDemoPayload = (): DemoBanmedicaPayload => ({
  centroMedicoRut: '76.123.456-7',
  centroMedicoNombre: 'Clinica Demo Banmedica',
  fechaAtencion: new Date().toISOString().slice(0, 10),
  montoPagado: 35000,
  observaciones: 'Demo controlado para Banmedica Urgencias. El formulario no se envia.',
})

const emptyKPIs: DashboardKPIs = {
  totalReembolsado: 0,
  solicitudesPendientes: 0,
  solicitudesExitosas: 0,
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.replace(/^data:[^;]+;base64,/, ''))
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado'))
    reader.readAsDataURL(file)
  })
}

function getProcessBadgeClass(status: DemoProcess['estado']): string {
  const meta = ESTADO_PROCESO_DEMO_META[status]
  switch (meta.color) {
    case 'success':
      return 'bg-success/10 text-success'
    case 'primary':
      return 'bg-primary/10 text-primary'
    case 'warning':
      return 'bg-warning/10 text-warning'
    case 'destructive':
      return 'bg-destructive/10 text-destructive'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function getReembolsoBadgeClass(status: Reembolso['estado']): string {
  const meta = ESTADO_SOLICITUD_META[status]
  switch (meta.color) {
    case 'success':
      return 'bg-success/10 text-success'
    case 'primary':
      return 'bg-primary/10 text-primary'
    case 'warning':
      return 'bg-warning/10 text-warning'
    case 'destructive':
      return 'bg-destructive/10 text-destructive'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

export function DashboardPage() {
  const { usuario, logout } = useAuth()
  const [overview, setOverview] = useState<DemoOverview | null>(null)
  const [kpis, setKpis] = useState<DashboardKPIs>(emptyKPIs)
  const [reembolsos, setReembolsos] = useState<Reembolso[]>([])
  const [conversation, setConversation] = useState<ConversationSnapshot | null>(null)
  const [procesos, setProcesos] = useState<DemoProcess[]>([])
  const [selectedProcess, setSelectedProcess] = useState<DemoProcess | null>(null)
  const [form, setForm] = useState<DemoBanmedicaPayload>(defaultDemoPayload)
  const [messageText, setMessageText] = useState('')
  const [selectedPrestacionCodigo, setSelectedPrestacionCodigo] = useState('')
  const [selectedVoucherFile, setSelectedVoucherFile] = useState<File | null>(null)
  const [selectedDetailFile, setSelectedDetailFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentIsapreName = useMemo(() => {
    const id = overview?.primaryIsapre
    return ISAPRES.find((item) => item.id === id)?.nombre ?? 'Sin Isapre'
  }, [overview?.primaryIsapre])

  const loadProcessDetail = useCallback(async (processId: string) => {
    const response = await getDemoProcesoById(processId)
    if (response.success && response.data) {
      setSelectedProcess(response.data)
    }
  }, [])

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [overviewResponse, kpisResponse, reembolsosResponse, procesosResponse, conversationResponse] = await Promise.all([
        getDemoOverview(),
        getDashboardKPIs(),
        getReembolsos(),
        getDemoProcesos(),
        getConversationSnapshot('web'),
      ])

      if (overviewResponse.success && overviewResponse.data) {
        setOverview(overviewResponse.data)
      }
      if (kpisResponse.success && kpisResponse.data) {
        setKpis(kpisResponse.data)
      }
      if (reembolsosResponse.success && reembolsosResponse.data) {
        setReembolsos(reembolsosResponse.data)
      }
      if (procesosResponse.success && procesosResponse.data) {
        setProcesos(procesosResponse.data)
        const firstProcess = procesosResponse.data[0]
        if (firstProcess) {
          await loadProcessDetail(firstProcess.id)
        } else {
          setSelectedProcess(null)
        }
      }
      if (conversationResponse.success && conversationResponse.data) {
        setConversation(conversationResponse.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el dashboard')
    } finally {
      setIsLoading(false)
    }
  }, [loadProcessDetail])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleChange = <K extends keyof DemoBanmedicaPayload>(key: K, value: DemoBanmedicaPayload[K]) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const handleRunDemo = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      const response = await createBanmedicaDemo(form)
      if (!response.success || !response.data) {
        throw new Error(response.error ?? 'No se pudo crear el proceso demo')
      }

      await loadData()
      await loadProcessDetail(response.data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el demo')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenWhatsapp = () => {
    if (!overview?.whatsappEntryUrl) {
      setError('Falta configurar la URL de entrada a WhatsApp en el backend.')
      return
    }
    window.open(overview.whatsappEntryUrl, '_blank', 'noopener,noreferrer')
  }

  const handleSendWebMessage = async (override?: Partial<WebConversationMessagePayload>) => {
    const finalText = override?.text ?? messageText
    const finalPrestacionCodigo = override?.prestacionCodigo ?? (selectedPrestacionCodigo || undefined)
    const finalAttachments = override?.attachments

    if (!finalText.trim() && !finalPrestacionCodigo && !selectedVoucherFile && !selectedDetailFile && !finalAttachments?.length) {
      setError('Debes escribir un mensaje, elegir una prestación o adjuntar al menos un archivo.')
      return
    }

    setIsSendingMessage(true)
    setError(null)

    try {
      const attachmentsPayload = finalAttachments ?? [
        selectedVoucherFile
          ? {
              fileName: selectedVoucherFile.name,
              mimeType: selectedVoucherFile.type || 'application/octet-stream',
              base64Data: await fileToBase64(selectedVoucherFile),
              sizeBytes: selectedVoucherFile.size,
              role: 'voucher' as const,
            }
          : null,
        selectedDetailFile
          ? {
              fileName: selectedDetailFile.name,
              mimeType: selectedDetailFile.type || 'application/octet-stream',
              base64Data: await fileToBase64(selectedDetailFile),
              sizeBytes: selectedDetailFile.size,
              role: 'detalle' as const,
            }
          : null,
      ].filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment))

      const response = await sendWebConversationMessage({
        text: finalText.trim() || undefined,
        prestacionCodigo: finalPrestacionCodigo ?? null,
        attachments: attachmentsPayload,
      })

      if (!response.success || !response.data) {
        throw new Error(response.error ?? 'No se pudo procesar el mensaje web')
      }

      setConversation(response.data)
      setMessageText('')
      setSelectedPrestacionCodigo('')
      setSelectedVoucherFile(null)
      setSelectedDetailFile(null)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el mensaje web')
    } finally {
      setIsSendingMessage(false)
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-10">
        <div className="flex items-center gap-3 rounded-xl border bg-card px-5 py-4 shadow-sm">
          <RefreshCw className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Cargando dashboard del demo...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-secondary/30 to-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-primary">Dashboard de demo RPA</p>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {usuario?.nombre ?? 'Usuario'} - {currentIsapreName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Desde aquí puedes abrir WhatsApp, monitorear la conversación, y opcionalmente encolar una ejecución directa para validación técnica.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => void loadData()}>
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
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

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <p className="text-sm text-muted-foreground">Total reembolsado</p>
            <p className="mt-2 text-2xl font-bold">{formatCLP(kpis.totalReembolsado)}</p>
          </div>
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <p className="text-sm text-muted-foreground">Solicitudes pendientes</p>
            <p className="mt-2 text-2xl font-bold">{kpis.solicitudesPendientes}</p>
          </div>
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <p className="text-sm text-muted-foreground">Procesos demo activos</p>
            <p className="mt-2 text-2xl font-bold">{overview?.activeProcesses ?? 0}</p>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Demo Banmedica Urgencias</h2>
                <p className="text-sm text-muted-foreground">
                  Llena los datos de prueba, encola el flujo y valida que el worker llegue al formulario sin enviarlo.
                </p>
              </div>
              <Bot className="h-6 w-6 text-primary" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="RUT del centro médico"
                value={form.centroMedicoRut}
                onChange={(event) => handleChange('centroMedicoRut', event.target.value)}
              />
              <Input
                label="Centro médico"
                value={form.centroMedicoNombre}
                onChange={(event) => handleChange('centroMedicoNombre', event.target.value)}
              />
              <Input
                label="Fecha de atención"
                type="date"
                value={form.fechaAtencion}
                onChange={(event) => handleChange('fechaAtencion', event.target.value)}
              />
              <Input
                label="Monto pagado"
                type="number"
                value={String(form.montoPagado)}
                onChange={(event) => handleChange('montoPagado', Number(event.target.value))}
              />
            </div>

            <div className="mt-4">
              <Input
                label="Observaciones"
                value={form.observaciones}
                onChange={(event) => handleChange('observaciones', event.target.value)}
              />
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={() => void handleRunDemo()} isLoading={isSubmitting}>
                <Bot className="h-4 w-4" />
                Ejecutar demo Banmedica
              </Button>
              <Button variant="outline" onClick={() => setForm(defaultDemoPayload())}>
                Reiniciar valores
              </Button>
            </div>

            <div className="mt-5">
              <Banner variant="info" title="Canal WhatsApp">
                El botón de WhatsApp deja listo el aterrizaje del usuario. Si escribe
                {' '}cualquier mensaje, el orquestador conversacional identifica su Isapre enrolada, muestra las prestaciones disponibles y guía el formulario por WhatsApp.
              </Banner>
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Últimos reembolsos</h2>
                <p className="text-sm text-muted-foreground">
                  Historial actual del usuario autenticado.
                </p>
              </div>
              <FileText className="h-5 w-5 text-primary" />
            </div>

            <div className="space-y-3">
              {reembolsos.length === 0 && (
                <p className="text-sm text-muted-foreground">Aún no hay reembolsos registrados.</p>
              )}
              {reembolsos.slice(0, 5).map((reembolso) => (
                <div key={reembolso.id} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{ISAPRES.find((item) => item.id === reembolso.isapre)?.nombre}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(reembolso.createdAt)}</p>
                    </div>
                    <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', getReembolsoBadgeClass(reembolso.estado))}>
                      {ESTADO_SOLICITUD_META[reembolso.estado].label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">{formatCLP(reembolso.monto)}</p>
                  {reembolso.error && (
                    <p className="mt-2 text-xs text-destructive">{reembolso.error}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Estado conversacional web</h2>
                <p className="text-sm text-muted-foreground">
                  Simulador de mensajería mientras WhatsApp termina su publicación en Meta/Kapso.
                </p>
              </div>
              <MessageCircle className="h-5 w-5 text-primary" />
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Etapa</p>
                <p className="mt-2 font-medium">{conversation?.state?.etapa ?? 'Sin conversación activa'}</p>
                {conversation?.state?.updatedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Última actualización: {formatDate(conversation.state.updatedAt)}
                  </p>
                )}
              </div>

              <div className="rounded-xl border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Acciones rápidas</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleSendWebMessage({ text: 'menú' })}
                    isLoading={isSendingMessage}
                  >
                    Menú
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleSendWebMessage({ text: 'estado' })}
                    isLoading={isSendingMessage}
                  >
                    Estado
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleSendWebMessage({ text: 'ayuda' })}
                    isLoading={isSendingMessage}
                  >
                    Ayuda
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Prestaciones detectadas</p>
                <div className="mt-3 space-y-2">
                  {(conversation?.prestaciones ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">Aún no hay catálogo cargado para la conversación actual.</p>
                  )}
                  {(conversation?.prestaciones ?? []).map((prestacion) => (
                    <div key={prestacion.id} className="rounded-lg bg-secondary/40 px-3 py-2">
                      <p className="text-sm font-medium">{prestacion.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {prestacion.requiereFormulario ? 'Formulario guiado' : 'Adjuntos / capa preparada'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Últimos adjuntos</p>
                <div className="mt-3 space-y-2">
                  {(conversation?.attachments ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">Todavía no se han cargado boletas o vouchers en el canal web.</p>
                  )}
                  {(conversation?.attachments ?? []).slice(0, 4).map((attachment) => (
                    <div key={attachment.id} className="rounded-lg bg-secondary/40 px-3 py-2">
                      <p className="text-sm font-medium">{attachment.nombreArchivo}</p>
                      <p className="text-xs text-muted-foreground">{attachment.mimeType}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Mensajería web de pruebas</h2>
                <p className="text-sm text-muted-foreground">
                  Permite simular el chat, adjuntar boletas y probar la extracción antes de habilitar WhatsApp productivo.
                </p>
              </div>
              <MessageCircle className="h-5 w-5 text-primary" />
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border p-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <Select
                    label="Prestación sugerida"
                    value={selectedPrestacionCodigo}
                    onChange={(event) => setSelectedPrestacionCodigo(event.target.value)}
                    options={(conversation?.prestaciones ?? []).map((prestacion) => ({
                      value: prestacion.codigo,
                      label: prestacion.nombre,
                    }))}
                    placeholder="Elegir prestación"
                  />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-foreground" htmlFor="web-voucher">
                      Voucher o boleta principal
                    </label>
                    <input
                      id="web-voucher"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      className="block h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      onChange={(event) => setSelectedVoucherFile(event.target.files?.[0] ?? null)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Sube el documento principal. La extracción automática se aplica sobre imágenes.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-foreground" htmlFor="web-detalle">
                      Detalle u orden médica
                    </label>
                    <input
                      id="web-detalle"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      className="block h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      onChange={(event) => setSelectedDetailFile(event.target.files?.[0] ?? null)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Opcional para la demo. Si existe, el worker intentará usarlo como respaldo complementario.
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <Input
                    label="Mensaje"
                    placeholder="Ej: quiero iniciar un reembolso, o adjunto una boleta de urgencia"
                    value={messageText}
                    onChange={(event) => setMessageText(event.target.value)}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button onClick={() => void handleSendWebMessage()} isLoading={isSendingMessage}>
                    <SendHorizontal className="h-4 w-4" />
                    Enviar al inbox web
                  </Button>
                  {selectedVoucherFile && (
                    <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                      <Paperclip className="h-3.5 w-3.5" />
                      Voucher: {selectedVoucherFile.name}
                    </div>
                  )}
                  {selectedDetailFile && (
                    <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                      <Paperclip className="h-3.5 w-3.5" />
                      Detalle: {selectedDetailFile.name}
                    </div>
                  )}
                </div>
              </div>

              {(conversation?.messages ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">Todavía no hay mensajes registrados para este usuario en el canal web.</p>
              )}
              {(conversation?.messages ?? []).map((message) => (
                <div key={message.id} className="rounded-xl border p-4">
                  {(() => {
                    const prestacionCodigo = typeof message.metadata?.prestacionCodigo === 'string'
                      ? message.metadata.prestacionCodigo
                      : null

                    return (
                      <>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium capitalize">{message.direccion}</p>
                    <span className="text-xs text-muted-foreground">{formatDate(message.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm text-foreground">{message.contenido ?? '(sin contenido visible)'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Tipo: {message.tipo}</p>
                  {prestacionCodigo && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Prestación: {prestacionCodigo}
                    </p>
                  )}
                      </>
                    )
                  })()}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Procesos demo</h2>
                <p className="text-sm text-muted-foreground">
                  Cola, ejecuciones y resultados de navegación.
                </p>
              </div>
              <CalendarClock className="h-5 w-5 text-primary" />
            </div>

            <div className="space-y-3">
              {procesos.length === 0 && (
                <p className="text-sm text-muted-foreground">Todavía no se ha ejecutado ningún proceso demo.</p>
              )}
              {procesos.map((process) => (
                <button
                  key={process.id}
                  type="button"
                  onClick={() => void loadProcessDetail(process.id)}
                  className={cn(
                    'w-full rounded-xl border p-4 text-left transition-colors hover:bg-accent',
                    selectedProcess?.id === process.id && 'border-primary bg-primary/5',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{process.flujo}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(process.createdAt)}</p>
                    </div>
                    <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', getProcessBadgeClass(process.estado))}>
                      {ESTADO_PROCESO_DEMO_META[process.estado].label}
                    </span>
                  </div>
                  {process.resumen && (
                    <p className="mt-2 text-sm text-muted-foreground">{process.resumen}</p>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Historial del proceso</h2>
                <p className="text-sm text-muted-foreground">
                  Pasos, botones usados y campos detectados/completados por el worker.
                </p>
              </div>
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>

            {!selectedProcess && (
              <p className="text-sm text-muted-foreground">
                Selecciona un proceso para ver su detalle.
              </p>
            )}

            {selectedProcess && (
              <div className="space-y-6">
                <div className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', getProcessBadgeClass(selectedProcess.estado))}>
                      {ESTADO_PROCESO_DEMO_META[selectedProcess.estado].label}
                    </span>
                    <span className="text-xs text-muted-foreground">Intentos: {selectedProcess.intentos}</span>
                    {selectedProcess.startedAt && (
                      <span className="text-xs text-muted-foreground">
                        Inicio: {formatDate(selectedProcess.startedAt)}
                      </span>
                    )}
                  </div>
                  {selectedProcess.error && (
                    <Banner variant="destructive" title="Último error" className="mt-4">
                      {selectedProcess.error}
                    </Banner>
                  )}
                </div>

                <div>
                  <h3 className="mb-3 font-semibold">Bitácora de navegación</h3>
                  <div className="space-y-3">
                    {(selectedProcess.pasos ?? []).map((step) => (
                      <div key={step.id} className="rounded-xl border p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {step.status === 'error' ? (
                              <TriangleAlert className="h-4 w-4 text-destructive" />
                            ) : step.status === 'success' ? (
                              <CheckCircle2 className="h-4 w-4 text-success" />
                            ) : (
                              <Clock3 className="h-4 w-4 text-primary" />
                            )}
                            <p className="font-medium">{step.accion}</p>
                          </div>
                          <span className="text-xs text-muted-foreground">#{step.orden}</span>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{step.detalle ?? 'Sin detalle'}</p>
                        {step.url && (
                          <p className="mt-2 break-all text-xs text-muted-foreground">URL: {step.url}</p>
                        )}
                        {step.selector && (
                          <p className="mt-1 break-all text-xs text-muted-foreground">Selector: {step.selector}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 font-semibold">Campos detectados y llenados</h3>
                  <div className="space-y-3">
                    {(selectedProcess.campos ?? []).map((field) => (
                      <div key={field.id} className="rounded-xl border p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{field.label}</p>
                          <span className="text-xs text-muted-foreground">{field.tipo}</span>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {field.valorIngresado ? `Valor: ${field.valorIngresado}` : 'Campo detectado sin valor aún'}
                        </p>
                        {field.selector && (
                          <p className="mt-1 break-all text-xs text-muted-foreground">Selector: {field.selector}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
