package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/metrics"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("chats/redis")

func startSpan(ctx context.Context, name, operation string) (context.Context, oteltrace.Span, time.Time) {
	ctx, span := tracer.Start(ctx, name,
		oteltrace.WithSpanKind(oteltrace.SpanKindClient),
		oteltrace.WithAttributes(
			attribute.String("db.system", "redis"),
			attribute.String("db.operation", operation),
		),
	)
	return ctx, span, time.Now().UTC()
}

func finishSpan(span oteltrace.Span, operation string, start time.Time, err error) {
	metrics.RedisOpDuration.WithLabelValues(operation).Observe(time.Since(start).Seconds())
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	span.End()
}

type StreamRepository struct {
	client     *redis.Client
	partitions int
}

func NewStreamRepository(client *redis.Client, partitions int) *StreamRepository {
	if partitions <= 0 {
		partitions = 1
	}
	if partitions > 128 {
		partitions = 128
	}
	return &StreamRepository{
		client:     client,
		partitions: partitions,
	}
}

func (r *StreamRepository) Publish(ctx context.Context, msg *domain.Message) error {
	if msg == nil {
		return fmt.Errorf("nil message")
	}
	if msg.ChatID == "" {
		return fmt.Errorf("chat_id is required")
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	partition := crc32.ChecksumIEEE([]byte(msg.ChatID)) % uint32(r.partitions)
	streamKey := fmt.Sprintf("global:ingest:{%d}", partition)

	ctx, span, start := startSpan(ctx, "redis.publish", "publish")
	span.SetAttributes(attribute.String("stream", streamKey))
	err = r.client.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		MaxLen: domain.StreamMaxLen,
		Approx: domain.StreamApproxTrim,
		Values: map[string]interface{}{
			"data": data,
		},
	}).Err()
	finishSpan(span, "publish", start, err)
	return err
}
