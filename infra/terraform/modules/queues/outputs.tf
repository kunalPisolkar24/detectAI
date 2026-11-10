output "queue_urls" {
  description = "Queue URL by declared key."
  value = merge(
    { for key, queue in aws_sqs_queue.terminal : key => queue.url },
    { for key, queue in aws_sqs_queue.redrive_source : key => queue.url },
  )
}

output "queue_arns" {
  description = "Queue ARN by declared key."
  value = merge(
    { for key, queue in aws_sqs_queue.terminal : key => queue.arn },
    { for key, queue in aws_sqs_queue.redrive_source : key => queue.arn },
  )
}

output "fabric" {
  description = "Planned queue shape by declared key: the contract surface (the redrive ARN resolves at apply)."
  value = merge(
    { for key, queue in aws_sqs_queue.terminal : key => {
      name                        = queue.name
      fifo_queue                  = queue.fifo_queue
      content_based_deduplication = queue.content_based_deduplication
      visibility_timeout_seconds  = queue.visibility_timeout_seconds
      message_retention_seconds   = queue.message_retention_seconds
    } },
    { for key, queue in aws_sqs_queue.redrive_source : key => {
      name                        = queue.name
      fifo_queue                  = queue.fifo_queue
      content_based_deduplication = queue.content_based_deduplication
      visibility_timeout_seconds  = queue.visibility_timeout_seconds
      message_retention_seconds   = queue.message_retention_seconds
    } },
  )
}

output "redrive_targets" {
  description = "Redrive intent by queue key: dlq name plus the receive budget (the ARN resolves at apply)."
  value = {
    for key, queue in var.queues : key => {
      dlq               = queue.dlq
      max_receive_count = queue.max_receive_count
    } if queue.dlq != ""
  }
}
