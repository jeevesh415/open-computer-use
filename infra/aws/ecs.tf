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
#
# One or two containers depending on var.remove_frontend_sidecar:
#   * remove_frontend_sidecar = false (default):
#       - nextjs-app (port 3000) — the frontend, receives ALB traffic
#       - backend    (port 8001) — FastAPI, reachable at localhost:8001 from
#                                  frontend (sidecar pattern)
#   * remove_frontend_sidecar = true (requires three_service_split_enabled):
#       - nextjs-app only.  Next.js API routes reach the backend via ALB DNS
#         (PYTHON_BACKEND_URL), which routes by path to the split
#         api/sse/ws services.  ~40% memory reduction per frontend task.
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "app" {
  family                   = var.project_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  # The Route53 / time_sleep dependency from an earlier (failed) attempt was
  # removed along with route53.tf — see alb_internal.tf for the correct
  # approach.  The task def no longer needs to wait on any DNS propagation
  # because the internal ALB's DNS is auto-registered in AWS's resolver and
  # available immediately on ALB creation.

  # Container list is built conditionally.  `merge(...)` on the nextjs-app
  # definition conditionally attaches `dependsOn` (only when the backend
  # sidecar exists; otherwise the frontend would wait forever for a HEALTHY
  # signal that never arrives).  `concat(...)` on the outer list drops the
  # backend container entirely when remove_frontend_sidecar = true.
  container_definitions = jsonencode(concat(
    [
      # ----- Frontend Container (always present) -------------------------
      merge(
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

          # Environment layering (early → late; LATE wins under ECS duplicate
          # resolution):
          #   1. Static defaults (NODE_ENV, HOSTNAME, PORT).
          #   2. User-provided frontend_env_vars from tfvars — FILTERED to
          #      drop PYTHON_BACKEND_URL so a stale user override can't
          #      silently undo the infrastructure's routing decision.  That
          #      env var is entirely owned by var.remove_frontend_sidecar and
          #      is set last, below, so it always wins.
          #   3. Infrastructure-owned PYTHON_BACKEND_URL last → wins even if
          #      a duplicate slipped through.
          environment = concat(
            [
              { name = "NODE_ENV", value = "production" },
              { name = "NEXT_TELEMETRY_DISABLED", value = "1" },
              # HOSTNAME must be set explicitly — Fargate's container runtime
              # can override the Dockerfile ENV with the task hostname, causing
              # Next.js to bind to the wrong interface and reject health checks.
              { name = "HOSTNAME", value = "0.0.0.0" },
              { name = "PORT", value = "3000" },
              # NODE_OPTIONS: cap V8's old-generation heap so a slow leak or a
              # genuinely large request can't push the container into a hard OOM.
              #
              # 2026-04-24T03:18:36Z first OOM incident: container 86867d6a
              # died with `FATAL ERROR: Reached heap limit` after a 140 s
              # mark-sweep that freed only 3 MB (502→499 MB).  Without an
              # explicit cap, V8's default heap on Node 20 is ~75 % of the
              # memlimit cgroup it sees, which on Fargate is the *task*
              # memory, not the per-container reservation — so V8 happily
              # grows past the container limit and the kernel kills us with
              # no graceful shutdown, no drain.
              #
              # 2026-05-02T03:53:00Z second OOM (this is what drove the
              # 1024→2048 MiB bump):
              #   FATAL ERROR: Ineffective mark-compacts near heap limit
              #   Allocation failed - JavaScript heap out of memory
              # on task `8d476ca3…`. Driver was a per-user EC2 snapshot
              # polling loop that grew the heap past the prior 768 MiB cap
              # under organic load.  The fix is the SAME shape recommended
              # in the prior comment: bump frontend_memory to 2048 MiB AND
              # raise this to 1536 (NOT one without the other — V8 must
              # have headroom under the cgroup limit).
              #
              # Sizing math (2026-05-02):
              #   1536 MiB old-generation heap (this knob)
              #   +  ~512 MiB non-heap (V8 code cache, stacks, native
              #      buffers, async I/O queues, libuv thread pool stacks)
              #   = ~2048 MiB total — exactly the new container reservation.
              # V8 starts GCing aggressively before the cgroup limit, so
              # slow leaks surface as observable GC pauses and slow
              # responses (caught by ALBRequestCountPerTarget) rather than
              # as a sudden SIGKILL.
              #
              # SIGUSR2 heap snapshots (`process.kill(pid, 'SIGUSR2')`) are
              # available on Node ≥18 for live debugging via ECS Exec.
              { name = "NODE_OPTIONS", value = "--max-old-space-size=1536" },
            ],
            [
              for k, v in var.frontend_env_vars : { name = k, value = v }
              # Drop PYTHON_BACKEND_URL from user overrides — the infra-side
              # value (below) is the only correct source under the split +
              # sidecar-removal flag combinations.
              if k != "PYTHON_BACKEND_URL"
            ],
            [
              # PYTHON_BACKEND_URL appears LAST so ECS's duplicate-key
              # resolution (keeps the last) can't be reversed by upstream
              # config drift.
              #
              # Port + host selection:
              #   * Sidecar present    → http://localhost:8001
              #       (loopback; backend container in the same task)
              #   * Sidecar removed    → http://<internal-alb-dns>:8001
              #       (scheme=internal ALB, private IPs only from within VPC,
              #        forwards by path to api/sse/ws target groups)
              #
              # Background on why the "obvious" options don't work:
              #   • Public ALB DNS (:8001 HTTPS) — cert is for coasty.ai,
              #     so TLS validation fails against the raw ALB hostname.
              #   • Public ALB DNS (:8002 HTTP) — ALB is internet-facing,
              #     DNS resolves to PUBLIC IPs from inside the VPC.  Traffic
              #     exits via NAT; the ALB SG rule "from ECS SG" rejects the
              #     NAT-sourced packet.  Dropped.
              #   • Route53 private hosted zone with alias to the public ALB —
              #     still returns the ALB's PUBLIC IPs (documented AWS limit
              #     for internet-facing ALBs).  Same NAT loop, same SG drop.
              #   • coasty.ai on port 8001 via Cloudflare — that's the public
              #     edge, goes to NAT too AND adds the CF hop.
              #
              # The supported answer is a second ALB with `internal = true`
              # (see alb_internal.tf).  Internal ALB DNS resolves to the
              # ALB's private ENI addresses from within the VPC.  Traffic
              # stays on the VPC fabric: ~1 ms round-trip, no NAT, no SG
              # mismatch.  Listener rules in ecs_split.tf forward to the
              # same api/sse/ws target groups as the public ALB does.
              { name = "PYTHON_BACKEND_URL", value = (
                var.remove_frontend_sidecar && length(aws_lb.internal_backend) > 0
                ? "http://${aws_lb.internal_backend[0].dns_name}:8001"
                : "http://localhost:8001"
              ) },
            ]
          )

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
        # Only declare dependsOn when the backend sidecar exists in this task.
        # With the sidecar removed, nextjs-app has no intra-task dependency.
        var.remove_frontend_sidecar ? {} : {
          dependsOn = [{
            containerName = "backend"
            condition     = "HEALTHY"
          }]
        }
      ),
    ],

    # ----- Backend Sidecar Container (omitted when remove_frontend_sidecar) -
    var.remove_frontend_sidecar ? [] : [
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
            # Admin allowlist for /api/billing/sessions/cleanup (and future
            # admin routes) — see backend/app/services/auth.py::require_admin.
            # Empty = no admins (fail-closed). Operators set var.admin_emails
            # in terraform.tfvars to populate.
            { name = "ADMIN_EMAILS", value = var.admin_emails },
            # Wire up the Valkey replication group provisioned in elasticache.tf.
            # backend_env_vars (terraform.tfvars) takes precedence — set REDIS_URL
            # there to override (e.g. for a pinned reader endpoint).
            { name = "REDIS_URL", value = "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379" },
            { name = "CACHE_ENABLED", value = "true" },
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
    ]
  ))
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

  # Backend API — exposed on ALB port 8001 via the legacy backend target group.
  # Only attached when the sidecar container exists in the task definition;
  # with remove_frontend_sidecar=true there's no "backend" container for ECS
  # to register, so this block is omitted.
  dynamic "load_balancer" {
    for_each = var.remove_frontend_sidecar ? [] : [1]
    content {
      target_group_arn = aws_lb_target_group.backend.arn
      container_name   = "backend"
      container_port   = 8001
    }
  }

  # Give containers time to start before ALB health checks count against the task.
  # Backend needs ~10-30s to init, frontend waits for backend HEALTHY, then needs
  # 2 consecutive ALB checks (60s) to become healthy.  Total: ~120s worst case.
  health_check_grace_period_seconds = 180

  # Rolling deployment: never drop below current capacity, allow up to
  # 200% during deploy so new tasks come up before old ones drain.
  #
  # NOTE: deployment_minimum_healthy_percent is hard-capped at 100 by the
  # ECS API (InvalidParameterException otherwise). A 2026-05-02 change set
  # this to 150 to mitigate a deploy-time 5xx incident (1,002 ELB 5xx
  # between 19:21Z–19:57Z; root cause: Next.js cold start ~5 min, during
  # which HealthyHostCount sat at 1 and got overwhelmed by 200+ RPS).
  # That fix was rejected by the API on the next apply — the field can't
  # express "wait for ALB-healthy before draining", it only governs the
  # RUNNING-state floor.
  #
  # Reverted to 100 (the max legal value) on 2026-05-05 to unblock apply.
  # If the cold-start 5xx pattern returns, the real levers are:
  #   • bump min_capacity / desired_count so a single warming task is
  #     never the only healthy host
  #   • increase slow_start_seconds on the frontend target group
  #     (alb.tf) so traffic ramps gracefully onto freshly-warm tasks
  #   • move to ECS blue/green via CodeDeploy (full new fleet stands up
  #     and passes health checks before any traffic shifts)
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # Enable ECS deployment circuit breaker to auto-rollback failed deploys
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Force a new deployment on every `terraform apply`.
  #
  # Rationale: var.frontend_image / var.backend_image use the `:latest` mutable
  # tag, so pushing a new image to ECR does NOT change the task-definition string
  # Terraform diffs against — without this flag, `apply` is a no-op and ECS
  # never pulls the new digest.  With force_new_deployment=true, ECS schedules
  # a fresh rollout on every apply.  Fargate always pulls the image on task
  # start, so the new digest is picked up.
  #
  # Disruption is bounded by the rolling-deploy settings above:
  #   • min healthy 100%  → never drops below current capacity
  #   • max 200%          → new tasks come up BEFORE old ones drain
  #   • 120s deregistration delay on the target group
  #     (alb.tf:61, alb.tf:101) → in-flight requests finish on old tasks
  #   • circuit breaker + rollback → auto-revert on health failures
  #
  # Trade-off: every apply triggers a deploy, even when only non-image fields
  # changed.  That's intentional — the alternative (immutable image tags) would
  # require plumbing a tag var through every push.  If you want a no-op apply,
  # comment this line and run `aws ecs update-service --force-new-deployment`
  # out-of-band (see the `redeploy_command` output in outputs.tf).
  force_new_deployment = true

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

# -----------------------------------------------------------------------------
# Scale on ALB request count per target.
#
# Background — why we added this in addition to CPU and memory policies
# ---------------------------------------------------------------------
# On 2026-04-23T03:18Z (23:18 EDT 04-23) the frontend received a 1,040
# req/s burst against a single Next.js task.  P99 latency climbed to
# 53.38 s — past the public ALB's 60 s idle timeout — and 970 of those
# requests came back as ELB 5xx.  The auto-scaling policies in place at
# the time (CPU 70% / memory 80%) never fired: Next.js's request queue
# fills up before CPU saturates, so by the time CPU would trip the alarm
# the requests are already timing out.
#
# ALBRequestCountPerTarget reacts to *queue length* (effectively, RPS per
# task), not CPU.  At >200 sustained reqs/min per running task, scale out
# before the queue overflows.  This is a leading indicator; CPU/memory
# remain as backstop policies for workloads that are CPU-bound rather
# than I/O-bound.
#
# `resource_label` is the special "<alb-arn-suffix>/<tg-arn-suffix>" form
# required by ALBRequestCountPerTarget so the autoscaling target knows
# WHICH ALB target group's request count to monitor.  See
# https://docs.aws.amazon.com/autoscaling/application/userguide/services-that-can-integrate-applicationelb.html#applicationelb-resource-label
# -----------------------------------------------------------------------------

resource "aws_appautoscaling_policy" "request_count" {
  name               = "${var.project_name}-request-count-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.frontend.arn_suffix}"
    }
    target_value = var.request_count_per_target_target
    # Scale-out fast (60s) so a burst doesn't sit on the queue for long.
    # Scale-in slow (300s) so we don't oscillate when traffic dips briefly.
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
