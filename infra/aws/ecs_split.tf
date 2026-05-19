# =============================================================================
# 3-Service ECS Split  —  coasty-api / coasty-sse / coasty-ws
# =============================================================================
#
# Gated by var.three_service_split_enabled.  When disabled (default) this file
# produces zero AWS resources and the legacy sidecar setup (aws_ecs_service.app
# in ecs.tf) handles all backend traffic.
#
# When enabled:
#   * Three backend-only task defs + services are provisioned, each with the
#     same image but a different COASTY_SERVICE_MODE env var.
#   * Three target groups (api/sse/ws-tg) are added on port 8001.
#   * Three listener rules on the backend ALB listener route traffic by path:
#       priority  10  →  /api/electron/ws           →  ws-tg
#       priority  20  →  /api/chat, /api/chat/*     →  sse-tg
#       priority  30  →  /api/swarm, /api/swarm/*   →  sse-tg
#       priority 1000 →  /*                          →  api-tg  (catch-all)
#     The listener's DEFAULT action (forward to the sidecar backend-tg) becomes
#     unreachable but is left in place so toggling the flag off cleanly reverts.
#   * Per-service autoscaling:
#       api →  CPU target 70%
#       sse →  CPU target 50%   (streams hold event-loop time)
#       ws  →  Memory target 70% (each WS holds ~50-100KB of buffer memory)
#
# The frontend+backend sidecar in aws_ecs_service.app is LEFT IN PLACE so the
# Next.js frontend keeps proxying internal calls to `http://localhost:8001`
# without any code changes.  External port-8001 traffic (Electron app direct,
# public API consumers) routes through the split services via the listener
# rules.
# =============================================================================


# -----------------------------------------------------------------------------
# Shared locals
# -----------------------------------------------------------------------------

locals {
  # Base backend environment identical across all three split services.
  # The per-service override (COASTY_SERVICE_MODE) is appended in each
  # task definition.  The user-provided backend_env_vars map is appended
  # LAST so it can override any of these defaults.
  split_backend_base_env = concat(
    [
      { name = "SERVER_HOST", value = "0.0.0.0" },
      { name = "SERVER_PORT", value = "8001" },
      { name = "ENVIRONMENT", value = "production" },
      { name = "DEBUG", value = "false" },
      # The same wide CORS_ORIGINS list as the sidecar backend.
      { name = "CORS_ORIGINS", value = "http://localhost:3000,https://coasty.ai,https://www.coasty.ai" },
      # Admin allowlist for /api/billing/sessions/cleanup (and future admin
      # routes) — see backend/app/services/auth.py::require_admin. Empty =
      # no admins (fail-closed). Mirrored from the sidecar task in ecs.tf so
      # the api/sse/ws split services share the same gate.
      { name = "ADMIN_EMAILS", value = var.admin_emails },
      { name = "REDIS_URL", value = "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379" },
      { name = "CACHE_ENABLED", value = "true" },
      # Project name — consumed by app/services/metrics.py to construct the
      # CloudWatch dimension value (`<project>-<mode>`) that matches the
      # autoscaling policies below.  If this drifts from var.project_name the
      # policies will query empty metric series and autoscaling freezes.
      { name = "COASTY_PROJECT_NAME", value = var.project_name },
    ],
  )

  split_backend_user_env = [for k, v in var.backend_env_vars : { name = k, value = v }]

  split_log_config = {
    logDriver = "awslogs"
    options = {
      "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
      "awslogs-region"        = var.aws_region
      "awslogs-stream-prefix" = "backend-split"
    }
  }

  # Health check reused across all three target groups.  /api/health is
  # mounted in every COASTY_SERVICE_MODE by main.py (ALB requires it).
  split_health_check = {
    path                = "/api/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    timeout             = 10
    interval            = 30
    matcher             = "200"
    enabled             = true
  }
}


# =============================================================================
# TARGET GROUPS  (port 8001, awsvpc target_type=ip for Fargate)
# =============================================================================

