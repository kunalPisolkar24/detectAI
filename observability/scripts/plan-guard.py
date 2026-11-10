#!/usr/bin/env python3
# The apply gate: blocks `make apply`/`auto-apply` when the plan proposes
# creating a board that is already live on the account — the signature of an
# apply running from an empty or foreign state file. Recovering from a state
# loss instead of applying: docs/runbooks/recover-duplicate-dashboards.md.

import re
import sys
from pathlib import Path

import board_audit

ROOT = board_audit.ROOT

ADD_PATTERN = re.compile(
    r"#\s*module\.dashboards\.module\.(\w+)\.newrelic_one_dashboard_json\.board\s+will be created"
)


def board_modules():
    modules = {}
    for template in (ROOT / "terraform" / "dashboards").glob("*/*.tftpl"):
        key = template.parent.name
        if template.stem != "prod":
            key += f"_{template.stem}"
        modules[key] = board_audit.template_board_name(template)
    return modules


def main():
    if len(sys.argv) < 2 or sys.argv[1] == "-h":
        raise SystemExit("usage: plan-guard.py <plan-output-file|->  (plan text in, exit 0 = safe)")
    plan_text = sys.stdin.read() if sys.argv[1] == "-" else Path(sys.argv[1]).read_text()

    api_key = board_audit.load_credential("NEW_RELIC_API_KEY")
    if not api_key:
        raise SystemExit("error: NEW_RELIC_API_KEY is missing (envs/.env or shell)")
    live = {
        board["name"]
        for board in board_audit.live_dashboards(api_key)
        if " / " not in board["name"]
    }

    modules = board_modules()

    failures = []
    for key in dict.fromkeys(ADD_PATTERN.findall(re.sub(r"\x1b\[[0-9;]*m", "", plan_text))):
        declared = modules.get(key)
        if declared is None:
            failures.append(f"added dashboard from module '{key}' is not in any board template")
        elif declared in live:
            failures.append(f"board {declared!r} is already live; creating module '{key}' would duplicate it")

    if failures:
        for failure in failures:
            print(f"failure: {failure}")
        print("fix: recover the state instead of applying - docs/runbooks/recover-duplicate-dashboards.md")
        raise SystemExit(1)
    print("guard: no live board would be duplicated")


if __name__ == "__main__":
    main()
