CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          uuid PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_expires_idx ON refresh_tokens (user_id, expires_at);

CREATE OR REPLACE FUNCTION refresh_tokens_create(p_id uuid, p_user_id uuid, p_expires_at timestamptz)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO refresh_tokens (id, user_id, expires_at)
    VALUES (p_id, p_user_id, p_expires_at);
$$;

CREATE OR REPLACE FUNCTION refresh_tokens_get(p_id uuid)
RETURNS TABLE (
    id uuid,
    user_id uuid,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz,
    token_version integer
) LANGUAGE sql AS $$
    SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, rt.created_at, rt.updated_at, u.token_version
    FROM refresh_tokens rt
    JOIN users u ON u.id = rt.user_id
    WHERE rt.id = p_id;
$$;

CREATE OR REPLACE FUNCTION refresh_tokens_revoke(p_id uuid, p_user_id uuid)
RETURNS void LANGUAGE sql AS $$
    UPDATE refresh_tokens rt
    SET revoked_at = now(), updated_at = now()
    WHERE rt.id = p_id AND rt.user_id = p_user_id AND rt.revoked_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION refresh_tokens_rotate(
    p_old_id uuid,
    p_new_id uuid,
    p_expected_version integer,
    p_new_expires_at timestamptz
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
    v_user_id uuid;
BEGIN
    UPDATE refresh_tokens rt
    SET revoked_at = now(), updated_at = now()
    FROM users u
    WHERE rt.id = p_old_id
      AND u.id = rt.user_id
      AND u.token_version = p_expected_version
      AND rt.revoked_at IS NULL
      AND rt.expires_at > now()
    RETURNING rt.user_id INTO v_user_id;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    PERFORM refresh_tokens_create(p_new_id, v_user_id, p_new_expires_at);
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_tokens_revoke_all_for_user(p_user_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE users u
    SET token_version = u.token_version + 1, updated_at = now()
    WHERE u.id = p_user_id;

    UPDATE refresh_tokens rt
    SET revoked_at = now(), updated_at = now()
    WHERE rt.user_id = p_user_id AND rt.revoked_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_tokens_delete_expired(p_user_id uuid)
RETURNS void LANGUAGE sql AS $$
    DELETE FROM refresh_tokens rt
    WHERE rt.user_id = p_user_id AND rt.expires_at <= now();
$$;