resource "aws_lb_target_group" "api" {
  count       = var.three_service_split_enabled ? 1 : 0
  name        = "${var.project_name}-api-tg"
  port        = 8001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = local.split_health_check.enabled
    path                = local.split_health_check.path
    port                = local.split_health_check.port
    protocol            = local.split_health_check.protocol
    healthy_threshold   = local.split_health_check.healthy_threshold
    unhealthy_threshold = local.split_health_check.unhealthy_threshold
    timeout             = local.split_health_check.timeout
    interval            = local.split_health_check.interval
    matcher             = local.split_health_check.matcher
  }

  # api service: short requests, 60 s drain is plenty
  deregistration_delay = 60

  tags = { Name = "${var.project_name}-api-tg" }
}

resource "aws_lb_target_group" "sse" {
  count       = var.three_service_split_enabled ? 1 : 0
  name        = "${var.project_name}-sse-tg"
  port        = 8001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = local.split_health_check.enabled
    path                = local.split_health_check.path
    port                = local.split_health_check.port
    protocol            = local.split_health_check.protocol
    healthy_threshold   = local.split_health_check.healthy_threshold
    unhealthy_threshold = local.split_health_check.unhealthy_threshold
    timeout             = local.split_health_check.timeout
    interval            = local.split_health_check.interval
    matcher             = local.split_health_check.matcher
  }

  # sse service: long-lived streams — give them realistic drain on deploy.
  # Clients reconnect so a severed stream at 120s is survivable.
  deregistration_delay = 120

  tags = { Name = "${var.project_name}-sse-tg" }
}

resource "aws_lb_target_group" "ws" {
  count       = var.three_service_split_enabled ? 1 : 0
  name        = "${var.project_name}-ws-tg"
  port        = 8001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = local.split_health_check.enabled
    path                = local.split_health_check.path
    port                = local.split_health_check.port
    protocol            = local.split_health_check.protocol
    healthy_threshold   = local.split_health_check.healthy_threshold
    unhealthy_threshold = local.split_health_check.unhealthy_threshold
    timeout             = local.split_health_check.timeout
    interval            = local.split_health_check.interval
    matcher             = local.split_health_check.matcher
  }

  # ws service: Electron app reconnects on its own with exponential backoff.
  # 120 s allows in-flight commands to finish before the socket is cut.
  deregistration_delay = 120

  # NOTE: we deliberately do NOT enable lb_cookie stickiness here.  The Electron
  # app uses the Node `ws` library which does not persist browser-style cookies
  # across reconnects, so cookie-based stickiness silently wouldn't work.  The
  # Redis RPC bridge (app/services/electron_rpc.py) makes stickiness unnecessary
  # anyway — any worker serving /api/chat etc. routes commands via pub/sub to
  # whichever ws task holds the Electron WebSocket.

  tags = { Name = "${var.project_name}-ws-tg" }
}


# =============================================================================
# TASK DEFINITIONS  (single `backend` container per task, no sidecar frontend)
# =============================================================================

resource "aws_ecs_task_definition" "api" {
  count                    = var.three_service_split_enabled ? 1 : 0
  family                   = "${var.project_name}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.split_api_cpu
  memory                   = var.split_api_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "backend"
    image     = var.backend_image
    essential = true
    cpu       = var.split_api_cpu
    memory    = var.split_api_memory

    portMappings = [{
      containerPort = 8001
      protocol      = "tcp"
    }]

    environment = concat(
      local.split_backend_base_env,
      [{ name = "COASTY_SERVICE_MODE", value = "api" }],
      local.split_backend_user_env,
    )

    healthCheck = {
      command     = ["CMD-SHELL", "curl -sf http://localhost:8001/api/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 45
    }

    logConfiguration = local.split_log_config
  }])

  tags = { Name = "${var.project_name}-api-taskdef" }
}

