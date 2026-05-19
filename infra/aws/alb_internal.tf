# =============================================================================
# Internal ALB — for frontend→backend traffic when the sidecar is removed
# =============================================================================
#
# Background — why this file exists
# ----------------------------------
# When var.remove_frontend_sidecar = true, the Next.js frontend no longer has
# a backend container in the same task, so it has to reach the backend over
# the network.  The public llmhub-alb is internet-facing, which means its
# auto-generated DNS name resolves to PUBLIC IPs even from inside the VPC.
# Any frontend→backend fetch aimed at that DNS therefore:
#
#   Fargate (private subnet, ECS SG)
#     └─► NAT Gateway (SNAT to NAT's public EIP)
#           └─► Internet Gateway
#                 └─► Public ALB ENI (public IP)
#                       └─► SG check "allow from ECS SG" — packet source is
#                           NAT's public EIP, NOT an ECS SG member → DROP
#
# Three earlier attempted fixes didn't work:
#   1. Opening the public :8002 listener to ECS SG only — NAT-originated
#      traffic never matches ECS SG, so SG drops it.
#   2. Route53 private hosted zone alias to the internet-facing ALB — Route53
#      returns the ALB's public IPs even in private zones (documented AWS
#      behaviour), so the traffic path is unchanged.
#   3. Opening :8002 to 0.0.0.0/0 — would work but exposes an HTTP-plaintext
#      backend to the public internet.  Unacceptable.
#
# The supported AWS solution is a SECOND ALB with scheme = "internal".  An
# internal ALB's ENIs live in private subnets with private IPs only; its
# auto-generated DNS name resolves (from within the VPC) to those private
# IPs.  Traffic stays on the VPC fabric, never touches NAT, has consistent
# single-digit-ms latency, and the SG rule "from ECS SG only" works as
# intended because the source IP really is in the ECS SG.
#
# Cost impact: ~$16/month base + LCU charges (tiny at our volume).
# Gated on var.remove_frontend_sidecar — zero resources when the sidecar is
# still in place.
#
# Target-group reuse
# ------------------
# ALBs can forward to target groups that are ALSO forwarded to by other
# ALBs.  We therefore reuse the existing split TGs (api-tg, sse-tg, ws-tg)
# instead of creating duplicates.  The ECS services are already registered
# with those TGs via their load_balancer blocks in ecs_split.tf; the new
# internal listener rules below just add another path to reach them.
# =============================================================================


# -----------------------------------------------------------------------------
# Internal ALB security group — locked down to ECS tasks only.
# -----------------------------------------------------------------------------

resource "aws_security_group" "alb_internal" {
  count       = var.remove_frontend_sidecar ? 1 : 0
  name        = "${var.project_name}-alb-internal-sg"
  description = "Private-ALB SG allowing only ECS tasks inbound"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.project_name}-alb-internal-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_internal_from_ecs" {
  count                        = var.remove_frontend_sidecar ? 1 : 0
  security_group_id            = aws_security_group.alb_internal[0].id
  description                  = "HTTP from ECS tasks (frontend to backend)"
  from_port                    = 8001
  to_port                      = 8001
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.ecs.id
}

resource "aws_vpc_security_group_egress_rule" "alb_internal_egress" {
  count             = var.remove_frontend_sidecar ? 1 : 0
  security_group_id = aws_security_group.alb_internal[0].id
  description       = "Allow all outbound (to backend target ENIs)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}


# -----------------------------------------------------------------------------
# The internal ALB itself.
#
# Key setting: `internal = true` — this is the bit that makes the auto-
# generated DNS resolve to private IPs from within the VPC.  Subnets are the
# PRIVATE subnets (matches where the ECS tasks live), so the ALB's ENIs have
# only private IPs.
# -----------------------------------------------------------------------------

resource "aws_lb" "internal_backend" {
  count              = var.remove_frontend_sidecar ? 1 : 0
  name               = "${var.project_name}-int-alb"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_internal[0].id]
  subnets            = aws_subnet.private[*].id

  # Longer idle timeout than the 60 s default so SSE streams survive quiet
  # periods between chunks — matches the public ALB's setting.
  idle_timeout = 3600

  tags = { Name = "${var.project_name}-internal-alb" }
}


