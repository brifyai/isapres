import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface StepEvidenceProps {
  payload?: Record<string, unknown>
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

interface CampoVisible {
  label?: string
  selector?: string
  tipo?: string
}

function asCampos(value: unknown): CampoVisible[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => (item ?? {}) as CampoVisible)
}

/**
 * Evidencia que deja el worker cuando no encuentra un elemento: qué selectores
 * probó y qué había realmente en pantalla. Permite corregir un selector sin
 * tener que reproducir el fallo en un navegador.
 */
export function StepEvidence({ payload }: StepEvidenceProps) {
  const [abierto, setAbierto] = useState(false)

  const selectores = asStringList(payload?.selectoresIntentados)
  const clickeables = asStringList(payload?.textosClickeables)
  const campos = asCampos(payload?.camposVisibles)
  const captura = typeof payload?.capturaBase64 === 'string' ? payload.capturaBase64 : null

  const hayEvidencia = selectores.length > 0 || clickeables.length > 0 || campos.length > 0 || captura
  if (!hayEvidencia) {
    return null
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed">
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Evidencia de la pantalla
      </button>

      {abierto && (
        <div className="space-y-3 border-t px-3 py-3 text-xs">
          {selectores.length > 0 && (
            <div>
              <p className="mb-1 font-medium">Selectores probados</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {selectores.map((selector) => (
                  <li key={selector} className="break-all font-mono">{selector}</li>
                ))}
              </ul>
            </div>
          )}

          {clickeables.length > 0 && (
            <div>
              <p className="mb-1 font-medium">Elementos clickeables en pantalla</p>
              <div className="flex flex-wrap gap-1">
                {clickeables.map((texto, index) => (
                  <span key={`${texto}-${index}`} className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                    {texto}
                  </span>
                ))}
              </div>
            </div>
          )}

          {campos.length > 0 && (
            <div>
              <p className="mb-1 font-medium">Campos visibles</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {campos.map((campo, index) => (
                  <li key={`${campo.selector}-${index}`} className="break-all">
                    <span className="font-mono">{campo.selector}</span>
                    {campo.label ? ` — ${campo.label}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {captura && (
            <div>
              <p className="mb-1 font-medium">Captura al momento del fallo</p>
              <img
                src={`data:image/jpeg;base64,${captura}`}
                alt="Captura de la pantalla del portal al fallar el paso"
                className="w-full rounded border"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