resource "aws_ecs_task_definition" "sse" {
  count                    = var.three_service_split_enabled ? 1 : 0
  family                   = "${var.project_name}-sse"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.split_sse_cpu
  memory                   = var.split_sse_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "backend"
    image     = var.backend_image
    essential = true
    cpu       = var.split_sse_cpu
    memory    = var.split_sse_memory

    portMappings = [{
      containerPort = 8001
      protocol      = "tcp"
    }]

    environment = concat(
      local.split_backend_base_env,
      [{ name = "COASTY_SERVICE_MODE", value = "sse" }],
      local.split_backend_user_env,
    )

    healthCheck = {
      command     = ["CMD-SHELL", "curl -sf http://localhost:8001/api/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 45
    }

    logConfiguration = local.split_log_config
  }])

  tags = { Name = "${var.project_name}-sse-taskdef" }
}

resource "aws_ecs_task_definition" "ws" {
  count                    = var.three_service_split_enabled ? 1 : 0
  family                   = "${var.project_name}-ws"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.split_ws_cpu
  memory                   = var.split_ws_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "backend"
    image     = var.backend_image
    essential = true
    cpu       = var.split_ws_cpu
    memory    = var.split_ws_memory

    portMappings = [{
      containerPort = 8001
      protocol      = "tcp"
    }]

    environment = concat(
      local.split_backend_base_env,
      [{ name = "COASTY_SERVICE_MODE", value = "ws" }],
      local.split_backend_user_env,
    )

    healthCheck = {
      command     = ["CMD-SHELL", "curl -sf http://localhost:8001/api/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 45
    }

    logConfiguration = local.split_log_config
  }])

  tags = { Name = "${var.project_name}-ws-taskdef" }
}


# =============================================================================
# ECS SERVICES
# =============================================================================

resource "aws_ecs_service" "api" {
  count           = var.three_service_split_enabled ? 1 : 0
  name            = "${var.project_name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api[0].arn
  desired_count   = var.split_api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  # Public ALB target group (always registered — carries external traffic).
  load_balancer {
    target_group_arn = aws_lb_target_group.api[0].arn
    container_name   = "backend"
    container_port   = 8001
  }

  # Internal ALB target group (only when remove_frontend_sidecar = true).
  # ip-type TGs can only belong to ONE ALB, so we use a parallel TG here
  # rather than sharing api-tg across both ALBs.  Tasks auto-register with
  # both as they start; they auto-deregister from both as they stop.
  dynamic "load_balancer" {
    for_each = var.remove_frontend_sidecar ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.api_internal[0].arn
      container_name   = "backend"
      container_port   = 8001
    }
  }

  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  # Explicit dep on the internal listener: its default_action is what
  # "associates" api_internal with a load balancer.  Without this, terraform's
  # scheduler can run `UpdateService` (attaching api_internal) in parallel
  # with the listener creation and hit `target group ... does not have an
  # associated load balancer`.  When remove_frontend_sidecar=false the
  # listener's count is 0 and this expands to an empty dep, which is safe.
  depends_on = [aws_lb_listener.backend, aws_lb_listener.internal_backend]

  tags = { Name = "${var.project_name}-api-svc" }
}

resource "aws_ecs_service" "sse" {
  count           = var.three_service_split_enabled ? 1 : 0
  name            = "${var.project_name}-sse"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.sse[0].arn
  desired_count   = var.split_sse_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  # Public ALB target group (external SSE traffic).
  load_balancer {
    target_group_arn = aws_lb_target_group.sse[0].arn
    container_name   = "backend"
    container_port   = 8001
  }

  # Internal ALB target group — Next.js → backend SSE calls when sidecar is
  # removed.  See aws_ecs_service.api above for the reasoning on parallel TGs.
  dynamic "load_balancer" {
    for_each = var.remove_frontend_sidecar ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.sse_internal[0].arn
      container_name   = "backend"
      container_port   = 8001
    }
  }

  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  # Explicit dep on the internal listener rules: sse_internal is associated
  # with the internal ALB via listener rules 20 and 30, not the listener's
  # default_action.  Without an explicit dep, `UpdateService` can race the
  # rule creation and hit `target group ... does not have an associated
  # load balancer`.  Count-gated resources expand to empty deps when
  # remove_frontend_sidecar=false.
  depends_on = [
    aws_lb_listener.backend,
    aws_lb_listener_rule.internal_sse_chat,
    aws_lb_listener_rule.internal_sse_swarm,
  ]

  tags = { Name = "${var.project_name}-sse-svc" }
}

