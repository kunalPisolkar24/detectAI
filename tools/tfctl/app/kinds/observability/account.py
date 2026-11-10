"""The live account check: one GraphQL round-trip proving the credential pair."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Mapping

from app.engine.shell import die

MOCK_ACCOUNT_ID = 123456

GRAPHQL_HOSTS = {
    "EU": "https://api.eu.newrelic.com/graphql",
    "US": "https://api.newrelic.com/graphql",
    "JP": "https://api.jp.newrelic.com/graphql",
}


def live_check(config: Mapping[str, str | None]) -> None:
    """One GraphQL round-trip proving the key and the account fit together."""
    region = (config["region"] or "EU").upper()
    account_id = int(config["account_id"] or MOCK_ACCOUNT_ID)
    payload = json.dumps(
        {
            "query": "query($id: Int!) { actor { account(id: $id) { name } } }",
            "variables": {"id": account_id},
        }
    ).encode()
    request = urllib.request.Request(
        GRAPHQL_HOSTS[region],
        data=payload,
        headers={"API-Key": config["api_key"], "Content-Type": "application/json"},
    )
    bad_key = "check NEW_RELIC_API_KEY (User API key, NRAK-...)"
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = json.load(response)
    except urllib.error.HTTPError as err:
        fix = bad_key if err.code in (401, 403) else "retry, or check status.newrelic.com"
        die(f"New Relic API answered {err.code} ({err.reason})", fix)
    except urllib.error.URLError as err:
        die(
            f"cannot reach {GRAPHQL_HOSTS[region]}: {err.reason}",
            "check the network, then retry the check verb",
        )

    account = (body.get("data") or {}).get("actor", {}).get("account")
    if account is None:
        die(
            f"the key is valid but account {account_id} is not visible to it",
            "check NEW_RELIC_ACCOUNT_ID, or the key's user lacks this account",
        )
    print(f"  live: region {region}, account {account['name']} ({account_id}) OK")
