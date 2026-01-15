variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "ocalorista"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "domain_name" {
  description = "Base domain name"
  type        = string
  default     = "ocalorista.com"
}

variable "app_hostname" {
  description = "Full hostname for the app"
  type        = string
  default     = "app.ocalorista.com"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones to deploy to"
  type        = list(string)
  # Default to the 2 cheapest AZs in us-east-1
  default     = ["us-east-1a", "us-east-1b"]
}

variable "container_port" {
  description = "Port exposed by the container"
  type        = number
  default     = 3000
}

variable "task_cpu" {
  description = "CPU units for the task"
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Memory for the task in MB"
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Desired number of tasks"
  type        = number
  default     = 1
}

variable "secrets" {
  description = "List of secrets to inject into the container (full ARN format)"
  type = list(object({
    name       = string
    value_from = string
  }))
  default = []
}

variable "secret_names" {
  description = "List of secret names in Secrets Manager to inject (uses naming convention: {project}/{env}/{name})"
  type = list(object({
    env_var_name = string
    secret_name  = string
  }))
  default = []
}

variable "enable_github_oidc" {
  description = "Enable GitHub Actions OIDC integration for CI/CD"
  type        = bool
  default     = false
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub OIDC provider (set to false if it already exists in your AWS account)"
  type        = bool
  default     = true
}

variable "github_repository" {
  description = "GitHub repository in format 'owner/repo' for OIDC trust policy"
  type        = string
  default     = ""
}

# Database configuration
variable "db_postgres_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "15"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"  # Cheapest ARM-based instance
}

variable "db_allocated_storage" {
  description = "Initial storage allocation in GB"
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Maximum storage for autoscaling in GB"
  type        = number
  default     = 100
}

variable "db_name" {
  description = "Name of the database"
  type        = string
  default     = "ocalorista"
}

variable "db_username" {
  description = "Master username for the database"
  type        = string
  default     = "ocalorista"
}

variable "db_password" {
  description = "Master password for the database"
  type        = string
  sensitive   = true
}

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment"
  type        = bool
  default     = false
}

variable "db_backup_retention_period" {
  description = "Number of days to retain backups"
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = false
}

variable "db_skip_final_snapshot" {
  description = "Skip final snapshot when destroying"
  type        = bool
  default     = false
}

variable "db_publicly_accessible" {
  description = "Make the database publicly accessible (for development only!)"
  type        = bool
  default     = false
}
