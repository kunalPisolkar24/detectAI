package redis

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	driver "github.com/redis/go-redis/v9"
)

func TestConsumeGivesUpOnASilentServer(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go holdOpen(listener)

	opts, err := clientOptions("redis://"+listener.Addr().String(), "")
	if err != nil {
		t.Fatalf("client options: %v", err)
	}
	client := driver.NewClient(opts)
	t.Cleanup(func() { _ = client.Close() })
	limiter := &Limiter{client: client}

	start := time.Now()
	_, err = limiter.Consume(context.Background(), "owner-1", "create", 10)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("Consume = nil error, want the deadline to cut the call short")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("err = %v, want the deadline to end the call", err)
	}
	if elapsed > time.Second {
		t.Errorf("Consume took %v, want the fail-open deadline to bound it", elapsed)
	}
}

// holdOpen accepts connections and never answers them; the connections close
// when the listener does.
func holdOpen(listener net.Listener) {
	for {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
	}
}
