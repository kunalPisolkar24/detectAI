package grpc

import (
	"context"
	"time"

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

	logger.Log.Info("gRPC Request",
		zap.String("method", info.FullMethod),
		zap.String("code", code.String()),
		zap.Duration("duration", duration),
		zap.Error(err),
	)

	return resp, err
}