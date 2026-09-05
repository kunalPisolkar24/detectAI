package mongo

import (
	"context"
	"errors"
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
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &chat, nil
}

func (r *MongoRepository) GetUserChats(ctx context.Context, userID string, limit int) ([]*domain.ChatSession, error) {
	if limit <= 0 {
		limit = domain.DefaultUserChatsLimit
	}
	if limit > domain.MaxUserChatsLimit {
		limit = domain.MaxUserChatsLimit
	}
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
	if chats == nil {
		return []*domain.ChatSession{}, nil
	}
	return chats, nil
}

func (r *MongoRepository) UpdateChatTitle(ctx context.Context, chatID, title string) error {
	filter := bson.M{"_id": chatID}
	update := bson.M{"$set": bson.M{"title": title, "updated_at": time.Now().UTC()}}

	res, err := r.chatColl.UpdateOne(ctx, filter, update)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *MongoRepository) DeleteChat(ctx context.Context, chatID string) error {
	res, err := r.chatColl.DeleteOne(ctx, bson.M{"_id": chatID})
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		return domain.ErrNotFound
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
		if msg == nil || msg.ID == "" || msg.ChatID == "" {
			continue
		}
		if msg.CreatedAt.IsZero() {
			msg.CreatedAt = now
		}

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

		bucketTime := msg.CreatedAt
		if bucketTime.After(now) {
			bucketTime = now
		}
		filter := bson.M{
			"chat_id": msg.ChatID,
			"count":   bson.M{"$lt": domain.BucketCapacity},
			"end_date": bson.M{
				"$gt": now.Add(-domain.BucketWindow),
			},
		}

		update := bson.M{
			"$push": bson.M{"messages": msg},
			"$inc":  bson.M{"count": 1},
			"$max":  bson.M{"end_date": msg.CreatedAt},
			"$min":  bson.M{"start_date": msg.CreatedAt},
			"$setOnInsert": bson.M{
				"chat_id":      msg.ChatID,
				"bucket_index": bucketTime.UnixNano(),
			},
		}

		if _, err := r.messageColl.UpdateOne(ctx, filter, update, options.Update().SetUpsert(true)); err != nil {
			return err
		}
	}

	return nil
}

func (r *MongoRepository) GetHistory(ctx context.Context, chatID string, offset, limit int) ([]*domain.Message, error) {
	if limit <= 0 {
		limit = domain.DefaultPageSize
	}
	if limit > domain.MaxPageSize {
		limit = domain.MaxPageSize
	}
	if offset < 0 {
		offset = 0
	}
	needed := offset + limit
	bucketLimit := (needed / domain.BucketCapacity) + 2
	if bucketLimit > domain.MaxBucketsFetch {
		bucketLimit = domain.MaxBucketsFetch
	}

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

	allMessages := make([]*domain.Message, 0, len(buckets)*domain.BucketCapacity)
	for _, bucket := range buckets {
		for i := range bucket.Messages {
			msgCopy := bucket.Messages[i]
			allMessages = append(allMessages, &msgCopy)
		}
	}

	domain.SortMessagesDesc(allMessages)

	if offset >= len(allMessages) {
		return []*domain.Message{}, nil
	}

	end := offset + limit
	if end > len(allMessages) {
		end = len(allMessages)
	}

	return allMessages[offset:end], nil
}
