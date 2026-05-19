# =============================================================================
# ElastiCache (Valkey 7) replication group
# =============================================================================
# Backs the rate limiter, JWT-claim cache, image-compression LRU, screenshot
# hot cache, and circuit-breaker state shared across backend replicas.  Single
# shard (cluster mode disabled) with `redis_replica_count` read replicas in
# different AZs for HA.  Encryption in-transit + at-rest.
#
# Engine choice: Valkey 7 — open-source fork of Redis 7.2 that AWS introduced
# as the recommended replacement after the Redis 7.4 license change.  Same
# wire protocol; existing redis-py / redis.asyncio clients work unchanged.
# =============================================================================

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project_name}-cache-subnet"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "${var.project_name}-cache-subnet" }
}

resource "aws_security_group" "redis" {
  name        = "${var.project_name}-redis-sg"
  description = "Allow Redis access from ECS tasks only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project_name}-redis-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_ecs" {
  security_group_id            = aws_security_group.redis.id
  description                  = "Redis port from ECS service SG"
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.ecs.id
}

resource "aws_vpc_security_group_egress_rule" "redis_egress" {
  security_group_id = aws_security_group.redis.id
  description       = "Egress (required by AWS managed service)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# -----------------------------------------------------------------------------
# CloudWatch log group for ElastiCache slow logs.
#
# We MUST NOT reuse /ecs/llmhub (the shared app log group) as the slow-log
# destination.  ElastiCache verifies log-delivery permissions synchronously
# inside CreateReplicationGroup; without a CloudWatch Logs resource policy on
# the destination log group allowing `delivery.logs.amazonaws.com`, the
# verification times out and AWS returns the unhelpful 408
# `InvalidCredentialsException: This action cannot be completed now. Please
# try again.`  We fix this by giving ElastiCache its own log group and
# attaching a resource policy scoped to the ElastiCache service principal.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "elasticache_slow" {
  name              = "/aws/elasticache/${var.project_name}/slow-log"
  retention_in_days = 14

  tags = { Name = "${var.project_name}-cache-slow-log" }
}

# Log-group resource policy: allow the CloudWatch Logs "vended logs" delivery
# principal to write on behalf of ElastiCache.  This is an ACCOUNT-level
# resource policy (not attached to the log group directly) but scoped via the
# Condition to this specific log group only.
resource "aws_cloudwatch_log_resource_policy" "elasticache_slow" {
  policy_name = "${var.project_name}-elasticache-slowlog-delivery"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowElastiCacheVendedLogDelivery"
      Effect = "Allow"
      Principal = {
        Service = "delivery.logs.amazonaws.com"
      }
      Action = [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ]
      Resource = "${aws_cloudwatch_log_group.elasticache_slow.arn}:*"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = data.aws_caller_identity.elasticache[0].account_id
        }
        ArnLike = {
          "aws:SourceArn" = "arn:aws:elasticache:${var.aws_region}:${data.aws_caller_identity.elasticache[0].account_id}:replicationgroup:${var.project_name}-cache"
        }
      }
    }]
  })
}

# Scoped data source — only fetched here so we don't collide with the one
# created conditionally inside cloudfront.tf (which has count = 1 guard).
data "aws_caller_identity" "elasticache" {
  count = 1
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.project_name}-cache"
  description          = "Coasty shared cache: rate limiter, JWT cache, hot images, circuit breaker"

  engine               = "valkey"
  engine_version       = "7.2"
  node_type            = var.redis_node_type
  port                 = 6379
  parameter_group_name = var.redis_parameter_group_name

  # 1 primary + N replicas.  Setting num_cache_clusters >= 2 enables Multi-AZ
  # automatic failover, which is required for prod.  Setting it to 1 is the
  # cost-saving dev/staging mode (no failover).
  num_cache_clusters         = 1 + var.redis_replica_count
  automatic_failover_enabled = var.redis_replica_count > 0
  multi_az_enabled           = var.redis_replica_count > 0

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  # Security: encrypt at rest + in transit.  Transit mode `preferred` accepts
  # both TLS and plaintext to permit a clients-don't-do-TLS-yet rolling
  # cutover; flip to `required` once all clients use rediss://.
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "preferred"

  # Maintenance batched into the next window — never apply changes immediately
  # because that can trigger a brief failover under load.
  apply_immediately       = false
  snapshot_retention_limit = var.redis_snapshot_retention_days
  snapshot_window          = "03:00-05:00"
  maintenance_window       = "sun:05:00-sun:07:00"

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.elasticache_slow.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  # Force the resource policy to exist *before* we call CreateReplicationGroup,
  # otherwise the log-delivery permission verification inside that call will
  # time out and return the infamous "408 / InvalidCredentialsException".
  depends_on = [aws_cloudwatch_log_resource_policy.elasticache_slow]

  tags = { Name = "${var.project_name}-cache" }
}
