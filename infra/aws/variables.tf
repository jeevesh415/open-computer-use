# -----------------------------------------------------------------------------
# General
# -----------------------------------------------------------------------------

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "llmhub"
}

variable "environment" {
  description = "Environment name (production, staging, dev)"
  type        = string
  default     = "production"
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "nat_gateway_count" {
  description = "Number of NAT gateways (1 = cost-saving / dev, 2 = HA / prod). One per AZ."
  type        = number
  default     = 2

  validation {
    condition     = var.nat_gateway_count >= 1 && var.nat_gateway_count <= 2
    error_message = "nat_gateway_count must be 1 or 2 (matches subnet count)."
  }
}

# -----------------------------------------------------------------------------
# Container Images
# -----------------------------------------------------------------------------

variable "frontend_image" {
  description = "Full ECR image URI for the frontend (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/llmhub-frontend:latest)"
  type        = string
}

variable "backend_image" {
  description = "Full ECR image URI for the backend (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/llmhub-backend:latest)"
  type        = string
}

# -----------------------------------------------------------------------------
# Task Resources
# -----------------------------------------------------------------------------

variable "task_cpu" {
  description = "Total CPU units for the Fargate task (1024 = 1 vCPU). Must be >= sum of container CPUs."
  type        = number
  default     = 1024
}

variable "task_memory" {
  description = "Total memory (MiB) for the Fargate task. Must be >= sum of container memory."
  type        = number
  default     = 2048
}

variable "frontend_cpu" {
  description = "CPU units allocated to the frontend container"
  type        = number
  default     = 512
}

variable "frontend_memory" {
  description = "Memory (MiB) allocated to the frontend container"
  type        = number
  # Bumped 1024 → 2048 on 2026-05-02 in response to a JS heap OOM at
  # 2026-05-02T03:53:00Z on task `8d476ca3…`:
  #
  #   FATAL ERROR: Ineffective mark-compacts near heap limit
  #   Allocation failed - JavaScript heap out of memory
  #
  # The crash dropped HealthyHostCount=1 and produced 282 ELB-side 5xx
  # in the next minute. Driver: per-user EC2 snapshot polling loop
  # (~1 minute heartbeat × multiple users × 2 tasks duplicating reads)
  # kept growing the V8 old-generation heap past the 768 MiB
  # `--max-old-space-size` cap → SIGABRT, no graceful drain.
  #
  # Bumping to 2048 + raising NODE_OPTIONS to 1536 (in ecs.tf) gives
  # V8 enough room for steady-state load while leaving ~25% (512 MiB)
  # headroom for non-heap overhead.
  default = 2048
}

variable "backend_cpu" {
  description = "CPU units allocated to the backend container"
  type        = number
  default     = 512
}

variable "backend_memory" {
  description = "Memory (MiB) allocated to the backend container"
  type        = number
  default     = 1024
}

# -----------------------------------------------------------------------------
# Scaling
# -----------------------------------------------------------------------------

variable "desired_count" {
  description = "Initial number of task instances to run"
  type        = number
  default     = 1
}

variable "min_capacity" {
  description = "Minimum number of tasks for auto-scaling"
  type        = number
  default     = 1
}

variable "max_capacity" {
  description = "Maximum number of tasks for auto-scaling"
  type        = number
  default     = 4
}

variable "cpu_scaling_target" {
  description = "Target CPU utilization (%) to trigger scale-out"
  type        = number
  default     = 70
}

variable "memory_scaling_target" {
  description = "Target memory utilization (%) to trigger scale-out"
  type        = number
  default     = 80
}

variable "request_count_per_target_target" {
  description = <<-EOT
    Target requests-per-minute per running frontend task to trigger scale-out
    via the ALBRequestCountPerTarget predefined metric.

    Why we have this in addition to CPU and memory:
      The 2026-04-23T03:18Z incident saw the frontend task hit P99 latency
      53s and produce 970 ELB 5xx in a single minute, well before CPU
      crossed the 70% target.  Next.js's queueing behaviour means a
      saturated event loop doesn't necessarily show up as CPU pressure
      until requests are already timing out.  Request-count-per-target
      reacts faster: at >200 reqs/min sustained, scale out before the
      queue overflows.

    200 is a deliberate cap-and-double of typical steady-state RPS for the
    frontend and is well under what a single Fargate vCPU can serve cleanly
    for SSR pages.  Tune this lower for spikier traffic or up to 400 if
    the workload is mostly static-served.
  EOT
  type        = number
  default     = 200
}

# -----------------------------------------------------------------------------
# Load Balancer & HTTPS
# -----------------------------------------------------------------------------

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS. Leave empty for HTTP-only mode."
  type        = string
  default     = ""
}

