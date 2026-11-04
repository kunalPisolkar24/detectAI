output "secrets_name" {
  description = "Secret name of the document-parser blob (runtime reads target it by name)."
  value       = module.secrets_plane.secret_name
}

output "ssm_parameter_prefix" {
  description = "SSM path prefix of the seeded non-secret config parameters."
  value       = module.secrets_plane.ssm_parameter_prefix
}

output "ssm_parameter_names" {
  description = "Full names of the seeded config parameters (sorted)."
  value       = module.secrets_plane.ssm_parameter_names
}
