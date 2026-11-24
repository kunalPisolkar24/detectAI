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
