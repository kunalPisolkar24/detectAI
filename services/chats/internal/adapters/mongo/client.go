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
// In standalone mode it is a no-op. Queries are mode-agnostic: all messages operations
// already filter on chat_id (the shard key), and chats remains intentionally unsharded
// (small metadata per chat, see decision in docs/sharding.md).
func EnsureSharding(ctx context.Context, client *mongo.Client, dbName, mongoMode string) error {
	if strings.ToLower(strings.TrimSpace(mongoMode)) != "sharded" {
		return nil
	}
	// Bounded so boot does not hang forever against mongos/docdb elastic.
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	adminDB := client.Database("admin")

	// Enable sharding on DB (idempotent; code 23 AlreadyInitialized or 13 Unauthorized on standalone mongo is ok)
	enableRes := adminDB.RunCommand(ctx, bson.D{
		{Key: "enableSharding", Value: dbName},
	})
	if err := enableRes.Err(); err != nil {
		if !isShardingAlreadyDone(err) && !isNotShardedCapable(err) {
			return err
		}
		// Standalone mongod returns CommandNotFound / illegal operation -> treat as soft skip.
		if isNotShardedCapable(err) {
			return nil
		}
	}

	// Shard only messages on chat_id hashed. Leave chats unsharded.
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
