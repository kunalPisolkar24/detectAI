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
	logger        logger.Logger
}

func NewHandler(prod queue.EventProducer, val validator.SignatureValidator, secret string, log logger.Logger) *Handler {
	return &Handler{
		producer:      prod,
		validator:     val,
		webhookSecret: secret,
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
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		h.logger.Error("Failed to read request body", "error", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot read body"})
		return
	}

	signature := c.GetHeader("Paddle-Signature")
	if !h.validator.Validate(signature, bodyBytes, h.webhookSecret) {
		h.logger.Warn("Invalid signature received", "ip", c.ClientIP())
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
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
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		h.logger.Error("Failed to read internal event body", "error", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot read body"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := h.producer.Publish(ctx, bodyBytes); err != nil {
		h.logger.Error("Failed to publish internal event", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Queue Error"})
		return
	}

	h.logger.Info("Internal event queued successfully")
	c.JSON(http.StatusOK, gin.H{"status": "queued"})
}