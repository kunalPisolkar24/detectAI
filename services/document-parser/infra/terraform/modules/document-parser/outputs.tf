output "secrets_name" {
  description = "Secret name (the identifier every consumer uses)."
  value       = aws_secretsmanager_secret.services.name
}
