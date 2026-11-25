CREATE TABLE IF NOT EXISTS auth_identities (
    id                  uuid PRIMARY KEY,
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            text NOT NULL CHECK (provider IN ('google', 'github')),
    provider_account_id text NOT NULL,
    provider_email      text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT auth_identities_provider_identity_key UNIQUE (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS auth_identities_user_id_idx ON auth_identities (user_id);

CREATE OR REPLACE FUNCTION auth_identities_create(
    p_id uuid,
    p_user_id uuid,
    p_provider text,
    p_provider_account_id text,
    p_provider_email text
) RETURNS void LANGUAGE sql AS $$
    INSERT INTO auth_identities (id, user_id, provider, provider_account_id, provider_email)
    VALUES (p_id, p_user_id, p_provider, p_provider_account_id, lower(p_provider_email));
$$;

CREATE OR REPLACE FUNCTION auth_identities_get(p_provider text, p_provider_account_id text)
RETURNS TABLE (
    id uuid,
    user_id uuid,
    provider text,
    provider_account_id text,
    provider_email text,
    created_at timestamptz,
    updated_at timestamptz
) LANGUAGE sql AS $$
    SELECT a.id, a.user_id, a.provider, a.provider_account_id, a.provider_email,
           a.created_at, a.updated_at
    FROM auth_identities a
    WHERE a.provider = p_provider AND a.provider_account_id = p_provider_account_id;
$$;

CREATE OR REPLACE FUNCTION auth_identities_for_user(p_user_id uuid)
RETURNS TABLE (
    id uuid,
    user_id uuid,
    provider text,
    provider_account_id text,
    provider_email text,
    created_at timestamptz,
    updated_at timestamptz
) LANGUAGE sql AS $$
    SELECT a.id, a.user_id, a.provider, a.provider_account_id, a.provider_email,
           a.created_at, a.updated_at
    FROM auth_identities a
    WHERE a.user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION auth_identities_update_email(p_id uuid, p_provider_email text)
RETURNS void LANGUAGE sql AS $$
    UPDATE auth_identities a
    SET provider_email = lower(p_provider_email), updated_at = now()
    WHERE a.id = p_id;
$$;

CREATE OR REPLACE FUNCTION auth_identities_delete(p_id uuid)
RETURNS void LANGUAGE sql AS $$
    DELETE FROM auth_identities a WHERE a.id = p_id;
$$;
