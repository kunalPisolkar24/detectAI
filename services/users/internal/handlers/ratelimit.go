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
	"sync"
	"time"

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

const refusalLogSlots = 256

type logSlot struct {
	key   string
	until time.Time
}

// logGate suppresses duplicate refusal log lines until an identity's budget has
// recovered. A fixed ring keeps the gate bounded no matter how many identities
// are refused; duplicate lines across replicas are bounded by the replica count.
type logGate struct {
	mu    sync.Mutex
	slots []logSlot
	next  int
}

func newLogGate() *logGate {
	return &logGate{slots: make([]logSlot, refusalLogSlots)}
}

func (g *logGate) allow(key string, hold time.Duration, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, slot := range g.slots {
		if slot.key == key && now.Before(slot.until) {
			return false
		}
	}
	if hold <= 0 {
		hold = time.Second
	}
	g.slots[g.next] = logSlot{key: key, until: now.Add(hold)}
	g.next = (g.next + 1) % len(g.slots)
	return true
}

// The check fails open: a cache fault lets the call through.
func NewRateLimitInterceptor(limiter limiter.Limiter, limits Limits, logger *slog.Logger) connectrpc.UnaryInterceptorFunc {
	gate := newLogGate()
	return func(next connectrpc.UnaryFunc) connectrpc.UnaryFunc {
		return func(ctx context.Context, req connectrpc.AnyRequest) (connectrpc.AnyResponse, error) {
			selected, limited := scopeByProcedure[req.Spec().Procedure]
			if !limited {
				return next(ctx, req)
			}
			identity := rateLimitIdentity(ctx, req)
			decision, err := limiter.Consume(ctx, identity, string(selected), limits.forScope(selected))
			if err != nil {
				logger.WarnContext(ctx, "rate limit check failed open",
					"scope", string(selected),
					"identity", identity,
					"error", err)
				return next(ctx, req)
			}
			if !decision.Allowed {
				if gate.allow(identity+":"+string(selected), decision.ResetAfter, time.Now()) {
					logRefusal(ctx, logger, identity, selected, decision)
				}
				return nil, rateLimitError(decision)
			}
			return next(ctx, req)
		}
	}
}

// Authenticated calls carry a verified user id from the auth interceptor;
// everything else falls back to the client IP.
func rateLimitIdentity(ctx context.Context, req connectrpc.AnyRequest) string {
	if userID, ok := UserIDFrom(ctx); ok {
		return "u:" + shortDigest(userID.String())
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

func logRefusal(ctx context.Context, logger *slog.Logger, identity string, selected scope, decision limiter.Decision) {
	logger.InfoContext(ctx, "rate limit refused",
		"scope", string(selected),
		"identity", identity,
		"remaining", decision.Remaining,
		"limit", decision.Limit,
		"retry_after_ms", decision.RetryAfter.Milliseconds())
}

func rateLimitError(decision limiter.Decision) error {
	err := connectrpc.NewError(connectrpc.CodeResourceExhausted, errors.New("rate limit exceeded"))
	err.Meta().Set("retry-after-ms", strconv.FormatInt(decision.RetryAfter.Milliseconds(), 10))
	err.Meta().Set("x-ratelimit-limit", strconv.Itoa(decision.Limit))
	err.Meta().Set("x-ratelimit-remaining", strconv.Itoa(decision.Remaining))
	return err
}