resource "aws_ecs_service" "ws" {
  count           = var.three_service_split_enabled ? 1 : 0
  name            = "${var.project_name}-ws"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ws[0].arn
  desired_count   = var.split_ws_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  # Public ALB target group (external Electron WS traffic on :8001).
  load_balancer {
    target_group_arn = aws_lb_target_group.ws[0].arn
    container_name   = "backend"
    container_port   = 8001
  }

  # NOTE: the ws service intentionally does NOT register with any internal
  # target group.  The internal ALB has no listener rule for /api/electron/ws
  # because Next.js never proxies WebSockets to the backend (the Electron app
  # connects directly to the public :8001 HTTPS listener).  Registering with
  # an orphan internal TG fails with `The target group ... does not have an
  # associated load balancer` — AWS rejects ECS registration against any TG
  # that isn't wired to at least one listener or listener rule.  The api and
  # sse services ARE registered with internal TGs because those TGs are
  # wired to the internal listener (default action for api_internal, rules
  # 20/30 for sse_internal).

  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.backend]

  tags = { Name = "${var.project_name}-ws-svc" }
}


# =============================================================================
# ALB LISTENER RULES  (port 8001, path-based routing)
# =============================================================================
#
# Priority ordering (LOWER = evaluated FIRST):
#   10   →  /api/electron/ws       →  ws-tg
#   20   →  /api/chat, /api/chat/*  →  sse-tg
#   30   →  /api/swarm, /api/swarm/* → sse-tg
#   1000 →  /*                      →  api-tg   (catch-all)
#
# The listener's DEFAULT action (forward to backend-tg / the sidecar) is
# unchanged; rule 1000 intercepts /* before the default is consulted, so
# external port-8001 traffic never hits the sidecar when the flag is on.
# Flipping the flag to false removes all rules and the default action is
# back in charge.
# =============================================================================

resource "aws_lb_listener_rule" "split_electron_ws" {
  count        = var.three_service_split_enabled ? 1 : 0
  listener_arn = aws_lb_listener.backend.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/api/electron/ws"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ws[0].arn
  }
}

