# -----------------------------------------------------------------------------
# ALB Security Group
# Allows inbound HTTP/HTTPS from the internet. Outbound to ECS tasks.
# -----------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb-sg"
  description = "Allow inbound HTTP/HTTPS traffic to the load balancer"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project_name}-alb-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from internet"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from internet"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "alb_backend_api" {
  security_group_id = aws_security_group.alb.id
  description       = "Backend API from internet (Electron app)"
  from_port         = 8001
  to_port           = 8001
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

# NOTE: removed `alb_backend_internal_http` (:8002 on the public ALB).  That
# setup didn't work — the public ALB's DNS resolves to public IPs from within
# the VPC, so fargate traffic NAT-translated before reaching the listener and
# the SG rule (from ECS SG) rejected the NAT-sourced packet.  Replaced by a
# dedicated INTERNAL ALB in alb_internal.tf (has private IPs only).
#
# The matching ecs ingress rule "backend port from internal ALB" lives in
# alb_internal.tf, colocated with the internal ALB itself for clarity.

resource "aws_vpc_security_group_egress_rule" "alb_egress" {
  security_group_id = aws_security_group.alb.id
  description       = "Allow all outbound (to ECS tasks)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# -----------------------------------------------------------------------------
# ECS Tasks Security Group
# Only allows inbound from the ALB on the frontend port (3000).
# Backend port (8001) is internal to the task via localhost — no SG rule needed.
# -----------------------------------------------------------------------------

resource "aws_security_group" "ecs" {
  name        = "${var.project_name}-ecs-sg"
  description = "Allow inbound traffic only from the ALB"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project_name}-ecs-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "ecs_from_alb" {
  security_group_id            = aws_security_group.ecs.id
  description                  = "Frontend port from ALB only"
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_ingress_rule" "ecs_backend_from_alb" {
  security_group_id            = aws_security_group.ecs.id
  description                  = "Backend API port from ALB"
  from_port                    = 8001
  to_port                      = 8001
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "ecs_egress" {
  security_group_id = aws_security_group.ecs.id
  description       = "Allow all outbound (ECR pulls, Supabase, external APIs)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
