# -----------------------------------------------------------------------------
# ECS Task Execution Role
# Used by the ECS agent itself to pull images from ECR and push logs to
# CloudWatch.
# -----------------------------------------------------------------------------

resource "aws_iam_role" "ecs_execution" {
  name = "${var.project_name}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# Managed policy: covers ECR pull + CloudWatch log writes
resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# -----------------------------------------------------------------------------
# ECS Task Role
# Used by your application containers at runtime. Add permissions here for
# any AWS services your app needs to call (S3, SES, DynamoDB, etc.).
# -----------------------------------------------------------------------------

resource "aws_iam_role" "ecs_task" {
  name = "${var.project_name}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# Example: uncomment and customize if your app needs runtime AWS access
# resource "aws_iam_role_policy" "ecs_task_app" {
#   name = "${var.project_name}-app-permissions"
#   role = aws_iam_role.ecs_task.id
#
#   policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Effect   = "Allow"
#         Action   = ["s3:GetObject", "s3:PutObject"]
#         Resource = "arn:aws:s3:::my-bucket/*"
#       }
#     ]
#   })
# }

# -----------------------------------------------------------------------------
# CloudWatch custom-metric publishing
#
# Allows the backend containers to publish:
#   * Coasty/SSE::ActiveStreams   (from the coasty-sse service)
#   * Coasty/WS::LocalConnections (from the coasty-ws service)
#
# These metrics drive the target-tracking autoscaling policies in
# ecs_split.tf (aws_appautoscaling_policy.split_sse_streams /
# split_ws_connections).  `PutMetricData` has no resource-level ARN support —
# AWS requires `Resource = "*"` — so the scope is narrowed via a Condition
# that restricts writes to only the two namespaces we use.  A compromised
# task can't spam AWS/* or unrelated namespaces.
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "ecs_task_metrics" {
  name = "${var.project_name}-task-metrics"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PublishCustomMetrics"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = ["Coasty/SSE", "Coasty/WS"]
          }
        }
      }
    ]
  })
}
