import { ShieldCheck, Lock } from 'lucide-react'
import { Banner } from '@/components/ui/Banner'

/**
 * Banner destacado que explica el tratamiento seguro de credenciales.
 * Cumple con el requisito de nota de privacidad (AES-256).
 */
export function PrivacyBanner() {
  return (
    <Banner variant="success" title="Tus credenciales están protegidas">
      <div className="flex flex-col gap-2">
        <p>
          Tus datos de acceso a la sucursal virtual de tu Isapre se guardan
          <strong className="font-semibold"> encriptados con AES-256</strong> y se
          utilizan <strong className="font-semibold">exclusivamente</strong> para
          automatizar el proceso de reembolso de tus boletas.
        </p>
        <ul className="flex flex-col gap-1.5 text-xs">
          <li className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            Cifrado de extremo a extremo (AES-256)
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            No almacenamos tus credenciales en texto plano
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Puedes eliminar tus credenciales en cualquier momento
          </li>
        </ul>
      </div>
    </Banner>
  )
}