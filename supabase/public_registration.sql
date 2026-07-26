-- Registro publico directo desde el frontend hacia Supabase.
-- Ejecutar DESPUES de supabase/schema.sql
--
-- 1) Carga la clave maestra que ya usa tu sistema externo:
--    insert into private.app_secrets (secret_name, secret_value)
--    values ('email_encryption_key', 'TU_MISMA_CLAVE_ACTUAL')
--    on conflict (secret_name) do update
--      set secret_value = excluded.secret_value,
--          updated_at = timezone('utc', now());
--
-- 2) El frontend llamara a la RPC:
--    public.register_public_user(...)
--
-- Esta RPC:
-- - crea el usuario en public.usuarios
-- - cifra la password de la Isapre con la misma estrategia del backend
-- - crea la fila en public.credenciales_isapre

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.app_secrets (
  secret_name text primary key,
  secret_value text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

revoke all on private.app_secrets from public;
revoke all on private.app_secrets from anon;
revoke all on private.app_secrets from authenticated;

create or replace function private.bytea_xor(left_value bytea, right_value bytea)
returns bytea
language plpgsql
immutable
as $$
declare
  result bytea;
  idx integer;
begin
  if length(left_value) <> length(right_value) then
    raise exception 'bytea_xor requiere buffers del mismo largo';
  end if;

  result := decode(repeat('00', length(left_value)), 'hex');

  for idx in 0..length(left_value) - 1 loop
    result := set_byte(
      result,
      idx,
      get_byte(left_value, idx) # get_byte(right_value, idx)
    );
  end loop;

  return result;
end;
$$;

create or replace function private.pbkdf2_sha256(
  password_text text,
  salt_value bytea,
  iterations integer,
  key_length integer
)
returns bytea
language plpgsql
immutable
as $$
declare
  block_index bytea := decode('00000001', 'hex');
  password_bytes bytea := convert_to(password_text, 'utf8');
  u_value bytea;
  t_value bytea;
  iter integer;
begin
  if iterations < 1 then
    raise exception 'iterations debe ser >= 1';
  end if;

  if key_length < 1 or key_length > 32 then
    raise exception 'Esta implementacion solo soporta key_length entre 1 y 32 bytes';
  end if;

  u_value := hmac(salt_value || block_index, password_bytes, 'sha256');
  t_value := u_value;

  for iter in 2..iterations loop
    u_value := hmac(u_value, password_bytes, 'sha256');
    t_value := private.bytea_xor(t_value, u_value);
  end loop;

  return substring(t_value from 1 for key_length);
end;
$$;

create or replace function private.get_email_encryption_key()
returns text
language plpgsql
security definer
set search_path = private
as $$
declare
  configured_key text;
begin
  select secret_value
  into configured_key
  from private.app_secrets
  where secret_name = 'email_encryption_key';

  if configured_key is null or btrim(configured_key) = '' then
    raise exception 'Falta private.app_secrets.email_encryption_key';
  end if;

  return configured_key;
end;
$$;

create or replace function private.encrypt_isapre_password(plain_password text)
returns text
language plpgsql
security definer
set search_path = private
as $$
declare
  salt_value bytea;
  iv_value bytea;
  derived_key bytea;
  cipher_value bytea;
begin
  if plain_password is null or btrim(plain_password) = '' then
    raise exception 'La contraseña de la Isapre es obligatoria';
  end if;

  salt_value := gen_random_bytes(16);
  iv_value := gen_random_bytes(16);
  derived_key := private.pbkdf2_sha256(
    private.get_email_encryption_key(),
    salt_value,
    100000,
    32
  );
  cipher_value := encrypt_iv(
    convert_to(plain_password, 'utf8'),
    derived_key,
    iv_value,
    'aes-cbc/pad:pkcs'
  );

  return encode(salt_value, 'hex')
    || ':' || encode(iv_value, 'hex')
    || ':' || encode(cipher_value, 'hex');
end;
$$;

create or replace function public.register_public_user(
  p_nombre text,
  p_telefono text,
  p_rut text,
  p_isapre_id text,
  p_isapre_rut text,
  p_isapre_password text,
  p_accepted_privacy_policy boolean,
  p_accepted_terms boolean,
  p_consent_ip text default null,
  p_consent_user_agent text default null
)
returns table (
  id integer,
  nombre text,
  telefono text,
  rut text,
  isapre_id text,
  isapre_rut text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  new_user_id integer;
  normalized_phone text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  normalized_rut text := btrim(coalesce(p_rut, ''));
  normalized_isapre_rut text := btrim(coalesce(p_isapre_rut, ''));
begin
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre es obligatorio';
  end if;

  if normalized_phone = '' then
    raise exception 'El telefono es obligatorio';
  end if;

  if normalized_rut = '' then
    raise exception 'El RUT es obligatorio';
  end if;

  if btrim(coalesce(p_isapre_id, '')) = '' then
    raise exception 'La Isapre es obligatoria';
  end if;

  if normalized_isapre_rut = '' then
    raise exception 'El RUT de la sucursal virtual es obligatorio';
  end if;

  if coalesce(p_accepted_privacy_policy, false) is not true then
    raise exception 'Debes aceptar la política de privacidad';
  end if;

  if coalesce(p_accepted_terms, false) is not true then
    raise exception 'Debes aceptar los términos y condiciones';
  end if;

  if exists (
    select 1
    from public.usuarios
    where usuarios.telefono = normalized_phone
  ) then
    raise exception 'Ya existe una cuenta con este teléfono';
  end if;

  insert into public.usuarios (
    nombre,
    telefono,
    rut,
    password_hash,
    accepted_privacy_policy_at,
    accepted_terms_at,
    consent_ip,
    consent_user_agent
  )
  values (
    btrim(p_nombre),
    normalized_phone,
    normalized_rut,
    crypt(normalized_phone || normalized_rut, gen_salt('bf', 8)),
    timezone('utc', now()),
    timezone('utc', now()),
    nullif(btrim(coalesce(p_consent_ip, '')), ''),
    nullif(btrim(coalesce(p_consent_user_agent, '')), '')
  )
  returning usuarios.id into new_user_id;

  insert into public.credenciales_isapre (
    usuario_id,
    isapre_id,
    rut,
    password_encrypted
  )
  values (
    new_user_id,
    p_isapre_id::public.isapre_id,
    normalized_isapre_rut,
    private.encrypt_isapre_password(p_isapre_password)
  );

  return query
  select
    u.id,
    u.nombre,
    u.telefono,
    u.rut,
    c.isapre_id::text,
    c.rut,
    u.created_at,
    u.updated_at
  from public.usuarios u
  join public.credenciales_isapre c
    on c.usuario_id = u.id
  where u.id = new_user_id
  order by c.created_at asc
  limit 1;
end;
$$;

revoke all on function private.get_email_encryption_key() from public;
revoke all on function private.get_email_encryption_key() from anon;
revoke all on function private.get_email_encryption_key() from authenticated;

revoke all on function private.encrypt_isapre_password(text) from public;
revoke all on function private.encrypt_isapre_password(text) from anon;
revoke all on function private.encrypt_isapre_password(text) from authenticated;

grant execute on function public.register_public_user(
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  text,
  text
) to anon;

grant execute on function public.register_public_user(
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  text,
  text
) to authenticated;
