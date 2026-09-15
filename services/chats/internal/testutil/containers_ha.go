//go:build ha

package testutil

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	goredis "github.com/redis/go-redis/v9"
)

// MongoRSFixture is a single-node replica set (same mongo:7 image, different flags).
// It exercises the sharded/DocumentDB driver path (replicaSet, retryWrites=false, larger selection timeout)
// at ~1 container cost. Full mongos+configsvr+shards is deferred to Floci nightly.
type MongoRSFixture struct {
	Container testcontainers.Container
	Client    *mongo.Client
	DB        *mongo.Database
	URI       string // replicaSet-aware URI for database.ConnectMongo
}

// NewMongoRSFixture starts mongo:7 as a single-node RS `rs0` and waits for PRIMARY.
func NewMongoRSFixture(t *testing.T, dbName string) *MongoRSFixture {
	t.Helper()
	ctx := context.Background()

	req := testcontainers.ContainerRequest{
		Image:        "mongo:7",
		ExposedPorts: []string{"27017/tcp"},
		Cmd:          []string{"mongod", "--replSet", "rs0", "--bind_ip_all"},
		WaitingFor:   wait.ForLog("Waiting for connections").WithStartupTimeout(60 * time.Second),
	}
	ctr, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		t.Fatalf("failed to start mongo RS container: %v", err)
	}

	host, err := ctr.Host(ctx)
	if err != nil {
		t.Fatalf("failed to get mongo RS host: %v", err)
	}
	mappedPort, err := ctr.MappedPort(ctx, "27017")
	if err != nil {
		t.Fatalf("failed to get mongo RS port: %v", err)
	}

	// Initiate single-node RS. Retry briefly as mongod may not be fully ready after log.
	var initErr error
	for i := 0; i < 10; i++ {
		_, _, initErr = ctr.Exec(ctx, []string{
			"mongosh", "--quiet", "--eval",
			`try{rs.initiate({_id:"rs0",members:[{_id:0,host:"` + host + `:` + mappedPort.Port() + `"}]})}catch(e){if(!e.message.includes("already"))throw e}`,
		})
		if initErr == nil {
			break
		}
		time.Sleep(time.Duration(500*(i+1)) * time.Millisecond)
	}
	if initErr != nil {
		// Best-effort: log but continue; driver ping will fail with clear error.
		t.Logf("warning: rs.initiate exec failed: %v", initErr)
	}

	// Wait until RS is PRIMARY (isMaster/ hello).
	// Poll driver connect with directConnection + replicaSet.

	// Construct RS-aware URI. Use host:port from container; authSource admin is default.
	// Keep retryWrites=false (DocumentDB/sharded contract in database.ConnectMongo) but driver
	// will handle RS discovery via directConnection=false default.
	uri := fmt.Sprintf("mongodb://%s:%s/%s?replicaSet=rs0&retryWrites=false&directConnection=true", host, mappedPort.Port(), dbName)

	// Wait for PRIMARY by polling.
	var client *mongo.Client
	var lastErr error
	for i := 0; i < 30; i++ {
		c, err := mongo.Connect(ctx, options.Client().ApplyURI(uri).SetServerSelectionTimeout(2*time.Second))
		if err == nil {
			pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			err = c.Ping(pingCtx, nil)
			cancel()
			if err == nil {
				client = c
				lastErr = nil
				break
			}
			_ = c.Disconnect(ctx)
			lastErr = err
		} else {
			lastErr = err
		}
		time.Sleep(500 * time.Millisecond)
	}
	if client == nil {
		_ = ctr.Terminate(ctx)
		t.Fatalf("mongo RS never became PRIMARY (uri=%s): %v", uri, lastErr)
	}

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = client.Disconnect(ctx)
		_ = ctr.Terminate(ctx)
	})

	return &MongoRSFixture{
		Container: ctr,
		Client:    client,
		DB:        client.Database(dbName),
		URI:       uri,
	}
}

