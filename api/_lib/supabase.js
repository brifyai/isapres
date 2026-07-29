import { createClient } from '@supabase/supabase-js'

let adminClient = null

function getEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Falta ${name} en Vercel.`)
  }
  return value
}

export function getAdminSupabase() {
  if (!adminClient) {
    const supabaseUrl = process.env.SUPABASE_URL?.trim() || getEnv('VITE_SUPABASE_URL')
    adminClient = createClient(
      supabaseUrl,
      getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    )
  }

  return adminClient
}
