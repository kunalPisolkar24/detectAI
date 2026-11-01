package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"
)

// shutdown stops the listener and drains in-flight requests with the drain logged.
func shutdown(srv *http.Server, drain time.Duration) error {
	log.Println("signal received; draining in-flight requests")
	drainCtx, cancel := context.WithTimeout(context.Background(), drain)
	defer cancel()
	if err := srv.Shutdown(drainCtx); err != nil {
		return fmt.Errorf("drain incomplete: %w", err)
	}
	log.Println("graceful shutdown complete")
	return nil
}
