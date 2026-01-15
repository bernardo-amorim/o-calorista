variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Environment name (e.g., production, staging)"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones to deploy to (e.g., ['us-east-1a', 'us-east-1b'])"
  type        = list(string)
  # Default to the 2 cheapest AZs in us-east-1
  default     = ["us-east-1a", "us-east-1b"]

  validation {
    condition     = length(var.availability_zones) >= 1
    error_message = "At least one availability zone must be specified."
  }
}

variable "container_port" {
  description = "Port exposed by the container"
  type        = number
  default     = 3000
}

variable "db_publicly_accessible" {
  description = "Allow public access to the database (for development only!)"
  type        = bool
  default     = false
}
