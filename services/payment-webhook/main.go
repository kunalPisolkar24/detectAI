package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

// drainTimeout covers the 5 s publish budget plus slack (NFR-9).
const drainTimeout = 10 * time.Second

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	r := gin.Default()

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	r.GET("/ready", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	if err := serveAndDrain(srv); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}

// serveAndDrain serves until SIGINT/SIGTERM, then drains in-flight requests (NFR-9).
func serveAndDrain(srv *http.Server) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}

	log.Println("signal received; draining in-flight requests")
	drainCtx, cancel := context.WithTimeout(context.Background(), drainTimeout)
	defer cancel()
	if err := srv.Shutdown(drainCtx); err != nil {
		return fmt.Errorf("drain incomplete: %w", err)
	}
	log.Println("graceful shutdown complete")
	return nil
}
