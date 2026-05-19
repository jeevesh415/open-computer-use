"""
Post-deploy infrastructure health tests.

This module exercises the AWS state that the Terraform in infra/aws/ should
have produced and asserts it matches the intent encoded in the `.tf` files.
Every test carries the `@pytest.mark.infra` marker so CI can isolate infra-
only failures from HTTP/behavioural tests.

Design rules for this file:
  * Helpers are module-private (`_foo`) at the top.  Tests use them for
    lookups; tests never call boto3 paginators directly if a helper exists.
  * Every assertion carries a diagnostic message so a CI log line is enough
    to locate the offending resource without re-running anything locally.
  * Eventually-consistent checks (recently-applied Terraform changes can lag
    a few seconds for rolloutState to flip to COMPLETED) are wrapped in
    tenacity retries with stop_after_delay(30).
  * Flag-gated tests skip cleanly via `pytest.skip(...)` when the
    corresponding cfg() flag is false — this matches how the conftest
    advertises expected toggles in its banner.
"""
from __future__ import annotations

import datetime as _dt
from functools import lru_cache
from typing import Any, Iterable

import pytest
from tenacity import retry, stop_after_delay, wait_fixed

from conftest import cfg, first_healthy_target  # noqa: F401  (re-exported)


# ────────────────────────────────────────────────────────────────────────────
# Private helpers
# ────────────────────────────────────────────────────────────────────────────

# One-hour window — matches the "recent events" lookback in test category #2.
_EVENT_LOOKBACK = _dt.timedelta(hours=1)

# Phrases in ECS service events that indicate a real deployment failure.
# We match case-insensitively.  Each entry is intentionally narrow so we
# don't flag normal churn events.
_ECS_FAILURE_SUBSTRINGS = (
    "unable to place tasks",
    "deployment failed",
    "cannotpullcontainererror",
)


def _describe_service(ecs_client, cluster: str, service: str) -> dict[str, Any]:
    """Return the single-service dict from describe_services, or raise."""
    resp = ecs_client.describe_services(cluster=cluster, services=[service])
    failures = resp.get("failures", [])
    if failures:
        raise AssertionError(
            f"ECS describe_services failed for service={service!r} in "
            f"cluster={cluster!r}: {failures}"
        )
    services = resp.get("services", [])
    if not services:
        raise AssertionError(
            f"ECS service {service!r} not found in cluster {cluster!r}."
        )
    return services[0]


@lru_cache(maxsize=None)
def _list_all_target_groups(elbv2_client) -> tuple[dict[str, Any], ...]:
    """Return every target group in the region (cached, session-scope)."""
    out: list[dict[str, Any]] = []
    paginator = elbv2_client.get_paginator("describe_target_groups")
    for page in paginator.paginate():
        out.extend(page.get("TargetGroups", []))
    return tuple(out)


def _get_target_group(elbv2_client, name: str) -> dict[str, Any] | None:
    for tg in _list_all_target_groups(elbv2_client):
        if tg.get("TargetGroupName") == name:
            return tg
    return None


def _load_balancer_by_dns_prefix(elbv2_client, name: str) -> dict[str, Any] | None:
    """Look up an ALB by its Name (Terraform sets `name = "${project}-alb"`)."""
    resp = elbv2_client.describe_load_balancers()
    for lb in resp.get("LoadBalancers", []):
        if lb.get("LoadBalancerName") == name:
            return lb
    return None


def _list_listeners(elbv2_client, lb_arn: str) -> list[dict[str, Any]]:
    resp = elbv2_client.describe_listeners(LoadBalancerArn=lb_arn)
    return resp.get("Listeners", [])


def _list_rules(elbv2_client, listener_arn: str) -> list[dict[str, Any]]:
    resp = elbv2_client.describe_rules(ListenerArn=listener_arn)
    return resp.get("Rules", [])


def _path_patterns(rule: dict[str, Any]) -> list[str]:
    """Return the (possibly empty) list of path-pattern values on a rule."""
    for cond in rule.get("Conditions", []):
        if cond.get("Field") == "path-pattern":
            pp = cond.get("PathPatternConfig")
            if pp and pp.get("Values"):
                return list(pp["Values"])
            # Older rules stored patterns directly on `Values`
            if cond.get("Values"):
                return list(cond["Values"])
    return []


def _forward_target_group_arns(rule: dict[str, Any]) -> list[str]:
    """Return ALL target group ARNs a rule forwards to (weighted or not)."""
    arns: list[str] = []
    for action in rule.get("Actions", []):
        if action.get("Type") != "forward":
            continue
        if action.get("TargetGroupArn"):
            arns.append(action["TargetGroupArn"])
        fwd = action.get("ForwardConfig") or {}
        for tg in fwd.get("TargetGroups", []) or []:
            if tg.get("TargetGroupArn"):
                arns.append(tg["TargetGroupArn"])
    return arns


def _tg_name_from_arn(elbv2_client, arn: str) -> str:
    """Resolve a TG ARN to its Name by looking it up in the cached list."""
    for tg in _list_all_target_groups(elbv2_client):
        if tg.get("TargetGroupArn") == arn:
            return tg.get("TargetGroupName", arn)
    # Fall back to a describe — slower path but keeps the test informative
    resp = elbv2_client.describe_target_groups(TargetGroupArns=[arn])
    for tg in resp.get("TargetGroups", []):
        return tg.get("TargetGroupName", arn)
    return arn


def _public_alb(elbv2_client) -> dict[str, Any]:
    name = f"{cfg().project_name}-alb"
    lb = _load_balancer_by_dns_prefix(elbv2_client, name)
    assert lb is not None, f"Public ALB {name!r} not found in region {cfg().aws_region!r}"
    return lb


def _internal_alb(elbv2_client) -> dict[str, Any] | None:
    name = f"{cfg().project_name}-int-alb"
    return _load_balancer_by_dns_prefix(elbv2_client, name)


def _listener_on_port(elbv2_client, lb_arn: str, port: int) -> dict[str, Any] | None:
    for listener in _list_listeners(elbv2_client, lb_arn):
        if listener.get("Port") == port:
            return listener
    return None


