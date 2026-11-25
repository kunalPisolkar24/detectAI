DROP FUNCTION IF EXISTS auth_identities_delete(uuid);
DROP FUNCTION IF EXISTS auth_identities_update_email(uuid, text);
DROP FUNCTION IF EXISTS auth_identities_for_user(uuid);
DROP FUNCTION IF EXISTS auth_identities_get(text, text);
DROP FUNCTION IF EXISTS auth_identities_create(uuid, uuid, text, text, text);

DROP TABLE IF EXISTS auth_identities;
