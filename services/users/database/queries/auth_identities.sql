-- name: CreateAuthIdentity :exec
SELECT auth_identities_create(
    sqlc.arg(id),
    sqlc.arg(user_id),
    sqlc.arg(provider),
    sqlc.arg(provider_account_id),
    sqlc.arg(provider_email)
);

-- name: GetAuthIdentity :one
SELECT a.id::uuid AS id,
       a.user_id::uuid AS user_id,
       a.provider::text AS provider,
       a.provider_account_id::text AS provider_account_id,
       a.provider_email::text AS provider_email,
       a.created_at::timestamptz AS created_at,
       a.updated_at::timestamptz AS updated_at
FROM auth_identities_get(sqlc.arg(provider), sqlc.arg(provider_account_id)) AS a;

-- name: ListAuthIdentitiesForUser :many
SELECT a.id::uuid AS id,
       a.user_id::uuid AS user_id,
       a.provider::text AS provider,
       a.provider_account_id::text AS provider_account_id,
       a.provider_email::text AS provider_email,
       a.created_at::timestamptz AS created_at,
       a.updated_at::timestamptz AS updated_at
FROM auth_identities_for_user(sqlc.arg(user_id)) AS a;

-- name: UpdateAuthIdentityEmail :exec
SELECT auth_identities_update_email(sqlc.arg(id), sqlc.arg(provider_email));

-- name: DeleteAuthIdentity :exec
SELECT auth_identities_delete(sqlc.arg(id));
