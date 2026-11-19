#!/usr/bin/env python3
"""Generate terraform/imports.tf from the live New Relic plane.

Used by `make recover-state` when the floci state ledger cannot be restored
from a local snapshot. Every live board, alert policy, NRQL condition and
notification resource is adopted into state, so the following plan updates
them in place instead of creating a second generation.

Import IDs follow the provider's contract: dashboard GUID, policy id,
condition `policyId:conditionId`, notification UUID.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / "envs" / ".env"
TF_DIR = ROOT / "terraform"
API = "https://api.eu.newrelic.com/graphql"

# Conditions that were renamed in place: the live resource keeps its ID, so the
# new Terraform address must import the old condition.
CONDITION_ALIASES = {"Chats RPC error share high": "Chats Redis degraded"}


def credential(name: str) -> str | None:
    if os.environ.get(name):
        return os.environ[name]
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip()
    return None


def gql(query: str):
    key = credential("NEW_RELIC_API_KEY")
    if not key:
        raise SystemExit("error: NEW_RELIC_API_KEY is missing (envs/.env or shell)")
    request = urllib.request.Request(
        API,
        data=json.dumps({"query": query}).encode(),
        headers={"API-Key": key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.load(response)
    if body.get("errors"):
        raise SystemExit(f"error: NerdGraph query failed: {json.dumps(body['errors'])[:400]}")
    return body["data"]


def template_name(path: Path) -> str:
    match = re.search(r'"name":\s*"([^"]+)"', path.read_text())
    if not match:
        raise SystemExit(f"error: no dashboard name in {path}")
    return match.group(1).replace("${environment}", "prod")


def board_modules() -> dict[str, str]:
    modules = {}
    for template in sorted((TF_DIR / "dashboards").glob("*/*.tftpl")):
        key = template.parent.name.replace("-", "_")
        if template.stem != "prod":
            key += f"_{template.stem}"
        modules[key] = template_name(template)
    return modules


def policy_areas() -> dict[str, str]:
    text = (TF_DIR / "alerts" / "shared.tf").read_text()
    block = re.search(r"area_policies\s*=\s*\{(.*?)\n\s*\}", text, re.DOTALL)
    if not block:
        raise SystemExit("error: could not read area_policies from alerts/shared.tf")
    return dict(re.findall(r'(\w+)\s*=\s*"([^"]+)"', block.group(1)))


def condition_modules() -> dict[str, str]:
    modules = {}
    for path in sorted((TF_DIR / "alerts").glob("*.tf")):
        text = path.read_text()
        for match in re.finditer(r'module\s+"(\w+)"\s*\{(.*?)(?=\nmodule\s+"|\Z)', text, re.DOTALL):
            name = re.search(r'name\s*=\s*"([^"]+)"', match.group(2))
            if name:
                modules[match.group(1)] = name.group(1)
    return modules


def notification_names() -> dict[str, str]:
    text = (TF_DIR / "alerts" / "notifications.tf").read_text()
    result = {}
    for match in re.finditer(
        r'resource\s+"(\w+)"\s+"(\w+)"\s*\{(.*?)(?=\nresource\s+"|\Z)', text, re.DOTALL
    ):
        name = re.search(r'name\s*=\s*"([^"]+)"', match.group(3))
        if name:
            address = f"module.alerts.{match.group(1)}.{match.group(2)}"
            result[address] = name.group(1).replace("${var.environment}", "prod")
    return result


def main() -> int:
    key = credential("NEW_RELIC_API_KEY")
    account = credential("NEW_RELIC_ACCOUNT_ID")
    if not key or not account:
        raise SystemExit("error: NEW_RELIC_API_KEY and NEW_RELIC_ACCOUNT_ID are required")
    account_id = int(account)

    dashboards = gql("""
    { actor { entitySearch(query: "domain = 'VIZ' AND type = 'DASHBOARD'") {
      results { entities { guid name account { id } } } } } }
    """)["actor"]["entitySearch"]["results"]["entities"]
    live_boards = {
        e["name"]: e["guid"]
        for e in dashboards
        if str(e["account"]["id"]) == str(account_id) and " / " not in e["name"]
    }

    account = gql(f"""
    {{ actor {{ account(id: {account_id}) {{
      alerts {{
        policiesSearch {{ policies {{ id name }} }}
        nrqlConditionsSearch {{ nrqlConditions {{ id name policyId }} }}
      }}
      aiNotifications {{
        destinations {{ entities {{ id name }} }}
        channels {{ entities {{ id name }} }}
      }}
      aiWorkflows {{ workflows {{ entities {{ id name }} }} }}
    }} }} }}
    """)["actor"]["account"]
    policies = {p["name"]: p["id"] for p in account["alerts"]["policiesSearch"]["policies"]}
    conditions = {c["name"]: c for c in account["alerts"]["nrqlConditionsSearch"]["nrqlConditions"]}
    destinations = {d["name"]: d["id"] for d in account["aiNotifications"]["destinations"]["entities"]}
    channels = {c["name"]: c["id"] for c in account["aiNotifications"]["channels"]["entities"]}
    workflows = {w["name"]: w["id"] for w in account["aiWorkflows"]["workflows"]["entities"]}

    lines = [f"# Generated by scripts/recover_state.py on account {account_id}.", ""]

    def emit(address: str, identifier: str) -> None:
        lines.extend(["import {", f"  to = {address}", f'  id = "{identifier}"', "}", ""])

    missing = []
    for module, name in board_modules().items():
        if name not in live_boards:
            missing.append(f"board {name!r}")
            continue
        emit(f"module.dashboards.module.{module}.newrelic_one_dashboard_json.board", live_boards[name])
    for area, label in policy_areas().items():
        name = f"detectai-{label}-prod"
        if name not in policies:
            missing.append(f"policy {name!r}")
            continue
        emit(f'module.alerts.newrelic_alert_policy.area["{area}"]', policies[name])
    for module, name in condition_modules().items():
        # Prefer the current config name; fall back to a known former name for
        # conditions that were renamed in place and still carry their old ID.
        candidates = [name, CONDITION_ALIASES.get(name, name)]
        condition = next((conditions[c] for c in candidates if c in conditions), None)
        if not condition:
            missing.append(f"condition {name!r}")
            continue
        emit(
            f"module.alerts.module.{module}.newrelic_nrql_alert_condition.condition",
            f"{condition['policyId']}:{condition['id']}",
        )
    for address, source in (
        ("module.alerts.newrelic_notification_destination.email", destinations),
        ("module.alerts.newrelic_notification_channel.email", channels),
        ("module.alerts.newrelic_workflow.email_all", workflows),
    ):
        for name, identifier in notification_names().items():
            if name == address and identifier in source:
                emit(address, source[identifier])

    if missing:
        raise SystemExit("error: live resources missing: " + ", ".join(missing))

    target = TF_DIR / "imports.tf"
    target.write_text("\n".join(lines))
    print(f"wrote {target.relative_to(ROOT)} with {sum(1 for l in lines if l == 'import {')} imports")
    return 0


if __name__ == "__main__":
    sys.exit(main())
