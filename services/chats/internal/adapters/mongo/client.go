package mongo

import (
	"context"
	"strings"
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

	models := []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: "chat_id", Value: 1},
				{Key: "bucket_index", Value: -1},
			},
			Options: options.Index().SetName("idx_chat_history_lookup"),
		},
		{
			Keys: bson.D{
				{Key: "chat_id", Value: 1},
				{Key: "messages._id", Value: 1},
			},
			Options: options.Index().SetName("idx_chat_message_id"),
		},
		{
			Keys: bson.D{
				{Key: "chat_id", Value: 1},
				{Key: "count", Value: 1},
				{Key: "end_date", Value: 1},
			},
			Options: options.Index().SetName("idx_bucket_capacity"),
		},
	}

	if _, err := db.Collection("messages").Indexes().CreateMany(ctx, models); err != nil {
		return err
	}

	return nil
}

// EnsureSharding enables sharding for the messages collection when MongoMode=sharded.
func EnsureSharding(ctx context.Context, client *mongo.Client, dbName, mongoMode string) error {
	if strings.ToLower(strings.TrimSpace(mongoMode)) != "sharded" {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	adminDB := client.Database("admin")

	enableRes := adminDB.RunCommand(ctx, bson.D{
		{Key: "enableSharding", Value: dbName},
	})
	if err := enableRes.Err(); err != nil {
		if !isShardingAlreadyDone(err) && !isNotShardedCapable(err) {
			return err
		}
		if isNotShardedCapable(err) {
			return nil
		}
	}

	shardRes := adminDB.RunCommand(ctx, bson.D{
		{Key: "shardCollection", Value: dbName + ".messages"},
		{Key: "key", Value: bson.D{{Key: "chat_id", Value: "hashed"}}},
	})
	if err := shardRes.Err(); err != nil {
		if isShardingAlreadyDone(err) {
			return nil
		}
		if isNotShardedCapable(err) {
			return nil
		}
		return err
	}
	return nil
}

func isShardingAlreadyDone(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "already") ||
		strings.Contains(msg, "alreadyinitialized") ||
		strings.Contains(msg, "code 23") ||
		strings.Contains(msg, "code 20") || // NamespaceAlreadySharded on mongos
		strings.Contains(msg, "shardcollectioninprogress") ||
		strings.Contains(msg, "operation in progress")
}

func isNotShardedCapable(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "command not found") ||
		strings.Contains(msg, "no such command") ||
		strings.Contains(msg, "not supported") ||
		strings.Contains(msg, "illegal operation")
}
