import { GenericContainer, Network, Wait, type StartedNetwork, type StartedTestContainer } from "testcontainers"

export const HA_RABBIT_IMAGE = "rabbitmq:3.13-management-alpine"
const HA_COOKIE = "ha-test-cookie"
const AMQP_PORT = 5672

export interface RabbitCluster {
  network: StartedNetwork
  nodes: (StartedTestContainer | null)[]
  user: string
  pass: string
  urls(): string[]
  primaryUrl(): string
  killNode(idx: number): Promise<void>
  cleanup(): Promise<void>
}

async function execOrThrow(node: StartedTestContainer, cmd: string[]): Promise<string> {
  const res = await node.exec(cmd)
  if (res.exitCode !== 0) {
    throw new Error(`exec ${cmd.join(" ")} exited ${res.exitCode}: ${res.output}`)
  }
  return res.output
}

/**
 * 3-node RabbitMQ cluster for web publisher HA tests. No Compose:
 * programmatic containers on a dedicated network with shared Erlang cookie,
 * joined via rabbitmqctl. Mirrors Amazon MQ CLUSTER_MULTI_AZ (quorum, leader
 * election, single-node survival). Same pattern as workers
 * `src/tests/containers-rabbitmq-cluster.ts`; both `withNetworkAliases` and
 * `withHostname` are required (hostname alone does not register Docker DNS).
 */
export async function startRabbitCluster(
  user = "guest",
  pass = "guest",
  image = HA_RABBIT_IMAGE,
): Promise<RabbitCluster> {
  const network = await new Network().start()
  const nodes: (StartedTestContainer | null)[] = []

  try {
    for (let i = 0; i < 3; i++) {
      const hostname = `rabbit${i + 1}`
      const container = new GenericContainer(image)
        .withEnvironment({
          RABBITMQ_DEFAULT_USER: user,
          RABBITMQ_DEFAULT_PASS: pass,
          RABBITMQ_ERLANG_COOKIE: HA_COOKIE,
          RABBITMQ_NODENAME: `rabbit@${hostname}`,
          RABBITMQ_USE_LONGNAME: "false",
        })
        .withExposedPorts(AMQP_PORT, 15672)
        .withWaitStrategy(Wait.forLogMessage("Server startup complete"))
        .withStartupTimeout(120_000)
        .withNetwork(network)
        .withNetworkAliases(hostname)
        .withHostname(hostname)
      const started = await container.start()
      nodes.push(started)
    }

    // Join node2/node3 to node1 with retries (nodes need a few seconds post-log).
    for (let i = 1; i < 3; i++) {
      let joined = false
      let lastErr: unknown = null
      for (let attempt = 0; attempt < 12 && !joined; attempt++) {
        try {
          await execOrThrow(nodes[i]!, ["rabbitmqctl", "stop_app"])
          await execOrThrow(nodes[i]!, ["rabbitmqctl", "join_cluster", "rabbit@rabbit1"])
          await execOrThrow(nodes[i]!, ["rabbitmqctl", "start_app"])
          joined = true
        } catch (e) {
          lastErr = e
          try {
            await nodes[i]!.exec(["rabbitmqctl", "start_app"])
          } catch {}
          await new Promise((r) => setTimeout(r, 5000))
        }
      }
      if (!joined) throw lastErr instanceof Error ? lastErr : new Error(`join node ${i + 1} failed`)
    }

    // Verify 3 running nodes.
    const deadline = Date.now() + 90_000
    let clustered = false
    while (Date.now() < deadline && !clustered) {
      try {
        const out = await execOrThrow(nodes[0]!, ["rabbitmqctl", "cluster_status"])
        clustered =
          out.includes("rabbit@rabbit1") && out.includes("rabbit@rabbit2") && out.includes("rabbit@rabbit3")
      } catch {}
      if (!clustered) await new Promise((r) => setTimeout(r, 3000))
    }
    if (!clustered) throw new Error("rabbitmq cluster did not form 3 nodes")

    const urls = () =>
      nodes
        .filter((n): n is StartedTestContainer => n !== null)
        .map((n) => `amqp://${user}:${pass}@${n.getHost()}:${n.getMappedPort(AMQP_PORT)}/`)

    return {
      network,
      nodes,
      user,
      pass,
      urls,
      primaryUrl: () => {
        const all = urls()
        if (all.length === 0) throw new Error("no rabbit nodes available")
        return all[0] as string
      },
      async killNode(idx: number) {
        const n = nodes[idx]
        if (n) {
          await n.stop().catch(() => {})
          nodes[idx] = null
        }
      },
      async cleanup() {
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i]
          if (n) {
            await n.stop().catch(() => {})
            nodes[i] = null
          }
        }
        await network.stop().catch(() => {})
      },
    }
  } catch (e) {
    for (const n of nodes) {
      if (n) await n.stop().catch(() => {})
    }
    await network.stop().catch(() => {})
    throw e
  }
}
