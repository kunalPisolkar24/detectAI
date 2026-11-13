package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
)

// CreateChat inserts the chat shell; the service derives the title and saves the first message.
func (r *Mongo) CreateChat(ctx context.Context, ownerID, title string) (models.Chat, error) {
	start := time.Now()
	chat, err := r.createChat(ctx, ownerID, title)
	r.record(observability.DatastoreOperationCreateChat, err, start)
	return chat, err
}

func (r *Mongo) createChat(ctx context.Context, ownerID, title string) (models.Chat, error) {
	now := stamp(time.Now())
	chat := models.Chat{
		ID:        uuid.NewString(),
		UserID:    ownerID,
		Title:     title,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if _, err := r.chats.InsertOne(ctx, chat); err != nil {
		return models.Chat{}, wrap("create chat", err)
	}
	return chat, nil
}

// Chat returns the chat meta; a missing or unowned chat is models.ErrNotFound.
func (r *Mongo) Chat(ctx context.Context, ownerID, chatID string) (models.Chat, error) {
	start := time.Now()
	chat, err := r.chat(ctx, ownerID, chatID)
	r.record(observability.DatastoreOperationChat, err, start)
	return chat, err
}

func (r *Mongo) chat(ctx context.Context, ownerID, chatID string) (models.Chat, error) {
	var chat models.Chat
	err := r.chats.FindOne(ctx, bson.M{"_id": chatID, "user_id": ownerID}).Decode(&chat)
	if errors.Is(err, driver.ErrNoDocuments) {
		return models.Chat{}, models.ErrNotFound
	}
	if err != nil {
		return models.Chat{}, wrap("chat", err)
	}
	return chat, nil
}

// Chats lists the owner's chats newest-first.
func (r *Mongo) Chats(ctx context.Context, ownerID string, limit int) ([]models.ChatSummary, error) {
	start := time.Now()
	chats, err := r.listChats(ctx, ownerID, limit)
	r.record(observability.DatastoreOperationChats, err, start)
	return chats, err
}

func (r *Mongo) listChats(ctx context.Context, ownerID string, limit int) ([]models.ChatSummary, error) {
	limit = models.ClampChatsLimit(limit)

	find, err := r.chats.Find(ctx, bson.M{"user_id": ownerID}, options.Find().
		SetSort(bson.D{{Key: "updated_at", Value: -1}}).
		SetLimit(int64(limit)))
	if err != nil {
		return nil, wrap("chats", err)
	}
	defer find.Close(ctx)

	summaries := make([]models.ChatSummary, 0, limit)
	if err := find.All(ctx, &summaries); err != nil {
		return nil, wrap("chats", err)
	}
	return summaries, nil
}

// RenameChat changes the title and bumps updated_at.
func (r *Mongo) RenameChat(ctx context.Context, ownerID, chatID, title string) (models.ChatSummary, error) {
	start := time.Now()
	summary, err := r.renameChat(ctx, ownerID, chatID, title)
	r.record(observability.DatastoreOperationRenameChat, err, start)
	return summary, err
}

func (r *Mongo) renameChat(ctx context.Context, ownerID, chatID, title string) (models.ChatSummary, error) {
	var summary models.ChatSummary
	err := r.chats.FindOneAndUpdate(ctx,
		bson.M{"_id": chatID, "user_id": ownerID},
		bson.M{"$set": bson.M{"title": title, "updated_at": stamp(time.Now())}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&summary)
	if errors.Is(err, driver.ErrNoDocuments) {
		return models.ChatSummary{}, models.ErrNotFound
	}
	if err != nil {
		return models.ChatSummary{}, wrap("rename chat", err)
	}
	return summary, nil
}

// DeleteChat runs without a transaction.
func (r *Mongo) DeleteChat(ctx context.Context, ownerID, chatID string) error {
	start := time.Now()
	err := r.deleteChat(ctx, ownerID, chatID)
	r.record(observability.DatastoreOperationDeleteChat, err, start)
	return err
}

func (r *Mongo) deleteChat(ctx context.Context, ownerID, chatID string) error {
	res, err := r.chats.DeleteOne(ctx, bson.M{"_id": chatID, "user_id": ownerID})
	if err != nil {
		return wrap("delete chat", err)
	}
	if res.DeletedCount == 0 {
		return r.deletedChatOutcome(ctx, chatID)
	}
	if _, err := r.messages.DeleteMany(ctx, bson.M{"chat_id": chatID}); err != nil {
		return wrap("delete messages", err)
	}
	return nil
}

// deletedChatOutcome tells an already-deleted chat apart from another owner's chat:
// the first is a successful replay, the second is not the caller's chat.
func (r *Mongo) deletedChatOutcome(ctx context.Context, chatID string) error {
	var chat models.Chat
	err := r.chats.FindOne(ctx, bson.M{"_id": chatID}).Decode(&chat)
	if errors.Is(err, driver.ErrNoDocuments) {
		return nil
	}
	if err != nil {
		return wrap("delete chat", err)
	}
	return models.ErrNotFound
}

func (r *Mongo) ownChat(ctx context.Context, ownerID, chatID string) error {
	err := r.chats.FindOne(ctx, bson.M{"_id": chatID, "user_id": ownerID}).Err()
	if errors.Is(err, driver.ErrNoDocuments) {
		return models.ErrNotFound
	}
	if err != nil {
		return wrap("chat ownership", err)
	}
	return nil
}

func (r *Mongo) bumpChat(ctx context.Context, chatID string) error {
	if _, err := r.chats.UpdateOne(ctx,
		bson.M{"_id": chatID},
		bson.M{"$set": bson.M{"updated_at": stamp(time.Now())}},
	); err != nil {
		return wrap("bump chat", err)
	}
	return nil
}
