//go:build integration

package testutil

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ShardedMongoFixture is a real sharded cluster for integration tests:
//
//	1x configsvr (single-node RS cfg0) + 2x shards (single-node RS shard0/shard1)
//	+ 1x mongos + isolated docker network.
//
// Unlike MongoRSFixture (single mongod --replSet, ha tag, local-only), this
// exercises the true mongos path: enableSharding + shardCollection succeed,
// config.collections/config.chunks are populated, hashed chat_id routing and
// chunk distribution across 2 shards can be asserted.
//
// Topology is intentionally minimal-but-real: single-node RS per shard keeps
// startup ~60-120s. Three-node RS per shard (true failover) is out of scope.
type ShardedMongoFixture struct {
	CfgContainer    testcontainers.Container
	Shard0Container testcontainers.Container
	Shard1Container testcontainers.Container
	MongosContainer testcontainers.Container
	Network         testcontainers.Network
	NetworkName     string
	MongosClient    *mongo.Client
	DB              *mongo.Database
	MongosURI       string // mongos URI for database.ConnectMongo (retryWrites=false, no replicaSet)
	DbName          string
}

// NewShardedMongoFixture starts the full cluster, adds both shards via mongos
// and waits until listShards reports 2 shards. It does NOT call EnsureSharding;
// tests call it explicitly so success is asserted, not assumed.
func NewShardedMongoFixture(t *testing.T, dbName string) *ShardedMongoFixture {
	t.Helper()
	ctx := context.Background()

	networkName := fmt.Sprintf("mongo-sharded-%d", time.Now().UnixNano())
	net, err := testcontainers.GenericNetwork(ctx, testcontainers.GenericNetworkRequest{
		NetworkRequest: testcontainers.NetworkRequest{
			Name:           networkName,
			CheckDuplicate: true,
		},
	})
	if err != nil {
		t.Fatalf("failed to create docker network: %v", err)
	}
	cleanupNet := func() {
		cCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = net.Remove(cCtx)
	}

	// 1. Config server (single-node RS cfg0).
	cfgCtr := startMongoNode(t, ctx, networkName, "mongo-cfg",
		[]string{"mongod", "--configsvr", "--replSet", "cfg0", "--port", "27019", "--bind_ip_all"},
		"27019/tcp")
	initReplicaSet(t, ctx, cfgCtr, 27019, "cfg0", "mongo-cfg:27019", true)
	waitForRSPrimary(t, ctx, cfgCtr, 27019)

	// 2. Two shards (single-node RS each).
	shard0Ctr := startMongoNode(t, ctx, networkName, "mongo-shard0",
		[]string{"mongod", "--shardsvr", "--replSet", "shard0", "--port", "27018", "--bind_ip_all"},
		"27018/tcp")
	initReplicaSet(t, ctx, shard0Ctr, 27018, "shard0", "mongo-shard0:27018", false)
	waitForRSPrimary(t, ctx, shard0Ctr, 27018)

	shard1Ctr := startMongoNode(t, ctx, networkName, "mongo-shard1",
		[]string{"mongod", "--shardsvr", "--replSet", "shard1", "--port", "27018", "--bind_ip_all"},
		"27018/tcp")
	initReplicaSet(t, ctx, shard1Ctr, 27018, "shard1", "mongo-shard1:27018", false)
	waitForRSPrimary(t, ctx, shard1Ctr, 27018)

	// 3. Mongos router. Must start after cfg RS is PRIMARY.
	mongosReq := testcontainers.ContainerRequest{
		Image:        "mongo:7",
		ExposedPorts: []string{"27017/tcp"},
		Cmd:          []string{"mongos", "--configdb", "cfg0/mongo-cfg:27019", "--port", "27017", "--bind_ip_all"},
		WaitingFor:   wait.ForLog("Waiting for connections").WithStartupTimeout(180 * time.Second),
		Networks:     []string{networkName},
		NetworkAliases: map[string][]string{
			networkName: {"mongo-mongos"},
		},
	}
	mongosCtr, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: mongosReq,
		Started:          true,
	})
	if err != nil {
		_ = shard1Ctr.Terminate(ctx)
		_ = shard0Ctr.Terminate(ctx)
		_ = cfgCtr.Terminate(ctx)
		cleanupNet()
		t.Fatalf("failed to start mongos: %v", err)
	}

	// 4. addShard both shards via mongos (retry: mongos may accept connections
	// before config metadata is fully ready).
	addShard(t, ctx, mongosCtr, "shard0/mongo-shard0:27018")
	addShard(t, ctx, mongosCtr, "shard1/mongo-shard1:27018")
	waitForShardCount(t, ctx, mongosCtr, 2)

	// 5. Go driver connects via host-mapped mongos port. No replicaSet, no
	// directConnection (opposite of single-node RS fixture). retryWrites=false
	// is the sharded/DocumentDB contract (see pkg/database/mongo.go).
	host, err := mongosCtr.Host(ctx)
	if err != nil {
		terminateSharded(ctx, mongosCtr, shard0Ctr, shard1Ctr, cfgCtr)
		cleanupNet()
		t.Fatalf("failed to get mongos host: %v", err)
	}
	mappedPort, err := mongosCtr.MappedPort(ctx, "27017")
	if err != nil {
		terminateSharded(ctx, mongosCtr, shard0Ctr, shard1Ctr, cfgCtr)
		cleanupNet()
		t.Fatalf("failed to get mongos port: %v", err)
	}
	uri := fmt.Sprintf("mongodb://%s:%s/%s?retryWrites=false", host, mappedPort.Port(), dbName)

	var client *mongo.Client
	var lastErr error
	for i := 0; i < 30; i++ {
		c, err := mongo.Connect(ctx, options.Client().ApplyURI(uri).SetServerSelectionTimeout(5*time.Second))
		if err == nil {
			pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
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
		time.Sleep(time.Second)
	}
	if client == nil {
		terminateSharded(ctx, mongosCtr, shard0Ctr, shard1Ctr, cfgCtr)
		cleanupNet()
		t.Fatalf("mongos never became reachable (uri=%s): %v", uri, lastErr)
	}

	t.Cleanup(func() {
		cCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = client.Disconnect(cCtx)
		terminateSharded(cCtx, mongosCtr, shard0Ctr, shard1Ctr, cfgCtr)
		_ = net.Remove(cCtx)
	})

	return &ShardedMongoFixture{
		CfgContainer:    cfgCtr,
		Shard0Container: shard0Ctr,
		Shard1Container: shard1Ctr,
		MongosContainer: mongosCtr,
		Network:         net,
		NetworkName:     networkName,
		MongosClient:    client,
		DB:              client.Database(dbName),
		MongosURI:       uri,
		DbName:          dbName,
	}
}

