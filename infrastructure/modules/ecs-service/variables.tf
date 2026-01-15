variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Environment name (e.g., production, staging)"
  type        = string
}

variable "domain_name" {
  description = "Base domain name (e.g., ocalorista.com)"
  type        = string
}

variable "app_hostname" {
  description = "Full hostname for the app (e.g., app.ocalorista.com)"
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC"
  type        = string
}

variable "public_subnet_ids" {
  description = "IDs of public subnets for ALB"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "IDs of private subnets for ECS tasks"
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "ID of the ALB security group"
  type        = string
}

variable "ecs_tasks_security_group_id" {
  description = "ID of the ECS tasks security group"
  type        = string
}

variable "container_port" {
  description = "Port exposed by the container"
  type        = number
  default     = 3000
}

variable "task_cpu" {
  description = "CPU units for the task (256, 512, 1024, 2048, 4096)"
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
    env_var_name = string  # Name of the environment variable in the container
    secret_name  = string  # Name in Secrets Manager (e.g., 'openai-api-key')
  }))
  default = []
}

variable "secret_arns" {
  description = "List of secrets to inject by ARN (for secrets created by other modules in the same apply)"
  type = list(object({
    env_var_name = string  # Name of the environment variable in the container
    secret_arn   = string  # Full ARN of the secret
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
