alter table public.usuarios
  add column if not exists beneficiarios jsonb not null default '[]'::jsonb;

alter table public.usuarios
  add column if not exists beneficiarios_updated_at timestamptz;
