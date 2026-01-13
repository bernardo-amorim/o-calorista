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