// ShardHosts returns the internal shard addresses (for debugging / failure tests).
func (f *ShardedMongoFixture) ShardHosts() []string {
	return []string{"mongo-shard0:27018", "mongo-shard1:27018"}
}

func startMongoNode(t *testing.T, ctx context.Context, networkName, alias string, cmd []string, exposedPort string) testcontainers.Container {
	t.Helper()
	req := testcontainers.ContainerRequest{
		Image:        "mongo:7",
		ExposedPorts: []string{exposedPort},
		Cmd:          cmd,
		WaitingFor:   wait.ForLog("Waiting for connections").WithStartupTimeout(90 * time.Second),
		Networks:     []string{networkName},
		NetworkAliases: map[string][]string{
			networkName: {alias},
		},
	}
	ctr, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		t.Fatalf("failed to start %s: %v", alias, err)
	}
	return ctr
}

func initReplicaSet(t *testing.T, ctx context.Context, ctr testcontainers.Container, port int, rsName, memberHost string, configsvr bool) {
	t.Helper()
	var initiateJS string
	if configsvr {
		initiateJS = fmt.Sprintf(`rs.initiate({_id:"%s",configsvr:true,members:[{_id:0,host:"%s"}]})`, rsName, memberHost)
	} else {
		initiateJS = fmt.Sprintf(`rs.initiate({_id:"%s",members:[{_id:0,host:"%s"}]})`, rsName, memberHost)
	}
	var lastOut string
	var lastErr error
	for i := 0; i < 15; i++ {
		out, err := execMongosh(ctx, ctr, port, initiateJS)
		// Note: mongosh prints JS objects (ok: 1, no quotes) and returns exit 1
		// with "already initialized" on retry — both mean success.
		if strings.Contains(out, "ok: 1") || strings.Contains(out, `"ok"`) ||
			strings.Contains(out, "already initialized") || strings.Contains(out, "already") {
			return
		}
		lastOut, lastErr = out, err
		time.Sleep(time.Duration(500*(i+1)) * time.Millisecond)
	}
	t.Logf("warning: rs.initiate %s not confirmed (out=%q err=%v), continuing; PRIMARY poll will fail loudly if broken", rsName, lastOut, lastErr)
}