// RedisAuthFixture is a single redis:7-alpine with --requirepass (ElastiCache auth_token path).
// Same image, different flag — no Sentinel/Cluster orchestration you don't own.
type RedisAuthFixture struct {
	Container testcontainers.Container
	Client    *goredis.Client
	Addr      string
	Password  string
}

// NewRedisAuthFixture starts redis:7-alpine with --requirepass and waits for PONG via auth.
func NewRedisAuthFixture(t *testing.T, password string) *RedisAuthFixture {
	t.Helper()
	if password == "" {
		password = "test_redis_ha_password"
	}
	ctx := context.Background()

	req := testcontainers.ContainerRequest{
		Image:        "redis:7-alpine",
		ExposedPorts: []string{"6379/tcp"},
		Cmd:          []string{"redis-server", "--appendonly", "yes", "--requirepass", password},
		WaitingFor:   wait.ForLog("Ready to accept connections").WithStartupTimeout(30 * time.Second),
	}
	ctr, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		t.Fatalf("failed to start redis auth container: %v", err)
	}

	host, err := ctr.Host(ctx)
	if err != nil {
		t.Fatalf("failed to get redis auth host: %v", err)
	}
	mappedPort, err := ctr.MappedPort(ctx, "6379")
	if err != nil {
		t.Fatalf("failed to get redis auth port: %v", err)
	}
	addr := fmt.Sprintf("%s:%s", host, mappedPort.Port())

	client := goredis.NewClient(&goredis.Options{
		Addr:     addr,
		Password: password,
	})

	// Wait for PING with auth
	var lastErr error
	for i := 0; i < 20; i++ {
		pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		 err = client.Ping(pingCtx).Err()
		cancel()
		if err == nil {
			lastErr = nil
			break
		}
		lastErr = err
		time.Sleep(250 * time.Millisecond)
	}
	if lastErr != nil {
		_ = client.Close()
		_ = ctr.Terminate(ctx)
		t.Fatalf("redis auth PING failed (addr=%s): %v", addr, lastErr)
	}

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = client.Close()
		_ = ctr.Terminate(ctx)
	})

	return &RedisAuthFixture{
		Container: ctr,
		Client:    client,
		Addr:      addr,
		Password:  password,
	}
}

// RedisPrimaryReplicaFixture is primary + replica (same redis:7-alpine, cluster-disabled, primary-for-all).
// All traffic stays on primary.Addr (reader not used) — validates ElastiCache 1+1 contract without Sentinel.
type RedisPrimaryReplicaFixture struct {
	PrimaryContainer testcontainers.Container
	ReplicaContainer testcontainers.Container
	PrimaryClient    *goredis.Client
	ReplicaClient    *goredis.Client
	Network          testcontainers.Network
	NetworkName      string
	PrimaryAddr      string // host:port for CHAT_REDIS_ADDR
	Password         string
}

