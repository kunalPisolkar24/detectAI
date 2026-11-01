package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"
)

// drainTimeout covers the 5 s publish budget plus slack (NFR-9).
const drainTimeout = 10 * time.Second

// shutdown stops the listener and drains in-flight requests with the drain logged.
func shutdown(srv *http.Server) error {
	log.Println("signal received; draining in-flight requests")
	drainCtx, cancel := context.WithTimeout(context.Background(), drainTimeout)
	defer cancel()
	if err := srv.Shutdown(drainCtx); err != nil {
		return fmt.Errorf("drain incomplete: %w", err)
	}
	log.Println("graceful shutdown complete")
	return nil
}
