package server

import (
	"context"
	"gateway/internal/logger"
	"gateway/internal/queue"
	"gateway/internal/validator"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	producer      queue.EventProducer
	validator     validator.SignatureValidator
	webhookSecret string
	internalKey   string
	logger        logger.Logger
}

func NewHandler(prod queue.EventProducer, val validator.SignatureValidator, secret string, internalKey string, log logger.Logger) *Handler {
	return &Handler{
		producer:      prod,
		validator:     val,
		webhookSecret: secret,
		internalKey:   internalKey,
		logger:        log,
	}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	r.GET("/health", h.healthCheck)
	r.POST("/webhook/paddle", h.handleWebhook)
	r.POST("/internal/events", h.handleInternalEvent)
}

func (h *Handler) healthCheck(c *gin.Context) {
	if !h.producer.IsConnected() {
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
	if !h.validator.Validate(signature, bodyBytes, h.webhookSecret) {
		h.logger.Warn("Invalid signature received", "ip", c.ClientIP())
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	if err := h.producer.Publish(ctx, bodyBytes); err != nil {
		h.logger.Error("Failed to publish event", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Queue Error"})
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

	if err := h.producer.Publish(ctx, bodyBytes); err != nil {
		h.logger.Error("Failed to publish internal event", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Queue Error"})
		return
	}

	h.logger.Info("Internal event queued successfully")
	c.JSON(http.StatusOK, gin.H{"status": "queued"})
}