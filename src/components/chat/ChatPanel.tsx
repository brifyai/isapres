import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, MessageCircle, Paperclip, SendHorizontal, User, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type {
  ConversationMessage,
  ConversationSnapshot,
  WebConversationMessagePayload,
} from '@/types'
import { cn, formatDate } from '@/lib/utils'

interface ChatPanelProps {
  conversation: ConversationSnapshot | null
  isSending: boolean
  onSend: (payload: WebConversationMessagePayload) => Promise<void>
}

const ETAPA_LABEL: Record<string, string> = {
  idle: 'Sin conversación activa',
  awaiting_prestacion: 'Esperando que elijas la prestación',
  awaiting_document: 'Esperando el comprobante',
  awaiting_field: 'Completando datos faltantes',
  processing: 'Proceso en ejecución',
  completed: 'Proceso finalizado',
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

/** Campos que el agente reporta haber extraído del documento, si los declaró. */
function getExtractedFields(message: ConversationMessage): string[] {
  const campos = message.metadata?.camposExtraidos
  return Array.isArray(campos) ? campos.map(String) : []
}

/** Opciones que el agente ofrece para un campo tipo select. */
function getFieldOptions(message: ConversationMessage | undefined): Array<{ value: string; label: string }> {
  const opciones = message?.metadata?.opciones
  if (!Array.isArray(opciones)) {
    return []
  }

  return opciones
    .map((opcion) => {
      const raw = opcion as Record<string, unknown>
      if (raw?.label === undefined) {
        return null
      }
      return { value: String(raw.value ?? raw.label), label: String(raw.label) }
    })
    .filter((opcion): opcion is { value: string; label: string } => opcion !== null)
}

export function ChatPanel({ conversation, isSending, onSend }: ChatPanelProps) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // Eco optimista: el OCR puede tardar varios segundos y sin esto el mensaje
  // del usuario no aparece hasta que responde el backend.
  const [pending, setPending] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)

  // El backend entrega los 30 más recientes primero; el chat los lee al revés.
  const messages = useMemo(
    () => [...(conversation?.messages ?? [])].reverse(),
    [conversation?.messages],
  )

  const etapa = conversation?.state?.etapa ?? 'idle'
  const esperaDocumento = etapa === 'awaiting_document'
  const ofrecePrestaciones = etapa === 'idle' || etapa === 'awaiting_prestacion'

  // Opciones del último mensaje del agente: sólo valen si sigue siendo la
  // pregunta vigente y el usuario no respondió después.
  const opcionesVigentes = useMemo(() => {
    const ultimo = messages[messages.length - 1]
    if (etapa !== 'awaiting_field' || ultimo?.direccion !== 'saliente') {
      return []
    }
    return getFieldOptions(ultimo)
  }, [messages, etapa])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, pending])

  const send = async (payload: WebConversationMessagePayload, echo?: string) => {
    setPending(echo ?? payload.text ?? null)
    // Limpiamos el composer de inmediato: el eco ya muestra lo enviado.
    setText('')
    setFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }

    try {
      await onSend(payload)
    } finally {
      setPending(null)
    }
  }

  const handleSubmit = async () => {
    if (!text.trim() && !file) {
      return
    }

    // El primer documento es el comprobante; los siguientes, el detalle.
    const yaHayComprobante = (conversation?.attachments ?? []).length > 0
    const attachments = file
      ? [{
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64Data: await fileToBase64(file),
          sizeBytes: file.size,
          role: (yaHayComprobante ? 'detalle' : 'voucher') as 'detalle' | 'voucher',
        }]
      : undefined

    const echo = [text.trim(), file ? `📎 ${file.name}` : null].filter(Boolean).join('\n')
    await send({ text: text.trim() || undefined, attachments }, echo)
  }

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Agente de reembolsos</h2>
          <p className="text-sm text-muted-foreground">
            Conversa con el agente: elige la prestación, envía tu comprobante y él completa el
            formulario en el portal de tu Isapre.
          </p>
        </div>
        <MessageCircle className="h-5 w-5 shrink-0 text-primary" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
          {ETAPA_LABEL[etapa] ?? etapa}
        </span>
        <Button size="sm" variant="outline" onClick={() => void send({ text: 'menú' })} isLoading={isSending}>
          Reiniciar
        </Button>
        <Button size="sm" variant="outline" onClick={() => void send({ text: 'estado' })} isLoading={isSending}>
          Estado
        </Button>
      </div>

      <div className="mb-4 max-h-[28rem] space-y-3 overflow-y-auto rounded-xl border bg-background/50 p-4">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Escribe cualquier mensaje para que el agente inicie la conversación.
          </p>
        )}

        {messages.map((message) => {
          const esUsuario = message.direccion === 'entrante'
          const camposExtraidos = getExtractedFields(message)

          return (
            <div
              key={message.id}
              className={cn('flex gap-2', esUsuario ? 'justify-end' : 'justify-start')}
            >
              {!esUsuario && (
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}

              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-2.5',
                  esUsuario
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground',
                )}
              >
                <p className="whitespace-pre-wrap text-sm">
                  {message.contenido ?? '(sin contenido)'}
                </p>

                {camposExtraidos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {camposExtraidos.map((campo) => (
                      <span
                        key={campo}
                        className="rounded-full bg-background/30 px-2 py-0.5 text-[11px]"
                      >
                        {campo}
                      </span>
                    ))}
                  </div>
                )}

                <p
                  className={cn(
                    'mt-1.5 text-[11px]',
                    esUsuario ? 'text-primary-foreground/70' : 'text-muted-foreground',
                  )}
                >
                  {formatDate(message.createdAt)}
                </p>
              </div>

              {esUsuario && (
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-4 w-4 text-primary" />
                </div>
              )}
            </div>
          )
        })}
        {pending && (
          <div className="flex justify-end gap-2">
            <div className="max-w-[80%] rounded-2xl bg-primary/60 px-4 py-2.5 text-primary-foreground">
              <p className="whitespace-pre-wrap text-sm">{pending}</p>
              <p className="mt-1.5 text-[11px] text-primary-foreground/70">Enviando…</p>
            </div>
            <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <User className="h-4 w-4 text-primary" />
            </div>
          </div>
        )}

        {isSending && (
          <div className="flex justify-start gap-2">
            <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="flex items-center gap-1 rounded-2xl bg-secondary px-4 py-3">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={threadEndRef} />
      </div>

      {ofrecePrestaciones && (conversation?.prestaciones ?? []).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {(conversation?.prestaciones ?? []).map((prestacion) => (
            <button
              key={prestacion.id}
              type="button"
              disabled={isSending || !prestacion.disponible}
              onClick={() => void send({ text: prestacion.nombre })}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                prestacion.disponible
                  ? 'hover:border-primary hover:bg-primary/5'
                  : 'cursor-not-allowed opacity-50',
              )}
              title={prestacion.disponible ? undefined : 'Aún no habilitada para tramitación automática'}
            >
              {prestacion.nombre}
            </button>
          ))}
        </div>
      )}

      {opcionesVigentes.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {opcionesVigentes.map((opcion) => (
            <button
              key={opcion.value}
              type="button"
              disabled={isSending}
              onClick={() => void send({ text: opcion.label })}
              className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-50"
            >
              {opcion.label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {file && (
          <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs text-secondary-foreground">
            <Paperclip className="h-3.5 w-3.5" />
            {file.name}
            <button
              type="button"
              onClick={() => {
                setFile(null)
                if (fileInputRef.current) {
                  fileInputRef.current.value = ''
                }
              }}
              className="rounded-full p-0.5 hover:bg-background/50"
              aria-label="Quitar adjunto"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Adjuntar documento"
            className={cn('w-11 shrink-0 px-0', esperaDocumento && 'border-primary text-primary')}
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <input
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSubmit()
              }
            }}
            placeholder={
              esperaDocumento
                ? 'Adjunta tu boleta o voucher con el clip…'
                : 'Escribe tu mensaje…'
            }
            className="h-11 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
          />

          <Button
            onClick={() => void handleSubmit()}
            isLoading={isSending}
            disabled={!text.trim() && !file}
            className="w-11 shrink-0 px-0"
          >
            <SendHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
