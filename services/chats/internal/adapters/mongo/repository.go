package mongo

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type MongoRepository struct {
	db          *mongo.Database
	chatColl    *mongo.Collection
	messageColl *mongo.Collection
}

func NewMongoRepository(db *mongo.Database) *MongoRepository {
	return &MongoRepository{
		db:          db,
		chatColl:    db.Collection("chats"),
		messageColl: db.Collection("messages"),
	}
}

func (r *MongoRepository) CreateChat(ctx context.Context, chat *domain.ChatSession) error {
	_, err := r.chatColl.InsertOne(ctx, chat)
	return err
}

func (r *MongoRepository) GetChat(ctx context.Context, chatID string) (*domain.ChatSession, error) {
	var chat domain.ChatSession
	err := r.chatColl.FindOne(ctx, bson.M{"_id": chatID}).Decode(&chat)
	if err != nil {
		return nil, err
	}
	return &chat, nil
}

func (r *MongoRepository) GetUserChats(ctx context.Context, userID string, limit int) ([]*domain.ChatSession, error) {
	opts := options.Find().
		SetSort(bson.D{{Key: "updated_at", Value: -1}}).
		SetLimit(int64(limit))

	cursor, err := r.chatColl.Find(ctx, bson.M{"user_id": userID}, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var chats []*domain.ChatSession
	if err := cursor.All(ctx, &chats); err != nil {
		return nil, err
	}
	return chats, nil
}

func (r *MongoRepository) UpdateChatTitle(ctx context.Context, chatID, title string) error {
	filter := bson.M{"_id": chatID}
	update := bson.M{"$set": bson.M{"title": title, "updated_at": time.Now().UTC()}}

	_, err := r.chatColl.UpdateOne(ctx, filter, update)
	return err
}

func (r *MongoRepository) DeleteChat(ctx context.Context, chatID string) error {
	_, err := r.chatColl.DeleteOne(ctx, bson.M{"_id": chatID})
	if err != nil {
		return err
	}

	_, err = r.messageColl.DeleteMany(ctx, bson.M{"chat_id": chatID})
	return err
}

func (r *MongoRepository) BulkUpsertMessages(ctx context.Context, messages []*domain.Message) error {
	if len(messages) == 0 {
		return nil
	}

	now := time.Now().UTC()

	for _, msg := range messages {
		updateExistingResult, err := r.messageColl.UpdateOne(
			ctx,
			bson.M{
				"chat_id":      msg.ChatID,
				"messages._id": msg.ID,
			},
			bson.M{
				"$set": bson.M{
					"messages.$": msg,
				},
			},
		)
		if err != nil {
			return err
		}

		if updateExistingResult.MatchedCount > 0 {
			continue
		}

		filter := bson.M{
			"chat_id": msg.ChatID,
			"count":   bson.M{"$lt": 50},
			"end_date": bson.M{
				"$gt": now.Add(-24 * time.Hour),
			},
		}

		update := bson.M{
			"$push": bson.M{"messages": msg},
			"$inc":  bson.M{"count": 1},
			"$max":  bson.M{"end_date": msg.CreatedAt},
			"$min":  bson.M{"start_date": msg.CreatedAt},
			"$setOnInsert": bson.M{
				"chat_id":      msg.ChatID,
				"bucket_index": now.UnixNano(),
			},
		}

		if _, err := r.messageColl.UpdateOne(ctx, filter, update, options.Update().SetUpsert(true)); err != nil {
			return err
		}
	}

	return nil
}

func (r *MongoRepository) GetHistory(ctx context.Context, chatID string, offset, limit int) ([]*domain.Message, error) {
	bucketLimit := (limit / 50) + 2

	findOpts := options.Find().
		SetSort(bson.D{{Key: "bucket_index", Value: -1}}).
		SetLimit(int64(bucketLimit))

	cursor, err := r.messageColl.Find(ctx, bson.M{"chat_id": chatID}, findOpts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var buckets []domain.MessageBucket
	if err := cursor.All(ctx, &buckets); err != nil {
		return nil, err
	}

	var allMessages []*domain.Message
	for _, bucket := range buckets {
		for i := len(bucket.Messages) - 1; i >= 0; i-- {
			msg := bucket.Messages[i]
			allMessages = append(allMessages, &msg)
		}
	}

	if offset >= len(allMessages) {
		return []*domain.Message{}, nil
	}

	end := offset + limit
	if end > len(allMessages) {
		end = len(allMessages)
	}

	return allMessages[offset:end], nil
}