variable "health_check_path" {
  description = "HTTP path for ALB health checks against the frontend"
  type        = string
  default     = "/api/health"
}

# -----------------------------------------------------------------------------
# Environment Variables
# All config is passed as plain environment variables on the task definition.
# Mark sensitive values as sensitive = true if using Terraform Cloud.
# -----------------------------------------------------------------------------

variable "frontend_env_vars" {
  description = "Environment variables for the frontend container (key = value pairs)"
  type        = map(string)
  default     = {}
}

variable "backend_env_vars" {
  description = "Environment variables for the backend container (key = value pairs)"
  type        = map(string)
  default     = {}
}

# -----------------------------------------------------------------------------
# Admin allowlist — gates POST /api/billing/sessions/cleanup (and future admin
# routes) via require_admin().  Empty default fails closed: no admins, every
# admin endpoint returns 403.  See backend/app/services/auth.py::require_admin.
# Set explicitly in terraform.tfvars when operators need manual cleanup access.
# Not flagged sensitive — this is an allowlist of emails, not a credential.
# -----------------------------------------------------------------------------

variable "admin_emails" {
  description = "Comma-separated admin email allowlist for /api/billing/sessions/cleanup and future admin routes"
  type        = string
  default     = ""
  sensitive   = false
}

# -----------------------------------------------------------------------------
# 3-Service Split (coasty-api / coasty-sse / coasty-ws)
#
# When enabled, provisions three backend-only ECS services that mount disjoint
# subsets of routers (see backend/main.py COASTY_SERVICE_MODE).  ALB listener
# rules on port 8001 route `/api/electron/ws` → ws service, `/api/chat/*` and
# `/api/swarm/*` → sse service, and everything else → api service.
#
# The frontend+backend sidecar task stays up when this flag is on: the
# frontend still calls its local backend via `http://localhost:8001` for
# internal API proxying (CRUD, credits, etc.), but all EXTERNAL port-8001
# traffic (Electron app direct, public API consumers) routes to the split
# services.  Rollback = set flag to false and apply.
# -----------------------------------------------------------------------------

variable "three_service_split_enabled" {
  description = "Provision the coasty-api/sse/ws split services + ALB listener rules. When false (default) the legacy sidecar setup is unchanged."
  type        = bool
  default     = false
}

# Opt-in: remove the backend sidecar container from the frontend task and route
# internal frontend→backend calls through the ALB to the api service.
#
# REQUIRES three_service_split_enabled = true (there must be an api service for
# the default listener action to forward to).  Validated via the check block in
# main.tf.
#
# Effect when true:
#   * Frontend task drops the backend sidecar container (frontend task memory
#     ~1 GB instead of ~2 GB; ~40% savings per frontend task).
#   * PYTHON_BACKEND_URL in the frontend container flips from
#     http://localhost:8001  →  http://<alb_dns>:8001
#     Next.js API routes reach the api/sse/ws services by path via ALB rules.
#   * The :8001 listener's default action forwards to api-tg instead of
#     backend-tg (the legacy sidecar target group; left in place but unused).
#   * aws_ecs_service.app's second load_balancer block (backend → backend-tg)
#     is omitted.
#
# Rollback: set to false and apply.  The backend sidecar container returns,
# PYTHON_BACKEND_URL goes back to localhost, default action returns to
# backend-tg.  Safe with zero code changes.
variable "remove_frontend_sidecar" {
  description = "Remove the backend sidecar container from the frontend task and route internal calls through the ALB. REQUIRES three_service_split_enabled = true."
  type        = bool
  default     = false
}

# ---- api service (REST CRUD) --------------------------------------------

variable "split_api_cpu" {
  description = "CPU units for the api service task"
  type        = number
  default     = 512
}

variable "split_api_memory" {
  description = "Memory (MiB) for the api service task"
  type        = number
  default     = 1024
}

variable "split_api_desired_count" {
  description = "Initial desired task count for the api service"
  type        = number
  default     = 1
}

variable "split_api_min_capacity" {
  description = "Autoscaling floor for the api service"
  type        = number
  default     = 1
}

variable "split_api_max_capacity" {
  description = "Autoscaling ceiling for the api service"
  type        = number
  default     = 4
}

variable "split_api_cpu_target" {
  description = "Target CPU utilization (%) for api service autoscaling"
  type        = number
  default     = 70
}

# ---- sse service (long-lived streaming) ---------------------------------

variable "split_sse_cpu" {
  description = "CPU units for the sse service task (streams are not CPU-bound but concurrent streams hold event-loop time)"
  type        = number
  default     = 1024
}

variable "split_sse_memory" {
  description = "Memory (MiB) for the sse service task"
  type        = number
  default     = 2048
}

