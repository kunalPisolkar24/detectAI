package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	publish, err := newPublisher(cfg)
	if err != nil {
		log.Fatal(err)
	}

	srv := &http.Server{
		Addr:    ":" + strconv.Itoa(cfg.Port),
		Handler: router.New(cfg, publish),
	}

	if err := server.Run(srv, cfg.DrainTimeout); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}

// newPublisher binds the SQS transport at boot: the SDK's default chain reads
// region and credentials from the process environment — bootstrap vars never
// ride the Config plane — and one SendMessage per publish heads the configured
// FIFO queue.
func newPublisher(cfg config.Config) (*queue.Service, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background())
	if err != nil {
		return nil, fmt.Errorf("queue: SQS client config: %w", err)
	}
	return queue.NewService(queue.NewSQSAdapter(sqs.NewFromConfig(awsCfg), cfg.QueueURL), cfg.PublishBudget), nil
}
