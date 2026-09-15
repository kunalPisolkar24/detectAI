package http

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/domain"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/ports"
)

const (
	maxBodySize      = 1 << 20
	requestTimeout   = 5 * time.Second
	retryAfterHeader = "5"
)

type HandlerConfig struct {
	Service     ports.PaymentService
	Health      ports.HealthChecker
	Metrics     ports.MetricsRecorder
	InternalKey string
	Logger      ports.Logger
}

type Handler struct {
	service     ports.PaymentService
	health      ports.HealthChecker
	metrics     ports.MetricsRecorder
	internalKey string
	logger      ports.Logger
}

func NewHandler(cfg HandlerConfig) *Handler {
	return &Handler{
		service:     cfg.Service,
		health:      cfg.Health,
		metrics:     cfg.Metrics,
		internalKey: cfg.InternalKey,
		logger:      cfg.Logger,
	}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	r.GET("/healthz", h.livez)
	r.GET("/readyz", h.readyz)
	r.POST("/webhook/paddle", h.handleWebhook)
	r.POST("/internal/events", RequireInternalKey(h.internalKey, h.metrics), h.handleInternalEvent)
}

func (h *Handler) livez(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *Handler) readyz(c *gin.Context) {
	if !h.health.IsConnected() {
		h.logger.Error("Readiness check failed: RabbitMQ disconnected")
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "error", "rabbitmq": "disconnected"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "gateway"})
}

func isRetryablePublishError(err error) bool {
	return errors.Is(err, domain.ErrNotConnected) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled)
}

func (h *Handler) readBody(c *gin.Context) ([]byte, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodySize)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		reason := "unreadable"
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			reason = "too_large"
		}
		h.metrics.RecordWebhookBodyError(reason)
		h.logger.Error("Failed to read request body", "error", err, "reason", reason)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request body too large or unreadable"})
		return nil, false
	}
	return body, true
}

func (h *Handler) handleWebhook(c *gin.Context) {
	body, ok := h.readBody(c)
	if !ok {
		return
	}
	signature := c.GetHeader("Paddle-Signature")
	ctx, cancel := context.WithTimeout(c.Request.Context(), requestTimeout)
	defer cancel()

	if err := h.service.ProcessWebhook(ctx, signature, body); err != nil {
		h.logger.Error("Failed to process webhook", "error", err)
		if errors.Is(err, domain.ErrInvalidSignature) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
			return
		}
		if isRetryablePublishError(err) {
			c.Header("Retry-After", retryAfterHeader)
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Service Unavailable", "retryable": true})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal Server Error"})
		return
	}
	h.logger.Info("Event queued successfully")
	c.JSON(http.StatusOK, gin.H{"status": "queued"})
}

func (h *Handler) handleInternalEvent(c *gin.Context) {
	body, ok := h.readBody(c)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), requestTimeout)
	defer cancel()

	if err := h.service.ProcessInternalEvent(ctx, body); err != nil {
		h.logger.Error("Failed to process internal event", "error", err)
		if isRetryablePublishError(err) {
			c.Header("Retry-After", retryAfterHeader)
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Service Unavailable", "retryable": true})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal Server Error"})
		return
	}
	h.logger.Info("Internal event queued successfully")
	c.JSON(http.StatusOK, gin.H{"status": "queued"})
}
