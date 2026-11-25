DROP FUNCTION IF EXISTS users_delete(uuid);
DROP FUNCTION IF EXISTS users_set_email_verified(uuid, timestamptz);
DROP FUNCTION IF EXISTS users_update_profile(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS users_get_credentials_by_email(text);
DROP FUNCTION IF EXISTS users_get_by_email(text);
DROP FUNCTION IF EXISTS users_get_by_id(uuid);
DROP FUNCTION IF EXISTS users_create(uuid, text, text, text, text, text, text);

DROP TABLE IF EXISTS users;
