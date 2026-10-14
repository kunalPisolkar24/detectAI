package grpc

import (
	"context"
	"strings"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/metrics"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	grpc_codes "google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var tracer = otel.Tracer("chats/grpc")

// healthCheckMethod is served by the embedded gRPC health server on the same
// port. It is excluded from spans, metrics and error logs so health probing
// never pollutes loadtest dashboards.
const healthCheckMethod = "/grpc.health.v1.Health/Check"

func shortMethod(full string) string {
	if i := strings.LastIndex(full, "/"); i >= 0 && i+1 < len(full) {
		return full[i+1:]
	}
	return full
}

func splitService(full string) string {
	trimmed := strings.TrimPrefix(full, "/")
	if i := strings.Index(trimmed, "/"); i > 0 {
		return trimmed[:i]
	}
	return trimmed
}

func RecoveryInterceptor(
	ctx context.Context,
	req interface{},
	info *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (resp interface{}, err error) {
	defer func() {
		if r := recover(); r != nil {
			logger.Log.Error("gRPC panic recovered",
				zap.Any("panic", r),
				zap.String("method", info.FullMethod),
			)
			err = status.Error(grpc_codes.Internal, "Internal server error")
		}
	}()

	return handler(ctx, req)
}

func LoggingInterceptor(
	ctx context.Context,
	req interface{},
	info *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (interface{}, error) {
	if info.FullMethod == healthCheckMethod {
		return handler(ctx, req)
	}
	start := time.Now()
	method := shortMethod(info.FullMethod)

	ctx, span := tracer.Start(ctx, info.FullMethod,
		oteltrace.WithSpanKind(oteltrace.SpanKindServer),
		oteltrace.WithAttributes(
			attribute.String("rpc.system", "grpc"),
			attribute.String("rpc.service", splitService(info.FullMethod)),
			attribute.String("rpc.method", method),
		),
	)
	defer span.End()

	resp, err := handler(ctx, req)

	duration := time.Since(start)
	code := status.Code(err)
	statusStr := code.String()

	metrics.RequestLatency.WithLabelValues(info.FullMethod, statusStr).Observe(duration.Seconds())
	metrics.GRPCRequests.WithLabelValues(method, statusStr).Inc()

	logFields := append([]zap.Field{
		zap.String("method", info.FullMethod),
		zap.String("code", statusStr),
		zap.Duration("duration", duration),
	}, observability.TraceFields(ctx)...)

	if err != nil {
		metrics.GRPCErrors.WithLabelValues(method, statusStr).Inc()
		span.RecordError(err)
		span.SetStatus(codes.Error, statusStr)
		if code == grpc_codes.InvalidArgument || code == grpc_codes.NotFound || code == grpc_codes.PermissionDenied || code == grpc_codes.Unauthenticated {
			logger.Log.Warn("gRPC request client error",
				append(logFields, zap.Error(err))...,
			)
		} else {
			logger.Log.Error("gRPC request failed",
				append(logFields, zap.Error(err))...,
			)
		}
	} else {
		if duration > domain.SlowRequestThreshold {
			logger.Log.Info("gRPC slow request", logFields...)
		} else if ce := logger.Log.Check(zap.DebugLevel, "gRPC request"); ce != nil {
			ce.Write(logFields...)
		}
	}

	return resp, err
}
