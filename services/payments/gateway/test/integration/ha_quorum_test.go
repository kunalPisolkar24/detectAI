//go:build ha_integration

package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/domain"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/infrastructure/paddle"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/infrastructure/rabbitmq"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/logger"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/monitoring"
	transporthttp "github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/transport/http"

	"github.com/gin-gonic/gin"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

func haPaddleSignature(secret string, body []byte, ts int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d:%s", ts, body)))
	return fmt.Sprintf("ts=%d;h1=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}

// TestHAQuorumCluster verifies quorum queues on a real 3-node Testcontainers
// cluster (accuracy over speed, no Compose). Floci is Terraform-only; this
// suite verifies edge cases: quorum declare, 406 mismatch, single-node kill.
func TestHAQuorumCluster(t *testing.T) {
	ctx := context.Background()
	log := logger.New()
	monitor := monitoring.New("payment-gateway-ha-test")

	cluster := NewHACluster(ctx, t, "guest", "guest")
	t.Cleanup(func() { cluster.Cleanup(ctx) })

	base := fmt.Sprintf("payment_events_ha_%d", time.Now().UnixNano())
	webhookSecret := "test_webhook_secret_ha_16chars"
	internalKey := "test_internal_key_16chars"

	prod := rabbitmq.NewRabbitMQProducer(cluster.PrimaryURL(ctx), base, "quorum", log, monitor)
	defer prod.Close()

	require.Eventually(t, func() bool { return prod.IsConnected() }, 60*time.Second, 500*time.Millisecond, "producer did not connect to HA cluster")

	svc := domain.NewPaymentService(prod, paddle.NewPaddleValidator(), monitor, webhookSecret)
	handler := transporthttp.NewHandler(transporthttp.HandlerConfig{
		Service: svc, Health: prod, Metrics: monitor, InternalKey: internalKey, Logger: log,
	})
	router := gin.New()
	handler.RegisterRoutes(router)

	postJSON := func(path string, headers map[string]string, body []byte) *httptest.ResponseRecorder {
		req, err := http.NewRequest(http.MethodPost, path, bytes.NewBuffer(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}

	consumeOne := func(url, queue string, timeout time.Duration) ([]byte, bool) {
		conn, err := amqp.Dial(url)
		if err != nil {
			return nil, false
		}
		defer conn.Close()
		ch, err := conn.Channel()
		if err != nil {
			return nil, false
		}
		defer ch.Close()
		msgs, err := ch.Consume(queue, "", true, false, false, false, nil)
		if err != nil {
			return nil, false
		}
		select {
		case d := <-msgs:
			return d.Body, true
		case <-time.After(timeout):
			return nil, false
		}
	}

	t.Run("quorum publish and consume", func(t *testing.T) {
		event := map[string]interface{}{"event_type": "user.cancel_subscription", "data": map[string]string{"userId": "ha-user-1"}}
		body, _ := json.Marshal(event)
		w := postJSON("/internal/events", map[string]string{"X-Internal-Key": internalKey}, body)
		require.Equal(t, http.StatusOK, w.Code)

		consumed, ok := consumeOne(cluster.PrimaryURL(ctx), base, 10*time.Second)
		require.True(t, ok, "expected message on quorum queue")
		var got map[string]interface{}
		require.NoError(t, json.Unmarshal(consumed, &got))
		assert.Equal(t, "user.cancel_subscription", got["event_type"])
	})

	t.Run("classic redeclare of quorum queue fails 406", func(t *testing.T) {
		conn, err := amqp.Dial(cluster.PrimaryURL(ctx))
		require.NoError(t, err)
		defer conn.Close()
		ch, err := conn.Channel()
		require.NoError(t, err)
		defer ch.Close()
		// Same name, no x-queue-type (classic) must conflict with existing quorum queue.
		_, err = ch.QueueDeclare(base, true, false, false, false, amqp.Table{
			"x-dead-letter-exchange":    base + "_dlx",
			"x-dead-letter-routing-key": base,
		})
		require.Error(t, err, "expected PRECONDITION_FAILED when redeclaring quorum as classic")
		assert.Contains(t, err.Error(), "PRECONDITION_FAILED")
	})

	t.Run("DLQ is quorum when main is quorum", func(t *testing.T) {
		conn, err := amqp.Dial(cluster.PrimaryURL(ctx))
		require.NoError(t, err)
		defer conn.Close()
		ch, err := conn.Channel()
		require.NoError(t, err)
		defer ch.Close()
		// Producer declares <base>_dlq as quorum; classic redeclare must 406.
		_, err = ch.QueueDeclare(base+"_dlq", true, false, false, false, nil)
		require.Error(t, err, "expected 406: DLQ should be quorum, not classic")
		assert.Contains(t, err.Error(), "PRECONDITION_FAILED")
	})

	t.Run("survives single node failure with no loss", func(t *testing.T) {
		const n = 20
		for i := 0; i < n; i++ {
			body := []byte(fmt.Sprintf(`{"event_type":"subscription.updated","data":{"id":"ha-%d"}}`, i))
			sig := haPaddleSignature(webhookSecret, body, time.Now().Unix())
			w := postJSON("/webhook/paddle", map[string]string{"Paddle-Signature": sig}, body)
			require.Equal(t, http.StatusOK, w.Code, "publish %d", i)
		}
		// Inspect depth before kill to confirm all 20 enqueued.
		func() {
			conn, err := amqp.Dial(cluster.PrimaryURL(ctx))
			require.NoError(t, err)
			defer conn.Close()
			ch, err := conn.Channel()
			require.NoError(t, err)
			defer ch.Close()
			q, err := ch.QueueInspect(base)
			require.NoError(t, err)
			t.Logf("depth before kill: %d", q.Messages)
		}()
		// Kill a follower (idx 2); quorum majority (2/3) remains.
		require.NoError(t, cluster.KillNode(ctx, 2))

		// Producer on node0 must stay connected (or reconnect quickly).
		assert.Eventually(t, func() bool { return prod.IsConnected() }, 60*time.Second, 500*time.Millisecond)

		// Drain all N via a surviving node URL using a single long-lived consumer.
		survivor := cluster.PrimaryURL(ctx)
		conn, err := amqp.Dial(survivor)
		require.NoError(t, err)
		defer conn.Close()
		ch, err := conn.Channel()
		require.NoError(t, err)
		defer ch.Close()
		// Also log post-kill depth before draining.
		func() {
			q, err := ch.QueueInspect(base)
			if err == nil {
				t.Logf("depth after kill before drain: %d", q.Messages)
			} else {
				t.Logf("QueueInspect after kill failed: %v", err)
			}
		}()
		msgs, err := ch.Consume(base, "", true, false, false, false, nil)
		require.NoError(t, err)
		seen := map[string]bool{}
		timeout := time.After(30 * time.Second)
		for len(seen) < n {
			select {
			case d, ok := <-msgs:
				if !ok {
					t.Fatalf("consume channel closed early, seen %d/%d", len(seen), n)
				}
				seen[string(d.Body)] = true
			case <-timeout:
				t.Logf("timeout draining, seen %d/%d: %v", len(seen), n, seen)
				// Log queue state at timeout
				if q, err := ch.QueueInspect(base); err == nil {
					t.Logf("queue inspect at timeout: messages=%d consumers=%d", q.Messages, q.Consumers)
				}
				assert.Len(t, seen, n, "all messages must survive single-node kill")
				return
			}
		}
		assert.Len(t, seen, n, "all messages must survive single-node kill")
	})
}
