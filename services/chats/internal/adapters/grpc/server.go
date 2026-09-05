package grpc

import (
	"context"
	"net"
	"sync"

	pb "github.com/kunalPisolkar24/detectAI/services/chats/api/proto"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
)

type Server struct {
	cfg          *config.Config
	service      ports.ChatService
	healthServer *health.Server
	mu           sync.RWMutex
}

func NewServer(cfg *config.Config, service ports.ChatService) *Server {
	return &Server{
		cfg:     cfg,
		service: service,
	}
}

func (s *Server) Run(ctx context.Context) error {
	listener, err := net.Listen("tcp", s.cfg.GRPCPort)
	if err != nil {
		return err
	}

	grpcServer := grpc.NewServer(
		grpc.ChainUnaryInterceptor(
			RecoveryInterceptor,
			LoggingInterceptor,
		),
	)

	handler := NewHandler(s.service)
	pb.RegisterChatServiceServer(grpcServer, handler)

	s.healthServer = health.NewServer()
	healthpb.RegisterHealthServer(grpcServer, s.healthServer)
	s.healthServer.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
	s.healthServer.SetServingStatus("chat.ChatService", healthpb.HealthCheckResponse_SERVING)

	// Reflection is useful for debugging but should not be enabled in production.
	// We enable only when not production to reduce attack surface.
	if s.cfg.AppEnv != "production" {
		reflection.Register(grpcServer)
	}

	go func() {
		<-ctx.Done()
		if logger.Log != nil {
			logger.Log.Info("Shutting down gRPC server...")
		}
		s.healthServer.SetServingStatus("", healthpb.HealthCheckResponse_NOT_SERVING)
		s.healthServer.SetServingStatus("chat.ChatService", healthpb.HealthCheckResponse_NOT_SERVING)
		grpcServer.GracefulStop()
	}()

	if logger.Log != nil {
		logger.Log.Info("Starting gRPC server", zap.String("port", s.cfg.GRPCPort))
	}
	return grpcServer.Serve(listener)
}

func (s *Server) SetHealth(healthy bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	status := healthpb.HealthCheckResponse_NOT_SERVING
	if healthy {
		status = healthpb.HealthCheckResponse_SERVING
	}
	if s.healthServer != nil {
		s.healthServer.SetServingStatus("", status)
		s.healthServer.SetServingStatus("chat.ChatService", status)
	}
}
