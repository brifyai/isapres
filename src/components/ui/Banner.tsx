import { type ReactNode } from 'react'
import { ShieldCheck, AlertTriangle, Info, XCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type BannerVariant = 'info' | 'success' | 'warning' | 'destructive'

export interface BannerProps {
  variant?: BannerVariant
  title?: string
  children: ReactNode
  icon?: LucideIcon
  className?: string
}

const variantConfig: Record<
  BannerVariant,
  { container: string; icon: string; Icon: LucideIcon }
> = {
  info: {
    container: 'bg-primary/5 border-primary/20 text-primary',
    icon: 'text-primary',
    Icon: Info,
  },
  success: {
    container: 'bg-success/5 border-success/20 text-success',
    icon: 'text-success',
    Icon: ShieldCheck,
  },
  warning: {
    container: 'bg-warning/5 border-warning/20 text-warning',
    icon: 'text-warning',
    Icon: AlertTriangle,
  },
  destructive: {
    container: 'bg-destructive/5 border-destructive/20 text-destructive',
    icon: 'text-destructive',
    Icon: XCircle,
  },
}

export function Banner({
  variant = 'info',
  title,
  children,
  icon,
  className,
}: BannerProps) {
  const config = variantConfig[variant]
  const Icon = icon ?? config.Icon

  return (
    <div
      role="alert"
      className={cn(
        'flex gap-3 rounded-lg border p-4',
        config.container,
        className,
      )}
    >
      <Icon className={cn('h-5 w-5 shrink-0', config.icon)} aria-hidden="true" />
      <div className="flex flex-col gap-1">
        {title && <p className="text-sm font-semibold">{title}</p>}
        <div className="text-sm text-foreground/80">{children}</div>
      </div>
    </div>
  )
}