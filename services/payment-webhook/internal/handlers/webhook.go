package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/events"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

// NewPaddleWebhook mounts the Paddle ingress face: bounded read, signature
// verify, envelope gate, then one enqueue — every verdict recorded through
// the telemetry seam, rejections warned (NFR-8).
func NewPaddleWebhook(v *validator.Paddle, maxBody int64, publish *queue.Service, obs observability.Telemetry) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, err := validator.ReadBounded(c.Request.Body, maxBody)
		if err != nil {
			respondReadError(c, obs, err, maxBody)
			return
		}
		if v.Verify(c.GetHeader("Paddle-Signature"), body) != nil {
			obs.RecordInvalidSignature()
			slog.Warn("paddle webhook signature rejected")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		// Presence only: unknown event types and arbitrary data still queue (FR-7).
		issues := validator.CheckEnvelope(body)
		if len(issues.Missing) > 0 {
			obs.RecordEnvelopeRejection(strings.Join(issues.Missing, ","))
			slog.Warn("paddle webhook envelope rejected",
				slog.String("missing", strings.Join(issues.Missing, ",")))
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"error":   "payload rejected by the envelope check",
				"missing": issues.Missing,
			})
			return
		}
		event := events.ParseEvent(body)
		obs.RecordReceived(event.Type)
		if event.Type == events.UnknownEventType {
			obs.RecordUnknownEventType()
		}
		for _, advisory := range issues.Advisory {
			obs.RecordEnvelopeAdvisory(observability.AdvisoryReason(advisory))
		}
		ctx, end := obs.TrackProcessing(c.Request.Context(), event.Type, event.ID)
		defer end()
		start := time.Now()
		publishErr := publish.Publish(ctx, body)
		obs.RecordPublish(event.Type, publishStatus(publishErr), time.Since(start))
		publishResponse(c, publish, publishErr)
	}
}

// publishStatus partitions the publish outcome; the deadline alone is the
// timeout verdict, never double counted as an error.
func publishStatus(err error) observability.PublishStatus {
	switch {
	case err == nil:
		return observability.PublishSuccess
	case errors.Is(err, queue.ErrDeadlineExceeded):
		return observability.PublishTimeout
	default:
		return observability.PublishError
	}
}
