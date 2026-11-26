package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net"
	"strconv"
	"strings"

	connectrpc "connectrpc.com/connect"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache/limiter"
	usersv1connect "github.com/kunalPisolkar24/detectAI/services/users/proto/usersv1connect"
)

type scope string

const (
	scopeRead  scope = "read"
	scopeWrite scope = "write"
)

// A procedure that is not listed is not limited.
var scopeByProcedure = map[string]scope{
	usersv1connect.UserServiceGetMeProcedure:     scopeRead,
	usersv1connect.AuthServiceRegisterProcedure:  scopeWrite,
	usersv1connect.AuthServiceLoginProcedure:     scopeWrite,
	usersv1connect.AuthServiceRefreshProcedure:   scopeWrite,
	usersv1connect.UserServiceLogoutProcedure:    scopeWrite,
	usersv1connect.UserServiceLogoutAllProcedure: scopeWrite,
}

type Limits struct {
	Read  int
	Write int
}

func (l Limits) forScope(s scope) int {
	if s == scopeRead {
		return l.Read
	}
	return l.Write
}

// The check fails open: a cache fault lets the call through.
func NewRateLimitInterceptor(limiter limiter.Limiter, limits Limits, logger *slog.Logger) connectrpc.UnaryInterceptorFunc {
	return func(next connectrpc.UnaryFunc) connectrpc.UnaryFunc {
		return func(ctx context.Context, req connectrpc.AnyRequest) (connectrpc.AnyResponse, error) {
			selected, limited := scopeByProcedure[req.Spec().Procedure]
			if !limited {
				return next(ctx, req)
			}
			identity := rateLimitIdentity(req)
			decision, err := limiter.Consume(ctx, identity, string(selected), limits.forScope(selected))
			if err != nil {
				logger.WarnContext(ctx, "rate limit check failed open",
					"scope", string(selected),
					"identity", identity,
					"error", err)
				return next(ctx, req)
			}
			if !decision.Allowed {
				logRefusal(ctx, logger, identity, selected, decision)
				return nil, rateLimitError(decision)
			}
			return next(ctx, req)
		}
	}
}

// A bearer token is a stable, unforgeable identity for authenticated calls and
// needs no verification here; calls without one fall back to the client IP.
func rateLimitIdentity(req connectrpc.AnyRequest) string {
	if token := bearer(req.Header().Get("Authorization")); token != "" {
		return "t:" + shortDigest(token)
	}
	return "ip:" + shortDigest(clientIP(req))
}

func clientIP(req connectrpc.AnyRequest) string {
	if forwarded := req.Header().Get("X-Forwarded-For"); forwarded != "" {
		first, _, _ := strings.Cut(forwarded, ",")
		if ip := strings.TrimSpace(first); ip != "" {
			return ip
		}
	}
	if real := req.Header().Get("X-Real-IP"); real != "" {
		return strings.TrimSpace(real)
	}
	host, _, err := net.SplitHostPort(req.Peer().Addr)
	if err == nil {
		return host
	}
	return req.Peer().Addr
}

func shortDigest(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])[:16]
}

// The refusal is logged once per exhausted budget per window. The counter moves
// by one, so the first refusal of a window is limit+1; later ones stay silent
// and a client hammering the limit cannot flood the logs.
func logRefusal(ctx context.Context, logger *slog.Logger, identity string, selected scope, decision limiter.Decision) {
	if decision.Count != decision.Limit+1 {
		return
	}
	logger.InfoContext(ctx, "rate limit refused",
		"scope", string(selected),
		"identity", identity,
		"count", decision.Count,
		"limit", decision.Limit,
		"retry_after_ms", decision.RetryAfter.Milliseconds())
}

func rateLimitError(decision limiter.Decision) error {
	err := connectrpc.NewError(connectrpc.CodeResourceExhausted, errors.New("rate limit exceeded"))
	err.Meta().Set("retry-after-ms", strconv.FormatInt(decision.RetryAfter.Milliseconds(), 10))
	err.Meta().Set("x-ratelimit-limit", strconv.Itoa(decision.Limit))
	err.Meta().Set("x-ratelimit-remaining", "0")
	return err
}
