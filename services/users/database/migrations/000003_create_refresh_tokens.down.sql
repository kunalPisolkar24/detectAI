DROP FUNCTION IF EXISTS refresh_tokens_delete_expired(uuid);
DROP FUNCTION IF EXISTS refresh_tokens_revoke_all_for_user(uuid);
DROP FUNCTION IF EXISTS refresh_tokens_rotate(bytea, uuid, bytea, integer, timestamptz);
DROP FUNCTION IF EXISTS refresh_tokens_revoke_by_hash(bytea, uuid);
DROP FUNCTION IF EXISTS refresh_tokens_get_by_hash(bytea);
DROP FUNCTION IF EXISTS refresh_tokens_create(uuid, uuid, bytea, timestamptz);

DROP TABLE IF EXISTS refresh_tokens;
