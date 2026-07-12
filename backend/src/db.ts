import pg from 'pg'

const { Pool, types } = pg

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  throw new Error('Falta la variable de entorno DATABASE_URL')
}

// bigint/int8 -> number para mantener compatibilidad con el dominio actual
types.setTypeParser(20, (value) => Number.parseInt(value, 10))

function shouldUseSsl(connectionString: string): boolean {
  return !/localhost|127\.0\.0\.1/i.test(connectionString)
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: shouldUseSsl(DATABASE_URL) ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
})

export async function query<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params)
  return result.rows
}

export async function queryOne<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await pool.query<T>(text, params)
  return result.rows[0]
}

export async function execute(text: string, params: unknown[] = []): Promise<void> {
  await pool.query(text, params)
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Verifica la conexión y asegura el catálogo inicial de portales.
 * El esquema principal debe existir previamente en Supabase.
 */
export async function initDatabase(): Promise<void> {
  await pool.query('SELECT 1')

  await pool.query(`
    INSERT INTO portales_status (isapre_id, status, ultima_ejecucion_exitosa)
    VALUES
      ('colmena', 'operativo', timezone('utc', now())),
      ('banmedica', 'operativo', timezone('utc', now())),
      ('consalud', 'operativo', timezone('utc', now())),
      ('cruzblanca', 'operativo', timezone('utc', now())),
      ('nueva_masvida', 'operativo', timezone('utc', now())),
      ('vida_tres', 'operativo', timezone('utc', now())),
      ('esencial', 'operativo', timezone('utc', now()))
    ON CONFLICT (isapre_id) DO NOTHING
  `)
}
