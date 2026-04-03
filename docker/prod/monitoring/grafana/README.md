# Grafana Dashboard Management

The Grafana dashboards in this repo are provisioned from files and grouped by purpose:

- `dashboards/overview`
- `dashboards/services`
- `dashboards/infrastructure`

The source of truth for those dashboards is:

- `scripts/generate-dashboards.mjs`

If you want to change dashboard content, update the generator script and then regenerate the JSON files:

```bash
node docker/prod/monitoring/grafana/scripts/generate-dashboards.mjs
```

Provisioning is managed by:

- `provisioning/datasources/datasource.yml`
- `provisioning/dashboards/dashboards.yml`

Guidelines:

- Keep dashboard UIDs stable so links and bookmarks do not break.
- Prefer adding new dashboards to the right folder instead of making one giant overview.
- Keep panels focused on production signals: availability, traffic, errors, latency, saturation, and resource usage.
- Use Prometheus job labels for service-level dashboards and cAdvisor compose-service labels for container-level dashboards.
