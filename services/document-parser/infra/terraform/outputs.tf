output "secrets_name" {
  description = "Secret name of the document-parser blob (runtime reads target it by name)."
  value       = module.document_parser.secrets_name
}

output "ssm_parameter_prefix" {
  description = "SSM path prefix of the seeded non-secret config parameters."
  value       = module.document_parser.ssm_parameter_prefix
}

output "ssm_parameter_names" {
  description = "Full names of the seeded config parameters (sorted)."
  value       = module.document_parser.ssm_parameter_names
}

output "iam_role_name" {
  description = "Runtime identity role name (assumable in-account)."
  value       = module.document_parser.iam_role_name
}

output "iam_role_arn" {
  description = "Runtime identity role ARN."
  value       = module.document_parser.iam_role_arn
}
