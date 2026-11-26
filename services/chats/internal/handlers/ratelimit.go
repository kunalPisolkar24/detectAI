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

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/limiter"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

type scope string

const (
	scopeRead   scope = "read"
	scopeCreate scope = "create"
	scopeWrite  scope = "write"
)

// A procedure that is not listed is not limited.
var scopeByProcedure = map[string]scope{
	chatv1connect.ChatServiceCreateChatProcedure:          scopeCreate,
	chatv1connect.ChatServiceGetChatProcedure:             scopeRead,
	chatv1connect.ChatServiceListChatsProcedure:           scopeRead,
	chatv1connect.ChatServiceGetChatHistoryProcedure:      scopeRead,
	chatv1connect.ChatServiceRenameChatProcedure:          scopeWrite,
	chatv1connect.ChatServiceDeleteChatProcedure:          scopeWrite,
	chatv1connect.ChatServiceSaveUserMessageProcedure:     scopeWrite,
	chatv1connect.ChatServiceSaveAnalysisMessageProcedure: scopeWrite,
}

type Limits struct {
	Read   int
	Create int
	Write  int
}

func (l Limits) forScope(s scope) int {
	switch s {
	case scopeRead:
		return l.Read
	case scopeCreate:
		return l.Create
	default:
		return l.Write
	}
}

// The check fails open: a cache fault lets the call through.
func NewRateLimitInterceptor(limiter limiter.Limiter, limits Limits, logger *slog.Logger, obs observability.Telemetry) connect.UnaryInterceptorFunc {
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
				logger.WarnContext(ctx, "rate limit check failed open",
					"scope", string(selected),
					"owner", ownerIDHash(ownerID),
					"error", err)
				return next(ctx, req)
			}
			if !decision.Allowed {
				obs.RecordRateLimitRefusal(string(selected))
				logRefusal(ctx, logger, ownerID, selected, decision)
				return nil, rateLimitError(decision)
			}
			return next(ctx, req)
		}
	}
}

// The refusal is logged once per exhausted budget per window. The counter moves
// by one, so the first refusal of a window is limit+1; later ones stay silent
// and a client hammering the limit cannot flood the logs.
func logRefusal(ctx context.Context, logger *slog.Logger, ownerID string, selected scope, decision limiter.Decision) {
	if decision.Count != decision.Limit+1 {
		return
	}
	logger.InfoContext(ctx, "rate limit refused",
		"scope", string(selected),
		"owner", ownerIDHash(ownerID),
		"count", decision.Count,
		"limit", decision.Limit,
		"retry_after_ms", decision.RetryAfter.Milliseconds())
}

// A short digest of an owner id; raw ids never reach the logs.
func ownerIDHash(ownerID string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(ownerID))))
	return hex.EncodeToString(digest[:])[:16]
}

func rateLimitError(decision limiter.Decision) error {
	err := connect.NewError(connect.CodeResourceExhausted, errors.New("rate limit exceeded"))
	err.Meta().Set("retry-after-ms", strconv.FormatInt(decision.RetryAfter.Milliseconds(), 10))
	err.Meta().Set("x-ratelimit-limit", strconv.Itoa(decision.Limit))
	err.Meta().Set("x-ratelimit-remaining", "0")
	return err
}
