#!/usr/bin/env python3
# The board census: the account must hold exactly the dashboards this stack
# declares, each once. It fails on duplicated or missing boards — the aftermath
# of an apply that ran with an empty state file — so a second blind apply can
# never fan out a fresh copy of every board and policy (the Nov 8 incident).

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / "envs" / ".env"
API = "https://api.eu.newrelic.com/graphql"

DASHBOARD_QUERY = """
query {
  actor { entitySearch(query: "domain = 'VIZ' AND type = 'DASHBOARD'") {
    count
    results { entities {
      guid name account { id }
      ... on DashboardEntityOutline { createdAt }
      tags { key values }
    } }
  } }
}"""


def load_credential(name):
    shell = os.environ.get(name)
    if shell:
        return shell
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip()
    return None


def template_board_name(template):
    match = re.search(r'"name":\s*"([^"]+)"', template.read_text())
    if not match:
        raise SystemExit(f"error: no dashboard name found in {template.relative_to(ROOT)}")
    return match.group(1).replace("${environment}", "prod")


def declared_board_names():
    names = {}
    for template in sorted((ROOT / "terraform" / "dashboards").glob("*/*.tftpl")):
        names[template_board_name(template)] = template.relative_to(ROOT)
    return names


def live_dashboards(api_key):
    req = urllib.request.Request(
        API,
        data=json.dumps({"query": DASHBOARD_QUERY}).encode(),
        headers={"API-Key": api_key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.load(resp)
    if body.get("errors"):
        raise SystemExit(f"error: entity search failed: {body['errors']}")
    search = body["data"]["actor"]["entitySearch"]
    entities = search["results"]["entities"]
    if len(entities) != search["count"]:
        raise SystemExit(f"error: entity search truncation: {len(entities)} of {search['count']}")
    account_id = load_credential("NEW_RELIC_ACCOUNT_ID") or ""
    return [e for e in entities if str(e["account"]["id"]) == account_id]


def main():
    api_key = load_credential("NEW_RELIC_API_KEY")
    if not api_key:
        raise SystemExit("error: NEW_RELIC_API_KEY is missing (envs/.env or shell)")

    declared = declared_board_names()
    live = live_dashboards(api_key)
    boards = [e for e in live if " / " not in e["name"]]
    tagged = [
        e for e in boards
        if any(t["key"] == "managed-by" and "terraform" in (t["values"] or [])
               for t in e["tags"] or [])
    ]
    have = {b["name"] for b in tagged}

    failures = []
    by_name = {}
    for board in live:
        by_name.setdefault(board["name"], []).append(board)
    for name, copies in sorted(by_name.items()):
        if len(copies) > 1:
            stamps = ", ".join(f"{c['guid']} ({c['createdAt'][:10]})" for c in copies)
            failures.append(f"duplicated board name {name!r}: {stamps}")
    for name in sorted(set(declared) - have):
        failures.append(f"missing declared board {name!r}")
    for name in sorted(have - set(declared)):
        failures.append(f"unexpected terraform-managed board {name!r}")

    for name in sorted(set(b["name"] for b in boards) - set(declared)):
        print(f"warning: board not managed by this stack: {name}")
    print(f"live boards: {len(boards)} ({len(live) - len(boards)} page entities) | "
          f"declared: {len(declared)} | terraform-tagged: {len(tagged)}")
    if failures:
        for failure in failures:
            print(f"failure: {failure}")
        raise SystemExit(1)
    print("audit: clean")


if __name__ == "__main__":
    main()
