package database

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

// MongoConnectConfig mirrors the subset of internal/config.Config needed for Mongo.
// Using a struct avoids importing internal/config (cycle) and keeps this package reusable.
type MongoConnectConfig struct {
	URI            string
	MaxPoolSize    uint64
	MinPoolSize    uint64
	ServerTimeout  time.Duration
	TLSEnabled     bool
	TLSCAFile      string
	Mode           string // standalone | sharded (only used for logging/hints)
}

func ConnectMongo(ctx context.Context, cfg MongoConnectConfig) (*mongo.Client, error) {
	if cfg.URI == "" {
		return nil, fmt.Errorf("MONGO_URI is required")
	}
	if cfg.MaxPoolSize == 0 {
		cfg.MaxPoolSize = 100
	}
	if cfg.MinPoolSize == 0 {
		cfg.MinPoolSize = 10
	}
	if cfg.ServerTimeout == 0 {
		cfg.ServerTimeout = 5 * time.Second
	}

	opts := options.Client().
		ApplyURI(cfg.URI).
		SetMaxPoolSize(cfg.MaxPoolSize).
		SetMinPoolSize(cfg.MinPoolSize).
		SetConnectTimeout(5 * time.Second).
		SetServerSelectionTimeout(cfg.ServerTimeout).
		SetRetryWrites(false)

	// DocumentDB and sharded (mongos) require retryWrites=false.
	// Explicitly set it even if URI already contains it — safe on standalone.

	if cfg.TLSEnabled {
		tlsCfg, err := buildTLSConfig(cfg.TLSCAFile)
		if err != nil {
			return nil, fmt.Errorf("build TLS config: %w", err)
		}
		opts.SetTLSConfig(tlsCfg)
	}

	client, err := mongo.Connect(ctx, opts)
	if err != nil {
		return nil, err
	}

	if err := client.Ping(ctx, readpref.Primary()); err != nil {
		_ = client.Disconnect(ctx)
		return nil, err
	}

	return client, nil
}

// ConnectMongoSimple retains the old signature for tests and callers that don't use config.
// It defaults to standalone-safe values: retryWrites=false, no TLS, pool 100/10, timeout 5s.
func ConnectMongoSimple(ctx context.Context, uri string) (*mongo.Client, error) {
	return ConnectMongo(ctx, MongoConnectConfig{URI: uri})
}

func buildTLSConfig(caFile string) (*tls.Config, error) {
	if caFile == "" {
		// No CA file: still enable TLS but skip verify (Floci local without cert).
		// For real AWS, always provide the combined CA bundle.
		return &tls.Config{InsecureSkipVerify: true}, nil //nolint:gosec
	}
	pemData, err := os.ReadFile(caFile)
	if err != nil {
		return nil, err
	}
	// Go driver v1.14.0 only reads first cert from sslCAFile; we append all.
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pemData) {
		return nil, fmt.Errorf("no valid certs in %s", caFile)
	}
	return &tls.Config{
		RootCAs:            pool,
		InsecureSkipVerify: false,
		MinVersion:         tls.VersionTLS12,
	}, nil
}
