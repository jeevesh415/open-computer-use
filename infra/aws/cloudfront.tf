# =============================================================================
# CloudFront + S3 (foundational, opt-in via var.cloudfront_enabled)
# =============================================================================
# Removes 60–80 % of ALB load by pushing the long-tail of `/_next/static/*`
# requests to S3 served via CloudFront edge cache, while routing dynamic /api/*
# and HTML through to the ALB.
#
# ROLL-OUT (manual, do NOT do this on the first apply):
#   1. terraform apply with cloudfront_enabled=true to create S3, OAC,
#      distribution, and policies.  Distribution provisioning takes 15–30 min.
#   2. Add a CI step that uploads `.next/static/*` to s3://${static_bucket} on
#      every build.  The Next.js standalone output writes these to
#      `/.next/static/` — `aws s3 sync` is sufficient.
#   3. Set `assetPrefix` in next.config.js to your CloudFront domain so that
#      asset URLs resolve through the CDN.
#   4. Point your customer DNS at the CloudFront distribution (CNAME or A
#      alias).  Until then the ALB DNS still works.
#
# COST: CloudFront is pay-per-use; expect $0.085/GB for North America/Europe
# transfers and $0.0075/10k HTTP requests.  Net win vs ALB even at modest
# volume (ALB charges per LCU which dominates above ~10 RPS sustained).
# =============================================================================

variable "cloudfront_enabled" {
  description = "If true, provision the S3 static-asset bucket + CloudFront distribution. Requires an ACM cert in us-east-1 for HTTPS."
  type        = bool
  default     = false
}

variable "cloudfront_certificate_arn" {
  description = "ACM certificate ARN in us-east-1 (CloudFront restriction). Leave empty to use the default *.cloudfront.net cert."
  type        = string
  default     = ""
}

variable "cloudfront_alternate_domains" {
  description = "Custom domains served by the distribution (e.g. ['app.coasty.ai']). Requires cloudfront_certificate_arn to cover them."
  type        = list(string)
  default     = []
}


# -----------------------------------------------------------------------------
# S3 bucket — Next.js immutable static chunks (`/_next/static/*`)
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "static" {
  count         = var.cloudfront_enabled ? 1 : 0
  bucket        = "${var.project_name}-static-${data.aws_caller_identity.current[0].account_id}"
  force_destroy = false

  tags = { Name = "${var.project_name}-static" }
}

# Lookup account ID only when we need it (CloudFront-disabled deployments
# shouldn't pay for the data source call).
data "aws_caller_identity" "current" {
  count = var.cloudfront_enabled ? 1 : 0
}

resource "aws_s3_bucket_public_access_block" "static" {
  count                   = var.cloudfront_enabled ? 1 : 0
  bucket                  = aws_s3_bucket.static[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "static" {
  count  = var.cloudfront_enabled ? 1 : 0
  bucket = aws_s3_bucket.static[0].id

  versioning_configuration {
    # Versioning lets a botched deploy roll back without redeploying the app.
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "static" {
  count  = var.cloudfront_enabled ? 1 : 0
  bucket = aws_s3_bucket.static[0].id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}


# -----------------------------------------------------------------------------
# CloudFront — OAC (Origin Access Control), distribution, S3 bucket policy
# -----------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "s3" {
  count                             = var.cloudfront_enabled ? 1 : 0
  name                              = "${var.project_name}-s3-oac"
  description                       = "OAC for the static asset bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "static_oac" {
  count  = var.cloudfront_enabled ? 1 : 0
  bucket = aws_s3_bucket.static[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontReadOnly"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = ["s3:GetObject"]
      Resource  = "${aws_s3_bucket.static[0].arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.main[0].arn
        }
      }
    }]
  })
}

resource "aws_cloudfront_distribution" "main" {
  count               = var.cloudfront_enabled ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project_name} CDN (static via S3, dynamic via ALB)"
  default_root_object = ""
  price_class         = "PriceClass_100" # US/Europe edges. Use PriceClass_All for global.
  aliases             = var.cloudfront_alternate_domains

  # ---- Origins -----------------------------------------------------------
  origin {
    origin_id                = "alb-dynamic"
    domain_name              = aws_lb.main.dns_name
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = var.certificate_arn != "" ? "https-only" : "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60   # ALB long-poll + SSE keepalive headroom
      origin_keepalive_timeout = 60
    }
  }

  origin {
    origin_id                = "s3-static"
    domain_name              = aws_s3_bucket.static[0].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3[0].id
    s3_origin_config {
      # Required by Terraform schema even when using OAC; OAI is ignored.
      origin_access_identity = ""
    }
  }

  # ---- Default behaviour: forward to ALB, no caching --------------------
  default_cache_behavior {
    target_origin_id       = "alb-dynamic"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS managed: forwards all headers, cookies, query strings; no cache.
    # Identifier from
    # https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"  # CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3"  # AllViewer
  }

  # ---- Static chunks: serve from S3 with maximum cache lifetime ---------
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "s3-static"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6"  # CachingOptimized — TTL 1d/1y
  }

  # ---- /api/* and /_next/image: explicit no-cache passthrough -----------
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "alb-dynamic"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"  # CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3"  # AllViewer
  }

  ordered_cache_behavior {
    path_pattern           = "/_next/image*"
    target_origin_id       = "alb-dynamic"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # Light caching of optimized images is safe; Next.js bakes a content hash
    # into the URL, so cached entries stay valid as long as the source does.
    cache_policy_id          = "658327ea-f89d-4fab-a63d-7e88639e58f6"  # CachingOptimized
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"  # AllViewerExceptHostHeader
  }

  # ---- Viewer cert -------------------------------------------------------
  viewer_certificate {
    cloudfront_default_certificate = var.cloudfront_certificate_arn == ""
    acm_certificate_arn            = var.cloudfront_certificate_arn != "" ? var.cloudfront_certificate_arn : null
    ssl_support_method             = var.cloudfront_certificate_arn != "" ? "sni-only" : null
    minimum_protocol_version       = var.cloudfront_certificate_arn != "" ? "TLSv1.2_2021" : "TLSv1"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = { Name = "${var.project_name}-cdn" }
}

output "cloudfront_distribution_domain" {
  description = "CloudFront distribution domain (point your DNS here once the distribution is Deployed)."
  value       = var.cloudfront_enabled ? aws_cloudfront_distribution.main[0].domain_name : null
}

output "static_assets_bucket" {
  description = "S3 bucket for /_next/static/* — sync .next/static/ here in CI."
  value       = var.cloudfront_enabled ? aws_s3_bucket.static[0].bucket : null
}
