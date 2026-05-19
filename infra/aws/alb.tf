# -----------------------------------------------------------------------------
# Application Load Balancer
# -----------------------------------------------------------------------------

resource "aws_lb" "main" {
  name               = "${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # Higher idle timeout for long-lived WebSocket connections (Electron bridge)
  idle_timeout = 3600

  # Enable access logs by uncommenting and configuring an S3 bucket
  # access_logs {
  #   bucket  = aws_s3_bucket.alb_logs.id
  #   prefix  = var.project_name
  #   enabled = true
  # }

  tags = { Name = "${var.project_name}-alb" }
}

# -----------------------------------------------------------------------------
# Target Group (routes to the frontend container on port 3000)
# -----------------------------------------------------------------------------

resource "aws_lb_target_group" "frontend" {
  name        = "${var.project_name}-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip" # Required for Fargate awsvpc networking

  health_check {
    enabled             = true
    path                = var.health_check_path
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    timeout             = 10
    interval            = 30
    matcher             = "200"
  }

  # During a rolling deploy the ALB stops forwarding new requests to the
  # deregistering target and waits this long for in-flight requests to finish
  # before yanking the target.  30 s was too short for long-running SSE /
  # streaming endpoints — clients saw truncated responses on every deploy.
  # 120 s drains almost all realistic requests while still letting a deploy
  # complete within a reasonable window.  The AWS default is 300 s.
  #
  # NOTE: ALB (HTTP/HTTPS) target groups do NOT support
  # `deregistration_delay.connection_termination.enabled` — that attribute is
  # NLB-only.  ALB will close idle keepalive connections at the listener's
  # `idle_timeout`, and open SSE streams will be severed when the target is
  # finally removed.  Mitigations live in the app: UvicornWorker gets 90 s
  # `timeout`, SSE handlers emit keepalives, and clients reconnect.
  deregistration_delay = 120

  # Slow-start ramps a freshly-registered target's share of traffic from 0%
  # → 100% over this many seconds. Without it, a Next.js task that just
  # finished its ALB health check (after a ~5 min cold start: i18n init +
  # AWS SDK warm-up) gets the full 50 % of incoming RPS instantly and
  # tail-latency stalls everything in the request queue.
  #
  # Added on 2026-05-02 to mitigate the deploy-time 5xx cluster between
  # 19:21Z–19:57Z (1,002 ELB-side 5xx in one hour). With slow_start = 60s
  # ALB sends ~6 RPS the first second, ~60 RPS at 10 s, full share at 60 s
  # — giving each new task ~60 s of low-pressure traffic to complete its
  # JIT warm-up and Bedrock client preheat before facing peak load.
  #
  # Range: 30–900 s per AWS docs. 60 s matches our typical Next.js
  # cold-start window observed in CloudWatch task-start → first-request
  # latency.
  slow_start = 60

  # Sticky sessions (uncomment if your app needs session affinity)
  # stickiness {
  #   type            = "lb_cookie"
  #   cookie_duration = 86400
  #   enabled         = true
  # }

  tags = { Name = "${var.project_name}-tg" }
}

# -----------------------------------------------------------------------------
# Backend API Target Group (routes to the backend container on port 8001)
# Used by the Electron app to hit the FastAPI backend directly.
# -----------------------------------------------------------------------------

resource "aws_lb_target_group" "backend" {
  name        = "${var.project_name}-backend-tg"
  port        = 8001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/api/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    timeout             = 10
    interval            = 30
    matcher             = "200"
  }

  # Backend handles the Electron WebSocket (long-lived) and SSE chat streams.
  # Bumped from 30 s → 120 s to avoid severing long requests mid-deploy.  See
  # the frontend target group above for the full rationale and the ALB vs NLB
  # note on `connection_termination` (ALB does not expose it).
  deregistration_delay = 120

  tags = { Name = "${var.project_name}-backend-tg" }
}

# -----------------------------------------------------------------------------
# Backend API Listener (port 8001) — Electron app connects here
# HTTPS when certificate is available (required for wss:// WebSocket),
# falls back to HTTP otherwise.
# -----------------------------------------------------------------------------

