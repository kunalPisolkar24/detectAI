//go:build integration

package testutil

import (
	"context"
	"testing"
	"time"

	tcmongo "github.com/testcontainers/testcontainers-go/modules/mongodb"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	goredis "github.com/redis/go-redis/v9"
)

type MongoFixture struct {
	Container *tcmongo.MongoDBContainer
	Client    *mongo.Client
	DB        *mongo.Database
}

func NewMongoFixture(t *testing.T, dbName string) *MongoFixture {
	t.Helper()
	ctx := context.Background()

	container, err := tcmongo.Run(ctx, "mongo:7")
	if err != nil {
		t.Fatalf("failed to start mongo container: %v", err)
	}

	uri, err := container.ConnectionString(ctx)
	if err != nil {
		t.Fatalf("failed to get mongo connection string: %v", err)
	}

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatalf("failed to connect to mongo: %v", err)
	}

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = client.Disconnect(ctx)
		_ = container.Terminate(ctx)
	})

	return &MongoFixture{
		Container: container,
		Client:    client,
		DB:        client.Database(dbName),
	}
}

type RedisFixture struct {
	Container *tcredis.RedisContainer
	Client    goredis.UniversalClient
}

func NewRedisFixture(t *testing.T) *RedisFixture {
	t.Helper()
	ctx := context.Background()

	container, err := tcredis.Run(ctx, "redis:7-alpine")
	if err != nil {
		t.Fatalf("failed to start redis container: %v", err)
	}

	addr, err := container.Endpoint(ctx, "")
	if err != nil {
		t.Fatalf("failed to get redis endpoint: %v", err)
	}

	client := goredis.NewClient(&goredis.Options{Addr: addr})

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = client.Close()
		_ = container.Terminate(ctx)
	})

	return &RedisFixture{
		Container: container,
		Client:    client,
	}
}
