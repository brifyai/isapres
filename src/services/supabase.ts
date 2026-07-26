import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let supabaseClient: SupabaseClient | null = null

function getEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string {
  const value = import.meta.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Falta configurar ${name} en Vercel. Revisa las variables públicas de Supabase.`,
    )
  }
  return value
}

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(
      getEnv('VITE_SUPABASE_URL'),
      getEnv('VITE_SUPABASE_ANON_KEY'),
    )
  }

  return supabaseClient
}
