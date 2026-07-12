import pg from 'pg'

const { Pool, types } = pg

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  throw new Error('Falta la variable de entorno DATABASE_URL')
}

types.setTypeParser(20, (value) => Number.parseInt(value, 10))

function shouldUseSsl(connectionString: string): boolean {
  return !/localhost|127\.0\.0\.1/i.test(connectionString)
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: shouldUseSsl(DATABASE_URL) ? { rejectUnauthorized: false } : false,
  max: 5,
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
