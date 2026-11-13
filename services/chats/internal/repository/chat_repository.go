package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/store"
)

// CreateChat inserts the chat shell with a server-generated id.
func (r *Repository) CreateChat(ctx context.Context, ownerID, title string) (store.Chat, error) {
	now := stamp(time.Now())
	chat := store.Chat{
		ID:        uuid.NewString(),
		UserID:    ownerID,
		Title:     title,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if _, err := r.chats.InsertOne(ctx, chat); err != nil {
		return store.Chat{}, fmt.Errorf("repository: create chat: %w", err)
	}
	return chat, nil
}

// Chat returns the owner-scoped chat meta.
func (r *Repository) Chat(ctx context.Context, ownerID, chatID string) (store.Chat, error) {
	var chat store.Chat
	err := r.chats.FindOne(ctx, bson.M{"_id": chatID, "user_id": ownerID}).Decode(&chat)
	if errors.Is(err, driver.ErrNoDocuments) {
		return store.Chat{}, store.ErrNotFound
	}
	if err != nil {
		return store.Chat{}, fmt.Errorf("repository: chat: %w", err)
	}
	return chat, nil
}

// Chats lists the owner's chats newest-first by updated_at.
func (r *Repository) Chats(ctx context.Context, ownerID string, limit int) ([]store.ChatSummary, error) {
	limit = store.ClampChatsLimit(limit)

	find, err := r.chats.Find(ctx, bson.M{"user_id": ownerID}, options.Find().
		SetSort(bson.D{{Key: "updated_at", Value: -1}}).
		SetLimit(int64(limit)))
	if err != nil {
		return nil, fmt.Errorf("repository: chats: %w", err)
	}
	defer find.Close(ctx)

	summaries := make([]store.ChatSummary, 0, limit)
	if err := find.All(ctx, &summaries); err != nil {
		return nil, fmt.Errorf("repository: chats: %w", err)
	}
	return summaries, nil
}

// RenameChat sets the title and bumps updated_at, returning the summary.
func (r *Repository) RenameChat(ctx context.Context, ownerID, chatID, title string) (store.ChatSummary, error) {
	var summary store.ChatSummary
	err := r.chats.FindOneAndUpdate(ctx,
		bson.M{"_id": chatID, "user_id": ownerID},
		bson.M{"$set": bson.M{"title": title, "updated_at": stamp(time.Now())}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&summary)
	if errors.Is(err, driver.ErrNoDocuments) {
		return store.ChatSummary{}, store.ErrNotFound
	}
	if err != nil {
		return store.ChatSummary{}, fmt.Errorf("repository: rename chat: %w", err)
	}
	return summary, nil
}

// DeleteChat deletes the chat then its messages without a transaction.
func (r *Repository) DeleteChat(ctx context.Context, ownerID, chatID string) error {
	res, err := r.chats.DeleteOne(ctx, bson.M{"_id": chatID, "user_id": ownerID})
	if err != nil {
		return fmt.Errorf("repository: delete chat: %w", err)
	}
	if res.DeletedCount == 0 {
		return r.deletedChatOutcome(ctx, chatID)
	}
	if _, err := r.messages.DeleteMany(ctx, bson.M{"chat_id": chatID}); err != nil {
		return fmt.Errorf("repository: delete messages: %w", err)
	}
	return nil
}

// deletedChatOutcome tells an already-deleted chat apart from another owner's chat:
// the first is a successful replay, the second is not the caller's chat.
func (r *Repository) deletedChatOutcome(ctx context.Context, chatID string) error {
	var chat store.Chat
	err := r.chats.FindOne(ctx, bson.M{"_id": chatID}).Decode(&chat)
	if errors.Is(err, driver.ErrNoDocuments) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("repository: delete chat: %w", err)
	}
	return store.ErrNotFound
}

// ownChat reports whether the chat exists under the caller's identity.
func (r *Repository) ownChat(ctx context.Context, ownerID, chatID string) error {
	err := r.chats.FindOne(ctx, bson.M{"_id": chatID, "user_id": ownerID}).Err()
	if errors.Is(err, driver.ErrNoDocuments) {
		return store.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("repository: chat ownership: %w", err)
	}
	return nil
}

// bumpChat moves the sidebar order key forward after a message write.
func (r *Repository) bumpChat(ctx context.Context, chatID string) error {
	if _, err := r.chats.UpdateOne(ctx,
		bson.M{"_id": chatID},
		bson.M{"$set": bson.M{"updated_at": stamp(time.Now())}},
	); err != nil {
		return fmt.Errorf("repository: bump chat: %w", err)
	}
	return nil
}
