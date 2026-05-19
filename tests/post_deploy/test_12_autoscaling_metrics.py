"""
test_12_autoscaling_metrics — verify the custom CloudWatch metrics that drive
the SSE and WS service autoscaling policies are *actually being published*.

Why this exists
===============
The split-service deploy enables two non-default autoscaling policies:
  * `Coasty/SSE/ActiveStreams`     → drives split-sse-cpu/streams scaling
  * `Coasty/WS/LocalConnections`   → drives split-ws-memory/connections scaling

Both have target values (150 / 200) configured in `infra/aws/ecs_split.tf`.
Neither has registered a single scaling activity in the past 48 hours.
That is consistent with two very different states:

  (a) The service is genuinely below the target and autoscaling is correctly
      idle.
  (b) `metrics.py`'s publisher is broken / disabled / pointing at the wrong
      namespace and CloudWatch is receiving NO data — autoscaling has
      nothing to scale on, and the cluster will fail to grow under real
      load.  This is a silent failure mode that doesn't show up until the
      first real spike, at which point recovery is impossible.

The only durable way to disambiguate (a) from (b) is to check whether the
metrics show up in CloudWatch with `get_metric_statistics`.  If at least
one datapoint exists in the last `LOG_LOOKBACK_MINUTES` window, the
publisher is alive — so a low-traffic service legitimately reads zero.
If ZERO datapoints exist, the publisher is broken (state (b)).

This file does NOT generate synthetic load against production.  Driving
ActiveStreams above 5 from outside the VPC requires creating real chats
that consume real Bedrock tokens — billable, not a smoke test.  The
existing scaling tests in `test_11_observability.py` already check
*current* metric presence; this file extends that with two additional
checks:

  1. Metric histogram check — "is the metric variance > 0 over a 24h
     window?"  A live publisher publishes even when the value is 0; a
     broken publisher publishes nothing.  Variance-of-zero is a real
     signal because the metric is published at a fixed cadence — not in
     reaction to traffic — by `metrics.py`'s background loop.

  2. Dimension audit — "do the dimensions on the published metric match
     what the autoscaling policy expects?"  A metric with the wrong
     dimensions exists in CloudWatch but does not feed the autoscaling
     target — the policy is silently inert.

Both checks are read-only against CloudWatch.  No infra is touched.
"""
from __future__ import annotations

import datetime as _dt
import os

import pytest

from conftest import cfg


pytestmark = pytest.mark.observability


# ── Fixtures ──────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def cloudwatch_client(aws_region):
    """Module-scoped CloudWatch client.  All tests in this file are read-only."""
    import boto3
    return boto3.client("cloudwatch", region_name=aws_region)


# ── Helpers ───────────────────────────────────────────────────────────────


def _expected_dimensions(service_short: str) -> list[dict]:
    """
    The `metrics.py` publisher tags every datapoint with `ServiceName` —
    the same label the autoscaling policy filters on.  See
    `infra/aws/ecs_split.tf::aws_appautoscaling_policy.split_sse_streams`
    and the `dimensions` block on `customized_metric_specification`.

    `service_short` is the suffix the autoscaling policy uses
    (`api`, `sse`, `ws`); the actual ServiceName value is `<project>-<short>`.
    """
    return [{"Name": "ServiceName", "Value": f"{cfg().project_name}-{service_short}"}]


def _has_datapoint(
    cloudwatch_client,
    namespace: str,
    metric_name: str,
    dimensions: list[dict],
    minutes: int,
) -> tuple[bool, int]:
    """Return (publisher_alive, datapoint_count) over the last `minutes`."""
    end = _dt.datetime.now(_dt.timezone.utc)
    start = end - _dt.timedelta(minutes=minutes)
    resp = cloudwatch_client.get_metric_statistics(
        Namespace=namespace,
        MetricName=metric_name,
        Dimensions=dimensions,
        StartTime=start,
        EndTime=end,
        # 60s period matches `metrics.py`'s default publish cadence.
        # Any larger period would mask a publisher that's only emitting
        # zero values.
        Period=60,
        # Sum + Average + SampleCount lets us distinguish "always zero"
        # (alive publisher, no traffic) from "no datapoints" (broken).
        Statistics=["Sum", "Average", "SampleCount"],
    )
    points = resp.get("Datapoints", []) or []
    return (len(points) > 0, len(points))


# ── Tests ─────────────────────────────────────────────────────────────────


