# -----------------------------------------------------------------------------
# ECS Cluster
# -----------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${var.project_name}-cluster" }
}

# -----------------------------------------------------------------------------
# Task Definition
# Two containers in one task (sidecar pattern):
#   - nextjs-app (port 3000) — the frontend, receives ALB traffic
#   - backend (port 8001) — FastAPI, reachable at localhost:8001 from frontend
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "app" {
  family                   = var.project_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    # ----- Frontend Container -----
    {
      name      = "nextjs-app"
      image     = var.frontend_image
      essential = true
      cpu       = var.frontend_cpu
      memory    = var.frontend_memory

      portMappings = [{
        containerPort = 3000
        protocol      = "tcp"
      }]

      environment = concat(
        [
          { name = "NODE_ENV", value = "production" },
          { name = "NEXT_TELEMETRY_DISABLED", value = "1" },
          { name = "PYTHON_BACKEND_URL", value = "http://localhost:8001" },
          # HOSTNAME must be set explicitly — Fargate's container runtime can
          # override the Dockerfile ENV with the task hostname, causing Next.js
          # to bind to the wrong interface and reject localhost health checks.
          { name = "HOSTNAME", value = "0.0.0.0" },
          { name = "PORT", value = "3000" },
        ],
        [for k, v in var.frontend_env_vars : { name = k, value = v }]
      )

      # Wait for backend to be running before starting frontend
      dependsOn = [{
        containerName = "backend"
        condition     = "HEALTHY"
      }]

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"const http=require('http');const r=http.get('http://localhost:3000/api/health',res=>{process.exit(res.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.setTimeout(4000,()=>{r.destroy();process.exit(1)})\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "frontend"
        }
      }
    },

    # ----- Backend Container (sidecar) -----
    {
      name      = "backend"
      image     = var.backend_image
      essential = true
      cpu       = var.backend_cpu
      memory    = var.backend_memory

      portMappings = [{
        containerPort = 8001
        protocol      = "tcp"
      }]

      environment = concat(
        [
          { name = "SERVER_HOST", value = "0.0.0.0" },
          { name = "SERVER_PORT", value = "8001" },
          { name = "ENVIRONMENT", value = "production" },
          { name = "DEBUG", value = "false" },
          { name = "CORS_ORIGINS", value = "http://localhost:3000,https://coasty.ai,https://www.coasty.ai" },
        ],
        [for k, v in var.backend_env_vars : { name = k, value = v }]
      )

      healthCheck = {
        command     = ["CMD-SHELL", "curl -sf http://localhost:8001/api/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 45
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "backend"
        }
      }
    }
  ])
}

# -----------------------------------------------------------------------------
# ECS Service
# -----------------------------------------------------------------------------

resource "aws_ecs_service" "app" {
  name            = "${var.project_name}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false # Tasks are in private subnets, outbound via NAT
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.frontend.arn
    container_name   = "nextjs-app"
    container_port   = 3000
  }

  # Backend API — exposed on ALB port 8001 for the Electron app
  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = 8001
  }

  # Give containers time to start before ALB health checks count against the task.
  # Backend needs ~10-30s to init, frontend waits for backend HEALTHY, then needs
  # 2 consecutive ALB checks (60s) to become healthy.  Total: ~120s worst case.
  health_check_grace_period_seconds = 180

  # Rolling deployment: keep at least 100% healthy, spin up to 200% during deploy
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # Enable ECS deployment circuit breaker to auto-rollback failed deploys
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Let auto-scaling manage desired_count after initial deploy
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.http, aws_lb_listener.backend]
}

# -----------------------------------------------------------------------------
# Auto Scaling
# -----------------------------------------------------------------------------

resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = var.max_capacity
  min_capacity       = var.min_capacity
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Scale on CPU utilization
resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.project_name}-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.cpu_scaling_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# Scale on memory utilization
resource "aws_appautoscaling_policy" "memory" {
  name               = "${var.project_name}-memory-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = var.memory_scaling_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
