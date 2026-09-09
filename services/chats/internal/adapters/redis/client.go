package redis

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/redis/go-redis/v9"
)

func NewClient(cfg *config.Config) (redis.UniversalClient, error) {
	options := &redis.UniversalOptions{
		Addrs:        cfg.RedisAddrs,
		Password:     cfg.RedisPassword,
		PoolSize:     cfg.RedisPoolSize,
		MinIdleConns: 10,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		ClientName:   "go-chat-service",
	}
	if cfg.RedisTLSEnabled {
		tlsCfg, err := buildRedisTLSConfig(cfg.RedisTLSCAFile)
		if err != nil {
			return nil, fmt.Errorf("build redis TLS config: %w", err)
		}
		options.TLSConfig = tlsCfg
	}

	client := redis.NewUniversalClient(options)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	return client, nil
}

func buildRedisTLSConfig(caFile string) (*tls.Config, error) {
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
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: false,
	}, nil
}