@lru_cache(maxsize=1)
def _production_vpc_id(elbv2_client_id: int) -> str:
    """
    The VPC the production workload actually lives in.
    Production environments drift: it's common to find orphan SGs named
    identically to live ones from a previous deployment or a staging stack
    that shared the account.  We resolve the "real" VPC by looking at the
    public ALB — wherever it lives is the production VPC — and scope every
    SG lookup to that VPC.
    Cache is keyed on the client's id() so pytest-xdist workers don't collide.
    """
    # elbv2_client_id is only for cache keying — we rebuild the client here.
    import boto3
    elbv2 = boto3.client("elbv2", region_name=cfg().aws_region)
    lbs = elbv2.describe_load_balancers(Names=[f"{cfg().project_name}-alb"])
    return lbs["LoadBalancers"][0]["VpcId"]


def _sg_by_name(ec2_client, name: str) -> dict[str, Any] | None:
    """
    Look up a SG by name, scoped to the production VPC.
    Without the VPC filter this silently returns an orphan SG from an
    unrelated VPC in the same account when names collide — that's how the
    first draft of this test ended up asserting against a sg-id that no
    resource actually references.
    """
    import boto3
    elbv2 = boto3.client("elbv2", region_name=cfg().aws_region)
    vpc_id = _production_vpc_id(id(elbv2))
    resp = ec2_client.describe_security_groups(
        Filters=[
            {"Name": "group-name", "Values": [name]},
            {"Name": "vpc-id", "Values": [vpc_id]},
        ]
    )
    groups = resp.get("SecurityGroups", [])
    return groups[0] if groups else None


def _ingress_rules(sg: dict[str, Any]) -> list[dict[str, Any]]:
    return sg.get("IpPermissions", []) or []


def _has_broad_cidr(perm: dict[str, Any]) -> bool:
    for r in perm.get("IpRanges", []):
        if r.get("CidrIp") == "0.0.0.0/0":
            return True
    for r in perm.get("Ipv6Ranges", []):
        if r.get("CidrIpv6") == "::/0":
            return True
    return False


def _refs_sg(perm: dict[str, Any], sg_id: str) -> bool:
    for p in perm.get("UserIdGroupPairs", []):
        if p.get("GroupId") == sg_id:
            return True
    return False


def _find_ingress_on_port(
    sg: dict[str, Any], port: int
) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for perm in _ingress_rules(sg):
        if perm.get("IpProtocol") not in ("tcp", "-1"):
            continue
        fp, tp = perm.get("FromPort"), perm.get("ToPort")
        if fp is None or tp is None:
            # all-ports rule (IpProtocol == "-1") is handled separately; skip
            continue
        if fp <= port <= tp:
            matches.append(perm)
    return matches


# ────────────────────────────────────────────────────────────────────────────
# 1. ECS services exist, active, fully deployed
# ────────────────────────────────────────────────────────────────────────────


def _service_filter(services: list[str]) -> list[str]:
    """Drop split services when the split flag is off."""
    if cfg().expect_three_service_split:
        return services
    return [s for s in services if s.endswith("-service")]


@pytest.mark.infra
def test_ecs_cluster_exists(ecs_client):
    cluster_name = cfg().aws_ecs_cluster
    resp = ecs_client.describe_clusters(clusters=[cluster_name])
    clusters = resp.get("clusters", [])
    assert clusters, f"ECS cluster {cluster_name!r} not found in region {cfg().aws_region!r}"
    status = clusters[0].get("status")
    assert status == "ACTIVE", (
        f"ECS cluster {cluster_name!r} status={status!r}, expected ACTIVE. "
        f"ARN={clusters[0].get('clusterArn')!r}"
    )


@pytest.mark.infra
def test_expected_services_exist(ecs_client, expected_services):
    names = _service_filter(expected_services)
    resp = ecs_client.describe_services(
        cluster=cfg().aws_ecs_cluster, services=names
    )
    found = {s["serviceName"] for s in resp.get("services", [])}
    missing = set(names) - found
    assert not missing, (
        f"Expected ECS services are missing from cluster "
        f"{cfg().aws_ecs_cluster!r}: {sorted(missing)}. "
        f"Found: {sorted(found)}. "
        f"describe_services failures: {resp.get('failures', [])}"
    )


@pytest.mark.infra
@pytest.mark.parametrize(
    "svc_suffix",
    ["service", "api", "sse", "ws"],
)
def test_service_active_and_stable(ecs_client, svc_suffix):
    project = cfg().project_name
    svc_name = f"{project}-{svc_suffix}"

    if svc_suffix != "service" and not cfg().expect_three_service_split:
        pytest.skip(
            f"EXPECT_THREE_SERVICE_SPLIT=0 — skipping stability check for split "
            f"service {svc_name!r}"
        )

    @retry(stop=stop_after_delay(30), wait=wait_fixed(2), reraise=True)
    def _check():
        svc = _describe_service(ecs_client, cfg().aws_ecs_cluster, svc_name)
        status = svc.get("status")
        running = svc.get("runningCount", -1)
        desired = svc.get("desiredCount", -1)
        arn = svc.get("serviceArn", "<no-arn>")
        assert status == "ACTIVE", (
            f"Service {svc_name!r} status={status!r}, expected ACTIVE. ARN={arn}"
        )
        assert desired >= 1, (
            f"Service {svc_name!r} desiredCount={desired} (<1). "
            f"ARN={arn}"
        )
        assert running == desired, (
            f"Service {svc_name!r} runningCount={running} != desiredCount={desired}. "
            f"ARN={arn}"
        )

    _check()


@pytest.mark.infra
@pytest.mark.parametrize(
    "svc_suffix",
    ["service", "api", "sse", "ws"],
)
def test_service_deployments_completed(ecs_client, svc_suffix):
    project = cfg().project_name
    svc_name = f"{project}-{svc_suffix}"

    if svc_suffix != "service" and not cfg().expect_three_service_split:
        pytest.skip(
            f"EXPECT_THREE_SERVICE_SPLIT=0 — skipping deployment check for "
            f"split service {svc_name!r}"
        )

    @retry(stop=stop_after_delay(30), wait=wait_fixed(2), reraise=True)
    def _check():
        svc = _describe_service(ecs_client, cfg().aws_ecs_cluster, svc_name)
        deployments = svc.get("deployments", [])
        arn = svc.get("serviceArn", "<no-arn>")
        assert deployments, (
            f"Service {svc_name!r} has no deployments listed. ARN={arn}"
        )
        for d in deployments:
            state = d.get("rolloutState")
            d_id = d.get("id", "<no-id>")
            assert state == "COMPLETED", (
                f"Service {svc_name!r} deployment {d_id!r} rolloutState={state!r}, "
                f"expected COMPLETED. rolloutStateReason="
                f"{d.get('rolloutStateReason')!r}. ARN={arn}"
            )
            failed = d.get("failedTasks", 0)
            assert failed == 0, (
                f"Service {svc_name!r} deployment {d_id!r} has failedTasks={failed}. "
                f"ARN={arn}"
            )

    _check()


