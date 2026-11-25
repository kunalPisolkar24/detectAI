DROP FUNCTION IF EXISTS refresh_tokens_delete_expired(uuid);
DROP FUNCTION IF EXISTS refresh_tokens_revoke_all_for_user(uuid);
DROP FUNCTION IF EXISTS refresh_tokens_rotate(uuid, uuid, integer, timestamptz);
DROP FUNCTION IF EXISTS refresh_tokens_revoke(uuid, uuid);
DROP FUNCTION IF EXISTS refresh_tokens_get(uuid);
DROP FUNCTION IF EXISTS refresh_tokens_create(uuid, uuid, timestamptz);

DROP TABLE IF EXISTS refresh_tokens;
