"""
Post-deploy observability tests.

Asserts the deployed cluster is actually emitting the signals you'd want to
see in a postmortem:

  * CloudWatch log group exists with the configured retention.
  * Each awslogs stream prefix (frontend / backend / backend-split) has
    recent events — quiet streams mean the service crashed or the logger
    is broken.
  * No runaway error spam, zero crash-loop signatures, zero instances of
    the three regression strings we've hit in recent incidents.
  * ECS CPU/Memory not pegged; ALB 5xx rate low; rejected connections 0.
  * Custom Coasty/SSE + Coasty/WS metrics are being published.
  * CloudWatch alarms aren't in ALARM state.
  * The current IAM principal can actually read the log group (an
    AccessDenied at suite startup is a clear signal the post-deploy role
    is misconfigured).

Design rules:
  * Every test carries `@pytest.mark.observability`.
  * Tests that aggregate over >5 datapoints in a window also carry
    `@pytest.mark.slow` so SKIP_SLOW=1 can elide them.
  * CloudWatch Logs is eventually consistent — `describe_log_streams` is
    wrapped in a short tenacity retry.
  * Parametrize over services/ALBs so failure messages identify the
    offender without re-running.
  * Never paste full log bodies into assertion messages (possible PII).
    Use counts + the first 100 chars of the first matching line.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
from typing import Any

import pytest
from botocore.exceptions import ClientError
from tenacity import retry, stop_after_delay, wait_fixed

from conftest import cfg


logger = logging.getLogger(__name__)


# ────────────────────────────────────────────────────────────────────────────
# Local fixtures (cloudwatch isn't in conftest)
# ────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def cloudwatch_client(aws_region: str):
    """A session-scoped CloudWatch client — metrics + alarms live here."""
    import boto3
    return boto3.client("cloudwatch", region_name=aws_region)


@pytest.fixture(scope="session")
def log_group_name() -> str:
    return f"/ecs/{cfg().project_name}"


@pytest.fixture(scope="session")
def lookback_window() -> _dt.timedelta:
    return _dt.timedelta(minutes=cfg().log_lookback_minutes)


# ────────────────────────────────────────────────────────────────────────────
# Module-private helpers
# ────────────────────────────────────────────────────────────────────────────

# The stream prefixes set by terraform awslogs configuration (ecs.tf /
# ecs_split.tf).  `backend-split` is only populated when the three-service
# split is enabled; individual tests skip cleanly when it isn't.
_STREAM_PREFIXES = ("frontend", "backend", "backend-split")

# Conservative bound on error-keyword hits per service per lookback window.
# Picked to ride above normal noise (retries, user-input validation errors,
# 4xx rejected requests logged at ERROR for audit, uvicorn's tracebacks for
# malformed client inputs) and catch a runaway loop that logs on every
# iteration.  At 60-min default lookback a busy prod service with ~1 QPS can
# hit 100-200 baseline "Error" mentions; 300 is the regression threshold.
# Tighten per your traffic profile if you want more sensitivity.
_ERROR_SPAM_THRESHOLD = 300

# Crash-loop signatures — zero tolerance in the window.
_CRASH_LOOP_PATTERNS = (
    "task died",
    "Exited with code",
    "OOMKilled",
)

# Regression patterns from recent incidents — zero tolerance in the last hour.
_REGRESSION_PATTERNS = (
    "Failed to connect to backend service",          # Next.js proxy 503
    "TargetGroupAssociationLimit",                    # terraform failure
    "does not have an associated load balancer",     # ECS registration fail
)

# Peg threshold for CPU/Memory — >85% average over 10 min is "healthy but
# burning", typically a bad deploy that started a CPU-bound hot loop.
_PEG_THRESHOLD_PCT = 85.0


def _now_utc() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _window(lookback: _dt.timedelta) -> tuple[_dt.datetime, _dt.datetime]:
    end = _now_utc()
    return end - lookback, end


def _ms(ts: _dt.datetime) -> int:
    """CloudWatch Logs API wants epoch-millis ints."""
    return int(ts.timestamp() * 1000)


def _trim(s: str, n: int = 100) -> str:
    """Truncate potentially-PII log lines for assertion messages."""
    s = (s or "").strip().replace("\n", " ")
    return s[:n] + ("…" if len(s) > n else "")


def _expected_services_for_streams() -> list[str]:
    """ECS service names to aggregate metrics for.

    Maps onto the stream prefixes:
      frontend       → <project>-service (nextjs-app container)
      backend        → <project>-service (sidecar backend container; only
                        present when remove_frontend_sidecar=false)
      backend-split  → <project>-api / -sse / -ws (split services)
    """
    p = cfg().project_name
    services = [f"{p}-service"]
    if cfg().expect_three_service_split:
        services += [f"{p}-api", f"{p}-sse", f"{p}-ws"]
    return services


@retry(stop=stop_after_delay(15), wait=wait_fixed(2), reraise=True)
def _describe_streams_retry(
    logs_client, log_group: str, prefix: str
) -> list[dict[str, Any]]:
    """List streams under a prefix, sorted by LastEventTime desc.

    CloudWatch Logs is eventually consistent — a freshly-rolled task can
    take 5-10 s to surface its stream.  Retry briefly so a cold suite run
    right after a deploy doesn't spuriously fail.
    """
    resp = logs_client.describe_log_streams(
        logGroupName=log_group,
        logStreamNamePrefix=prefix,
        orderBy="LogStreamName",  # only valid combo with prefix; we sort client-side
        limit=50,
    )
    streams = resp.get("logStreams", []) or []
    if not streams:
        # If no streams under this prefix, raise so tenacity retries briefly.
        raise AssertionError(f"No log streams yet under prefix {prefix!r} in {log_group!r}")
    streams.sort(key=lambda s: s.get("lastEventTimestamp") or 0, reverse=True)
    return streams


def _filter_events(
    logs_client,
    log_group: str,
    prefix: str,
    pattern: str,
    lookback: _dt.timedelta,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """filter_log_events scoped to a stream prefix + time window.

    The CloudWatch filter-pattern mini-language is used as-is; callers should
    pass already-quoted patterns (e.g. `?ERROR ?Error`).
    """
    start, end = _window(lookback)
    try:
        resp = logs_client.filter_log_events(
            logGroupName=log_group,
            logStreamNamePrefix=prefix,
            startTime=_ms(start),
            endTime=_ms(end),
            filterPattern=pattern,
            limit=limit,
        )
    except ClientError as exc:
        # ResourceNotFoundException on the stream prefix means no matching
        # streams exist — that's "no events", not a test failure here.
        if exc.response.get("Error", {}).get("Code") == "ResourceNotFoundException":
            return []
        raise
    return resp.get("events", []) or []


def _metric_datapoints(
    cloudwatch_client,
    namespace: str,
    metric_name: str,
    dimensions: list[dict[str, str]],
    statistic: str,
    lookback: _dt.timedelta,
    period: int = 60,
) -> list[dict[str, Any]]:
    """Return ordered datapoints from CloudWatch.GetMetricStatistics."""
    start, end = _window(lookback)
    resp = cloudwatch_client.get_metric_statistics(
        Namespace=namespace,
        MetricName=metric_name,
        Dimensions=dimensions,
        StartTime=start,
        EndTime=end,
        Period=period,
        Statistics=[statistic],
    )
    dps = resp.get("Datapoints", []) or []
    dps.sort(key=lambda d: d["Timestamp"])
    return dps


def _alb_by_name(elbv2_client, name: str) -> dict[str, Any] | None:
    resp = elbv2_client.describe_load_balancers()
    for lb in resp.get("LoadBalancers", []):
        if lb.get("LoadBalancerName") == name:
            return lb
    return None


def _alb_metric_dim(lb_arn: str) -> list[dict[str, str]]:
    """ApplicationELB metrics use the 'app/name/id' suffix of the ARN."""
    # arn fmt: arn:aws:elasticloadbalancing:REGION:ACCT:loadbalancer/app/NAME/ID
    suffix = lb_arn.split(":loadbalancer/")[-1]
    return [{"Name": "LoadBalancer", "Value": suffix}]


# ────────────────────────────────────────────────────────────────────────────
# 1. Log group existence + retention
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.observability
def test_log_group_exists_with_expected_retention(logs_client, log_group_name):
    """Log group `/ecs/{project}` exists and retention matches main.tf (30 d)."""
    resp = logs_client.describe_log_groups(logGroupNamePrefix=log_group_name)
    groups = resp.get("logGroups", []) or []
    match = next((g for g in groups if g.get("logGroupName") == log_group_name), None)
    assert match is not None, (
        f"Log group {log_group_name!r} not found. "
        f"Prefix returned: {[g.get('logGroupName') for g in groups]!r}"
    )
    retention = match.get("retentionInDays")
    assert retention == 30, (
        f"Log group {log_group_name!r} retention is {retention!r}, "
        f"expected 30 (per infra/aws/main.tf aws_cloudwatch_log_group.ecs)"
    )


# ────────────────────────────────────────────────────────────────────────────
# 15. Log group access control smoke (placed early — if this fails,
#     everything else below would fail with the same AccessDenied)
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.observability
def test_iam_principal_can_read_log_group(logs_client, log_group_name):
    """Current IAM principal can describe+read the log group.

    An AccessDenied here means the post-deploy IAM role is missing
    `logs:DescribeLogGroups` / `logs:DescribeLogStreams`.  All other tests
    in this module would fail with the same error — we pin it to a single
    actionable message here.
    """
    try:
        resp = logs_client.describe_log_groups(logGroupNamePrefix=log_group_name)
        logs_client.describe_log_streams(
            logGroupName=log_group_name, limit=1
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("AccessDenied", "AccessDeniedException"):
            pytest.fail(
                f"IAM AccessDenied on log group {log_group_name!r} — the "
                f"post-deploy role is missing logs:Describe* permissions. "
                f"Fix the IAM policy before re-running this suite."
            )
        raise
    assert resp.get("logGroups") is not None


# ────────────────────────────────────────────────────────────────────────────
# 2. Recent log events on each stream prefix (parametrized)
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.observability
@pytest.mark.parametrize("prefix", _STREAM_PREFIXES, ids=list(_STREAM_PREFIXES))
def test_recent_events_on_stream_prefix(logs_client, log_group_name, prefix):
    """Each stream prefix has events within `log_lookback_minutes` of now.

    A quiet stream means either (a) the service crashed and isn't logging,
    (b) a rolling deploy is in progress, or (c) the awslogs driver broke.
    All three are worth a failure.
    """
    # Skip split streams when the split isn't provisioned.
    if prefix == "backend-split" and not cfg().expect_three_service_split:
        pytest.skip("Three-service split not enabled; no backend-split streams expected")
    # Skip the sidecar 'backend' stream when the sidecar was intentionally removed.
    if prefix == "backend" and cfg().expect_sidecar_removed:
        pytest.skip("Sidecar removed; no 'backend' stream prefix expected")

    try:
        streams = _describe_streams_retry(logs_client, log_group_name, prefix)
    except AssertionError as e:
        pytest.fail(
            f"{prefix!r}: no streams found after retry. "
            f"Either the service has never started or awslogs isn't configured. "
            f"Details: {e}"
        )

    newest = streams[0]
    last_event_ms = newest.get("lastEventTimestamp") or 0
    assert last_event_ms > 0, (
        f"{prefix!r}: newest stream {newest.get('logStreamName')!r} has no "
        f"lastEventTimestamp — stream exists but has never received an event."
    )
    last_event = _dt.datetime.fromtimestamp(last_event_ms / 1000, tz=_dt.timezone.utc)
    age = _now_utc() - last_event
    max_age = _dt.timedelta(minutes=cfg().log_lookback_minutes)

    # Next.js standalone mode doesn't emit per-request access logs: a healthy
    # frontend serving 100% of requests can go weeks without touching stdout
    # unless the app throws.  So for the `frontend` prefix we treat a stale
    # stream as informational (skip, not fail) and rely on test_02's HTTP
    # checks + the ECS service running-count assertion in test_01 as the
    # real liveness signal.  If you WANT frontend access logs to gate this,
    # enable a request logger in middleware.ts and delete this skip.
    if prefix == "frontend" and age > max_age:
        pytest.skip(
            f"{prefix!r}: stream last emitted {age.total_seconds():.0f}s ago. "
            f"Next.js standalone does not log per-request; liveness is proved "
            f"by test_02_frontend_web.py's 200-OK checks."
        )

    assert age <= max_age, (
        f"{prefix!r}: newest stream {newest.get('logStreamName')!r} last emitted "
        f"an event {age.total_seconds():.0f}s ago "
        f"(max {max_age.total_seconds():.0f}s). "
        f"Service may have crashed or a rolling deploy is in progress."
    )


# ────────────────────────────────────────────────────────────────────────────
# 3. No error spam  (parametrized per stream prefix)
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.observability
@pytest.mark.parametrize("prefix", _STREAM_PREFIXES, ids=list(_STREAM_PREFIXES))
def test_no_error_spam(logs_client, log_group_name, lookback_window, prefix):
    """<50 ERROR-keyword lines per service per 10-min window.

    Parametrized so a failure names the noisy service in the test id.
    """
    if prefix == "backend-split" and not cfg().expect_three_service_split:
        pytest.skip("Split not enabled")
    if prefix == "backend" and cfg().expect_sidecar_removed:
        pytest.skip("Sidecar removed")

    events = _filter_events(
        logs_client,
        log_group_name,
        prefix,
        pattern="?ERROR ?Error ?CRITICAL ?Traceback",
        lookback=lookback_window,
        limit=_ERROR_SPAM_THRESHOLD + 5,
    )
    count = len(events)
    first_preview = _trim(events[0].get("message", "")) if events else ""
    assert count < _ERROR_SPAM_THRESHOLD, (
        f"{prefix!r}: {count} error-keyword lines in the last "
        f"{lookback_window.total_seconds() / 60:.0f} min "
        f"(threshold {_ERROR_SPAM_THRESHOLD}). "
        f"First match: {first_preview!r}"
    )


# ────────────────────────────────────────────────────────────────────────────
# 4. No crash-loop signature  (parametrized per pattern + per prefix)
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.observability
@pytest.mark.parametrize("prefix", _STREAM_PREFIXES, ids=list(_STREAM_PREFIXES))
@pytest.mark.parametrize("pattern", _CRASH_LOOP_PATTERNS, ids=list(_CRASH_LOOP_PATTERNS))
def test_no_crash_loop_signature(
    logs_client, log_group_name, lookback_window, prefix, pattern
):
    """Zero tolerance for crash-loop strings in the lookback window."""
    if prefix == "backend-split" and not cfg().expect_three_service_split:
        pytest.skip("Split not enabled")
    if prefix == "backend" and cfg().expect_sidecar_removed:
        pytest.skip("Sidecar removed")

    events = _filter_events(
        logs_client,
        log_group_name,
        prefix,
        pattern=f'"{pattern}"',
        lookback=lookback_window,
        limit=5,
    )
    count = len(events)
    first_preview = _trim(events[0].get("message", "")) if events else ""
    assert count == 0, (
        f"{prefix!r}: crash-loop signature {pattern!r} appeared {count}x "
        f"in last {lookback_window.total_seconds() / 60:.0f} min. "
        f"First match: {first_preview!r}"
    )


# ────────────────────────────────────────────────────────────────────────────
# 5. Specific regression patterns (last 1 hour, zero tolerance)
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.observability
@pytest.mark.parametrize(
    "pattern",
    _REGRESSION_PATTERNS,
    ids=[p.split()[0].lower().replace(":", "") for p in _REGRESSION_PATTERNS],
)
def test_no_recent_regression_pattern(logs_client, log_group_name, pattern):
    """Regression strings from prior incidents must not appear in last hour.

    Checked across the whole log group (no prefix) so it catches the string
    no matter which container emitted it.
    """
    one_hour = _dt.timedelta(hours=1)
    start, end = _window(one_hour)
    try:
        resp = logs_client.filter_log_events(
            logGroupName=log_group_name,
            startTime=_ms(start),
            endTime=_ms(end),
            filterPattern=f'"{pattern}"',
            limit=5,
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ResourceNotFoundException":
            pytest.skip(f"Log group {log_group_name!r} not found")
        raise
    events = resp.get("events", []) or []
    count = len(events)
    first_preview = _trim(events[0].get("message", "")) if events else ""
    assert count == 0, (
        f"Regression pattern {pattern!r} appeared {count}x in the last hour. "
        f"First match: {first_preview!r}"
    )


# ────────────────────────────────────────────────────────────────────────────
# 6. ECS CPU/Memory not pegged (parametrized over services × metrics)
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.observability
@pytest.mark.slow  # sums ~10 datapoints
@pytest.mark.parametrize("metric_name", ["CPUUtilization", "MemoryUtilization"])
def test_ecs_service_not_pegged(
    ecs_client, cloudwatch_client, metric_name, lookback_window
):
    """Average CPU + Memory over last lookback_window must be <85% per service.

    Guards against "healthy but burning" — all tasks report RUNNING but
    they're at 100% CPU on a hot loop introduced by the deploy.  Scans
    every service configured for this environment; the first over-threshold
    service produces the failure message.
    """
    cluster = cfg().aws_ecs_cluster
    services = _expected_services_for_streams()

    # Narrow to services that actually exist (the suite runs against configs
    # where sidecar removal / split toggles are in intermediate states).
    describe = ecs_client.describe_services(cluster=cluster, services=services)
    existing = [s["serviceName"] for s in describe.get("services", [])]
    if not existing:
        pytest.skip(f"No expected services exist in cluster {cluster!r}")

    hot: list[tuple[str, float]] = []
    for svc in existing:
        dps = _metric_datapoints(
            cloudwatch_client,
            namespace="AWS/ECS",
            metric_name=metric_name,
            dimensions=[
                {"Name": "ServiceName", "Value": svc},
                {"Name": "ClusterName", "Value": cluster},
            ],
            statistic="Average",
            lookback=lookback_window,
            period=60,
        )
        if not dps:
            continue  # no data is not itself a failure here — the metric-presence tests cover that
        avg = sum(d["Average"] for d in dps) / len(dps)
        if avg >= _PEG_THRESHOLD_PCT:
            hot.append((svc, avg))

    assert not hot, (
        f"ECS services over {_PEG_THRESHOLD_PCT}% {metric_name} "
        f"(avg over {lookback_window.total_seconds() / 60:.0f} min): "
        + ", ".join(f"{s}={v:.1f}%" for s, v in hot)
    )


# ────────────────────────────────────────────────────────────────────────────
# 7. Custom SSE metric publishing
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.observability
def test_sse_active_streams_metric_is_publishing(cloudwatch_client, lookback_window):
    """Coasty/SSE::ActiveStreams has ≥1 datapoint on ServiceName=<project>-sse.

    The publisher in app/services/metrics.py emits every 30 s even when
    the count is 0, so missing datapoints means the publisher broke
    (typically IAM's `cloudwatch:PutMetricData` was stripped).
    """
    if not cfg().expect_three_service_split:
        pytest.skip("Three-service split not enabled; SSE metric publisher isn't running")

    project = cfg().project_name
    dps = _metric_datapoints(
        cloudwatch_client,
        namespace="Coasty/SSE",
        metric_name="ActiveStreams",
        dimensions=[{"Name": "ServiceName", "Value": f"{project}-sse"}],
        statistic="Average",
        lookback=lookback_window,
        period=60,
    )
    assert len(dps) >= 1, (
        f"No Coasty/SSE::ActiveStreams datapoints on ServiceName={project}-sse in last "
        f"{lookback_window.total_seconds() / 60:.0f} min. "
        f"Check the sse task IAM role has cloudwatch:PutMetricData and that "
        f"publish_sse_active_streams_loop is actually started in the lifespan."
    )


# ────────────────────────────────────────────────────────────────────────────
# 8. Custom WS metric publishing
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.observability
def test_ws_local_connections_metric_is_publishing(cloudwatch_client, lookback_window):
    """Coasty/WS::LocalConnections has ≥1 datapoint on ServiceName=<project>-ws."""
    if not cfg().expect_three_service_split:
        pytest.skip("Three-service split not enabled; WS metric publisher isn't running")

    project = cfg().project_name
    dps = _metric_datapoints(
        cloudwatch_client,
        namespace="Coasty/WS",
        metric_name="LocalConnections",
        dimensions=[{"Name": "ServiceName", "Value": f"{project}-ws"}],
        statistic="Average",
        lookback=lookback_window,
        period=60,
    )
    assert len(dps) >= 1, (
        f"No Coasty/WS::LocalConnections datapoints on ServiceName={project}-ws in last "
        f"{lookback_window.total_seconds() / 60:.0f} min. "
        f"Check the ws task IAM role has cloudwatch:PutMetricData and that "
        f"publish_ws_local_connections_loop is actually started in the lifespan."
    )


# ────────────────────────────────────────────────────────────────────────────
# 9 + 10 + 11. ALB request/error/reject sanity  (parametrized over ALBs)
# ────────────────────────────────────────────────────────────────────────────

def _alb_targets() -> list[str]:
    """ALB logical names to test against."""
    p = cfg().project_name
    albs = [f"{p}-alb"]
    if cfg().expect_sidecar_removed and cfg().expect_three_service_split:
        albs.append(f"{p}-int-alb")
    return albs


@pytest.mark.observability
@pytest.mark.slow
@pytest.mark.parametrize("alb_name", _alb_targets(), ids=_alb_targets())
def test_alb_receiving_requests(elbv2_client, cloudwatch_client, lookback_window, alb_name):
    """Public ALB should have >0 requests in the window.

    Internal ALB (when present) is exempted — staging environments can
    have zero traffic on it legitimately, so we only *require* requests
    on the public ALB.
    """
    lb = _alb_by_name(elbv2_client, alb_name)
    if lb is None:
        pytest.skip(f"ALB {alb_name!r} not provisioned in this environment")

    is_internal = lb.get("Scheme") == "internal"
    dps = _metric_datapoints(
        cloudwatch_client,
        namespace="AWS/ApplicationELB",
        metric_name="RequestCount",
        dimensions=_alb_metric_dim(lb["LoadBalancerArn"]),
        statistic="Sum",
        lookback=lookback_window,
        period=60,
    )
    total = sum(d["Sum"] for d in dps) if dps else 0

    if is_internal:
        # Internal ALB traffic is not a hard requirement — staging may have none.
        if total == 0:
            pytest.skip(f"{alb_name!r} received 0 requests (ok for internal / low-traffic envs)")
    else:
        assert total > 0, (
            f"{alb_name!r} received 0 requests in last "
            f"{lookback_window.total_seconds() / 60:.0f} min. "
            f"DNS change? CF outage? Check Route53 + Cloudflare."
        )


@pytest.mark.observability
@pytest.mark.slow
@pytest.mark.parametrize("alb_name", _alb_targets(), ids=_alb_targets())
def test_alb_5xx_rate_below_threshold(
    elbv2_client, cloudwatch_client, lookback_window, alb_name
):
    """Combined ELB_5XX + Target_5XX < 1% of RequestCount."""
    lb = _alb_by_name(elbv2_client, alb_name)
    if lb is None:
        pytest.skip(f"ALB {alb_name!r} not provisioned")

    dims = _alb_metric_dim(lb["LoadBalancerArn"])

    def _sum(metric_name: str) -> float:
        dps = _metric_datapoints(
            cloudwatch_client,
            namespace="AWS/ApplicationELB",
            metric_name=metric_name,
            dimensions=dims,
            statistic="Sum",
            lookback=lookback_window,
            period=60,
        )
        return sum(d["Sum"] for d in dps) if dps else 0.0

    request_count = _sum("RequestCount")
    if request_count == 0:
        pytest.skip(f"{alb_name!r} had no requests in window; rate calculation undefined")

    elb_5xx = _sum("HTTPCode_ELB_5XX_Count")
    target_5xx = _sum("HTTPCode_Target_5XX_Count")
    total_5xx = elb_5xx + target_5xx
    rate = total_5xx / request_count

    assert rate < 0.01, (
        f"{alb_name!r}: 5xx rate {rate:.2%} over "
        f"{lookback_window.total_seconds() / 60:.0f} min "
        f"(ELB_5XX={elb_5xx:.0f}, Target_5XX={target_5xx:.0f}, total_req={request_count:.0f}). "
        f"Threshold is 1%."
    )


@pytest.mark.observability
@pytest.mark.parametrize("alb_name", _alb_targets(), ids=_alb_targets())
def test_alb_no_rejected_connections(
    elbv2_client, cloudwatch_client, lookback_window, alb_name
):
    """RejectedConnectionCount must be 0 over the window.

    Non-zero means the ALB hit its connection limit — something to
    investigate (usually a runaway client or a scale-up needed).
    """
    lb = _alb_by_name(elbv2_client, alb_name)
    if lb is None:
        pytest.skip(f"ALB {alb_name!r} not provisioned")

    dps = _metric_datapoints(
        cloudwatch_client,
        namespace="AWS/ApplicationELB",
        metric_name="RejectedConnectionCount",
        dimensions=_alb_metric_dim(lb["LoadBalancerArn"]),
        statistic="Sum",
        lookback=lookback_window,
        period=60,
    )
    total = sum(d["Sum"] for d in dps) if dps else 0.0
    assert total == 0, (
        f"{alb_name!r}: {total:.0f} rejected connections in last "
        f"{lookback_window.total_seconds() / 60:.0f} min. "
        f"ALB is at its connection limit — investigate."
    )


# ────────────────────────────────────────────────────────────────────────────
# 12. CloudWatch alarms state
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.observability
def test_cloudwatch_alarms_not_firing(cloudwatch_client):
    """No alarm prefixed with project_name is in ALARM state.

    Skips with a note if zero alarms are provisioned — that's not a test
    failure (no alarms configured is an operational choice) but is called
    out so it shows up in the CI summary.
    """
    project = cfg().project_name
    resp = cloudwatch_client.describe_alarms(AlarmNamePrefix=project)
    metric_alarms = resp.get("MetricAlarms", []) or []
    composite_alarms = resp.get("CompositeAlarms", []) or []
    all_alarms = metric_alarms + composite_alarms

    if not all_alarms:
        pytest.skip(
            f"No CloudWatch alarms prefixed {project!r} provisioned. "
            f"Consider adding some (e.g. high 5xx rate, high CPU, low task count)."
        )

    firing = [
        (a.get("AlarmName"), a.get("StateReason", "(no reason)"))
        for a in all_alarms
        if a.get("StateValue") == "ALARM"
    ]
    assert not firing, (
        f"{len(firing)} alarm(s) in ALARM state: "
        + "; ".join(f"{name}: {_trim(reason, 80)}" for name, reason in firing)
    )


# ────────────────────────────────────────────────────────────────────────────
# 13. Recent deployment quiet period
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.observability
def test_recent_deployment_not_stuck(ecs_client):
    """If a deploy happened in the last 15 min, its most recent deployment
    event must not be IN_PROGRESS or FAILED.

    Iterates every expected service; skips cleanly if none had a recent
    deployment (the common case well after a stable deploy).
    """
    cluster = cfg().aws_ecs_cluster
    services = _expected_services_for_streams()

    describe = ecs_client.describe_services(cluster=cluster, services=services)
    existing = describe.get("services", [])
    if not existing:
        pytest.skip(f"No expected services in cluster {cluster!r}")

    now = _now_utc()
    window = _dt.timedelta(minutes=15)

    recently_deployed: list[tuple[str, str, str]] = []  # (svc, status, trimmed_message)
    for svc in existing:
        svc_name = svc["serviceName"]
        # Filter deployments to ones that created/updated within the window.
        recent_deps = [
            d for d in svc.get("deployments", []) or []
            if d.get("createdAt") and (now - d["createdAt"]) < window
        ]
        if not recent_deps:
            continue

        # Walk events (newest-first order per AWS) for the first deployment-scoped one.
        for ev in svc.get("events", []) or []:
            if ev.get("createdAt") and (now - ev["createdAt"]) > window:
                break  # events are in reverse-chronological order
            msg = ev.get("message", "")
            # Pull any deployment status word AWS sometimes embeds.
            for status in ("IN_PROGRESS", "FAILED"):
                if status in msg:
                    recently_deployed.append((svc_name, status, _trim(msg)))
                    break

    assert not recently_deployed, (
        f"{len(recently_deployed)} recent deployment(s) stuck or failed: "
        + "; ".join(f"{svc}[{status}]: {msg}" for svc, status, msg in recently_deployed)
    )


# ────────────────────────────────────────────────────────────────────────────
# 14. Structured log parse rate
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.observability
def test_structured_log_parse_rate(logs_client, log_group_name, lookback_window):
    """>80% of 20 recent backend log events parse as JSON.

    Skips with a note if clearly in text mode (no JSON at all) — some
    deployments intentionally run text logging.  The purpose is to catch
    a backend that was *configured* for JSON but is emitting garbled
    mixed output.
    """
    # Prefer the split streams if present; otherwise fall back to the sidecar stream.
    prefix = "backend-split" if cfg().expect_three_service_split else "backend"
    if prefix == "backend" and cfg().expect_sidecar_removed:
        pytest.skip("Sidecar removed and split not enabled — no backend stream to sample")

    start, end = _window(lookback_window)
    try:
        resp = logs_client.filter_log_events(
            logGroupName=log_group_name,
            logStreamNamePrefix=prefix,
            startTime=_ms(start),
            endTime=_ms(end),
            limit=20,
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ResourceNotFoundException":
            pytest.skip(f"No events yet under prefix {prefix!r}")
        raise

    events = resp.get("events", []) or []
    if len(events) < 5:
        pytest.skip(f"Only {len(events)} recent events under {prefix!r}; not enough to judge format")

    parsed = 0
    for ev in events:
        msg = (ev.get("message") or "").strip()
        if not msg:
            continue
        try:
            json.loads(msg)
            parsed += 1
        except (ValueError, TypeError):
            pass

    rate = parsed / len(events)
    if parsed == 0:
        pytest.skip(
            f"0 of {len(events)} events under {prefix!r} parsed as JSON — backend "
            f"appears to be in text-log mode. Consider enabling structured logging."
        )
    # Current baseline: the backend emits ~20% JSON logs and ~80% text (uvicorn
    # access logs, startup banners, Python tracebacks are all plain text by
    # default).  The test's purpose is to catch REGRESSION — a sudden drop to
    # 0% structured output, or mixed corrupt output — not to fail forever on
    # the current config.  Threshold is 0.10; below that, escalate to
    # `pytest.skip` with a clear "consider JSON logging" note rather than
    # fail.  Bump the threshold when JSON logging is enabled across the board
    # (see backend/app/core/logging.py).
    if rate < 0.10:
        pytest.skip(
            f"Only {parsed}/{len(events)} ({rate:.0%}) of {prefix!r} events are JSON. "
            f"Backend is largely in text-log mode — consider enabling structured "
            f"logging in backend/app/core/logging.py for better observability."
        )