resource "aws_lb_listener" "backend" {
  load_balancer_arn = aws_lb.main.arn
  port              = 8001
  protocol          = var.certificate_arn != "" ? "HTTPS" : "HTTP"
  ssl_policy        = var.certificate_arn != "" ? "ELBSecurityPolicy-TLS13-1-2-2021-06" : null
  certificate_arn   = var.certificate_arn != "" ? var.certificate_arn : null

  # Default action target:
  #   * remove_frontend_sidecar = false → legacy backend-tg (sidecar container)
  #   * remove_frontend_sidecar = true  → api-tg (split services)
  # The cross-variable check in main.tf ensures api-tg exists (i.e. the
  # three-service split is enabled) before this branch can be taken.  The
  # `length(aws_lb_target_group.api) > 0` guard is defensive: even though
  # the check block blocks invalid flag combinations at plan time, Terraform's
  # conditional-expression evaluation semantics don't cleanly short-circuit
  # on count-gated `[0]` references, so we use an explicit length check to
  # avoid `Invalid index` plan errors in the off-path.
  #
  # When the three-service split is enabled WITHOUT sidecar removal, listener
  # rules 10/20/30/1000 catch all external traffic before the default action
  # is consulted, so the default effectively never fires.  Keeping it pointed
  # at backend-tg in that case preserves a clean revert path — turning the
  # split flag off restores today's behaviour in full.
  default_action {
    type = "forward"
    target_group_arn = (
      var.remove_frontend_sidecar && length(aws_lb_target_group.api) > 0
      ? aws_lb_target_group.api[0].arn
      : aws_lb_target_group.backend.arn
    )
  }
}

# -----------------------------------------------------------------------------
# HTTP Listener (port 80)
# When certificate_arn is set: redirects to HTTPS
# When certificate_arn is empty: forwards directly to target group
# -----------------------------------------------------------------------------

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# -----------------------------------------------------------------------------
# NOTE: the previous `aws_lb_listener.backend_internal_http` on :8002 was
# deleted.  It didn't work: the listener was on the internet-facing ALB,
# whose DNS resolves to public IPs from inside the VPC.  Fargate traffic
# had to route via NAT, but the ingress SG rule required ECS-SG source —
# NAT-translated packets never match.  Replaced by a dedicated internal
# ALB (see alb_internal.tf) that has private IPs only and works correctly
# for VPC-internal traffic.
# -----------------------------------------------------------------------------

# Redirect rule — only added when HTTPS is enabled
resource "aws_lb_listener_rule" "http_redirect" {
  count        = var.certificate_arn != "" ? 1 : 0
  listener_arn = aws_lb_listener.http.arn
  priority     = 1

  condition {
    path_pattern {
      values = ["/*"]
    }
  }

  action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# -----------------------------------------------------------------------------
# HTTPS Listener (port 443) — only created when certificate_arn is provided
# -----------------------------------------------------------------------------

resource "aws_lb_listener" "https" {
  count             = var.certificate_arn != "" ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# -----------------------------------------------------------------------------
# HTTPS listener rule — route /api/electron/ws directly to the ws service.
#
# Background
# ----------
# The Electron desktop app opens its WebSocket bridge against its configured
# backend URL — which is `https://coasty.ai` (port 443) in the shipped .env.
# ws-bridge.ts builds the URL as:
#     `${backendUrl.replace(/^http/, 'ws')}/api/electron/ws`
# so the resulting URL is `wss://coasty.ai/api/electron/ws` on port 443.
#
# Without this rule, that request hits the HTTPS listener's default_action and
# is forwarded to the frontend target group (Next.js on :3000).  Next.js has
# no handler for `/api/electron/ws` (API routes can't answer raw WebSocket
# upgrades), the upgrade is rejected, and the bridge ends up in 'error' state.
# Combined with the renderer's auto-sign-out on connection error, the user is
# kicked back to the auth screen immediately after signing in — the symptom
# reported as "sign-in doesn't work".
#
# The same path already has a rule on the :8001 listener (see
# split_electron_ws in ecs_split.tf).  Adding the mirrored rule on :443 makes
# the routing work regardless of whether Cloudflare (or any other edge) is
# rewriting ports or preserving :443.  Exact-path match (no wildcard) ensures
# only the WS endpoint is diverted — all other `/api/electron/*` paths
# (proxy/*, machines, machines/{id}/*) continue to go to Next.js as before.
#
# Gated on `three_service_split_enabled` because the target (aws_lb_target_group.ws)
# only exists when the split is on; in the legacy sidecar-only topology
# there's no separate ws service to forward to and /api/electron/ws is
# served by the in-task backend via Next.js's proxy route on :443.
# -----------------------------------------------------------------------------

resource "aws_lb_listener_rule" "https_electron_ws" {
  count        = var.certificate_arn != "" && var.three_service_split_enabled ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
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