# ────────────────────────────────────────────────────────────────────────────
# 2. ECS recent task failures in events[]
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.infra
@pytest.mark.parametrize(
    "svc_suffix",
    ["service", "api", "sse", "ws"],
)
def test_no_recent_deployment_failure_events(ecs_client, svc_suffix):
    project = cfg().project_name
    svc_name = f"{project}-{svc_suffix}"

    if svc_suffix != "service" and not cfg().expect_three_service_split:
        pytest.skip(
            f"EXPECT_THREE_SERVICE_SPLIT=0 — skipping event check for "
            f"split service {svc_name!r}"
        )

    svc = _describe_service(ecs_client, cfg().aws_ecs_cluster, svc_name)
    events = svc.get("events", [])[:20]
    cutoff = _dt.datetime.now(_dt.timezone.utc) - _EVENT_LOOKBACK
    offenders: list[str] = []
    for e in events:
        created = e.get("createdAt")
        if created is None:
            continue
        if created.tzinfo is None:
            created = created.replace(tzinfo=_dt.timezone.utc)
        if created < cutoff:
            continue
        msg = (e.get("message") or "").lower()
        for needle in _ECS_FAILURE_SUBSTRINGS:
            if needle in msg:
                offenders.append(
                    f"[{created.isoformat()}] {e.get('message')!r}"
                )
                break

    assert not offenders, (
        f"Service {svc_name!r} has {len(offenders)} failure-class events in the "
        f"last hour: {offenders}. ARN={svc.get('serviceArn')!r}"
    )


# ────────────────────────────────────────────────────────────────────────────
# 3. Target groups — existence, port, healthy target counts
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.infra
def test_expected_target_groups_exist(elbv2_client, expected_target_groups):
    missing: list[str] = []
    for name in expected_target_groups:
        if _get_target_group(elbv2_client, name) is None:
            missing.append(name)
    assert not missing, (
        f"Expected target groups missing in region {cfg().aws_region!r}: "
        f"{missing}. All TGs: "
        f"{sorted(t['TargetGroupName'] for t in _list_all_target_groups(elbv2_client))}"
    )


@pytest.mark.infra
def test_target_group_ports(elbv2_client, expected_target_groups):
    bad: list[str] = []
    for name, port in expected_target_groups.items():
        tg = _get_target_group(elbv2_client, name)
        if tg is None:
            continue  # covered by the existence test
        if tg.get("Port") != port:
            bad.append(
                f"{name} (arn={tg.get('TargetGroupArn')}): got port="
                f"{tg.get('Port')}, expected {port}"
            )
    assert not bad, f"Target group port mismatches: {bad}"


@pytest.mark.infra
def test_target_groups_are_ip_type(elbv2_client, expected_target_groups):
    """Fargate awsvpc networking requires target_type=ip on every TG we create."""
    bad: list[str] = []
    for name in expected_target_groups:
        tg = _get_target_group(elbv2_client, name)
        if tg is None:
            continue
        if tg.get("TargetType") != "ip":
            bad.append(
                f"{name} (arn={tg.get('TargetGroupArn')}): TargetType="
                f"{tg.get('TargetType')!r}, expected 'ip'"
            )
    assert not bad, f"Target groups with wrong target_type: {bad}"


@pytest.mark.infra
@pytest.mark.parametrize(
    "name_suffix",
    ["tg", "api-tg", "sse-tg", "ws-tg"],
)
def test_target_group_has_registered_targets(elbv2_client, name_suffix):
    if name_suffix in ("api-tg", "sse-tg", "ws-tg") and not cfg().expect_three_service_split:
        pytest.skip(
            f"EXPECT_THREE_SERVICE_SPLIT=0 — split TG {name_suffix} not expected"
        )
    tg_name = f"{cfg().project_name}-{name_suffix}"
    tg = _get_target_group(elbv2_client, tg_name)
    assert tg is not None, f"Target group {tg_name!r} missing — earlier test should have caught this"
    arn = tg["TargetGroupArn"]
    health = elbv2_client.describe_target_health(TargetGroupArn=arn)
    descs = health.get("TargetHealthDescriptions", [])
    assert descs, (
        f"Target group {tg_name!r} (arn={arn}) has NO registered targets. "
        f"ECS service did not register, or deployment is still rolling out."
    )


@pytest.mark.infra
@pytest.mark.parametrize(
    "name_suffix",
    ["tg", "api-tg", "sse-tg", "ws-tg"],
)
def test_target_group_has_healthy_targets(elbv2_client, name_suffix):
    if name_suffix in ("api-tg", "sse-tg", "ws-tg") and not cfg().expect_three_service_split:
        pytest.skip(
            f"EXPECT_THREE_SERVICE_SPLIT=0 — split TG {name_suffix} not expected"
        )
    tg_name = f"{cfg().project_name}-{name_suffix}"
    tg = _get_target_group(elbv2_client, tg_name)
    assert tg is not None, f"Target group {tg_name!r} missing"
    arn = tg["TargetGroupArn"]
    health = elbv2_client.describe_target_health(TargetGroupArn=arn)
    descs = health.get("TargetHealthDescriptions", [])
    healthy = [d for d in descs if d["TargetHealth"]["State"] == "healthy"]
    assert healthy, (
        f"Target group {tg_name!r} (arn={arn}) has no healthy targets. "
        f"Raw states: {[(d['Target'].get('Id'), d['TargetHealth']['State'], d['TargetHealth'].get('Reason'), d['TargetHealth'].get('Description')) for d in descs]}"
    )


