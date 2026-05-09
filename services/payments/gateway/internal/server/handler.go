package server

import (
	"context"
	"gateway/internal/domain"
	"gateway/internal/logger"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type HealthChecker interface {
	IsConnected() bool
}

type HandlerConfig struct {
	Service     *domain.PaymentService
	Health      HealthChecker
	InternalKey string
	Logger      logger.Logger
}

type Handler struct {
	service     *domain.PaymentService
	health      HealthChecker
	internalKey string
	logger      logger.Logger
}

func NewHandler(cfg HandlerConfig) *Handler {
	return &Handler{
		service:     cfg.Service,
		health:      cfg.Health,
		internalKey: cfg.InternalKey,
		logger:      cfg.Logger,
	}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	r.GET("/health", h.healthCheck)
	r.POST("/webhook/paddle", h.handleWebhook)
	r.POST("/internal/events", h.handleInternalEvent)
}

func (h *Handler) healthCheck(c *gin.Context) {
	if !h.health.IsConnected() {
		h.logger.Error("Health check failed: RabbitMQ disconnected")
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "error", "rabbitmq": "disconnected"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "gateway"})
}

func (h *Handler) handleWebhook(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		h.logger.Error("Failed to read request body", "error", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request body too large or unreadable"})
		return
	}

	signature := c.GetHeader("Paddle-Signature")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	if err := h.service.ProcessWebhook(ctx, signature, bodyBytes); err != nil {
		h.logger.Error("Failed to process webhook", "error", err)
		if err.Error() == "invalid signature" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal Server Error"})
		return
	}

	h.logger.Info("Event queued successfully")
	c.JSON(http.StatusOK, gin.H{"status": "queued"})
}

func (h *Handler) handleInternalEvent(c *gin.Context) {
	key := c.GetHeader("X-Internal-Key")
	if key == "" || key != h.internalKey {
		h.logger.Warn("Unauthorized internal event attempt", "ip", c.ClientIP())
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		h.logger.Error("Failed to read internal event body", "error", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request body too large or unreadable"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	if err := h.service.ProcessInternalEvent(ctx, bodyBytes); err != nil {
		h.logger.Error("Failed to process internal event", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal Server Error"})
		return
	}

	h.logger.Info("Internal event queued successfully")
	c.JSON(http.StatusOK, gin.H{"status": "queued"})
}