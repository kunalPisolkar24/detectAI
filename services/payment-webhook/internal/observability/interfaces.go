// Package observability instruments the ingress face.
package observability

import (
	"context"
	"time"
)

// Telemetry is the app-facing seam; no OTel import reaches it.
type Telemetry interface {
	TrackProcessing(ctx context.Context, eventType, eventID string) (context.Context, func())

	RecordBodyError(reason Reason)

	RecordInvalidSignature()

	RecordEnvelopeRejection(reason string)

	RecordEnvelopeAdvisory(reason AdvisoryReason)

	RecordReceived(eventType string)

	RecordUnknownEventType()

	RecordPublish(eventType string, status PublishStatus, duration time.Duration)

	// Shutdown drains spans, metrics, and logs; export leftovers never fail the process.
	Shutdown(ctx context.Context) error
}

// Reason is the payment_webhook_body_errors_total attribution vocabulary.
type Reason string

const (
	ReasonUnreadable Reason = "unreadable"
	ReasonTooLarge   Reason = "too_large"
)

// AdvisoryReason is the payment_webhook_envelope_advisories_total vocabulary.
type AdvisoryReason string

const (
	AdvisoryNotificationID AdvisoryReason = "notification_id"
	AdvisoryAddressableID  AdvisoryReason = "addressable_id"
)

// PublishStatus partitions the publish counter and the duration histogram.
type PublishStatus string

const (
	PublishSuccess PublishStatus = "success"
	PublishError   PublishStatus = "error"
	PublishTimeout PublishStatus = "timeout"
)
