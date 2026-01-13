output "vpc_id" {
  description = "ID of the VPC"
  value       = module.networking.vpc_id
}

output "cluster_name" {
  description = "Name of the ECS cluster"
  value       = module.ecs_service.cluster_name
}

output "service_name" {
  description = "Name of the ECS service"
  value       = module.ecs_service.service_name
}

output "ecr_repository_url" {
  description = "URL of the ECR repository"
  value       = module.ecs_service.ecr_repository_url
}

output "alb_dns_name" {
  description = "DNS name of the ALB"
  value       = module.ecs_service.alb_dns_name
}

output "app_url" {
  description = "Full URL of the application"
  value       = module.ecs_service.app_url
}

output "log_group_name" {
  description = "Name of the CloudWatch log group"
  value       = module.ecs_service.log_group_name
}

output "github_actions_role_arn" {
  description = "ARN of the IAM role for GitHub Actions (add to GitHub secrets as AWS_ROLE_ARN)"
  value       = module.ecs_service.github_actions_role_arn
}
