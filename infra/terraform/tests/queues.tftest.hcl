mock_provider "aws" {}

# The committed fabric: one ledger entry per queue in infra.toml. Only the
# ledger is set here — visibility/retention ride the variables' spec-pinned
# defaults, so these asserts carry the contract.
variables {
  aws_region = "eu-central-1"
  queues = {
    "payment_events.fifo" = {
      name              = "payment_events.fifo"
      dlq               = "payment_events_dlq.fifo"
      max_receive_count = 5
    }
    "payment_events_dlq.fifo" = {
      name              = "payment_events_dlq.fifo"
      dlq               = ""
      max_receive_count = 0
    }
  }
}

run "fabric_carries_the_service_contract" {
  command = plan

  assert {
    condition     = module.queues.fabric["payment_events.fifo"].fifo_queue == true
    error_message = "The main queue is a FIFO queue."
  }

  assert {
    condition     = module.queues.fabric["payment_events.fifo"].content_based_deduplication == false
    error_message = "Dedup is explicit per event (MessageDeduplicationId), never content-based."
  }

  assert {
    condition     = module.queues.fabric["payment_events.fifo"].visibility_timeout_seconds == 300
    error_message = "The redrive budget per receive attempt is the spec's 300s."
  }

  assert {
    condition     = module.queues.fabric["payment_events.fifo"].message_retention_seconds == 1209600
    error_message = "Retention is the spec's 14 days; it stays IaC-only, not a runtime knob."
  }

  assert {
    condition     = module.queues.fabric["payment_events_dlq.fifo"].message_retention_seconds == 1209600
    error_message = "The DLQ holds payments 14 days too."
  }

  assert {
    condition     = module.queues.fabric["payment_events_dlq.fifo"].fifo_queue == true
    error_message = "The DLQ is FIFO like its source queue."
  }

  assert {
    condition     = length(module.queues.redrive_targets) == 1
    error_message = "Only the main queue redrives into the DLQ."
  }

  assert {
    condition     = module.queues.redrive_targets["payment_events.fifo"].dlq == "payment_events_dlq.fifo" && module.queues.redrive_targets["payment_events.fifo"].max_receive_count == 5
    error_message = "The redrive wiring matches the spec's 5-attempt budget."
  }
}

run "an_empty_ledger_plans_nothing" {
  command = plan

  variables {
    queues = {}
  }

  assert {
    condition     = length(module.queues.fabric) == 0
    error_message = "No declared queues, no planned queues."
  }
}
