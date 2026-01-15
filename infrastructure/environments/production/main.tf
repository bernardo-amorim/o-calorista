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

  project_name           = var.project_name
  environment            = var.environment
  vpc_cidr               = var.vpc_cidr
  availability_zones     = var.availability_zones
  container_port         = var.container_port
  db_publicly_accessible = var.db_publicly_accessible
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

  # Secrets from other modules (passed by ARN to avoid lookup timing issues)
  secret_arns = [
    { env_var_name = "DATABASE_URL", secret_arn = module.rds.database_url_secret_arn }
  ]

  # GitHub Actions CI/CD
  enable_github_oidc          = var.enable_github_oidc
  create_github_oidc_provider = var.create_github_oidc_provider
  github_repository           = var.github_repository

  depends_on = [module.rds]
}

# RDS PostgreSQL Module
module "rds" {
  source = "../../modules/rds"

  project_name      = var.project_name
  environment       = var.environment
  # Use public subnets when publicly accessible, private otherwise
  subnet_ids        = var.db_publicly_accessible ? module.networking.public_subnet_ids : module.networking.private_subnet_ids
  security_group_id = module.networking.database_security_group_id

  # Database configuration
  postgres_version      = var.db_postgres_version
  instance_class        = var.db_instance_class
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  database_name         = var.db_name
  database_username     = var.db_username
  database_password     = var.db_password

  # Network access
  publicly_accessible = var.db_publicly_accessible

  # High availability & backup
  multi_az                = var.db_multi_az
  backup_retention_period = var.db_backup_retention_period
  deletion_protection     = var.db_deletion_protection
  skip_final_snapshot     = var.db_skip_final_snapshot
}
