output "endpoint" {
  description = "Database endpoint (hostname:port)"
  value       = aws_db_instance.postgres.endpoint
}

output "hostname" {
  description = "Database hostname"
  value       = aws_db_instance.postgres.address
}

output "port" {
  description = "Database port"
  value       = aws_db_instance.postgres.port
}

output "database_name" {
  description = "Name of the database"
  value       = aws_db_instance.postgres.db_name
}

output "instance_id" {
  description = "RDS instance identifier"
  value       = aws_db_instance.postgres.id
}
