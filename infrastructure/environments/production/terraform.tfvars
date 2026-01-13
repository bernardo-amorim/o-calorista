# Production Environment Variables
# O Calorista

aws_region   = "us-east-1"
project_name = "ocalorista"
environment  = "production"

# Domain configuration
domain_name  = "ocalorista.com"
app_hostname = "app.ocalorista.com"

# Network configuration
vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]  # 2 cheapest AZs in us-east-1

# ECS configuration
container_port = 3000
task_cpu       = 256
task_memory    = 512
desired_count  = 1

# Secrets (configure these after creating secrets in AWS Secrets Manager)
# Example:
# secrets = [
#   {
#     name       = "OPENAI_API_KEY"
#     value_from = "arn:aws:secretsmanager:us-east-1:123456789:secret:ocalorista/production/openai-key"
#   },
#   {
#     name       = "WHATSAPP_ACCESS_TOKEN"
#     value_from = "arn:aws:secretsmanager:us-east-1:123456789:secret:ocalorista/production/whatsapp-token"
#   },
#   {
#     name       = "WHATSAPP_PHONE_NUMBER_ID"
#     value_from = "arn:aws:secretsmanager:us-east-1:123456789:secret:ocalorista/production/whatsapp-phone-id"
#   },
#   {
#     name       = "WHATSAPP_VERIFY_TOKEN"
#     value_from = "arn:aws:secretsmanager:us-east-1:123456789:secret:ocalorista/production/whatsapp-verify-token"
#   },
#   {
#     name       = "META_APP_SECRET"
#     value_from = "arn:aws:secretsmanager:us-east-1:123456789:secret:ocalorista/production/meta-app-secret"
#   }
# ]
secrets = []

# GitHub Actions CI/CD
# Set to true and provide your repo to enable automatic deployments
enable_github_oidc          = true
create_github_oidc_provider = false   # Set to false if OIDC provider already exists in your AWS account
github_repository           = "bernardo-amorim/o-calorista"