@pytest.mark.infra
def test_internal_target_groups_registered_and_healthy(elbv2_client):
    if not cfg().expect_sidecar_removed:
        pytest.skip("EXPECT_SIDECAR_REMOVED=0 — internal ALB TGs not expected")
    for suffix in ("int-api-tg", "int-sse-tg"):
        name = f"{cfg().project_name}-{suffix}"
        tg = _get_target_group(elbv2_client, name)
        assert tg is not None, f"Internal target group {name!r} missing"
        arn = tg["TargetGroupArn"]
        descs = elbv2_client.describe_target_health(TargetGroupArn=arn).get(
            "TargetHealthDescriptions", []
        )
        assert descs, f"Internal TG {name!r} (arn={arn}) has no registered targets"
        healthy = [d for d in descs if d["TargetHealth"]["State"] == "healthy"]
        assert healthy, (
            f"Internal TG {name!r} (arn={arn}) has no healthy targets. "
            f"Raw: {[(d['Target'].get('Id'), d['TargetHealth']['State']) for d in descs]}"
        )


@pytest.mark.infra
def test_legacy_backend_tg_emptiness_when_sidecar_removed(elbv2_client):
    """When the sidecar is removed the legacy backend-tg is allowed to be empty."""
    tg_name = f"{cfg().project_name}-backend-tg"
    tg = _get_target_group(elbv2_client, tg_name)
    assert tg is not None, (
        f"Legacy backend TG {tg_name!r} still expected to exist as a TG (even "
        f"when sidecar removed) — Terraform does not destroy it. Missing."
    )
    arn = tg["TargetGroupArn"]
    descs = elbv2_client.describe_target_health(TargetGroupArn=arn).get(
        "TargetHealthDescriptions", []
    )
    if not cfg().expect_sidecar_removed:
        # Legacy path: sidecar is still deployed, backend-tg MUST have healthy targets
        healthy = [d for d in descs if d["TargetHealth"]["State"] == "healthy"]
        assert healthy, (
            f"EXPECT_SIDECAR_REMOVED=0 — legacy backend TG {tg_name!r} "
            f"(arn={arn}) has no healthy sidecar targets. "
            f"Raw: {[(d['Target'].get('Id'), d['TargetHealth']['State']) for d in descs]}"
        )
    # With sidecar removed, any state (including empty) is acceptable — no assert


# ────────────────────────────────────────────────────────────────────────────
# 4. Regression guard — no wildcard /api/electron/* rule on :443
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.infra
def test_no_wildcard_electron_rule_on_https(elbv2_client):
    """
    Regression for the sign-in outage: a rule with path pattern
    `/api/electron/*` on the :443 listener swallows ALL electron sub-paths
    (proxy, machines, ws) and routes them at once.  Only the exact
    `/api/electron/ws` rule is allowed.
    """
    if not cfg().expect_https_443:
        pytest.skip("EXPECT_HTTPS_443_LISTENER=0 — no HTTPS listener to scan")
    lb = _public_alb(elbv2_client)
    listener = _listener_on_port(elbv2_client, lb["LoadBalancerArn"], 443)
    assert listener, (
        f"HTTPS :443 listener missing on public ALB "
        f"{lb.get('LoadBalancerArn')!r}"
    )
    rules = _list_rules(elbv2_client, listener["ListenerArn"])
    offenders: list[str] = []
    for r in rules:
        for pat in _path_patterns(r):
            if pat == "/api/electron/*":
                offenders.append(
                    f"rule arn={r.get('RuleArn')} priority={r.get('Priority')} "
                    f"pattern={pat!r}"
                )
    assert not offenders, (
        f"Found forbidden wildcard `/api/electron/*` rule(s) on HTTPS :443 "
        f"listener — this is the sign-in outage bug; only the exact "
        f"/api/electron/ws rule is permitted: {offenders}"
    )


# ────────────────────────────────────────────────────────────────────────────
# 5. :443 listener rules — default → frontend, exact /api/electron/ws → ws-tg
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.infra
def test_https_443_has_electron_ws_exact_rule(elbv2_client):
    if not cfg().expect_https_443:
        pytest.skip("EXPECT_HTTPS_443_LISTENER=0 — HTTPS listener not expected")
    if not cfg().expect_three_service_split:
        pytest.skip(
            "EXPECT_THREE_SERVICE_SPLIT=0 — /api/electron/ws on :443 only "
            "exists with the split"
        )

    lb = _public_alb(elbv2_client)
    listener = _listener_on_port(elbv2_client, lb["LoadBalancerArn"], 443)
    assert listener, f"HTTPS :443 listener missing on ALB {lb.get('LoadBalancerArn')!r}"

    rules = _list_rules(elbv2_client, listener["ListenerArn"])
    match: dict[str, Any] | None = None
    for r in rules:
        if r.get("Priority") == "10" and _path_patterns(r) == ["/api/electron/ws"]:
            match = r
            break
    assert match is not None, (
        f"HTTPS :443 listener missing priority=10 rule with exact path "
        f"`/api/electron/ws`. Present rules: "
        f"{[(r.get('Priority'), _path_patterns(r)) for r in rules]}. "
        f"Listener arn={listener.get('ListenerArn')!r}"
    )
    targets = _forward_target_group_arns(match)
    assert targets, f"Electron WS rule forwards to no target group; rule={match}"
    names = [_tg_name_from_arn(elbv2_client, a) for a in targets]
    expected = f"{cfg().project_name}-ws-tg"
    assert expected in names, (
        f"Electron WS rule (priority 10) on :443 should forward to {expected!r}, "
        f"forwards to {names} instead. Rule ARN={match.get('RuleArn')!r}"
    )


@pytest.mark.infra
def test_https_443_default_action_is_frontend(elbv2_client):
    if not cfg().expect_https_443:
        pytest.skip("EXPECT_HTTPS_443_LISTENER=0")

    lb = _public_alb(elbv2_client)
    listener = _listener_on_port(elbv2_client, lb["LoadBalancerArn"], 443)
    assert listener, f"HTTPS :443 listener missing on ALB {lb.get('LoadBalancerArn')!r}"

    default_actions = listener.get("DefaultActions") or []
    tgs: list[str] = []
    for a in default_actions:
        if a.get("Type") == "forward":
            if a.get("TargetGroupArn"):
                tgs.append(a["TargetGroupArn"])
            fwd = a.get("ForwardConfig") or {}
            for t in fwd.get("TargetGroups", []) or []:
                if t.get("TargetGroupArn"):
                    tgs.append(t["TargetGroupArn"])
    assert tgs, f"HTTPS :443 listener has no forward default action. Listener={listener}"
    names = [_tg_name_from_arn(elbv2_client, a) for a in tgs]
    expected = f"{cfg().project_name}-tg"
    assert expected in names, (
        f"HTTPS :443 default action should forward to frontend TG {expected!r}, "
        f"forwards to {names} instead. Listener arn={listener.get('ListenerArn')!r}"
    )


