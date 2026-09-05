package mongo

import (
	"context"
	"errors"
	"sort"
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
		limit = 50
	}
	if limit > 100 {
		limit = 100
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

		// Try to update existing message in place (idempotent)
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

		// Insert into a bucket that still has capacity and is recent.
		// bucket_index is tied to the message time to keep ordering deterministic.
		bucketTime := msg.CreatedAt
		if bucketTime.After(now) {
			bucketTime = now
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
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	// Need enough buckets to cover offset+limit messages (each bucket holds <=50).
	// Add 2 extra buckets for fragmentation / boundary.
	needed := offset + limit
	bucketLimit := (needed / 50) + 2
	// Cap to avoid unbounded memory on absurd offsets (which usecase already guards).
	if bucketLimit > 500 {
		bucketLimit = 500
	}
	if bucketLimit < 1 {
		bucketLimit = 1
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

	// Buckets are sorted by bucket_index desc. Messages inside each bucket are in insertion order.
	// We collect all then sort globally to guarantee stable descending order regardless of bucket boundaries.
	var allMessages []*domain.Message
	allMessages = make([]*domain.Message, 0, len(buckets)*50)
	for _, bucket := range buckets {
		for i := range bucket.Messages {
			// Copy to avoid aliasing loop variable
			msgCopy := bucket.Messages[i]
			allMessages = append(allMessages, &msgCopy)
		}
	}

	// Global sort descending (newest first), tie-break by ID for determinism
	sort.Slice(allMessages, func(i, j int) bool {
		if allMessages[i].CreatedAt.Equal(allMessages[j].CreatedAt) {
			return allMessages[i].ID > allMessages[j].ID
		}
		return allMessages[i].CreatedAt.After(allMessages[j].CreatedAt)
	})

	if offset >= len(allMessages) {
		return []*domain.Message{}, nil
	}

	end := offset + limit
	if end > len(allMessages) {
		end = len(allMessages)
	}

	return allMessages[offset:end], nil
}
