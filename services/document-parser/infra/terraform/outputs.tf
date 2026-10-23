output "secrets_name" {
  description = "Secret name of the document-parser blob (runtime reads target it by name)."
  value       = module.document_parser.secrets_name
}