@pytest.mark.infra
def test_https_443_no_rule_forwards_to_legacy_backend(elbv2_client):
    """Guardrail: on :443 no rule should forward to legacy `{project}-backend-tg`."""
    if not cfg().expect_https_443:
        pytest.skip("EXPECT_HTTPS_443_LISTENER=0")

    lb = _public_alb(elbv2_client)
    listener = _listener_on_port(elbv2_client, lb["LoadBalancerArn"], 443)
    assert listener is not None, "HTTPS listener missing"
    rules = _list_rules(elbv2_client, listener["ListenerArn"])
    legacy = f"{cfg().project_name}-backend-tg"
    offenders: list[str] = []
    for r in rules:
        names = [_tg_name_from_arn(elbv2_client, a) for a in _forward_target_group_arns(r)]
        if legacy in names:
            offenders.append(
                f"priority={r.get('Priority')} arn={r.get('RuleArn')} "
                f"patterns={_path_patterns(r)} → {names}"
            )
    assert not offenders, (
        f"HTTPS :443 has rule(s) forwarding to legacy {legacy!r}: {offenders}. "
        f"That TG is reserved for the sidecar on :8001 only."
    )


# ────────────────────────────────────────────────────────────────────────────
# 6. :8001 backend listener rules — split routing
# ────────────────────────────────────────────────────────────────────────────


_SPLIT_8001_EXPECTATIONS = [
    # (priority, patterns, expected_tg_suffix)
    ("10", ["/api/electron/ws"], "ws-tg"),
    ("20", ["/api/chat", "/api/chat/*"], "sse-tg"),
    ("30", ["/api/swarm", "/api/swarm/*"], "sse-tg"),
    ("1000", ["/*"], "api-tg"),
]


@pytest.mark.infra
@pytest.mark.parametrize(
    "priority,patterns,expected_suffix",
    _SPLIT_8001_EXPECTATIONS,
    ids=lambda x: str(x) if not isinstance(x, list) else ",".join(x),
)
def test_backend_8001_listener_rule(
    elbv2_client, priority, patterns, expected_suffix
):
    if not cfg().expect_three_service_split:
        pytest.skip("EXPECT_THREE_SERVICE_SPLIT=0 — split rules not expected")

    lb = _public_alb(elbv2_client)
    listener = _listener_on_port(elbv2_client, lb["LoadBalancerArn"], 8001)
    assert listener is not None, (
        f"Public ALB :8001 listener missing on ALB {lb.get('LoadBalancerArn')!r}"
    )
    rules = _list_rules(elbv2_client, listener["ListenerArn"])
    match: dict[str, Any] | None = None
    for r in rules:
        if r.get("Priority") == priority and set(_path_patterns(r)) == set(patterns):
            match = r
            break
    assert match is not None, (
        f":8001 listener missing rule priority={priority} "
        f"patterns={patterns}. Present rules: "
        f"{[(r.get('Priority'), _path_patterns(r)) for r in rules]}. "
        f"Listener arn={listener.get('ListenerArn')!r}"
    )
    names = [_tg_name_from_arn(elbv2_client, a) for a in _forward_target_group_arns(match)]
    expected = f"{cfg().project_name}-{expected_suffix}"
    assert expected in names, (
        f":8001 priority={priority} rule (patterns={patterns}) should forward "
        f"to {expected!r}, forwards to {names}. Rule arn={match.get('RuleArn')!r}"
    )


# ────────────────────────────────────────────────────────────────────────────
# 7. Internal ALB — scheme, subnets, listener, rules
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.infra
def test_internal_alb_exists_and_internal(elbv2_client):
    if not cfg().expect_sidecar_removed:
        pytest.skip("EXPECT_SIDECAR_REMOVED=0 — internal ALB not expected")
    lb = _internal_alb(elbv2_client)
    expected_name = f"{cfg().project_name}-int-alb"
    assert lb is not None, f"Internal ALB {expected_name!r} missing"
    assert lb.get("Scheme") == "internal", (
        f"Internal ALB {lb.get('LoadBalancerArn')!r} has Scheme="
        f"{lb.get('Scheme')!r}, expected 'internal'"
    )
    azs = lb.get("AvailabilityZones", []) or []
    assert len(azs) >= 2, (
        f"Internal ALB {lb.get('LoadBalancerArn')!r} should span >=2 AZs/"
        f"subnets, has {len(azs)}: {azs}"
    )


@pytest.mark.infra
def test_internal_alb_subnets_are_private(ec2_client, elbv2_client):
    if not cfg().expect_sidecar_removed:
        pytest.skip("EXPECT_SIDECAR_REMOVED=0")
    lb = _internal_alb(elbv2_client)
    assert lb is not None, "Internal ALB missing"
    subnet_ids = [az["SubnetId"] for az in lb.get("AvailabilityZones", []) if az.get("SubnetId")]
    assert len(subnet_ids) >= 2, (
        f"Internal ALB {lb.get('LoadBalancerArn')!r} has <2 subnets: {subnet_ids}"
    )
    resp = ec2_client.describe_subnets(SubnetIds=subnet_ids)
    for sn in resp.get("Subnets", []):
        # Private subnets do NOT auto-assign public IPs.  This is the cheapest
        # and most reliable probe short of parsing route tables.
        assert sn.get("MapPublicIpOnLaunch") is False, (
            f"Subnet {sn['SubnetId']!r} attached to internal ALB has "
            f"MapPublicIpOnLaunch=True — looks public, internal ALB must "
            f"only be in private subnets. AZ={sn.get('AvailabilityZone')!r}"
        )


