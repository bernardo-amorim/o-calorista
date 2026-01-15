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
# Note: DATABASE_URL is passed via secret_arns from the RDS module (not here)
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
create_github_oidc_provider = true    # Creates the GitHub OIDC provider for keyless auth
github_repository           = "bernardo-amorim/o-calorista"

# Database configuration
db_postgres_version      = "15"
db_instance_class        = "db.t4g.micro"  # ~$12/month, ARM-based
db_allocated_storage     = 20              # Minimum for gp3
db_max_allocated_storage = 100             # Auto-scale up to 100GB
db_name                  = "ocalorista"
db_username              = "ocalorista"
# db_password            = "SET_VIA_TF_VAR_db_password"  # Use: export TF_VAR_db_password="your-secure-password"
db_multi_az              = false           # Set to true for high availability
db_backup_retention_period = 7
db_deletion_protection   = false           # Set to true after initial setup
db_skip_final_snapshot   = false
db_publicly_accessible   = true            # DEV ONLY! Set to false for production