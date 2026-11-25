-- name: CreateRefreshToken :exec
SELECT refresh_tokens_create(sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(expires_at));

-- name: GetRefreshToken :one
SELECT t.id::uuid AS id,
       t.user_id::uuid AS user_id,
       t.expires_at::timestamptz AS expires_at,
       t.revoked_at::timestamptz AS revoked_at,
       t.created_at::timestamptz AS created_at,
       t.updated_at::timestamptz AS updated_at,
       t.token_version::integer AS token_version
FROM refresh_tokens_get(sqlc.arg(id)) AS t;

-- name: RevokeRefreshToken :exec
SELECT refresh_tokens_revoke(sqlc.arg(id), sqlc.arg(user_id));

-- name: RotateRefreshToken :one
SELECT refresh_tokens_rotate(
    sqlc.arg(old_id),
    sqlc.arg(new_id),
    sqlc.arg(expected_version),
    sqlc.arg(new_expires_at)
);

-- name: RevokeAllRefreshTokensForUser :exec
SELECT refresh_tokens_revoke_all_for_user(sqlc.arg(user_id));

-- name: DeleteExpiredRefreshTokens :exec
SELECT refresh_tokens_delete_expired(sqlc.arg(user_id));
