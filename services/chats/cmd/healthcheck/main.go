package main

import (
	"fmt"
	"net/http"
	"os"
	"time"
)

const (
	defaultPort    = "8090"
	probeTimeout   = 3 * time.Second
	readyProbePath = "/api/v1/ready"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	client := &http.Client{Timeout: probeTimeout}
	response, err := client.Get("http://127.0.0.1:" + port + readyProbePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "healthcheck: ready probe: %v\n", err)
		os.Exit(1)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "healthcheck: ready probe: status %d\n", response.StatusCode)
		os.Exit(1)
	}
}
