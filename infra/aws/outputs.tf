# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Route53 zone ID of the ALB (needed for DNS alias records)"
  value       = aws_lb.main.zone_id
}

output "app_url" {
  description = "URL to access the application"
  value       = var.certificate_arn != "" ? "https://${aws_lb.main.dns_name}" : "http://${aws_lb.main.dns_name}"
}

output "backend_api_url" {
  description = "URL for the backend API (Electron app connects here)"
  value       = "http://${aws_lb.main.dns_name}:8001"
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "Name of the ECS service"
  value       = aws_ecs_service.app.name
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group for container logs"
  value       = aws_cloudwatch_log_group.ecs.name
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs (where ECS tasks run)"
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "Public subnet IDs (where ALB lives)"
  value       = aws_subnet.public[*].id
}

# Useful command reminders
output "deploy_command" {
  description = "Command to trigger a new deployment with latest images"
  value       = "aws ecs update-service --cluster ${aws_ecs_cluster.main.name} --service ${aws_ecs_service.app.name} --force-new-deployment --region ${var.aws_region}"
}

output "logs_command" {
  description = "Command to tail live container logs"
  value       = "aws logs tail /ecs/${var.project_name} --follow --region ${var.aws_region}"
}

# -----------------------------------------------------------------------------
# Cache (ElastiCache Valkey)
# -----------------------------------------------------------------------------

output "redis_primary_endpoint" {
  description = "Primary endpoint hostname for the Valkey replication group"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "redis_reader_endpoint" {
  description = "Reader endpoint (for read-replica fan-out — currently unused; the backend uses primary only)"
  value       = aws_elasticache_replication_group.main.reader_endpoint_address
}

output "redis_url" {
  description = "rediss:// URL for the backend's REDIS_URL env var (TLS, primary endpoint, port 6379)"
  value       = "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
  sensitive   = false
}