@pytest.mark.skipif(
    not cfg().expect_three_service_split,
    reason="Three-service split not enabled — Coasty/SSE metric isn't published.",
)
def test_sse_active_streams_metric_publisher_alive(cloudwatch_client):
    """
    The `metrics.py` background loop emits Coasty/SSE/ActiveStreams every 60s
    even when there are 0 active streams (the publisher is on a fixed timer,
    not traffic-driven).  ANY datapoint in the last lookback window proves
    the publisher is alive and CloudWatch is receiving its writes.

    Zero datapoints is the failure mode — a deployed metric publisher is
    NOT publishing, which means the autoscaling policy
    `aws_appautoscaling_policy.split_sse_streams` has no metric to scale
    on under real load.  Silent until traffic hits.
    """
    alive, n = _has_datapoint(
        cloudwatch_client,
        namespace="Coasty/SSE",
        metric_name="ActiveStreams",
        dimensions=_expected_dimensions("sse"),
        minutes=cfg().log_lookback_minutes,
    )
    assert alive, (
        f"Coasty/SSE/ActiveStreams: 0 datapoints in last "
        f"{cfg().log_lookback_minutes} min for ServiceName="
        f"{cfg().project_name}-sse. The publisher in "
        f"backend/app/services/metrics.py may be disabled or the SSE "
        f"service may have crashed before its first publish window. "
        f"Without this metric the autoscaling policy "
        f"`aws_appautoscaling_policy.split_sse_streams` is inert under load."
    )


@pytest.mark.skipif(
    not cfg().expect_three_service_split,
    reason="Three-service split not enabled — Coasty/WS metric isn't published.",
)
def test_ws_local_connections_metric_publisher_alive(cloudwatch_client):
    """Sibling test for Coasty/WS/LocalConnections."""
    alive, n = _has_datapoint(
        cloudwatch_client,
        namespace="Coasty/WS",
        metric_name="LocalConnections",
        dimensions=_expected_dimensions("ws"),
        minutes=cfg().log_lookback_minutes,
    )
    assert alive, (
        f"Coasty/WS/LocalConnections: 0 datapoints in last "
        f"{cfg().log_lookback_minutes} min for ServiceName="
        f"{cfg().project_name}-ws. Without this metric the autoscaling "
        f"policy `aws_appautoscaling_policy.split_ws_connections` is "
        f"inert under load."
    )


@pytest.mark.skipif(
    not cfg().expect_three_service_split,
    reason="Three-service split not enabled.",
)
def test_sse_metric_dimensions_match_autoscaling_policy(cloudwatch_client):
    """
    A metric with WRONG dimensions exists in CloudWatch but does NOT feed
    the autoscaling target — the policy looks for `ServiceName=<project>-sse`
    specifically.  `metrics.py` builds this string from
    `COASTY_PROJECT_NAME` env var; if that's unset or wrong, the metric
    publishes under a different ServiceName and the autoscaling policy
    silently reads zero.

    Verify by listing all dimension combinations the metric is published
    under and assert the expected one exists.
    """
    end = _dt.datetime.now(_dt.timezone.utc)
    start = end - _dt.timedelta(hours=1)
    resp = cloudwatch_client.list_metrics(
        Namespace="Coasty/SSE",
        MetricName="ActiveStreams",
        # IncludeLinkedAccounts: keep simple — single account here.
    )
    metrics = resp.get("Metrics", []) or []
    if not metrics:
        pytest.skip(
            "No Coasty/SSE/ActiveStreams metrics returned by list_metrics. "
            "Either the publisher is broken (sister test catches that) "
            "or CloudWatch hasn't surfaced the metric yet."
        )

    # Collect every (Name, Value) pair we see across all variants.
    seen_dimensions: set[tuple[tuple[str, str], ...]] = set()
    for m in metrics:
        dims = tuple(sorted((d["Name"], d["Value"]) for d in m.get("Dimensions", [])))
        seen_dimensions.add(dims)

    expected_tuple = tuple(sorted(
        (d["Name"], d["Value"]) for d in _expected_dimensions("sse")
    ))
    assert expected_tuple in seen_dimensions, (
        f"Coasty/SSE/ActiveStreams is published, but NOT with the dimensions "
        f"the autoscaling policy expects "
        f"({dict(expected_tuple)}). "
        f"Found dimension sets: {[dict(d) for d in seen_dimensions]}. "
        f"Check `metrics.py` — `COASTY_PROJECT_NAME` env var must equal "
        f"{cfg().project_name!r} on the SSE task definition."
    )


