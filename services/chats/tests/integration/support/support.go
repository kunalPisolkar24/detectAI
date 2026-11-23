package support

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	tcmongo "github.com/testcontainers/testcontainers-go/modules/mongodb"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
	"go.mongodb.org/mongo-driver/v2/bson"
	mongodriver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	// MongoImage and RedisImage are the images the local compose stack runs,
	// so the integration tree meets the same planes the service meets in dev.
	MongoImage = "mongo:8.0"
	RedisImage = "redis:8-alpine"

	startBudget = 2 * time.Minute
	stopBudget  = 30 * time.Second
)

type MongoFixture struct {
	Container *tcmongo.MongoDBContainer
	URI       string
}

type RedisFixture struct {
	Container *tcredis.RedisContainer
	Endpoint  string
}

var (
	dockerOnce sync.Once
	dockerUp   bool

	mongoOnce   sync.Once
	mongoShared *MongoFixture
	mongoErr    error

	redisOnce   sync.Once
	redisShared *RedisFixture
	redisErr    error
)

func DockerUp() bool {
	dockerOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		provider, err := testcontainers.NewDockerProvider()
		if err != nil {
			return
		}
		dockerUp = provider.Health(ctx) == nil
	})
	return dockerUp
}

func Mongo(t testing.TB) *MongoFixture {
	t.Helper()
	if !DockerUp() {
		t.Skip("docker daemon unreachable; the container-backed layer needs it")
	}

	mongoOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), startBudget)
		defer cancel()

		container, err := tcmongo.Run(ctx, MongoImage)
		if err != nil {
			mongoErr = err
			return
		}
		uri, err := container.ConnectionString(ctx)
		if err != nil {
			mongoErr = err
			return
		}
		waitForMongo(t, uri)
		mongoShared = &MongoFixture{Container: container, URI: uri}
	})
	if mongoErr != nil {
		t.Fatalf("start the mongo container: %v", mongoErr)
	}
	return mongoShared
}

func Redis(t testing.TB) *RedisFixture {
	t.Helper()
	if !DockerUp() {
		t.Skip("docker daemon unreachable; the container-backed layer needs it")
	}

	redisOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), startBudget)
		defer cancel()

		container, err := tcredis.Run(ctx, RedisImage)
		if err != nil {
			redisErr = err
			return
		}
		endpoint, err := container.ConnectionString(ctx)
		if err != nil {
			redisErr = err
			return
		}
		waitForRedis(t, endpoint)
		redisShared = &RedisFixture{Container: container, Endpoint: endpoint}
	})
	if redisErr != nil {
		t.Fatalf("start the redis container: %v", redisErr)
	}
	return redisShared
}

func NewMongo(ctx context.Context) (*MongoFixture, error) {
	container, err := tcmongo.Run(ctx, MongoImage)
	if err != nil {
		return nil, err
	}
	uri, err := container.ConnectionString(ctx)
	if err != nil {
		_ = container.Terminate(ctx)
		return nil, err
	}
	if err := waitMongo(uri); err != nil {
		_ = container.Terminate(ctx)
		return nil, err
	}
	return &MongoFixture{Container: container, URI: uri}, nil
}

func NewRedis(ctx context.Context) (*RedisFixture, error) {
	container, err := tcredis.Run(ctx, RedisImage)
	if err != nil {
		return nil, err
	}
	endpoint, err := container.ConnectionString(ctx)
	if err != nil {
		_ = container.Terminate(ctx)
		return nil, err
	}
	if err := waitRedis(endpoint); err != nil {
		_ = container.Terminate(ctx)
		return nil, err
	}
	return &RedisFixture{Container: container, Endpoint: endpoint}, nil
}

func (m *MongoFixture) Stop(t testing.TB) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), stopBudget)
	defer cancel()
	if err := m.Container.Stop(ctx, nil); err != nil {
		t.Fatalf("stop the mongo container: %v", err)
	}
}

func (r *RedisFixture) Stop(t testing.TB) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), stopBudget)
	defer cancel()
	if err := r.Container.Stop(ctx, nil); err != nil {
		t.Fatalf("stop the redis container: %v", err)
	}
}

func (m *MongoFixture) Terminate(ctx context.Context) {
	terminate(ctx, m.Container)
}

func (r *RedisFixture) Terminate(ctx context.Context) {
	terminate(ctx, r.Container)
}

func Main(m *testing.M) {
	code := m.Run()
	shutdown()
	os.Exit(code)
}

func shutdown() {
	ctx, cancel := context.WithTimeout(context.Background(), stopBudget)
	defer cancel()
	if mongoShared != nil {
		terminate(ctx, mongoShared.Container)
		mongoShared = nil
	}
	if redisShared != nil {
		terminate(ctx, redisShared.Container)
		redisShared = nil
	}
}

func terminate(ctx context.Context, container testcontainers.Container) {
	_ = container.Terminate(ctx)
}

// waitForMongo blocks until the server answers a ping. The container reports
// itself started before it serves, and the service dials with a five-second
// budget, so the plane has to be ready before the test hands it over.
func waitForMongo(t testing.TB, uri string) {
	t.Helper()
	if err := waitMongo(uri); err != nil {
		t.Fatalf("the mongo container never became ready: %v", err)
	}
}

func waitForRedis(t testing.TB, endpoint string) {
	t.Helper()
	if err := waitRedis(endpoint); err != nil {
		t.Fatalf("the redis container never became ready: %v", err)
	}
}

func waitMongo(uri string) error {
	deadline := time.Now().Add(startBudget)
	for {
		err := probeMongo(uri)
		if err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return err
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func probeMongo(uri string) error {
	if err := pingMongo(uri); err != nil {
		return err
	}
	return probeMongoWrite(uri)
}

// probeMongoWrite runs one index build, the write the service opens its
// sessions with. A server that answers a ping can still be busy with its
// startup DDL, and the first real write then waits behind it.
func probeMongoWrite(uri string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client, err := mongodriver.Connect(options.Client().
		ApplyURI(uri).
		SetConnectTimeout(5 * time.Second).
		SetServerSelectionTimeout(5 * time.Second))
	if err != nil {
		return err
	}
	defer func() { _ = client.Disconnect(context.Background()) }()

	_, err = client.
		Database("probe").
		Collection("probe").
		Indexes().
		CreateOne(ctx, mongodriver.IndexModel{Keys: bson.D{{Key: "probe", Value: 1}}})
	return err
}

func waitRedis(endpoint string) error {
	deadline := time.Now().Add(startBudget)
	for {
		err := pingRedis(endpoint)
		if err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return err
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// pingMongo dials the server the way the service dials it, with the same
// connect and server-selection budgets, so a plane that answers here is a
// plane the service can reach.
func pingMongo(uri string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongodriver.Connect(options.Client().
		ApplyURI(uri).
		SetConnectTimeout(5 * time.Second).
		SetServerSelectionTimeout(5 * time.Second))
	if err != nil {
		return err
	}
	defer func() { _ = client.Disconnect(context.Background()) }()
	return client.Ping(ctx, nil)
}

func pingRedis(endpoint string) error {
	opts, err := goredis.ParseURL(endpoint)
	if err != nil {
		return err
	}
	opts.DialTimeout = 5 * time.Second
	opts.ReadTimeout = 5 * time.Second
	opts.WriteTimeout = 5 * time.Second

	client := goredis.NewClient(opts)
	defer func() { _ = client.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return client.Ping(ctx).Err()
}
