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

func buildTLSConfig(caFile string) (*tls.Config, error) {
	if caFile == "" {
		return &tls.Config{InsecureSkipVerify: true}, nil //nolint:gosec
	}
	pemData, err := os.ReadFile(caFile)
	if err != nil {
		return nil, err
	}
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
