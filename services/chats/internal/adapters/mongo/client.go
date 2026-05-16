package mongo

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func EnsureIndexes(ctx context.Context, db *mongo.Database) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	_, err := db.Collection("chats").Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "updated_at", Value: -1}},
		Options: options.Index().SetName("idx_user_chats_timeline"),
	})
	if err != nil {
		return err
	}

	_, err = db.Collection("messages").Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "chat_id", Value: 1},
			{Key: "bucket_index", Value: -1},
		},
		Options: options.Index().SetName("idx_chat_history_lookup"),
	})
	if err != nil {
		return err
	}

	return nil
}