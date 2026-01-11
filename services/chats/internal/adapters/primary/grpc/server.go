package grpc

import (
	"context"
	"net"

	pb "github.com/kunalPisolkar24/detectAI/services/chats/api/proto"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

type Server struct {
	cfg     *config.Config
	service ports.ChatService
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
		grpc.UnaryInterceptor(LoggingInterceptor),
	)

	handler := NewHandler(s.service)
	pb.RegisterChatServiceServer(grpcServer, handler)
	reflection.Register(grpcServer)

	go func() {
		<-ctx.Done()
		logger.Log.Info("Shutting down gRPC server...")
		grpcServer.GracefulStop()
	}()

	logger.Log.Info("Starting gRPC server", zap.String("port", s.cfg.GRPCPort))
	return grpcServer.Serve(listener)
}