@pytest.mark.infra
def test_internal_alb_listener_default_is_api_internal(elbv2_client):
    if not cfg().expect_sidecar_removed:
        pytest.skip("EXPECT_SIDECAR_REMOVED=0")
    lb = _internal_alb(elbv2_client)
    assert lb is not None, "Internal ALB missing"
    listener = _listener_on_port(elbv2_client, lb["LoadBalancerArn"], 8001)
    assert listener is not None, (
        f"Internal ALB {lb.get('LoadBalancerArn')!r} has no :8001 listener"
    )
    default = listener.get("DefaultActions") or []
    arns: list[str] = []
    for a in default:
        if a.get("Type") == "forward":
            if a.get("TargetGroupArn"):
                arns.append(a["TargetGroupArn"])
            fwd = a.get("ForwardConfig") or {}
            for t in fwd.get("TargetGroups", []) or []:
                if t.get("TargetGroupArn"):
                    arns.append(t["TargetGroupArn"])
    names = [_tg_name_from_arn(elbv2_client, a) for a in arns]
    expected = f"{cfg().project_name}-int-api-tg"
    assert expected in names, (
        f"Internal ALB :8001 default should forward to {expected!r}, got "
        f"{names}. Listener arn={listener.get('ListenerArn')!r}"
    )


_INTERNAL_RULE_EXPECTATIONS = [
    ("20", ["/api/chat", "/api/chat/*"], "int-sse-tg"),
    ("30", ["/api/swarm", "/api/swarm/*"], "int-sse-tg"),
    ("1000", ["/*"], "int-api-tg"),
]


@pytest.mark.infra
@pytest.mark.parametrize(
    "priority,patterns,expected_suffix", _INTERNAL_RULE_EXPECTATIONS
)
def test_internal_alb_listener_rule(
    elbv2_client, priority, patterns, expected_suffix
):
    if not cfg().expect_sidecar_removed:
        pytest.skip("EXPECT_SIDECAR_REMOVED=0")
    lb = _internal_alb(elbv2_client)
    assert lb is not None, "Internal ALB missing"
    listener = _listener_on_port(elbv2_client, lb["LoadBalancerArn"], 8001)
    assert listener is not None, "Internal ALB :8001 listener missing"
    rules = _list_rules(elbv2_client, listener["ListenerArn"])
    match: dict[str, Any] | None = None
    for r in rules:
        if r.get("Priority") == priority and set(_path_patterns(r)) == set(patterns):
            match = r
            break
    assert match is not None, (
        f"Internal ALB :8001 missing rule priority={priority} "
        f"patterns={patterns}. Present rules: "
        f"{[(r.get('Priority'), _path_patterns(r)) for r in rules]}. "
        f"Listener arn={listener.get('ListenerArn')!r}"
    )
    names = [_tg_name_from_arn(elbv2_client, a) for a in _forward_target_group_arns(match)]
    expected = f"{cfg().project_name}-{expected_suffix}"
    assert expected in names, (
        f"Internal ALB rule priority={priority} should forward to {expected!r}, "
        f"forwards to {names}. Rule arn={match.get('RuleArn')!r}"
    )


@pytest.mark.infra
def test_internal_alb_has_no_electron_ws_rule(elbv2_client):
    """Intentional: Next.js never proxies WebSockets to the backend."""
    if not cfg().expect_sidecar_removed:
        pytest.skip("EXPECT_SIDECAR_REMOVED=0")
    lb = _internal_alb(elbv2_client)
    assert lb is not None, "Internal ALB missing"
    listener = _listener_on_port(elbv2_client, lb["LoadBalancerArn"], 8001)
    assert listener is not None
    rules = _list_rules(elbv2_client, listener["ListenerArn"])
    offenders: list[str] = []
    for r in rules:
        patterns = _path_patterns(r)
        if any("/api/electron/ws" == p or p.startswith("/api/electron") for p in patterns):
            offenders.append(
                f"priority={r.get('Priority')} patterns={patterns} "
                f"arn={r.get('RuleArn')}"
            )
    assert not offenders, (
        f"Internal ALB has electron WS rule(s) it MUST NOT have: {offenders}. "
        f"See alb_internal.tf header comment."
    )


# ────────────────────────────────────────────────────────────────────────────
# 8. No orphan int-ws-tg
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.infra
def test_no_int_ws_tg_exists(elbv2_client):
    """
    Regression guard — if this TG shows up, the previous apply that broke
    everything has returned.  Terraform must never create it.
    """
    name = f"{cfg().project_name}-int-ws-tg"
    tg = _get_target_group(elbv2_client, name)
    assert tg is None, (
        f"Orphan target group {name!r} exists (arn={tg.get('TargetGroupArn') if tg else None}). "
        f"The internal ALB has no listener rule for /api/electron/ws; this TG "
        f"would be unattached and ECS RegisterTargets would fail."
    )


# ────────────────────────────────────────────────────────────────────────────
# 9. Security groups
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.infra
def test_alb_sg_allows_80_443_8001_from_internet(ec2_client):
    name = f"{cfg().project_name}-alb-sg"
    sg = _sg_by_name(ec2_client, name)
    assert sg is not None, f"ALB SG {name!r} not found"
    for port in (80, 443, 8001):
        perms = _find_ingress_on_port(sg, port)
        has_broad = any(_has_broad_cidr(p) for p in perms)
        assert has_broad, (
            f"ALB SG {name!r} (id={sg.get('GroupId')}) missing ingress on "
            f"port {port} from 0.0.0.0/0. Present ingress rules: "
            f"{sg.get('IpPermissions')}"
        )


@pytest.mark.infra
def test_alb_sg_has_no_other_broad_ingress(ec2_client):
    """Only 80/443/8001 may be open to the internet."""
    name = f"{cfg().project_name}-alb-sg"
    sg = _sg_by_name(ec2_client, name)
    assert sg is not None, f"ALB SG {name!r} not found"
    allowed = {80, 443, 8001}
    offenders: list[str] = []
    for perm in _ingress_rules(sg):
        if not _has_broad_cidr(perm):
            continue
        fp, tp = perm.get("FromPort"), perm.get("ToPort")
        if fp is None or tp is None:
            offenders.append(
                f"protocol={perm.get('IpProtocol')!r} (all-ports) broad cidr"
            )
            continue
        # The rule must cover ONLY ports in the allowlist.
        for p in range(fp, tp + 1):
            if p not in allowed:
                offenders.append(f"port {p} open 0.0.0.0/0 (range {fp}-{tp})")
                break
    assert not offenders, (
        f"ALB SG {name!r} (id={sg.get('GroupId')}) has unexpected broad "
        f"ingress: {offenders}"
    )


