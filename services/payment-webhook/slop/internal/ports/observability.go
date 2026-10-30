package ports

type MetricsRecorder interface {
	RecordPublish(eventType, status string)
	RecordInvalidSignature()
	RecordWebhookReceived(eventType string)
	RecordWebhookUnknownEventType()
	RecordInternalEventUnauthorized()
	RecordWebhookBodyError(reason string)
	RecordSignatureValidationDuration(seconds float64)
	SetRabbitMQStatus(connected bool)
	RecordRabbitMQPublishDuration(duration float64)
	RecordRabbitMQReconnection()
}

type Logger interface {
	Info(msg string, args ...any)
	Error(msg string, args ...any)
	Warn(msg string, args ...any)
}
