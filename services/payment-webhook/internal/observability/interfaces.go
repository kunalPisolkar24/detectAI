// Package observability instruments the ingress face. The seam below is the
// only thing callers see — instrument names, SDK providers, and exporters stay
// behind the adapters and the boot, per document-parser's observability LLD.
package observability

import (
	"context"
	"time"
)

// Telemetry is the app-facing seam: the one interface the handler, the router,
// and the boot share. No OTel import reaches this file.
type Telemetry interface {
	// TrackProcessing opens the application span under the otelgin route span
	// and stamps event_type/event_id on it; the returned func closes it.
	TrackProcessing(ctx context.Context, eventType, eventID string) (context.Context, func())

	// RecordBodyError is the 400/413 site — unreadable or beyond the read bound.
	RecordBodyError(reason Reason)

	// RecordInvalidSignature is the 401 site.
	RecordInvalidSignature()

	// RecordEnvelopeRejection is the 422 site; reason names the missing core field(s).
	RecordEnvelopeRejection(reason string)

	// RecordEnvelopeAdvisory covers the advisory-only oddities of a queued body.
	RecordEnvelopeAdvisory(reason AdvisoryReason)

	// RecordReceived fires for every accepted body.
	RecordReceived(eventType string)

	// RecordUnknownEventType labels received bodies with a blank event_type.
	RecordUnknownEventType()

	// RecordPublish closes the enqueue site; with the deadline verdict, status is timeout.
	RecordPublish(eventType string, status PublishStatus, duration time.Duration)

	// Shutdown drains spans, then metrics, then logs — budget-capped, guarded,
	// idempotent, never failing the process it rides on.
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

// PublishStatus partitions the publish counter and the duration histogram;
// counters sum paths without double counting.
type PublishStatus string

const (
	PublishSuccess PublishStatus = "success"
	PublishError   PublishStatus = "error"
	PublishTimeout PublishStatus = "timeout"
)