@pytest.mark.infra
def test_ecs_sg_ingress_only_from_alb_sg(ec2_client):
    alb_name = f"{cfg().project_name}-alb-sg"
    ecs_name = f"{cfg().project_name}-ecs-sg"
    alb_sg = _sg_by_name(ec2_client, alb_name)
    ecs_sg = _sg_by_name(ec2_client, ecs_name)
    assert alb_sg is not None, f"ALB SG {alb_name!r} not found"
    assert ecs_sg is not None, f"ECS SG {ecs_name!r} not found"
    alb_sg_id = alb_sg["GroupId"]

    # 3000 must be referenced from ALB SG
    port_3000 = _find_ingress_on_port(ecs_sg, 3000)
    assert any(_refs_sg(p, alb_sg_id) for p in port_3000), (
        f"ECS SG {ecs_name!r} ({ecs_sg['GroupId']}) missing ingress on 3000 "
        f"from ALB SG {alb_sg_id!r}. Perms: {port_3000}"
    )

    # 8001 must be referenced from ALB SG
    port_8001 = _find_ingress_on_port(ecs_sg, 8001)
    assert any(_refs_sg(p, alb_sg_id) for p in port_8001), (
        f"ECS SG {ecs_name!r} ({ecs_sg['GroupId']}) missing ingress on 8001 "
        f"from ALB SG {alb_sg_id!r}. Perms: {port_8001}"
    )

    # No port-3000 or port-8001 rule may be broad-cidr
    for port in (3000, 8001):
        broad = [p for p in _find_ingress_on_port(ecs_sg, port) if _has_broad_cidr(p)]
        assert not broad, (
            f"ECS SG {ecs_name!r} has broad-CIDR ingress on port {port}: {broad}"
        )


@pytest.mark.infra
def test_ecs_sg_allows_8001_from_internal_alb_sg(ec2_client):
    if not cfg().expect_sidecar_removed:
        pytest.skip("EXPECT_SIDECAR_REMOVED=0 — internal ALB SG not expected")
    internal_name = f"{cfg().project_name}-alb-internal-sg"
    ecs_name = f"{cfg().project_name}-ecs-sg"
    int_sg = _sg_by_name(ec2_client, internal_name)
    ecs_sg = _sg_by_name(ec2_client, ecs_name)
    assert int_sg is not None, f"Internal ALB SG {internal_name!r} missing"
    assert ecs_sg is not None, f"ECS SG {ecs_name!r} missing"
    int_sg_id = int_sg["GroupId"]
    port_8001 = _find_ingress_on_port(ecs_sg, 8001)
    assert any(_refs_sg(p, int_sg_id) for p in port_8001), (
        f"ECS SG {ecs_name!r} missing ingress on 8001 referencing internal ALB "
        f"SG {int_sg_id!r}. Perms: {port_8001}"
    )


@pytest.mark.infra
def test_ecs_sg_egress_is_open(ec2_client):
    ecs_name = f"{cfg().project_name}-ecs-sg"
    ecs_sg = _sg_by_name(ec2_client, ecs_name)
    assert ecs_sg is not None, f"ECS SG {ecs_name!r} missing"
    egresses = ecs_sg.get("IpPermissionsEgress", []) or []
    wide = False
    for e in egresses:
        proto = e.get("IpProtocol")
        if proto == "-1" and _has_broad_cidr(e):
            wide = True
            break
    assert wide, (
        f"ECS SG {ecs_name!r} ({ecs_sg['GroupId']}) missing the 0/0 all-proto "
        f"egress rule. Egress rules: {egresses}"
    )


@pytest.mark.infra
def test_internal_alb_sg_ingress_only_from_ecs_sg(ec2_client):
    if not cfg().expect_sidecar_removed:
        pytest.skip("EXPECT_SIDECAR_REMOVED=0")
    internal_name = f"{cfg().project_name}-alb-internal-sg"
    ecs_name = f"{cfg().project_name}-ecs-sg"
    int_sg = _sg_by_name(ec2_client, internal_name)
    ecs_sg = _sg_by_name(ec2_client, ecs_name)
    assert int_sg is not None, f"Internal ALB SG {internal_name!r} missing"
    assert ecs_sg is not None, f"ECS SG {ecs_name!r} missing"
    ecs_sg_id = ecs_sg["GroupId"]

    port_8001 = _find_ingress_on_port(int_sg, 8001)
    assert port_8001, (
        f"Internal ALB SG {internal_name!r} ({int_sg['GroupId']}) has no "
        f"ingress on 8001. Perms: {int_sg.get('IpPermissions')}"
    )
    for p in port_8001:
        assert _refs_sg(p, ecs_sg_id), (
            f"Internal ALB SG {internal_name!r} has ingress on 8001 that is "
            f"NOT from ECS SG {ecs_sg_id!r}: {p}"
        )
        assert not _has_broad_cidr(p), (
            f"Internal ALB SG {internal_name!r} has broad-CIDR ingress on "
            f"8001: {p}"
        )


# ────────────────────────────────────────────────────────────────────────────
# 10. ACM certificate attached to :443 is ISSUED and not expiring soon
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.infra
def test_https_certificate_is_issued_and_not_expiring(elbv2_client, acm_client):
    if not cfg().expect_https_443:
        pytest.skip("EXPECT_HTTPS_443_LISTENER=0")
    lb = _public_alb(elbv2_client)
    listener = _listener_on_port(elbv2_client, lb["LoadBalancerArn"], 443)
    assert listener is not None, "HTTPS :443 listener missing"
    certs = listener.get("Certificates") or []
    assert certs, (
        f"HTTPS :443 listener {listener.get('ListenerArn')!r} has no certificates"
    )
    cert_arn = certs[0].get("CertificateArn")
    assert cert_arn, f"HTTPS :443 cert entry has no ARN: {certs[0]}"

    desc = acm_client.describe_certificate(CertificateArn=cert_arn).get("Certificate", {})
    status = desc.get("Status")
    assert status == "ISSUED", (
        f"Certificate {cert_arn!r} Status={status!r}, expected ISSUED. "
        f"Domain={desc.get('DomainName')!r}"
    )
    not_after = desc.get("NotAfter")
    assert not_after is not None, f"Certificate {cert_arn!r} has no NotAfter field"
    if not_after.tzinfo is None:
        not_after = not_after.replace(tzinfo=_dt.timezone.utc)
    now = _dt.datetime.now(_dt.timezone.utc)
    days_left = (not_after - now).days
    assert days_left >= 30, (
        f"Certificate {cert_arn!r} (domain={desc.get('DomainName')!r}) "
        f"expires in {days_left} days (NotAfter={not_after.isoformat()}); "
        f"renew before the 30-day threshold."
    )


