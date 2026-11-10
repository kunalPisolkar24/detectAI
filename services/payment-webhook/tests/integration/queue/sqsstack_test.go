package queue_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	dockerclient "github.com/moby/moby/client"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/router"
)

const (
	webhookSecret = "paddle-change-me-16-chars"
	queueAccount  = "000000000000/payment_events.fifo"
	servedBody    = 1 << 20
	occurredAt    = "2026-11-10T09:00:00Z"
)

// elasticConf replicates the shared dev emulator conf (infra/docker/elasticmq/elasticmq.conf),
// so the suite meets the same strict-limits queue plane the service meets elsewhere.
const elasticConf = `include classpath("application.conf")

node-address {
  protocol = http
  host = localhost
  port = 9324
  context-path = ""
}

rest-sqs {
  enabled = true
  bind-port = 9324
  bind-hostname = "0.0.0.0"
  sqs-limits = strict
}

aws {
  region = ap-southeast-2
  accountId = "000000000000"
}

queues {
  "payment_events.fifo" {
    fifo = true
    contentBasedDeduplication = true
    defaultVisibilityTimeout = 300 seconds
    delay = 0 seconds
    receiveMessageWait = 0 seconds
    deadLettersQueue {
      name = "payment_events_dlq.fifo"
      maxReceiveCount = 5
    }
  }
  "payment_events_dlq.fifo" {
    fifo = true
    contentBasedDeduplication = true
    defaultVisibilityTimeout = 300 seconds
    delay = 0 seconds
    receiveMessageWait = 0 seconds
  }
}`

// dockerReachable gates the suite; no daemon means the layer skips and `make test` stays green.
func dockerReachable() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	client, err := dockerclient.NewClientWithOpts(dockerclient.FromEnv, dockerclient.WithAPIVersionNegotiation())
	if err != nil {
		return false
	}
	_, err = client.Ping(ctx, dockerclient.PingOptions{})
	return err == nil
}

// stack is one live slice of the app: emulator, real SQS transport, serving router.
type stack struct {
	container testcontainers.Container
	client    *sqs.Client
	web       http.Client
	baseURL   string
	queueURL  string
}

func newStack(t *testing.T) *stack {
	t.Helper()
	gin.SetMode(gin.TestMode)
	ctx := context.Background()

	conf := filepath.Join(t.TempDir(), "elasticmq.conf")
	if err := os.WriteFile(conf, []byte(elasticConf), 0o644); err != nil {
		t.Fatalf("write the emulator conf: %v", err)
	}
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "softwaremill/elasticmq-native:1.7.1",
			ExposedPorts: []string{"9324/tcp"},
			Files: []testcontainers.ContainerFile{{
				HostFilePath:      conf,
				ContainerFilePath: "/opt/elasticmq.conf",
				FileMode:          0o644,
			}},
			WaitingFor: wait.ForHTTP("/health").WithPort("9324").WithStartupTimeout(60 * time.Second),
		},
		Started: true,
	})
	if err != nil {
		t.Fatalf("start the emulator: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = container.Terminate(ctx)
	})

	host, err := container.Host(ctx)
	if err != nil {
		t.Fatalf("resolve the emulator host: %v", err)
	}
	port, err := container.MappedPort(ctx, "9324")
	if err != nil {
		t.Fatalf("map the emulator port: %v", err)
	}
	endpoint := fmt.Sprintf("http://%s:%s", host, port.Port())

	baseURL, client, queueURL := bootApp(t, endpoint)
	return &stack{
		container: container,
		client:    client,
		web:       http.Client{Timeout: 15 * time.Second},
		baseURL:   baseURL,
		queueURL:  queueURL,
	}
}

// bootApp assembles the service exactly as cmd/api does and serves it on a live listener.
func bootApp(t *testing.T, endpoint string) (baseURL string, client *sqs.Client, queueURL string) {
	t.Helper()
	queueURL = endpoint + "/" + queueAccount

	t.Setenv("ENV_TYPE", "dev")
	t.Setenv("PADDLE_WEBHOOK_SECRET", webhookSecret)
	t.Setenv("MAX_BODY_BYTES", strconv.FormatInt(servedBody, 10))
	t.Setenv("QUEUE_URL", queueURL)
	t.Setenv("PUBLISH_BUDGET", "5s")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	t.Setenv("OTEL_SERVICE_NAME", "payment-webhook-test")
	t.Setenv("OTEL_SERVICE_VERSION", "integration")
	t.Setenv("OTEL_TRACE_SAMPLE_RATIO", "1")
	t.Setenv("AWS_REGION", "ap-southeast-2")
	t.Setenv("AWS_ACCESS_KEY_ID", "test")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test")
	t.Setenv("AWS_ENDPOINT_URL_SQS", endpoint)
	t.Setenv("AWS_CONFIG_FILE", filepath.Join(t.TempDir(), "aws_config"))
	t.Setenv("AWS_SHARED_CREDENTIALS_FILE", filepath.Join(t.TempDir(), "aws_credentials"))

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load on the dev plane: %v", err)
	}
	flick, err := config.DeploymentFlick()
	if err != nil {
		t.Fatal(err)
	}
	obs, err := observability.Boot(cfg, flick)
	if err != nil {
		t.Fatalf("observability boot: %v", err)
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background())
	if err != nil {
		t.Fatalf("SQS client config: %v", err)
	}
	client = sqs.NewFromConfig(awsCfg)
	publish := queue.NewService(queue.NewSQSAdapter(client, cfg.QueueURL), cfg.PublishBudget)
	server := httptest.NewServer(router.New(cfg, publish, obs))
	t.Cleanup(server.Close)
	return server.URL, client, queueURL
}