resource "aws_lb_listener_rule" "split_sse_chat" {
  count        = var.three_service_split_enabled ? 1 : 0
  listener_arn = aws_lb_listener.backend.arn
  priority     = 20

  condition {
    path_pattern {
      # Both trailing-slash and non-trailing variants, plus any sub-path
      values = ["/api/chat", "/api/chat/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.sse[0].arn
  }
}

resource "aws_lb_listener_rule" "split_sse_swarm" {
  count        = var.three_service_split_enabled ? 1 : 0
  listener_arn = aws_lb_listener.backend.arn
  priority     = 30

  condition {
    path_pattern {
      values = ["/api/swarm", "/api/swarm/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.sse[0].arn
  }
}

resource "aws_lb_listener_rule" "split_api_catchall" {
  count        = var.three_service_split_enabled ? 1 : 0
  listener_arn = aws_lb_listener.backend.arn
  priority     = 1000

  condition {
    path_pattern {
      values = ["/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[0].arn
  }
}


# =============================================================================
# INTERNAL ALB LISTENER RULES  (attached to aws_lb.internal_backend)
# =============================================================================
#
# These rules mirror the public ALB's split rules, but live on the INTERNAL
# ALB (see alb_internal.tf for why).  They forward to the SAME target groups
# as the public ALB rules (ALBs can share target groups), so the ECS service
# registration in the load_balancer block above is unchanged.
#
# Gated on both three_service_split_enabled AND remove_frontend_sidecar —
# the internal ALB is only provisioned when the sidecar is removed.
# =============================================================================

resource "aws_lb_listener_rule" "internal_sse_chat" {
  count        = var.three_service_split_enabled && var.remove_frontend_sidecar ? 1 : 0
  listener_arn = aws_lb_listener.internal_backend[0].arn
  priority     = 20

  condition {
    path_pattern {
      values = ["/api/chat", "/api/chat/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.sse_internal[0].arn
  }
}

resource "aws_lb_listener_rule" "internal_sse_swarm" {
  count        = var.three_service_split_enabled && var.remove_frontend_sidecar ? 1 : 0
  listener_arn = aws_lb_listener.internal_backend[0].arn
  priority     = 30

  condition {
    path_pattern {
      values = ["/api/swarm", "/api/swarm/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.sse_internal[0].arn
  }
}

# NOTE: /api/electron/ws intentionally has NO internal rule.  The Electron
# desktop app connects DIRECTLY to the public :8001 HTTPS listener; the
# Next.js frontend never proxies WebSockets to the backend.  If internal
# code ever accidentally hits /api/electron/ws through PYTHON_BACKEND_URL,
# it falls through to the api catch-all below and gets a non-WS REST
# handler's response — a clear failure surface, intended.

resource "aws_lb_listener_rule" "internal_api_catchall" {
  count        = var.three_service_split_enabled && var.remove_frontend_sidecar ? 1 : 0
  listener_arn = aws_lb_listener.internal_backend[0].arn
  priority     = 1000

  condition {
    path_pattern {
      values = ["/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api_internal[0].arn
  }
}


# =============================================================================
# AUTOSCALING
# =============================================================================

# ---- api service: scale on CPU ------------------------------------------

resource "aws_appautoscaling_target" "split_api" {
  count              = var.three_service_split_enabled ? 1 : 0
  max_capacity       = var.split_api_max_capacity
  min_capacity       = var.split_api_min_capacity
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "split_api_cpu" {
  count              = var.three_service_split_enabled ? 1 : 0
  name               = "${var.project_name}-api-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.split_api[0].resource_id
  scalable_dimension = aws_appautoscaling_target.split_api[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.split_api[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.split_api_cpu_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ---- sse service: scale on CPU (lower target because streams hold threads) --

resource "aws_appautoscaling_target" "split_sse" {
  count              = var.three_service_split_enabled ? 1 : 0
  max_capacity       = var.split_sse_max_capacity
  min_capacity       = var.split_sse_min_capacity
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.sse[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# CPU-based sse scaling (default).  Disabled when sse_autoscale_on_active_streams
# is true — only one policy should drive each scaling target at a time, so the
# two policies are mutually exclusive via complementary count guards.
resource "aws_appautoscaling_policy" "split_sse_cpu" {
  count              = var.three_service_split_enabled && !var.sse_autoscale_on_active_streams ? 1 : 0
  name               = "${var.project_name}-sse-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.split_sse[0].resource_id
  scalable_dimension = aws_appautoscaling_target.split_sse[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.split_sse[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.split_sse_cpu_target
    scale_in_cooldown  = 300
    # Longer scale-out cooldown for sse — sudden load spikes often match
    # a single user starting a session; we don't want to over-provision on
    # every spike.  Still fast enough to add capacity within 3-5 minutes.
    scale_out_cooldown = 120
  }
}

# Custom-metric sse scaling (opt-in).  Drives the scaling target on the live
# count of active SSE streams rather than CPU%.  See the module docstring in
# app/services/metrics.py for why this is the right metric for long-lived
# streams.  The ServiceName dimension MUST match what every sse worker
# publishes — metrics.py builds it as `${COASTY_PROJECT_NAME}-${mode}` so the
# value below needs to stay in lock-step with `${var.project_name}-sse`.
resource "aws_appautoscaling_policy" "split_sse_streams" {
  count              = var.three_service_split_enabled && var.sse_autoscale_on_active_streams ? 1 : 0
  name               = "${var.project_name}-sse-streams-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.split_sse[0].resource_id
  scalable_dimension = aws_appautoscaling_target.split_sse[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.split_sse[0].service_namespace

  target_tracking_scaling_policy_configuration {
    customized_metric_specification {
      namespace   = "Coasty/SSE"
      metric_name = "ActiveStreams"
      # Average across all workers of the service — each worker publishes
      # its own count every 30 s.  Sum would overcount as the fleet scales
      # out; Average is stable and gives us "streams per worker" which is
      # the natural capacity unit for target-tracking.
      statistic = "Average"

      dimensions {
        name  = "ServiceName"
        value = "${var.project_name}-sse"
      }
    }
    target_value       = var.split_sse_streams_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 120
  }
}

# ---- ws service: scale on memory (Electron WS holds per-connection buffers) -

resource "aws_appautoscaling_target" "split_ws" {
  count              = var.three_service_split_enabled ? 1 : 0
  max_capacity       = var.split_ws_max_capacity
  min_capacity       = var.split_ws_min_capacity
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.ws[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Memory-based ws scaling (default).  Disabled when ws_autoscale_on_connections
# is true — mutually exclusive with the custom-metric policy below.
resource "aws_appautoscaling_policy" "split_ws_memory" {
  count              = var.three_service_split_enabled && !var.ws_autoscale_on_connections ? 1 : 0
  name               = "${var.project_name}-ws-memory-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.split_ws[0].resource_id
  scalable_dimension = aws_appautoscaling_target.split_ws[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.split_ws[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = var.split_ws_memory_target
    scale_in_cooldown  = 600 # WS clients reconnect on scale-in; be conservative
    scale_out_cooldown = 120
  }
}

# Custom-metric ws scaling (opt-in).  Drives the scaling target on the live
# count of local Electron WebSocket connections rather than memory%.  See the
# module docstring in app/services/metrics.py for rationale.
resource "aws_appautoscaling_policy" "split_ws_connections" {
  count              = var.three_service_split_enabled && var.ws_autoscale_on_connections ? 1 : 0
  name               = "${var.project_name}-ws-connections-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.split_ws[0].resource_id
  scalable_dimension = aws_appautoscaling_target.split_ws[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.split_ws[0].service_namespace

  target_tracking_scaling_policy_configuration {
    customized_metric_specification {
      namespace   = "Coasty/WS"
      metric_name = "LocalConnections"
      statistic   = "Average"

      dimensions {
        name  = "ServiceName"
        value = "${var.project_name}-ws"
      }
    }
    target_value       = var.split_ws_connections_target
    scale_in_cooldown  = 600
    scale_out_cooldown = 120
  }
}


# =============================================================================
# OUTPUTS (only emitted when split is enabled)
# =============================================================================

output "split_api_service_name" {
  description = "Name of the api ECS service (null when split is disabled)"
  value       = var.three_service_split_enabled ? aws_ecs_service.api[0].name : null
}

output "split_sse_service_name" {
  description = "Name of the sse ECS service (null when split is disabled)"
  value       = var.three_service_split_enabled ? aws_ecs_service.sse[0].name : null
}

output "split_ws_service_name" {
  description = "Name of the ws ECS service (null when split is disabled)"
  value       = var.three_service_split_enabled ? aws_ecs_service.ws[0].name : null
}

output "split_deploy_command" {
  description = "Single command to trigger rolling deploys on all three split services"
  value = var.three_service_split_enabled ? join(" && ", [
    "aws ecs update-service --cluster ${aws_ecs_cluster.main.name} --service ${aws_ecs_service.api[0].name} --force-new-deployment --region ${var.aws_region}",
    "aws ecs update-service --cluster ${aws_ecs_cluster.main.name} --service ${aws_ecs_service.sse[0].name} --force-new-deployment --region ${var.aws_region}",
    "aws ecs update-service --cluster ${aws_ecs_cluster.main.name} --service ${aws_ecs_service.ws[0].name} --force-new-deployment --region ${var.aws_region}",
  ]) : null
}
