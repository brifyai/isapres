import { useState, useCallback, type FormEvent, type ChangeEvent } from 'react'
import { User, Phone, KeyRound, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PrivacyBanner } from './PrivacyBanner'
import { IsapreSelector } from './IsapreSelector'
import { validateRut, formatRutInput } from '@/lib/rut'
import { registerUser } from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import type { IsapreId, RegistroUsuarioPayload } from '@/types'

interface FormErrors {
  nombre?: string
  telefono?: string
  rut?: string
  isapreId?: string
  isapreRut?: string
  isaprePassword?: string
}

interface OnboardingFormProps {
  /** Teléfono pre-cargado desde el link de WhatsApp (query param). */
  telefonoInicial?: string
  onSuccess?: () => void
}

/**
 * Formulario de Onboarding seguro para enrolar usuarios desde WhatsApp.
 *se
 * Campos:
 * - Nombre
 * - Teléfono (ID de WhatsApp)
 * - RUT (con validación módulo 11)
 * - Isapre (selector)
 * - RUT de sucursal virtual
 * - Contraseña de sucursal virtual
 *
 * Incluye banner de privacidad (AES-256) y validación en tiempo real.
 */
export function OnboardingForm({ telefonoInicial = '', onSuccess }: OnboardingFormProps) {
  const { setSession } = useAuth()

  // ── Estado del formulario ──
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState(telefonoInicial)
  const [rut, setRut] = useState('')
  const [isapreId, setIsapreId] = useState<IsapreId | ''>('')
  const [isapreRut, setIsapreRut] = useState('')
  const [isaprePassword, setIsaprePassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // ── Estado de UI ──
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)

  // ── Validaciones individuales ──

  const validateNombre = useCallback((value: string): string | undefined => {
    if (!value.trim()) return 'El nombre es obligatorio'
    if (value.trim().length < 3) return 'Debe tener al menos 3 caracteres'
    return undefined
  }, [])

  const validateTelefono = useCallback((value: string): string | undefined => {
    const limpio = value.replace(/\D/g, '')
    if (!limpio) return 'El teléfono es obligatorio'
    // Formato chileno: 569 + 8 dígitos = 11, o 9 + 8 = 9
    if (limpio.length < 9) return 'Debe tener al menos 9 dígitos'
    if (limpio.length > 11) return 'Número demasiado largo'
    return undefined
  }, [])

  const validateRutField = useCallback((value: string): string | undefined => {
    if (!value.trim()) return 'El RUT es obligatorio'
    if (!validateRut(value)) return 'RUT inválido. Verifica el dígito verificador'
    return undefined
  }, [])

  const validateIsapreRut = useCallback(
    (value: string): string | undefined => {
      if (!value.trim()) return 'El RUT de la Isapre es obligatorio'
      if (!validateRut(value)) return 'RUT inválido'
      return undefined
    },
    [],
  )

  const validateIsaprePassword = useCallback((value: string): string | undefined => {
    if (!value) return 'La contraseña es obligatoria'
    if (value.length < 4) return 'La contraseña parece muy corta'
    return undefined
  }, [])

  // ── Handlers con validación en tiempo real ──

  const handleNombreChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setNombre(value)
    if (errors.nombre) {
      setErrors((prev) => ({ ...prev, nombre: validateNombre(value) }))
    }
  }

  const handleTelefonoChange = (e: ChangeEvent<HTMLInputElement>) => {
    // Solo permitir dígitos y el signo +
    const value = e.target.value.replace(/[^\d+]/g, '')
    setTelefono(value)
    if (errors.telefono) {
      setErrors((prev) => ({ ...prev, telefono: validateTelefono(value) }))
    }
  }

  const handleRutChange = (e: ChangeEvent<HTMLInputElement>) => {
    const formatted = formatRutInput(e.target.value)
    setRut(formatted)
    if (errors.rut) {
      setErrors((prev) => ({ ...prev, rut: validateRutField(formatted) }))
    }
  }

  const handleIsapreRutChange = (e: ChangeEvent<HTMLInputElement>) => {
    const formatted = formatRutInput(e.target.value)
    setIsapreRut(formatted)
    if (errors.isapreRut) {
      setErrors((prev) => ({ ...prev, isapreRut: validateIsapreRut(formatted) }))
    }
  }

  const handleIsaprePasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setIsaprePassword(value)
    if (errors.isaprePassword) {
      setErrors((prev) => ({ ...prev, isaprePassword: validateIsaprePassword(value) }))
    }
  }

  // ── Validación completa del formulario ──

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {
      nombre: validateNombre(nombre),
      telefono: validateTelefono(telefono),
      rut: validateRutField(rut),
      isapreId: isapreId ? undefined : 'Selecciona tu Isapre',
      isapreRut: validateIsapreRut(isapreRut),
      isaprePassword: validateIsaprePassword(isaprePassword),
    }

    setErrors(newErrors)

    // Retorna true si no hay errores
    return !Object.values(newErrors).some((error) => error !== undefined)
  }, [
    nombre,
    telefono,
    rut,
    isapreId,
    isapreRut,
    isaprePassword,
    validateNombre,
    validateTelefono,
    validateRutField,
    validateIsapreRut,
    validateIsaprePassword,
  ])

  // ── Submit ──

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitError(null)

    if (!validateForm()) return

    setIsSubmitting(true)

    try {
      const payload: RegistroUsuarioPayload = {
        nombre: nombre.trim(),
        telefono: telefono.replace(/\D/g, ''),
        rut: rut.trim(),
        credenciales: {
          isapreId: isapreId as IsapreId,
          rut: isapreRut.trim(),
          password: isaprePassword,
        },
      }

      const response = await registerUser(payload)

      if (response.success && response.data) {
        // Guardar sesión con el token JWT retornado por el backend
        setSession(response.data.usuario, response.data.token)
        setIsSuccess(true)
        onSuccess?.()
      } else {
        setSubmitError(response.error ?? 'No se pudo completar el registro')
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Error inesperado. Intenta nuevamente.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Pantalla de éxito ──

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-8 w-8 text-success" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-foreground">¡Registro exitoso!</h2>
          <p className="text-sm text-muted-foreground">
            Tu cuenta ha sido creada. Ahora puedes solicitar reembolsos directamente
            desde WhatsApp enviando la foto de tu boleta.
          </p>
        </div>
      </div>
    )
  }

  // ── Formulario ──

  const isRutValid = rut.length > 0 && validateRut(rut)
  const isIsapreRutValid = isapreRut.length > 0 && validateRut(isapreRut)

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {/* Banner de privacidad */}
      <PrivacyBanner />

      {/* ── Datos personales ── */}
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">Datos personales</h2>

        <Input
          label="Nombre completo"
          placeholder="Ej: María González"
          value={nombre}
          onChange={handleNombreChange}
          error={errors.nombre}
          name="nombre"
          autoComplete="name"
          leftIcon={<User className="h-5 w-5" />}
        />

        <Input
          label="Teléfono (WhatsApp)"
          placeholder="+56 9 1234 5678"
          value={telefono}
          onChange={handleTelefonoChange}
          error={errors.telefono}
          name="telefono"
          type="tel"
          autoComplete="tel"
          leftIcon={<Phone className="h-5 w-5" />}
          hint="Tu número de WhatsApp donde recibes los reembolsos"
        />

        <Input
          label="RUT"
          placeholder="12.345.678-K"
          value={rut}
          onChange={handleRutChange}
          error={errors.rut}
          isValid={isRutValid}
          name="rut"
          autoComplete="off"
          hint="Sin puntos ni guion se formatea automáticamente"
        />
      </div>

      {/* ── Credenciales de Isapre ── */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">
            Credenciales de tu Isapre
          </h2>
          <p className="text-sm text-muted-foreground">
            Datos de acceso a la sucursal virtual de tu Isapre.
          </p>
        </div>

        <IsapreSelector
          value={isapreId}
          onChange={(value) => {
            setIsapreId(value)
            if (errors.isapreId) {
              setErrors((prev) => ({ ...prev, isapreId: undefined }))
            }
          }}
          error={errors.isapreId}
        />

        <Input
          label="RUT de la sucursal virtual"
          placeholder="12.345.678-K"
          value={isapreRut}
          onChange={handleIsapreRutChange}
          error={errors.isapreRut}
          isValid={isIsapreRutValid}
          name="isapreRut"
          autoComplete="off"
        />

        <Input
          label="Contraseña"
          placeholder="Tu contraseña de la sucursal virtual"
          value={isaprePassword}
          onChange={handleIsaprePasswordChange}
          error={errors.isaprePassword}
          name="isaprePassword"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          leftIcon={<KeyRound className="h-5 w-5" />}
          rightIcon={
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="pointer-events-auto text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {showPassword ? (
                <EyeOff className="h-5 w-5" />
              ) : (
                <Eye className="h-5 w-5" />
              )}
            </button>
          }
        />
      </div>

      {/* ── Error de submit ── */}
      {submitError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {submitError}
        </div>
      )}

      {/* ── Submit ── */}
      <Button type="submit" size="lg" fullWidth isLoading={isSubmitting}>
        {isSubmitting ? 'Registrando...' : 'Crear cuenta y enlazar Isapre'}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Al registrarte aceptas que usemos tus credenciales de Isapre únicamente
        para procesar tus reembolsos de forma automática.
      </p>
    </form>
  )
}