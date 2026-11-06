package observability

// The frozen instrument names: the New Relic dashboards and terraform alerts
// depend on them, so renaming is a dashboard/alert migration, not an edit
// (specification/observability.md's naming-stability contract).
const (
	InstrumentReceived           = "payment_webhooks_received_total"
	InstrumentPublished          = "payment_events_published_total"
	InstrumentInvalidSignatures  = "payment_webhook_signatures_invalid_total"
	InstrumentUnknownEventType   = "payment_webhooks_unknown_event_type_total"
	InstrumentBodyErrors         = "payment_webhook_body_errors_total"
	InstrumentEnvelopeRejections = "payment_webhook_envelope_rejections_total"
	InstrumentEnvelopeAdvisories = "payment_webhook_envelope_advisories_total"
	InstrumentEnqueueDuration    = "payment_events_enqueue_duration_seconds"
)
