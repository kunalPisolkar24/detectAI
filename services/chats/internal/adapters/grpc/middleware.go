package grpc

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/metrics"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

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
			err = status.Error(codes.Internal, "Internal server error")
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
	start := time.Now()

	resp, err := handler(ctx, req)

	duration := time.Since(start)
	code := status.Code(err)

	metrics.RequestLatency.WithLabelValues(info.FullMethod, code.String()).Observe(duration.Seconds())

	if err != nil {
		if code == codes.InvalidArgument || code == codes.NotFound || code == codes.PermissionDenied || code == codes.Unauthenticated {
			logger.Log.Warn("gRPC request client error",
				zap.String("method", info.FullMethod),
				zap.String("code", code.String()),
				zap.Duration("duration", duration),
				zap.Error(err),
			)
		} else {
			logger.Log.Error("gRPC request failed",
				zap.String("method", info.FullMethod),
				zap.String("code", code.String()),
				zap.Duration("duration", duration),
				zap.Error(err),
			)
		}
	} else {
		if duration > domain.SlowRequestThreshold {
			logger.Log.Info("gRPC slow request",
				zap.String("method", info.FullMethod),
				zap.Duration("duration", duration),
			)
		} else if ce := logger.Log.Check(zap.DebugLevel, "gRPC request"); ce != nil {
			ce.Write(
				zap.String("method", info.FullMethod),
				zap.String("code", code.String()),
				zap.Duration("duration", duration),
			)
		}
	}

	return resp, err
}