# ────────────────────────────────────────────────────────────────────────────
# 11. Task definition — PYTHON_BACKEND_URL env on nextjs-app
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.infra
def test_latest_taskdef_python_backend_url(ecs_client):
    family = cfg().project_name
    desc = ecs_client.describe_task_definition(taskDefinition=family)
    td = desc.get("taskDefinition") or {}
    td_arn = td.get("taskDefinitionArn", "<no-arn>")
    containers = td.get("containerDefinitions") or []
    nextjs = next((c for c in containers if c.get("name") == "nextjs-app"), None)
    assert nextjs is not None, (
        f"Task definition {td_arn!r} has no container named 'nextjs-app'. "
        f"Containers: {[c.get('name') for c in containers]}"
    )
    env = {e["name"]: e["value"] for e in nextjs.get("environment") or []}
    value = env.get("PYTHON_BACKEND_URL")
    assert value, (
        f"nextjs-app in task def {td_arn!r} missing PYTHON_BACKEND_URL env. "
        f"Env keys: {sorted(env)}"
    )
    if cfg().expect_sidecar_removed:
        # internal-*.elb.amazonaws.com:8001 — internal ALB DNS
        assert ".elb.amazonaws.com:8001" in value and "internal-" in value, (
            f"With EXPECT_SIDECAR_REMOVED=1, PYTHON_BACKEND_URL should point to "
            f"internal ALB (internal-*.elb.amazonaws.com:8001). Got: {value!r}. "
            f"Task def arn={td_arn!r}"
        )
        assert value.startswith("http://"), (
            f"Internal ALB is HTTP only (no TLS inside the VPC); expected "
            f"http:// scheme, got: {value!r}. Task def arn={td_arn!r}"
        )
    else:
        assert value == "http://localhost:8001", (
            f"With EXPECT_SIDECAR_REMOVED=0, PYTHON_BACKEND_URL should be "
            f"'http://localhost:8001' (loopback to sidecar). Got: {value!r}. "
            f"Task def arn={td_arn!r}"
        )


@pytest.mark.infra
def test_latest_taskdef_container_count(ecs_client):
    """One container (nextjs-app only) when sidecar removed, two otherwise."""
    family = cfg().project_name
    td = ecs_client.describe_task_definition(taskDefinition=family).get(
        "taskDefinition", {}
    )
    td_arn = td.get("taskDefinitionArn", "<no-arn>")
    names = sorted(c.get("name") for c in td.get("containerDefinitions") or [])
    if cfg().expect_sidecar_removed:
        assert names == ["nextjs-app"], (
            f"With EXPECT_SIDECAR_REMOVED=1, task def {td_arn!r} should have "
            f"exactly one container 'nextjs-app'; got {names}"
        )
    else:
        assert names == sorted(["nextjs-app", "backend"]), (
            f"With EXPECT_SIDECAR_REMOVED=0, task def {td_arn!r} should have "
            f"containers ['backend', 'nextjs-app']; got {names}"
        )


# ────────────────────────────────────────────────────────────────────────────
# 12. No duplicate listener priorities (drift guard)
# ────────────────────────────────────────────────────────────────────────────


def _each_listener_arn(elbv2_client) -> Iterable[tuple[str, str, int]]:
    """Yield (lb_name, listener_arn, port) for every listener on managed ALBs."""
    for lb in elbv2_client.describe_load_balancers().get("LoadBalancers", []):
        name = lb.get("LoadBalancerName", "")
        if not name.startswith(cfg().project_name):
            continue
        for lst in _list_listeners(elbv2_client, lb["LoadBalancerArn"]):
            yield name, lst["ListenerArn"], lst.get("Port")


@pytest.mark.infra
def test_no_duplicate_listener_priorities(elbv2_client):
    """AWS enforces this, but out-of-band edits can create surprises. Catch them."""
    failures: list[str] = []
    for lb_name, listener_arn, port in _each_listener_arn(elbv2_client):
        rules = _list_rules(elbv2_client, listener_arn)
        priorities: list[str] = []
        for r in rules:
            pr = r.get("Priority")
            if pr is None or pr == "default":
                continue
            priorities.append(str(pr))
        seen: dict[str, int] = {}
        for p in priorities:
            seen[p] = seen.get(p, 0) + 1
        dupes = [p for p, c in seen.items() if c > 1]
        if dupes:
            failures.append(
                f"{lb_name}:{port} listener {listener_arn!r} duplicate "
                f"priorities: {dupes}"
            )
    assert not failures, f"Listener priority duplicates detected: {failures}"


# ────────────────────────────────────────────────────────────────────────────
# 13. ALB state active
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.infra
def test_public_alb_active(elbv2_client):
    lb = _public_alb(elbv2_client)
    state = (lb.get("State") or {}).get("Code")
    assert state == "active", (
        f"Public ALB {lb.get('LoadBalancerArn')!r} State.Code={state!r}, "
        f"expected 'active'. Reason={(lb.get('State') or {}).get('Reason')!r}"
    )


@pytest.mark.infra
def test_internal_alb_active(elbv2_client):
    if not cfg().expect_sidecar_removed:
        pytest.skip("EXPECT_SIDECAR_REMOVED=0 — no internal ALB expected")
    lb = _internal_alb(elbv2_client)
    assert lb is not None, (
        f"Internal ALB {cfg().project_name}-int-alb not found in region "
        f"{cfg().aws_region!r}"
    )
    state = (lb.get("State") or {}).get("Code")
    assert state == "active", (
        f"Internal ALB {lb.get('LoadBalancerArn')!r} State.Code={state!r}, "
        f"expected 'active'. Reason={(lb.get('State') or {}).get('Reason')!r}"
    )
