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
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/server"
)

func main() {
	flick, err := config.DeploymentFlick()
	if err != nil {
		log.Fatal(err)
	}
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	publish, err := newPublisher(cfg)
	if err != nil {
		log.Fatal(err)
	}
	obs, err := observability.Boot(cfg, flick)
	if err != nil {
		log.Fatal(err)
	}

	srv := &http.Server{
		Addr:    ":" + strconv.Itoa(cfg.Port),
		Handler: router.New(cfg, publish, obs),
	}

	runErr := server.Run(srv, cfg.DrainTimeout)
	if err := obs.Shutdown(context.Background()); err != nil {
		log.Printf("observability drain incomplete: %v", err)
	}
	if runErr != nil {
		log.Fatalf("server exited: %v", runErr)
	}
}

// newPublisher binds the SQS transport at boot; SDK bootstrap vars never enter the Config plane.
func newPublisher(cfg config.Config) (*queue.Service, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background())
	if err != nil {
		return nil, fmt.Errorf("queue: SQS client config: %w", err)
	}
	return queue.NewService(queue.NewSQSAdapter(sqs.NewFromConfig(awsCfg), cfg.QueueURL), cfg.PublishBudget), nil
}
