CREATE TABLE IF NOT EXISTS users (
    id                 uuid PRIMARY KEY,
    email              text NOT NULL CHECK (email = lower(email)),
    name               text,
    first_name         text,
    last_name          text,
    image              text,
    email_verified_at  timestamptz,
    password_hash      text,
    token_version      integer NOT NULL DEFAULT 0,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_key UNIQUE (email)
);

CREATE OR REPLACE FUNCTION users_create(
    p_id uuid,
    p_email text,
    p_password_hash text,
    p_first_name text,
    p_last_name text,
    p_name text,
    p_image text
) RETURNS void LANGUAGE sql AS $$
    INSERT INTO users (id, email, password_hash, first_name, last_name, name, image)
    VALUES (p_id, lower(p_email), p_password_hash, p_first_name, p_last_name, p_name, p_image);
$$;

CREATE OR REPLACE FUNCTION users_get_by_id(p_id uuid)
RETURNS TABLE (
    id uuid,
    email text,
    name text,
    first_name text,
    last_name text,
    image text,
    email_verified_at timestamptz,
    token_version integer,
    created_at timestamptz,
    updated_at timestamptz
) LANGUAGE sql AS $$
    SELECT u.id, u.email, u.name, u.first_name, u.last_name, u.image,
           u.email_verified_at, u.token_version, u.created_at, u.updated_at
    FROM users u
    WHERE u.id = p_id;
$$;

CREATE OR REPLACE FUNCTION users_get_by_email(p_email text)
RETURNS TABLE (
    id uuid,
    email text,
    name text,
    first_name text,
    last_name text,
    image text,
    email_verified_at timestamptz,
    token_version integer,
    created_at timestamptz,
    updated_at timestamptz
) LANGUAGE sql AS $$
    SELECT u.id, u.email, u.name, u.first_name, u.last_name, u.image,
           u.email_verified_at, u.token_version, u.created_at, u.updated_at
    FROM users u
    WHERE u.email = lower(p_email);
$$;

CREATE OR REPLACE FUNCTION users_get_credentials_by_email(p_email text)
RETURNS TABLE (
    id uuid,
    password_hash text,
    token_version integer
) LANGUAGE sql AS $$
    SELECT u.id, coalesce(u.password_hash, '') AS password_hash, u.token_version
    FROM users u
    WHERE u.email = lower(p_email);
$$;

CREATE OR REPLACE FUNCTION users_update_profile(
    p_id uuid,
    p_name text,
    p_first_name text,
    p_last_name text,
    p_image text
) RETURNS void LANGUAGE sql AS $$
    UPDATE users u
    SET name = coalesce(p_name, u.name),
        first_name = coalesce(p_first_name, u.first_name),
        last_name = coalesce(p_last_name, u.last_name),
        image = coalesce(p_image, u.image),
        updated_at = now()
    WHERE u.id = p_id;
$$;

CREATE OR REPLACE FUNCTION users_set_email_verified(p_id uuid, p_verified_at timestamptz)
RETURNS void LANGUAGE sql AS $$
    UPDATE users u
    SET email_verified_at = p_verified_at, updated_at = now()
    WHERE u.id = p_id;
$$;

CREATE OR REPLACE FUNCTION users_delete(p_id uuid)
RETURNS void LANGUAGE sql AS $$
    DELETE FROM users u WHERE u.id = p_id;
$$;
