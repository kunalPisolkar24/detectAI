package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"strconv"
	"strings"

	"connectrpc.com/connect"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

// scope is the burst budget a procedure draws from.
type scope string

const (
	scopeCreate scope = "create"
	scopeWrite  scope = "write"
)

// scopeByProcedure maps a procedure onto the budget it draws from; a
// procedure that is not listed is not limited.
var scopeByProcedure = map[string]scope{
	chatv1connect.ChatServiceCreateChatProcedure:          scopeCreate,
	chatv1connect.ChatServiceSaveUserMessageProcedure:     scopeWrite,
	chatv1connect.ChatServiceSaveAnalysisMessageProcedure: scopeWrite,
}

// Limits are the per-user burst budgets of the scopes.
type Limits struct {
	Create int
	Write  int
}

// forScope returns the budget of a scope.
func (l Limits) forScope(s scope) int {
	if s == scopeCreate {
		return l.Create
	}
	return l.Write
}

// NewRateLimitInterceptor enforces the per-user burst budgets. The check
// fails open: a cache fault lets the call through.
func NewRateLimitInterceptor(limiter services.Limiter, limits Limits, logger *slog.Logger) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			selected, limited := scopeByProcedure[req.Spec().Procedure]
			if !limited {
				return next(ctx, req)
			}
			ownerID, err := OwnerFrom(ctx)
			if err != nil {
				return nil, err
			}
			decision, err := limiter.Consume(ctx, ownerID, string(selected), limits.forScope(selected))
			if err != nil {
				logger.Warn("rate limit check failed open",
					"scope", string(selected),
					"owner", ownerIDHash(ownerID),
					"error", err)
				return next(ctx, req)
			}
			if !decision.Allowed {
				logRefusal(logger, ownerID, selected, decision)
				return nil, rateLimitError(decision)
			}
			return next(ctx, req)
		}
	}
}

// logRefusal records the refusal once per exhausted budget per window. The
// counter moves by one, so the first refusal of a window is limit+1; later
// ones stay silent and a client hammering the limit cannot flood the logs.
func logRefusal(logger *slog.Logger, ownerID string, selected scope, decision services.Decision) {
	if decision.Count != decision.Limit+1 {
		return
	}
	logger.Info("rate limit refused",
		"scope", string(selected),
		"owner", ownerIDHash(ownerID),
		"count", decision.Count,
		"limit", decision.Limit,
		"retry_after_ms", decision.RetryAfter.Milliseconds())
}

// ownerIDHash is the short digest of an owner id; raw ids never reach the logs.
func ownerIDHash(ownerID string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(ownerID))))
	return hex.EncodeToString(digest[:])[:16]
}

// rateLimitError answers an over-limit call with the retry hint.
func rateLimitError(decision services.Decision) error {
	err := connect.NewError(connect.CodeResourceExhausted, errors.New("rate limit exceeded"))
	err.Meta().Set("retry-after-ms", strconv.FormatInt(decision.RetryAfter.Milliseconds(), 10))
	err.Meta().Set("x-ratelimit-limit", strconv.Itoa(decision.Limit))
	err.Meta().Set("x-ratelimit-remaining", "0")
	return err
}
