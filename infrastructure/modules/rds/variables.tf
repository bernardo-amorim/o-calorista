variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Environment name (e.g., production, staging)"
  type        = string
}

variable "subnet_ids" {
  description = "List of subnet IDs for the database"
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group ID for the database"
  type        = string
}

variable "postgres_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "15"
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"  # Cheapest ARM-based instance
}

variable "allocated_storage" {
  description = "Initial storage allocation in GB"
  type        = number
  default     = 20  # Minimum for gp3
}

variable "max_allocated_storage" {
  description = "Maximum storage for autoscaling in GB (set to 0 to disable)"
  type        = number
  default     = 100
}

variable "database_name" {
  description = "Name of the database to create"
  type        = string
  default     = "ocalorista"
}

variable "database_username" {
  description = "Master username for the database"
  type        = string
  default     = "ocalorista"
}

variable "database_password" {
  description = "Master password for the database"
  type        = string
  sensitive   = true
}

variable "multi_az" {
  description = "Enable Multi-AZ deployment for high availability"
  type        = bool
  default     = false  # Set to true for production HA
}

variable "backup_retention_period" {
  description = "Number of days to retain backups"
  type        = number
  default     = 7
}

variable "deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = false  # Set to true after initial setup
}

variable "skip_final_snapshot" {
  description = "Skip final snapshot when destroying the database"
  type        = bool
  default     = false
}

variable "publicly_accessible" {
  description = "Make the database publicly accessible (for development only!)"
  type        = bool
  default     = false
}
