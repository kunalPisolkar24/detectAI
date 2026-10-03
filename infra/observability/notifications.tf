# Email-only notifications. One destination + channel, one workflow fanning
# all policies to that channel. No Slack/PagerDuty in v1.
resource "newrelic_notification_destination" "email" {
  account_id = var.newrelic_account_id
  name       = "detectai-email-${var.environment}"
  type       = "EMAIL"

  property {
    key   = "email"
    value = var.alert_email
  }
}

resource "newrelic_notification_channel" "email" {
  account_id     = var.newrelic_account_id
  name           = "detectai-email-${var.environment}"
  type           = "EMAIL"
  destination_id = newrelic_notification_destination.email.id
  product        = "IINT"

  property {
    key   = "subject"
    value = "DetectAI {{accountName}}: {{conditionName}} ({{priority}})"
  }
}

resource "newrelic_workflow" "email_all" {
  account_id = var.newrelic_account_id
  name       = "detectai-email-all-${var.environment}"

  muting_rules_handling = "NOTIFY_ALL_ISSUES"

  issues_filter {
    name = "all-detectai"
    type = "FILTER"

    predicate {
      attribute = "policyName"
      operator  = "CONTAINS"
      values    = ["detectai-"]
    }
  }

  destination {
    channel_id = newrelic_notification_channel.email.id
  }
}
