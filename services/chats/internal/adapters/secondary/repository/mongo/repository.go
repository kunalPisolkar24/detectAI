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

func (r *MongoRepository) BulkUpsertMessages(ctx context.Context, messages []*domain.Message) error {
	if len(messages) == 0 {
		return nil
	}

	models := make([]mongo.WriteModel, 0, len(messages))

	for _, msg := range messages {
		filter := bson.M{
			"chat_id": msg.ChatID,
			"count":   bson.M{"$lt": 50},
		}

		update := bson.M{
			"$push": bson.M{"messages": msg},
			"$inc":  bson.M{"count": 1},
			"$set":  bson.M{"end_date": msg.CreatedAt},
			"$setOnInsert": bson.M{
				"_id":          msg.ID, // Bucket ID
				"bucket_index": time.Now().UnixNano(),
				"start_date":   msg.CreatedAt,
			},
		}

		model := mongo.NewUpdateOneModel().
			SetFilter(filter).
			SetUpdate(update).
			SetUpsert(true)

		models = append(models, model)
	}

	_, err := r.messageColl.BulkWrite(ctx, models)
	return err
}

func (r *MongoRepository) GetHistory(ctx context.Context, chatID string, offset, limit int) ([]*domain.Message, error) {
	// Estimation: 1 bucket = 50 msgs. Fetch enough buckets to cover limit.
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