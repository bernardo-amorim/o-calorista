# Production Environment
# O Calorista - WhatsApp Calorie Counting Assistant

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment and configure for remote state
  # backend "s3" {
  #   bucket         = "ocalorista-terraform-state"
  #   key            = "production/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "ocalorista-terraform-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Networking Module
module "networking" {
  source = "../../modules/networking"

  project_name       = var.project_name
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
  container_port     = var.container_port
}

# ECS Service Module
module "ecs_service" {
  source = "../../modules/ecs-service"

  project_name                = var.project_name
  environment                 = var.environment
  domain_name                 = var.domain_name
  app_hostname                = var.app_hostname
  vpc_id                      = module.networking.vpc_id
  public_subnet_ids           = module.networking.public_subnet_ids
  private_subnet_ids          = module.networking.private_subnet_ids
  alb_security_group_id       = module.networking.alb_security_group_id
  ecs_tasks_security_group_id = module.networking.ecs_tasks_security_group_id
  container_port              = var.container_port
  task_cpu                    = var.task_cpu
  task_memory                 = var.task_memory
  desired_count               = var.desired_count
  secrets                     = var.secrets
  secret_names                = var.secret_names

  # GitHub Actions CI/CD
  enable_github_oidc          = var.enable_github_oidc
  create_github_oidc_provider = var.create_github_oidc_provider
  github_repository           = var.github_repository
}
