# Exactly one board and its grouping tags, per call site.
resource "newrelic_one_dashboard_json" "board" {
  account_id = var.account_id
  json       = var.json
}

resource "newrelic_entity_tags" "board" {
  guid = newrelic_one_dashboard_json.board.guid

  tag {
    key    = "team"
    values = ["detectai"]
  }

  tag {
    key    = "managed-by"
    values = ["terraform"]
  }

  tag {
    key    = "service"
    values = [var.scope]
  }

  tag {
    key    = "env"
    values = [var.env]
  }

  tag {
    key    = "kind"
    values = [var.kind]
  }
}
