//go:build ha_integration

package integration

import (
	"context"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// HACluster is a 3-node RabbitMQ cluster for accuracy-over-speed HA tests.
// No Compose: all containers are started programmatically on a dedicated
// Docker network with a shared Erlang cookie, then joined via rabbitmqctl.
// Mirrors Amazon MQ CLUSTER_MULTI_AZ semantics (quorum queues, leader election,
// single-node failure survival) without needing real AWS.
type HACluster struct {
	Network testcontainers.Network
	Nodes   []testcontainers.Container
	User    string
	Pass    string
}

const haRabbitImage = "rabbitmq:3.13-management-alpine"

func withHANetwork(networkName, alias, hostname string) testcontainers.CustomizeRequestOption {
	return func(req *testcontainers.GenericContainerRequest) error {
		req.Networks = []string{networkName}
		if req.NetworkAliases == nil {
			req.NetworkAliases = map[string][]string{}
		}
		req.NetworkAliases[networkName] = []string{alias}
		prev := req.ConfigModifier
		req.ConfigModifier = func(c *container.Config) {
			if prev != nil {
				prev(c)
			}
			c.Hostname = hostname
		}
		return nil
	}
}

func execRabbit(ctx context.Context, c testcontainers.Container, args ...string) (string, error) {
	dc, ok := c.(*testcontainers.DockerContainer)
	if !ok {
		return "", fmt.Errorf("not a docker container")
	}
	code, reader, err := dc.Exec(ctx, args)
	if err != nil {
		return "", err
	}
	out, _ := io.ReadAll(reader)
	if code != 0 {
		return string(out), fmt.Errorf("exec %v exited %d: %s", args, code, string(out))
	}
	return string(out), nil
}

// NewHACluster starts 3 rabbitmq nodes and joins them into a cluster.
// Caller must defer cluster.Cleanup(ctx). Requires Docker.
func NewHACluster(ctx context.Context, t *testing.T, user, pass string) *HACluster {
	t.Helper()
	testcontainers.SkipIfProviderIsNotHealthy(t)

	cookie := "ha-test-cookie"
	netName := fmt.Sprintf("rmq-ha-%d", time.Now().UnixNano())
	nw, err := testcontainers.GenericNetwork(ctx, testcontainers.GenericNetworkRequest{
		NetworkRequest: testcontainers.NetworkRequest{Name: netName},
	})
	require.NoError(t, err)

	nodes := make([]testcontainers.Container, 0, 3)
	cleanupOnFail := func() {
		for _, n := range nodes {
			_ = n.Terminate(ctx)
		}
		_ = nw.Remove(ctx)
	}

	for i := 0; i < 3; i++ {
		hostname := fmt.Sprintf("rabbit%d", i+1)
		ctr, err := testcontainers.Run(ctx, haRabbitImage,
			testcontainers.WithEnv(map[string]string{
				"RABBITMQ_DEFAULT_USER":    user,
				"RABBITMQ_DEFAULT_PASS":    pass,
				"RABBITMQ_ERLANG_COOKIE":   cookie,
				"RABBITMQ_NODENAME":        fmt.Sprintf("rabbit@%s", hostname),
				"RABBITMQ_USE_LONGNAME":    "false",
			}),
			testcontainers.WithExposedPorts("5672/tcp", "15672/tcp"),
			testcontainers.WithWaitStrategy(
				wait.ForLog(".*Server startup complete.*").AsRegexp().WithStartupTimeout(120*time.Second),
			),
			withHANetwork(netName, hostname, hostname),
		)
		if err != nil {
			cleanupOnFail()
			require.NoError(t, err)
		}
		nodes = append(nodes, ctr)
	}

	// Join node2/node3 to node1. stop_app/join/start must run after each node is up.
	for i := 1; i < 3; i++ {
		var lastErr error
		joined := false
		for attempt := 0; attempt < 12 && !joined; attempt++ {
			_, lastErr = execRabbit(ctx, nodes[i], "rabbitmqctl", "stop_app")
			if lastErr != nil {
				time.Sleep(5 * time.Second)
				continue
			}
			_, lastErr = execRabbit(ctx, nodes[i], "rabbitmqctl", "join_cluster", "rabbit@rabbit1")
			if lastErr != nil {
				_, _ = execRabbit(ctx, nodes[i], "rabbitmqctl", "start_app")
				time.Sleep(5 * time.Second)
				continue
			}
			_, lastErr = execRabbit(ctx, nodes[i], "rabbitmqctl", "start_app")
			if lastErr != nil {
				time.Sleep(5 * time.Second)
				continue
			}
			joined = true
		}
		if !joined {
			cleanupOnFail()
			require.NoError(t, lastErr, "failed to join node %d to cluster", i+1)
		}
	}

	// Verify 3 running nodes via rabbit1.
	require.Eventually(t, func() bool {
		out, err := execRabbit(ctx, nodes[0], "rabbitmqctl", "cluster_status")
		if err != nil {
			return false
		}
		// cluster_status lists running_nodes; require all three hostnames present.
		return strings.Contains(out, "rabbit@rabbit1") &&
			strings.Contains(out, "rabbit@rabbit2") &&
			strings.Contains(out, "rabbit@rabbit3")
	}, 90*time.Second, 3*time.Second, "cluster did not form 3 nodes")

	return &HACluster{Network: nw, Nodes: nodes, User: user, Pass: pass}
}

// AmqpURL returns the host-mapped amqp:// URL for node idx.
func (h *HACluster) AmqpURL(ctx context.Context, idx int) string {
	endpoint, err := h.Nodes[idx].PortEndpoint(ctx, "5672/tcp", "")
	if err != nil {
		return ""
	}
	return fmt.Sprintf("amqp://%s:%s@%s", h.User, h.Pass, endpoint)
}

// PrimaryURL is node0's URL (initial contact point; NLB-like failover uses AllURLs).
func (h *HACluster) PrimaryURL(ctx context.Context) string {
	return h.AmqpURL(ctx, 0)
}

// AllURLs returns non-terminated node URLs (skips killed nodes).
func (h *HACluster) AllURLs(ctx context.Context) []string {
	out := []string{}
	for i, n := range h.Nodes {
		if n == nil {
			continue
		}
		_ = i
		ep, err := n.PortEndpoint(ctx, "5672/tcp", "")
		if err != nil {
			continue
		}
		out = append(out, fmt.Sprintf("amqp://%s:%s@%s", h.User, h.Pass, ep))
	}
	return out
}

// KillNode terminates node idx (broker-restart chaos). Surviving nodes keep quorum.
func (h *HACluster) KillNode(ctx context.Context, idx int) error {
	if h.Nodes[idx] == nil {
		return nil
	}
	err := h.Nodes[idx].Terminate(ctx)
	h.Nodes[idx] = nil
	return err
}

// Cleanup terminates remaining nodes and removes the network.
func (h *HACluster) Cleanup(ctx context.Context) {
	for i, n := range h.Nodes {
		if n != nil {
			_ = n.Terminate(ctx)
			h.Nodes[i] = nil
		}
	}
	if h.Network != nil {
		_ = h.Network.Remove(ctx)
	}
}