# -----------------------------------------------------------------------------
# Target groups DEDICATED to the internal ALB.
#
# AWS restriction: IP-type target groups (which ECS/Fargate requires via
# awsvpc networking) can be associated with AT MOST ONE ALB.  That rules out
# the "share the existing api-tg/sse-tg/ws-tg between public and internal
# ALBs" approach — it fails with `TargetGroupAssociationLimit`.  So we
# create a parallel set here: int-api-tg, int-sse-tg, int-ws-tg.  The ECS
# services register with both sets via separate `load_balancer` blocks
# (see the `dynamic "load_balancer"` blocks in ecs_split.tf).
#
# The config below mirrors the public TGs' health_check + deregistration
# delays exactly — same container on the other end, same operational
# characteristics.
# -----------------------------------------------------------------------------

resource "aws_lb_target_group" "api_internal" {
  count       = var.remove_frontend_sidecar ? 1 : 0
  name        = "${var.project_name}-int-api-tg"
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

  # Short drain — api requests are short; 60 s is plenty to finish them.
  deregistration_delay = 60

  tags = { Name = "${var.project_name}-int-api-tg" }
}

resource "aws_lb_target_group" "sse_internal" {
  count       = var.remove_frontend_sidecar ? 1 : 0
  name        = "${var.project_name}-int-sse-tg"
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

  # SSE streams can be long — give them 120 s to drain on deploy.
  deregistration_delay = 120

  tags = { Name = "${var.project_name}-int-sse-tg" }
}

# NOTE: no ws_internal TG.  The internal ALB has no listener rule for
# /api/electron/ws (Next.js never proxies WebSockets to the backend), so a
# ws_internal TG would be orphaned.  ECS rejects `RegisterTargets` against an
# orphan TG with `The target group ... does not have an associated load
# balancer`, and the apply fails.  If we ever internalise WebSocket routing,
# add (a) a ws_internal TG here, (b) a listener rule forwarding
# /api/electron/ws to it on the internal ALB, and (c) a matching
# `load_balancer` block in aws_ecs_service.ws — in that order.


# -----------------------------------------------------------------------------
# Listener on :8001 HTTP.  Internal ALB doesn't need TLS — traffic never
# leaves the VPC, and the Fargate-to-ALB hop is within AWS's private
# network.  Port 8001 matches the public ALB's port for internal cognitive
# consistency.
#
# Default forwards to the internal api-tg (the catch-all for anything that
# doesn't match a specific path rule).  Note the length() guard: when the
# internal TGs don't exist (flag false) the expression still type-checks
# by falling back to the sidecar TG, which is a dead branch in practice.
# -----------------------------------------------------------------------------

resource "aws_lb_listener" "internal_backend" {
  count             = var.remove_frontend_sidecar ? 1 : 0
  load_balancer_arn = aws_lb.internal_backend[0].arn
  port              = 8001
  protocol          = "HTTP"

  default_action {
    type = "forward"
    target_group_arn = (
      length(aws_lb_target_group.api_internal) > 0
      ? aws_lb_target_group.api_internal[0].arn
      : aws_lb_target_group.backend.arn
    )
  }

  tags = { Name = "${var.project_name}-internal-listener" }
}


# -----------------------------------------------------------------------------
# ECS SG ingress: allow the internal ALB's SG to reach backend :8001 on the
# task ENIs.  Without this, the ALB would deliver to the TG but the target
# ENI would reject the packet.
# -----------------------------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "ecs_from_internal_alb" {
  count                        = var.remove_frontend_sidecar ? 1 : 0
  security_group_id            = aws_security_group.ecs.id
  description                  = "Backend port from internal ALB"
  from_port                    = 8001
  to_port                      = 8001
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb_internal[0].id
}


# -----------------------------------------------------------------------------
# Outputs (only emitted when flag is on)
# -----------------------------------------------------------------------------

output "internal_alb_dns" {
  description = "Internal ALB DNS name — resolves to private IPs from within the VPC. Used as PYTHON_BACKEND_URL when remove_frontend_sidecar=true."
  value       = var.remove_frontend_sidecar ? aws_lb.internal_backend[0].dns_name : null
}
