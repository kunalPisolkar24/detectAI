package grpc

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/status"
)

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

	logger.Log.Info("gRPC Request",
		zap.String("method", info.FullMethod),
		zap.String("code", code.String()),
		zap.Duration("duration", duration),
		zap.Error(err),
	)

	return resp, err
}
