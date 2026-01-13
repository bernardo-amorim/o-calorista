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

# Secrets - automatically looked up from Secrets Manager by name
# These map environment variable names to secret names created by `bun run sync-secrets`
secret_names = [
  { env_var_name = "OPENAI_API_KEY", secret_name = "openai-api-key" },
  { env_var_name = "WHATSAPP_ACCESS_TOKEN", secret_name = "whatsapp-access-token" },
  { env_var_name = "WHATSAPP_PHONE_NUMBER_ID", secret_name = "whatsapp-phone-number-id" },
  { env_var_name = "WHATSAPP_VERIFY_TOKEN", secret_name = "whatsapp-verify-token" },
  { env_var_name = "META_APP_SECRET", secret_name = "meta-app-secret" },
]

# Legacy format (if you need to specify full ARNs manually)
secrets = []

# GitHub Actions CI/CD
# Set to true and provide your repo to enable automatic deployments
enable_github_oidc          = true
create_github_oidc_provider = false   # Set to false if OIDC provider already exists in your AWS account
github_repository           = "bernardo-amorim/o-calorista"
