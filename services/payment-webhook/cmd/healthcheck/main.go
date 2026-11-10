package main

import (
	"fmt"
	"net"
	"os"
	"time"
)

func main() {
	port := os.Getenv("AWS_LWA_PORT")
	if port == "" {
		port = "8080"
	}

	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", port), 2*time.Second)
	if err != nil {
		fmt.Fprintf(os.Stderr, "healthcheck: connect 127.0.0.1:%s: %v\n", port, err)
		os.Exit(1)
	}
	conn.Close()
}
