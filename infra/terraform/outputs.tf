output "queue_urls" {
  description = "Queue URL by declared key; rides the runtime endpoints via QUEUE_URL env."
  value       = module.queues.queue_urls
}

output "queue_arns" {
  description = "Queue ARN by declared key."
  value       = module.queues.queue_arns
}
