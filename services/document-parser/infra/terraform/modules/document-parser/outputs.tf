output "secrets_name" {
  description = "Secret name (the identifier every consumer uses)."
  value       = aws_secretsmanager_secret.services.name
}

output "ssm_parameter_prefix" {
  description = "SSM path prefix where the seeded non-secret config parameters live."
  value       = local.ssm_prefix
}

output "ssm_parameter_names" {
  description = "Full names of the seeded config parameters (sorted)."
  value       = sort(keys(local.config_parameters))
}

output "iam_role_name" {
  description = "Runtime identity role name (assumable in-account)."
  value       = aws_iam_role.runtime.name
}

output "iam_role_arn" {
  description = "Runtime identity role ARN."
  value       = aws_iam_role.runtime.arn
}