// NewRedisPrimaryReplicaFixture starts primary + replica with --requirepass and replicaof.
func NewRedisPrimaryReplicaFixture(t *testing.T) *RedisPrimaryReplicaFixture {
	t.Helper()
	ctx := context.Background()
	password := "test_redis_ha_password"

	// Create isolated network so replica can address primary by name
	networkName := fmt.Sprintf("redis-ha-%d", time.Now().UnixNano())
	net, err := testcontainers.GenericNetwork(ctx, testcontainers.GenericNetworkRequest{
		NetworkRequest: testcontainers.NetworkRequest{
			Name:           networkName,
			CheckDuplicate: true,
		},
	})
	if err != nil {
		t.Fatalf("failed to create docker network: %v", err)
	}

	primaryReq := testcontainers.ContainerRequest{
		Image:        "redis:7-alpine",
		ExposedPorts: []string{"6379/tcp"},
		Cmd:          []string{"redis-server", "--appendonly", "yes", "--requirepass", password},
		WaitingFor:   wait.ForLog("Ready to accept connections").WithStartupTimeout(30 * time.Second),
		Networks:     []string{networkName},
		NetworkAliases: map[string][]string{
			networkName: {"redis-primary"},
		},
	}
	primaryCtr, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: primaryReq,
		Started:          true,
	})
	if err != nil {
		_ = net.Remove(ctx)
		t.Fatalf("failed to start redis primary: %v", err)
	}

	replicaReq := testcontainers.ContainerRequest{
		Image:        "redis:7-alpine",
		ExposedPorts: []string{"6379/tcp"},
		Cmd: []string{
			"redis-server", "--appendonly", "yes",
			"--requirepass", password,
			"--masterauth", password,
			"--replicaof", "redis-primary", "6379",
		},
		WaitingFor: wait.ForLog("Ready to accept connections").WithStartupTimeout(30 * time.Second),
		Networks:   []string{networkName},
		NetworkAliases: map[string][]string{
			networkName: {"redis-replica"},
		},
	}
	replicaCtr, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: replicaReq,
		Started:          true,
	})
	if err != nil {
		_ = primaryCtr.Terminate(ctx)
		_ = net.Remove(ctx)
		t.Fatalf("failed to start redis replica: %v", err)
	}

	// Resolve host-mapped primary addr for Go client (CHAT_REDIS_ADDR)
	host, err := primaryCtr.Host(ctx)
	if err != nil {
		t.Fatalf("failed to get redis primary host: %v", err)
	}
	mappedPort, err := primaryCtr.MappedPort(ctx, "6379")
	if err != nil {
		t.Fatalf("failed to get redis primary port: %v", err)
	}
	primaryAddr := fmt.Sprintf("%s:%s", host, mappedPort.Port())

	// Also resolve replica addr for optional replica checks
	rHost, _ := replicaCtr.Host(ctx)
	rPort, _ := replicaCtr.MappedPort(ctx, "6379")
	replicaAddr := fmt.Sprintf("%s:%s", rHost, rPort.Port())

	primaryClient := goredis.NewClient(&goredis.Options{Addr: primaryAddr, Password: password})
	replicaClient := goredis.NewClient(&goredis.Options{Addr: replicaAddr, Password: password})

	// Wait for primary PING + replica sync (INFO replication)
	for i := 0; i < 30; i++ {
		pCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		pErr := primaryClient.Ping(pCtx).Err()
		cancel()
		if pErr != nil {
			time.Sleep(500 * time.Millisecond)
			continue
		}
		// Check replica replication state
		rCtx, rCancel := context.WithTimeout(ctx, 2*time.Second)
		info, iErr := replicaClient.Info(rCtx, "replication").Result()
		rCancel()
		if iErr == nil && (strings.Contains(info, "master_link_status:up") || strings.Contains(info, "role:slave") || strings.Contains(info, "role:replica")) {
			break
		}
		if i >= 29 {
			t.Logf("primary PING ok but replica not yet synced, info: %s err:%v", info, iErr)
		}
		time.Sleep(500 * time.Millisecond)
	}

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = primaryClient.Close()
		_ = replicaClient.Close()
		_ = replicaCtr.Terminate(ctx)
		_ = primaryCtr.Terminate(ctx)
		_ = net.Remove(ctx)
	})

	return &RedisPrimaryReplicaFixture{
		PrimaryContainer: primaryCtr,
		ReplicaContainer: replicaCtr,
		PrimaryClient:    primaryClient,
		ReplicaClient:    replicaClient,
		Network:          net,
		NetworkName:      networkName,
		PrimaryAddr:      primaryAddr,
		Password:         password,
	}
}

// HAConfig helpers — test-only *config.Config with HA-tuned defaults (never wired into compose).
func haMongoDefaults() (serverTimeout time.Duration, maxPool, minPool uint64) {
	return 15 * time.Second, 20, 5
}