// stopQueue kills the emulator to drive the outage row against real wire truth.
func (s *stack) stopQueue(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := s.container.Stop(ctx, nil); err != nil {
		t.Fatalf("stop the emulator: %v", err)
	}
}

// signBody signs with the true secret over "<ts>:<raw-body>", both fragments in one header.
func signBody(body []byte) string {
	return signWith(webhookSecret, body, 0)
}

func signWith(secret string, body []byte, ageSeconds int64) string {
	ts := strconv.FormatInt(time.Now().Unix()-ageSeconds, 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + ":"))
	mac.Write(body)
	return "ts=" + ts + ";h1=" + hex.EncodeToString(mac.Sum(nil))
}

func (s *stack) post(t *testing.T, body []byte, signature string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, s.baseURL+"/api/v1/webhook/paddle", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if signature != "" {
		req.Header.Set("Paddle-Signature", signature)
	}
	return s.do(t, req)
}

func (s *stack) get(t *testing.T, path string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, s.baseURL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	return s.do(t, req)
}

func (s *stack) do(t *testing.T, req *http.Request) (*http.Response, string) {
	t.Helper()
	res, err := s.web.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", req.Method, req.URL, err)
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read the response: %v", err)
	}
	return res, string(payload)
}

// collect receives until want messages arrive or the budget elapses; the caller asserts the count.
func (s *stack) collect(t *testing.T, want int, budget time.Duration) []types.Message {
	t.Helper()
	var got []types.Message
	deadline := time.Now().Add(budget)
	for len(got) < want && time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		out, err := s.client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
			QueueUrl:              aws.String(s.queueURL),
			MaxNumberOfMessages:   10,
			AttributeNames:        []types.QueueAttributeName{types.QueueAttributeNameAll},
			MessageAttributeNames: []string{"All"},
		})
		cancel()
		if err != nil {
			t.Fatalf("receive from the queue: %v", err)
		}
		got = append(got, out.Messages...)
		if len(out.Messages) == 0 {
			time.Sleep(50 * time.Millisecond)
		}
	}
	return got
}

// pollSilence drains long enough for a late arrival to surface, failing if one does.
func (s *stack) pollSilence(t *testing.T, budget time.Duration) {
	t.Helper()
	deadline := time.Now().Add(budget)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		out, err := s.client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
			QueueUrl:              aws.String(s.queueURL),
			MaxNumberOfMessages:   10,
			AttributeNames:        []types.QueueAttributeName{types.QueueAttributeNameAll},
			MessageAttributeNames: []string{"All"},
		})
		cancel()
		if err != nil {
			t.Fatalf("receive from the queue: %v", err)
		}
		if len(out.Messages) > 0 {
			t.Fatalf("the queue depth rose: %d message(s), first event_id %q",
				len(out.Messages), s.attr(t, out.Messages[0], "event_id"))
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func (s *stack) attr(t *testing.T, message types.Message, name string) string {
	t.Helper()
	attribute, ok := message.MessageAttributes[name]
	if !ok {
		t.Errorf("attribute %q missing on the delivered message", name)
		return ""
	}
	if deref(attribute.DataType) != "String" {
		t.Errorf("attribute %q type = %q, want String", name, deref(attribute.DataType))
	}
	return deref(attribute.StringValue)
}

// system reads a receive-side system attribute (group ids, dedup ids) by name.
func (s *stack) system(t *testing.T, message types.Message, name string) string {
	t.Helper()
	value, ok := message.Attributes[name]
	if !ok {
		t.Errorf("system attribute %q missing on the delivered message", name)
		return ""
	}
	return value
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// paddleBody builds a Paddle-shaped envelope whose data ids each row shapes.
func paddleBody(eventID, eventType, occurred, data string) []byte {
	return []byte(fmt.Sprintf(`{"event_id":%q,"event_type":%q,"occurred_at":%q,"notification_id":%q,"data":%s}`,
		eventID, eventType, occurred, "ntf_"+eventID, data))
}

// bodyOfLength sizes a valid subscription body to an exact byte count.
func bodyOfLength(t *testing.T, eventID string, size int) []byte {
	t.Helper()
	base := paddleBody(eventID, "subscription.updated", occurredAt, `{"id":"sub_pad","note":""}`)
	if len(base) >= size {
		t.Fatalf("the %q skeleton already runs %d bytes; size target %d impossible", eventID, len(base), size)
	}
	note := strings.Repeat("a", size-len(base))
	raw := strings.Replace(string(base), `"note":""`, `"note":"`+note+`"`, 1)
	if len(raw) != size {
		t.Fatalf("the sized body ran %d bytes, want %d", len(raw), size)
	}
	return []byte(raw)
}

func requireStatus(t *testing.T, res *http.Response, body string, want int) {
	t.Helper()
	if res.StatusCode != want {
		t.Fatalf("status = %d, want %d (body %q)", res.StatusCode, want, body)
	}
}
