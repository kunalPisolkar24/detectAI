package mongo

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
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
				"_id":          msg.ID,
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
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.D{{Key: "chat_id", Value: chatID}}}},
		{{Key: "$sort", Value: bson.D{{Key: "bucket_index", Value: -1}}}},
		{{Key: "$unwind", Value: "$messages"}},
		{{Key: "$sort", Value: bson.D{{Key: "messages.created_at", Value: -1}}}},
		{{Key: "$skip", Value: offset}},
		{{Key: "$limit", Value: limit}},
		{{Key: "$replaceRoot", Value: bson.D{{Key: "newRoot", Value: "$messages"}}}},
	}

	cursor, err := r.messageColl.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var messages []*domain.Message
	if err := cursor.All(ctx, &messages); err != nil {
		return nil, err
	}

	return messages, nil
}
