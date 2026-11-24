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
