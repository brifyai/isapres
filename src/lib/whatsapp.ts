function normalizePhone(value: string): string {
  return value.replace(/\D/g, '')
}

export function buildWhatsappEntryUrl(message?: string): string | null {
  const directUrl = import.meta.env.VITE_WHATSAPP_ENTRY_URL?.trim()
  if (directUrl) {
    return directUrl
  }

  const phone = normalizePhone(import.meta.env.VITE_WHATSAPP_PHONE ?? '')
  if (!phone) {
    return null
  }

  const text = encodeURIComponent(message ?? 'Hola, quiero iniciar mi proceso de reembolso.')
  return `https://wa.me/${phone}?text=${text}`
}
