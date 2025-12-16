package server

import (
	"context"
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
}

func NewHandler(prod queue.EventProducer, val validator.SignatureValidator, secret string) *Handler {
	return &Handler{
		producer:      prod,
		validator:     val,
		webhookSecret: secret,
	}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	r.GET("/health", h.healthCheck)
	r.POST("/webhook/paddle", h.handleWebhook)
}

func (h *Handler) healthCheck(c *gin.Context) {
	if !h.producer.IsConnected() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "error", "rabbitmq": "disconnected"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "gateway"})
}

func (h *Handler) handleWebhook(c *gin.Context) {
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot read body"})
		return
	}

	signature := c.GetHeader("Paddle-Signature")
	if !h.validator.Validate(signature, bodyBytes, h.webhookSecret) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := h.producer.Publish(ctx, bodyBytes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Queue Error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "queued"})
}