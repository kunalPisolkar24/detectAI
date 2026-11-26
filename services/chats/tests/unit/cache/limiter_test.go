package cache_test

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/client"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/limiter"
)

// TestConsumeGivesUpOnASilentServer checks that the limiter's own deadline
// ends the call when the cache plane stops answering.
func TestConsumeGivesUpOnASilentServer(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go serveSilentRedis(listener)

	conn, err := client.Connect(context.Background(), "redis://"+listener.Addr().String())
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = conn.Disconnect(context.Background()) })

	lim := limiter.NewRedis(conn)

	start := time.Now()
	_, err = lim.Consume(context.Background(), "owner-1", "create", 10)
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

func serveSilentRedis(listener net.Listener) {
	for {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		go func() {
			defer conn.Close()
			reader := bufio.NewReader(conn)
			for {
				command, err := readCommand(reader)
				if err != nil {
					return
				}
				switch command {
				case "PING":
					_, _ = conn.Write([]byte("+PONG\r\n"))
				case "EVAL", "EVALSHA":
					continue
				default:
					_, _ = conn.Write([]byte("-ERR unknown command\r\n"))
				}
			}
		}()
	}
}

func readCommand(reader *bufio.Reader) (string, error) {
	header, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(header, "*") {
		return "", errors.New("command is not an array")
	}
	count, err := strconv.Atoi(strings.TrimSpace(header[1:]))
	if err != nil {
		return "", err
	}
	arguments := make([]string, 0, count)
	for range count {
		size, err := reader.ReadString('\n')
		if err != nil {
			return "", err
		}
		if !strings.HasPrefix(size, "$") {
			return "", errors.New("argument is not a bulk string")
		}
		length, err := strconv.Atoi(strings.TrimSpace(size[1:]))
		if err != nil {
			return "", err
		}
		buffer := make([]byte, length+2)
		if _, err := io.ReadFull(reader, buffer); err != nil {
			return "", err
		}
		arguments = append(arguments, string(buffer[:length]))
	}
	if len(arguments) == 0 {
		return "", errors.New("command is empty")
	}
	return strings.ToUpper(arguments[0]), nil
}
