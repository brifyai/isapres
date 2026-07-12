import { Building2 } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { ISAPRES, type IsapreId } from '@/types'

interface IsapreSelectorProps {
  value: IsapreId | ''
  onChange: (value: IsapreId) => void
  error?: string
}

/**
 * Selector dropdown de Isapres abiertas chilenas.
 * Muestra solo las isapres activas para el RPA.
 */
export function IsapreSelector({ value, onChange, error }: IsapreSelectorProps) {
  const options = ISAPRES.filter((isapre) => isapre.activa).map((isapre) => ({
    value: isapre.id,
    label: isapre.nombre,
  }))

  return (
    <Select
      label="Tu Isapre"
      placeholder="Selecciona tu Isapre"
      options={options}
      value={value}
      onChange={(e) => onChange(e.target.value as IsapreId)}
      error={error}
      leftIcon={<Building2 className="h-5 w-5" />}
      name="isapre"
    />
  )
}