func waitForRSPrimary(t *testing.T, ctx context.Context, ctr testcontainers.Container, port int) {
	t.Helper()
	for i := 0; i < 30; i++ {
		out, err := execMongosh(ctx, ctr, port, `db.adminCommand("hello").isWritablePrimary`)
		if err == nil && strings.Contains(out, "true") {
			return
		}
		time.Sleep(time.Second)
	}
	t.Fatalf("replica set on port %d never became PRIMARY", port)
}

func addShard(t *testing.T, ctx context.Context, mongosCtr testcontainers.Container, shardConn string) {
	t.Helper()
	js := fmt.Sprintf(`sh.addShard("%s")`, shardConn)
	var lastOut string
	var lastErr error
	for i := 0; i < 20; i++ {
		out, err := execMongosh(ctx, mongosCtr, 27017, js)
		// mongosh prints { shardAdded: 'shard0', ok: 1, ... } on success.
		if strings.Contains(out, "shardAdded") || strings.Contains(out, "ok: 1") ||
			strings.Contains(out, `"ok"`) || strings.Contains(out, "already") {
			return
		}
		lastOut, lastErr = out, err
		time.Sleep(time.Second)
	}
	t.Fatalf("addShard %s failed (out=%q err=%v)", shardConn, lastOut, lastErr)
}

func waitForShardCount(t *testing.T, ctx context.Context, mongosCtr testcontainers.Container, want int) {
	t.Helper()
	for i := 0; i < 30; i++ {
		out, err := execMongosh(ctx, mongosCtr, 27017, `db.adminCommand({listShards:1}).shards.length`)
		if err == nil && strings.Contains(out, fmt.Sprintf("%d", want)) {
			return
		}
		time.Sleep(time.Second)
	}
	t.Fatalf("mongos never reported %d shards", want)
}

// ShardedCollectionInfo reads config.collections for assertions.
// On MongoDB 7 sharded collections are indicated by the presence of a
// config.collections entry carrying the shard key (there is no `sharded`
// boolean field); absence of an entry means unsharded.
func ShardedCollectionInfo(ctx context.Context, client *mongo.Client, dbName string) (sharded bool, key bson.M, err error) {
	var doc struct {
		ID  string `bson:"_id"`
		Key bson.M `bson:"key"`
	}
	err = client.Database("config").Collection("collections").FindOne(ctx, bson.M{"_id": dbName + ".messages"}).Decode(&doc)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return false, nil, nil
		}
		return false, nil, err
	}
	return true, doc.Key, nil
}

// ShardedChunkShards returns distinct shard ids holding chunks for the
// collection. On MongoDB 5+ config.chunks references the collection by UUID
// (the legacy `ns` field is gone), so resolve the UUID via config.collections.
func ShardedChunkShards(ctx context.Context, client *mongo.Client, dbName string) ([]string, int64, error) {
	raw, err := client.Database("config").Collection("collections").
		FindOne(ctx, bson.M{"_id": dbName + ".messages"}).DecodeBytes()
	if err != nil {
		return nil, 0, err
	}
	filter := bson.M{"uuid": raw.Lookup("uuid")}
	count, err := client.Database("config").Collection("chunks").CountDocuments(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	vals, err := client.Database("config").Collection("chunks").Distinct(ctx, "shard", filter)
	if err != nil {
		return nil, count, err
	}
	shards := make([]string, 0, len(vals))
	for _, v := range vals {
		if s, ok := v.(string); ok {
			shards = append(shards, s)
		}
	}
	return shards, count, nil
}

func execMongosh(ctx context.Context, ctr testcontainers.Container, port int, js string) (string, error) {
	execCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	code, reader, err := ctr.Exec(execCtx, []string{"mongosh", "--quiet", "--port", fmt.Sprintf("%d", port), "--eval", js})
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if reader != nil {
		_, _ = io.Copy(&buf, reader)
	}
	if code != 0 {
		return buf.String(), fmt.Errorf("mongosh exit %d: %s", code, buf.String())
	}
	return buf.String(), nil
}

func terminateSharded(ctx context.Context, ctrs ...testcontainers.Container) {
	for _, c := range ctrs {
		if c != nil {
			_ = c.Terminate(ctx)
		}
	}
}
