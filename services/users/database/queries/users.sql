-- name: CreateUser :exec
SELECT users_create(
    sqlc.arg(id),
    sqlc.arg(email),
    sqlc.arg(password_hash),
    sqlc.arg(first_name),
    sqlc.arg(last_name),
    sqlc.arg(name),
    sqlc.arg(image)
);

-- name: GetUserByID :one
SELECT u.id::uuid AS id,
       u.email::text AS email,
       u.name::text AS name,
       u.first_name::text AS first_name,
       u.last_name::text AS last_name,
       u.image::text AS image,
       u.email_verified_at::timestamptz AS email_verified_at,
       u.token_version::integer AS token_version,
       u.created_at::timestamptz AS created_at,
       u.updated_at::timestamptz AS updated_at
FROM users_get_by_id(sqlc.arg(id)) AS u;

-- name: GetUserByEmail :one
SELECT u.id::uuid AS id,
       u.email::text AS email,
       u.name::text AS name,
       u.first_name::text AS first_name,
       u.last_name::text AS last_name,
       u.image::text AS image,
       u.email_verified_at::timestamptz AS email_verified_at,
       u.token_version::integer AS token_version,
       u.created_at::timestamptz AS created_at,
       u.updated_at::timestamptz AS updated_at
FROM users_get_by_email(sqlc.arg(email)) AS u;

-- name: GetCredentialsByEmail :one
SELECT c.id::uuid AS id,
       c.password_hash::text AS password_hash,
       c.token_version::integer AS token_version
FROM users_get_credentials_by_email(sqlc.arg(email)) AS c;

-- name: UpdateUserProfile :exec
SELECT users_update_profile(
    sqlc.arg(id),
    sqlc.arg(name),
    sqlc.arg(first_name),
    sqlc.arg(last_name),
    sqlc.arg(image)
);

-- name: SetEmailVerified :exec
SELECT users_set_email_verified(sqlc.arg(id), sqlc.arg(verified_at));

-- name: DeleteUser :exec
SELECT users_delete(sqlc.arg(id));