variable "split_sse_desired_count" {
  description = "Initial desired task count for the sse service"
  type        = number
  default     = 1
}

variable "split_sse_min_capacity" {
  description = "Autoscaling floor for the sse service"
  type        = number
  default     = 1
}

variable "split_sse_max_capacity" {
  description = "Autoscaling ceiling for the sse service"
  type        = number
  default     = 4
}

variable "split_sse_cpu_target" {
  description = "Target CPU utilization (%) for sse service autoscaling (lower than api because streams hold threads). Used only when sse_autoscale_on_active_streams = false."
  type        = number
  default     = 50
}

# Opt-in: scale coasty-sse on the live SSE-stream count instead of CPU%.
# When true, replaces the CPU-based policy with a target-tracking policy
# whose customised metric is Coasty/SSE::ActiveStreams (emitted by every
# sse worker via app.services.metrics).  CPU% is a poor proxy for long
# streams because idle streams use near-zero CPU; a task can hold 2 000
# SSE clients at 30 % CPU and never trigger scale-out.  See the module
# docstring in app/services/metrics.py for full rationale.
#
# REQUIRES three_service_split_enabled = true.
variable "sse_autoscale_on_active_streams" {
  description = "Scale coasty-sse on Coasty/SSE::ActiveStreams custom metric instead of CPU%."
  type        = bool
  default     = false
}

variable "split_sse_streams_target" {
  description = "Target average ActiveStreams count per worker for sse autoscaling. Rule of thumb: ~150 SSE streams per uvicorn worker keeps p99 time-to-first-byte under 500 ms."
  type        = number
  default     = 150
}

# ---- ws service (Electron WebSocket) ------------------------------------

variable "split_ws_cpu" {
  description = "CPU units for the ws service task. Bumped from 512 to 1024 (Fargate's lower bound for tasks with >=4GB memory) when 2GB workers were getting OOM-SIGKILLed under live Electron load."
  type        = number
  default     = 1024
}

variable "split_ws_memory" {
  description = "Memory (MiB) for the ws service task. Bumped from 2048 to 4096 — observed peaks of 93% on 2GB triggering kernel OOM-kills (gunicorn worker SIGKILL with 'Perhaps out of memory?'); each Electron WS holds ~50-100KB plus screenshot buffers in flight, so headroom prevents drops."
  type        = number
  default     = 4096
}

variable "split_ws_desired_count" {
  description = "Initial desired task count for the ws service"
  type        = number
  default     = 1
}

variable "split_ws_min_capacity" {
  description = "Autoscaling floor for the ws service"
  type        = number
  default     = 1
}

variable "split_ws_max_capacity" {
  description = "Autoscaling ceiling for the ws service"
  type        = number
  default     = 3
}

variable "split_ws_memory_target" {
  description = "Target memory utilization (%) for ws service autoscaling — WS holds memory, not CPU. Used only when ws_autoscale_on_connections = false."
  type        = number
  default     = 70
}

# Opt-in: scale coasty-ws on the live Electron WebSocket connection count
# instead of memory%.  When true, replaces the memory-based policy with a
# target-tracking policy whose customised metric is
# Coasty/WS::LocalConnections (emitted by every ws worker via
# app.services.metrics).  Memory% is a proxy for connection count but
# distorted by Python GC + per-connection buffer variance.  See the module
# docstring in app/services/metrics.py for full rationale.
#
# REQUIRES three_service_split_enabled = true.
variable "ws_autoscale_on_connections" {
  description = "Scale coasty-ws on Coasty/WS::LocalConnections custom metric instead of memory%."
  type        = bool
  default     = false
}

variable "split_ws_connections_target" {
  description = "Target average LocalConnections count per worker for ws autoscaling. A Python event loop comfortably handles ~2 000 idle WebSockets, but we aim much lower (200/worker) to leave headroom for command-dispatch latency and CPU bursts during screenshot handling."
  type        = number
  default     = 200
}

# -----------------------------------------------------------------------------
# ElastiCache (Valkey)
# -----------------------------------------------------------------------------

variable "redis_node_type" {
  description = "ElastiCache node type. cache.t4g.micro for dev/staging (~$11/mo), cache.r7g.large for prod (~$130/mo)."
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_replica_count" {
  description = "Number of read replicas (0 = single-node, no failover; 1 = HA across 2 AZs; 2 = extra read capacity)."
  type        = number
  default     = 1
}

variable "redis_parameter_group_name" {
  description = "Parameter group name for the Valkey cluster. Use default.valkey7 unless you need custom maxmemory policies."
  type        = string
  default     = "default.valkey7"
}

variable "redis_snapshot_retention_days" {
  description = "Days to retain automatic snapshots (0 disables snapshots)."
  type        = number
  default     = 5
}
