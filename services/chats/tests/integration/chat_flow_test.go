//go:build integration

package integration

import (
	"context"
	"net"
	"testing"
	"time"

	pb "github.com/kunalPisolkar24/detectAI/services/chats/api/proto"
	mongorepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/mongo"
	redisrepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/redis"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/usecase"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	grpchandler "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/grpc"
	"google.golang.org/grpc/metadata"
)

type noopMetrics struct{}
func (n *noopMetrics) IncCacheHit()                     {}
func (n *noopMetrics) IncCacheMiss()                    {}
func (n *noopMetrics) AddIngestedMessages(_ float64)    {}
func (n *noopMetrics) SetStreamLag(_ string, _ float64) {}
func (n *noopMetrics) IncDLQMessages(_ float64)         {}
func (n *noopMetrics) IncStreamErrors(_ string)         {}
func (n *noopMetrics) IncDatabaseErrors(_ string)       {}

func startTestServer(t *testing.T) (pb.ChatServiceClient, context.CancelFunc) {
	t.Helper()

	mongoFix := testutil.NewMongoFixture(t, "chat_e2e_test")
	redisFix := testutil.NewRedisFixture(t)

	ctx := context.Background()
	require.NoError(t, mongorepo.EnsureIndexes(ctx, mongoFix.DB))

	persistence := mongorepo.NewMongoRepository(mongoFix.DB)
	cache := redisrepo.NewCacheRepository(redisFix.Client, 24*time.Hour)
	stream := redisrepo.NewStreamRepository(redisFix.Client, 1)
	logger := zap.NewNop()
	metrics := &noopMetrics{}

	svc := usecase.NewChatService(cache, stream, persistence, logger, metrics)
	handler := grpchandler.NewHandler(svc)

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	grpcServer := grpc.NewServer()
	pb.RegisterChatServiceServer(grpcServer, handler)

	serverCtx, cancel := context.WithCancel(context.Background())
	go func() {
		if err := grpcServer.Serve(lis); err != nil && serverCtx.Err() == nil {
			t.Logf("gRPC server stopped: %v", err)
		}
	}()

	t.Cleanup(func() {
		cancel()
		grpcServer.GracefulStop()
	})

	conn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })

	return pb.NewChatServiceClient(conn), cancel
}

func TestE2E_CreateSession_SaveMessage_GetHistory(t *testing.T) {
	client, _ := startTestServer(t)
	ctx := context.Background()

	// Step 1: Create a chat session
	createResp, err := client.CreateChat(ctx, &pb.CreateChatRequest{
		UserId: "user-e2e-1",
		Title:  "E2E Test Chat",
	})
	require.NoError(t, err)
	require.NotEmpty(t, createResp.ChatId)
	chatID := createResp.ChatId

	// Step 2: Save messages
	msgs := []struct{ content string }{{"Hello"}, {"World"}, {"gRPC E2E"}}
	for _, m := range msgs {
		_, err = client.SaveMessage(ctx, &pb.SaveMessageRequest{
			ChatId:  chatID,
			UserId:  "user-e2e-1",
			Role:    "user",
			Content: m.content,
		})
		require.NoError(t, err)
	}

	// Step 3: Get history with user ID in metadata (ownership check)
	md := metadata.Pairs("x-user-id", "user-e2e-1")
	ctxWithMeta := metadata.NewOutgoingContext(ctx, md)

	histResp, err := client.GetChatHistory(ctxWithMeta, &pb.GetChatHistoryRequest{
		ChatId:   chatID,
		Page:     1,
		PageSize: 10,
	})
	require.NoError(t, err)
	assert.Len(t, histResp.Messages, 3)
}

func TestE2E_GetHistory_Unauthorized(t *testing.T) {
	client, _ := startTestServer(t)
	ctx := context.Background()

	createResp, err := client.CreateChat(ctx, &pb.CreateChatRequest{
		UserId: "owner-user",
		Title:  "Private Chat",
	})
	require.NoError(t, err)

	// Attempt access with a different user ID
	md := metadata.Pairs("x-user-id", "attacker-user")
	ctxWithMeta := metadata.NewOutgoingContext(ctx, md)

	_, err = client.GetChatHistory(ctxWithMeta, &pb.GetChatHistoryRequest{
		ChatId:   createResp.ChatId,
		Page:     1,
		PageSize: 10,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "PermissionDenied")
}

func TestE2E_GetUserChats_ReturnsSessions(t *testing.T) {
	client, _ := startTestServer(t)
	ctx := context.Background()

	userID := "user-multi-session"
	for i := 0; i < 3; i++ {
		_, err := client.CreateChat(ctx, &pb.CreateChatRequest{UserId: userID, Title: "Chat"})
		require.NoError(t, err)
	}

	resp, err := client.GetUserChats(ctx, &pb.GetUserChatsRequest{UserId: userID})
	require.NoError(t, err)
	assert.Len(t, resp.Chats, 3)
}

func TestE2E_RenameAndDeleteChat(t *testing.T) {
	client, _ := startTestServer(t)
	ctx := context.Background()

	userID := "user-rename-delete"
	createResp, err := client.CreateChat(ctx, &pb.CreateChatRequest{UserId: userID, Title: "Original"})
	require.NoError(t, err)
	chatID := createResp.ChatId

	md := metadata.Pairs("x-user-id", userID)
	ctxWithMeta := metadata.NewOutgoingContext(ctx, md)

	renameResp, err := client.RenameChat(ctxWithMeta, &pb.RenameChatRequest{ChatId: chatID, NewTitle: "Renamed"})
	require.NoError(t, err)
	assert.True(t, renameResp.Success)

	deleteResp, err := client.DeleteChat(ctxWithMeta, &pb.DeleteChatRequest{ChatId: chatID})
	require.NoError(t, err)
	assert.True(t, deleteResp.Success)
}
