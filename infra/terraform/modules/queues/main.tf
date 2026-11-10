# Two resource classes by redrive role: a queue that redrives cannot read its
# DLQ's arn from a block of its own, so targets live in a separate for_each.
# The declaration's ledger law guarantees redrive targets are terminal.

locals {
  terminal_queues      = { for key, queue in var.queues : key => queue if queue.dlq == "" }
  redrive_sources      = { for key, queue in var.queues : key => queue if queue.dlq != "" }
  terminal_key_by_name = { for key, queue in var.queues : queue.name => key if queue.dlq == "" }
}

# Retention and visibility mirror specification/messaging.md: retention stays
# IaC-only, not a runtime knob. Producers (payment-webhook) always carry an
# explicit MessageDeduplicationId, so content-based dedup stays off.

resource "aws_sqs_queue" "terminal" {
  for_each = local.terminal_queues

  name                        = each.value.name
  fifo_queue                  = true
  content_based_deduplication = false

  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.message_retention_seconds
}

resource "aws_sqs_queue" "redrive_source" {
  for_each = local.redrive_sources

  name                        = each.value.name
  fifo_queue                  = true
  content_based_deduplication = false

  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.message_retention_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.terminal[local.terminal_key_by_name[each.value.dlq]].arn
    maxReceiveCount     = each.value.max_receive_count
  })
}
