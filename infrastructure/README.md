# O Calorista Infrastructure

Terraform infrastructure for O Calorista WhatsApp calorie counting assistant.

## Structure

```
infrastructure/
├── modules/
│   ├── networking/     # VPC, subnets, security groups
│   └── ecs-service/    # ECS cluster, service, ALB, Route53
├── environments/
│   └── production/     # Production environment config
└── README.md
```

## Adding a New Environment

To add a new environment (e.g., staging):

1. Copy the production folder:
   ```bash
   cp -r environments/production environments/staging
   ```

2. Update `terraform.tfvars` in the new folder:
   ```hcl
   environment  = "staging"
   app_hostname = "staging.ocalorista.com"
   vpc_cidr     = "10.1.0.0/16"  # Different CIDR to avoid conflicts
   ```

3. Initialize and apply:
   ```bash
   cd environments/staging
   terraform init
   terraform apply
   ```

## Prerequisites

- AWS CLI configured with appropriate credentials
- Terraform >= 1.0
- Existing Route53 hosted zone for `ocalorista.com`

## Deployment

### First-time Setup

1. Navigate to the environment:
   ```bash
   cd environments/production
   ```

2. Initialize Terraform:
   ```bash
   terraform init
   ```

3. Review the plan:
   ```bash
   terraform plan
   ```

4. Apply the infrastructure:
   ```bash
   terraform apply
   ```

### Deploying the Application

After infrastructure is created:

1. Build and push Docker image:
   ```bash
   # Get ECR login
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

   # Build image
   cd ../../server
   docker build -t ocalorista-production .

   # Tag and push
   docker tag ocalorista-production:latest <ecr-repo-url>:latest
   docker push <ecr-repo-url>:latest
   ```

2. Update ECS service:
   ```bash
   aws ecs update-service --cluster ocalorista-production --service ocalorista-production --force-new-deployment
   ```

## Secrets Management

Secrets should be stored in AWS Secrets Manager. Update `terraform.tfvars` with the secret ARNs:

```hcl
secrets = [
  {
    name       = "OPENAI_API_KEY"
    value_from = "arn:aws:secretsmanager:us-east-1:123456789:secret:ocalorista/production/openai-key"
  },
  # ... other secrets
]
```

Required secrets:
- `OPENAI_API_KEY` - OpenAI API key for food matching
- `WHATSAPP_ACCESS_TOKEN` - WhatsApp Cloud API access token
- `WHATSAPP_PHONE_NUMBER_ID` - WhatsApp Business phone number ID
- `WHATSAPP_VERIFY_TOKEN` - Webhook verification token
- `META_APP_SECRET` - Meta app secret for webhook signature verification

## Outputs

After applying, Terraform will output:
- `app_url` - Application URL (https://app.ocalorista.com)
- `ecr_repository_url` - ECR repository for Docker images
- `log_group_name` - CloudWatch log group for viewing logs

## Cost Optimization

The default configuration uses minimal resources:
- Fargate with 256 CPU / 512 MB memory
- Single task (can scale up as needed)
- 2 AZs for high availability

Estimated monthly cost: ~$15-25 USD (varies by usage)

## Cleanup

To destroy all resources:
```bash
terraform destroy
```

⚠️ This will delete all resources including the ECR repository and its images.