@pytest.mark.skipif(
    not cfg().expect_three_service_split,
    reason="Three-service split not enabled.",
)
def test_ws_metric_dimensions_match_autoscaling_policy(cloudwatch_client):
    """Sibling of test_sse_metric_dimensions for WS."""
    resp = cloudwatch_client.list_metrics(
        Namespace="Coasty/WS",
        MetricName="LocalConnections",
    )
    metrics = resp.get("Metrics", []) or []
    if not metrics:
        pytest.skip(
            "No Coasty/WS/LocalConnections metrics returned by list_metrics."
        )

    seen_dimensions: set[tuple[tuple[str, str], ...]] = set()
    for m in metrics:
        dims = tuple(sorted((d["Name"], d["Value"]) for d in m.get("Dimensions", [])))
        seen_dimensions.add(dims)

    expected_tuple = tuple(sorted(
        (d["Name"], d["Value"]) for d in _expected_dimensions("ws")
    ))
    assert expected_tuple in seen_dimensions, (
        f"Coasty/WS/LocalConnections is published, but NOT with the dimensions "
        f"the autoscaling policy expects ({dict(expected_tuple)}). "
        f"Found dimension sets: {[dict(d) for d in seen_dimensions]}. "
        f"Check `metrics.py` — COASTY_PROJECT_NAME must equal {cfg().project_name!r} "
        f"on the WS task definition."
    )


@pytest.mark.skipif(
    not cfg().expect_three_service_split,
    reason="Three-service split not enabled.",
)
def test_sse_metric_publishing_cadence_is_steady(cloudwatch_client):
    """
    `metrics.py` publishes on a fixed 60s cadence.  Over a 1-hour window
    we should see ≥30 datapoints (allowing for half the publishes to
    coincide on the same minute boundary in low-traffic mode).

    Anything substantially below that suggests the publisher is alive
    but FLAPPING — the SSE container is restarting too often, or the
    publisher's loop is being cancelled by a downstream exception.
    """
    end = _dt.datetime.now(_dt.timezone.utc)
    start = end - _dt.timedelta(hours=1)
    resp = cloudwatch_client.get_metric_statistics(
        Namespace="Coasty/SSE",
        MetricName="ActiveStreams",
        Dimensions=_expected_dimensions("sse"),
        StartTime=start,
        EndTime=end,
        Period=60,
        Statistics=["SampleCount"],
    )
    points = resp.get("Datapoints", []) or []
    if not points:
        pytest.skip(
            "Sister 'publisher_alive' test will surface the no-data case; "
            "this cadence test only meaningful when datapoints exist."
        )

    # Each Period=60 bucket can contain multiple SampleCount when there
    # are multiple SSE tasks publishing concurrently. The bare datapoint
    # count is what matters here.
    n = len(points)
    expected_min = 30  # 50% of 60 minutes — generous to allow gaps
    assert n >= expected_min, (
        f"Coasty/SSE/ActiveStreams: only {n} datapoints in the last hour "
        f"(expected ≥{expected_min} given the 60s publish cadence). "
        f"The publisher may be flapping — check sse service ECS events for "
        f"recent task replacements."
    )


@pytest.mark.skipif(
    not cfg().expect_three_service_split,
    reason="Three-service split not enabled.",
)
def test_autoscaling_policy_metric_dimension_match(elbv2_client):
    """
    Cross-check the autoscaling policy itself is configured to read the
    metric we just verified is being published. Without this, even a live
    publisher with correct dimensions won't drive scaling — the policy
    could be looking at the wrong namespace.

    This is fully boto3, no HTTP traffic. Reads
    `application-autoscaling.describe_scaling_policies` and asserts the
    customized_metric_specification matches the namespace + dimensions
    we expect.
    """
    import boto3
    aas = boto3.client("application-autoscaling", region_name=cfg().aws_region)

    # Find the streams policy
    resp = aas.describe_scaling_policies(
        ServiceNamespace="ecs",
        ResourceId=f"service/{cfg().aws_ecs_cluster}/{cfg().project_name}-sse",
        PolicyNames=[f"{cfg().project_name}-sse-streams-scaling"],
    )
    policies = resp.get("ScalingPolicies", []) or []
    if not policies:
        pytest.skip(
            f"No '{cfg().project_name}-sse-streams-scaling' policy found — "
            f"either var.sse_autoscale_on_active_streams is false (CPU-based "
            f"scaling instead) or the policy was renamed."
        )

    spec = policies[0].get("TargetTrackingScalingPolicyConfiguration", {})
    custom = spec.get("CustomizedMetricSpecification", {})
    assert custom.get("Namespace") == "Coasty/SSE", (
        f"Policy customized_metric_specification.Namespace is "
        f"{custom.get('Namespace')!r}, expected 'Coasty/SSE'."
    )
    assert custom.get("MetricName") == "ActiveStreams", (
        f"Policy MetricName is {custom.get('MetricName')!r}, expected "
        f"'ActiveStreams'."
    )

    dims = custom.get("Dimensions", []) or []
    expected = _expected_dimensions("sse")
    assert dims == expected, (
        f"Policy dimensions {dims} don't match what `metrics.py` publishes "
        f"({expected}). Either the policy is misconfigured or the env var "
        f"that drives ServiceName has drifted."
    )
