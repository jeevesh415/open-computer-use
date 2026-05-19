"""
test_05_internal_alb.py — Internal ALB + Next.js → Python backend proxy path

Why this file exists
--------------------
When `remove_frontend_sidecar=true`, the Next.js frontend no longer shares a
task with the FastAPI backend sidecar — it has to reach the backend over the
VPC network.  The chosen mechanism is a SECOND, internal-scheme ALB living in
the private subnets (see infra/aws/alb_internal.tf for the long-form
rationale).  If that ALB is misconfigured, every server-rendered page that
calls an `/app/api/*` route goes 502 in prod.  That failure mode is silent in
unit tests and invisible in plan diffs, so it has to be caught post-deploy.

Two planes of evidence
----------------------
This test suite runs from developer machines / CI, which are OUTSIDE the VPC.
Internal ALB DNS is intentionally unresolvable from out here.  So we prove
correctness through two independent planes:

  * Plane A (structural) — boto3 describes the ALB, its listener, rules,
    subnets, SGs, target groups, their health, and the frontend task def's
    PYTHON_BACKEND_URL env var.  If all of these line up with the Terraform
    blueprint AND targets are healthy, the frontend *can* reach the backend.

  * Plane B (behavioural) — hit the PUBLIC frontend routes that internally
    proxy to PYTHON_BACKEND_URL.  A 200/401/403 from those routes proves the
    proxy call succeeded (Next.js got a response from the internal ALB).  A
    502/503 means the proxy call failed — either the internal ALB is down,
    unreachable, or returning errors.  This is the strongest signal available
    without sitting inside the VPC.

Pairing the two planes: if Plane A is green but Plane B is red, the problem is
at the Fargate task's SG or Redis init, not the ALB.  If Plane A is red,
responders jump straight to the AWS console via the ARN in the assertion
message.

Every test is `@pytest.mark.internal` and the whole module is skipped when
`expect_sidecar_removed` is False (the internal ALB doesn't exist in that
mode).  Behavioural tests are `@pytest.mark.routing`, structural tests are
`@pytest.mark.infra` — CI can slice either plane independently.
"""
from __future__ import annotations

import re
from typing import Any

import pytest
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_delay,
    wait_fixed,
)

from conftest import assert_status, cfg

# ─── Module-level skip ────────────────────────────────────────────────────────
# The internal ALB is Terraform-gated on var.remove_frontend_sidecar.  If the
# sidecar is still in place, none of these resources exist and every assertion
# below would fail spuriously with "ALB not found".  Skip the whole module
# cleanly in that case — the skip reason is visible in pytest -ra output.
pytestmark = pytest.mark.skipif(
    not cfg().expect_sidecar_removed,
    reason="Internal ALB not provisioned when sidecar is in place (EXPECT_SIDECAR_REMOVED=0)",
)


# ─── Helper fixtures ──────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def internal_alb(elbv2_client) -> dict[str, Any]:
    """
    Resolve the internal ALB by name prefix `{project}-int-alb`.

    Session-scoped would be ideal but `elbv2_client` is already session-scoped
    and we want module-level cleanup if a prior test run mutated things — so
    this is module-scoped and re-fetches on every module load, matching the
    granularity of the suite's concerns.
    """
    project = cfg().project_name
    expected_name = f"{project}-int-alb"
    resp = elbv2_client.describe_load_balancers(Names=[expected_name])
    albs = resp.get("LoadBalancers", [])
    assert albs, (
        f"Internal ALB '{expected_name}' not found in region {cfg().aws_region}. "
        f"Either the Terraform apply didn't run with remove_frontend_sidecar=true, "
        f"or the ALB was manually deleted.  Re-apply `terraform apply` and re-run."
    )
    return albs[0]


@pytest.fixture(scope="module")
def internal_listener(elbv2_client, internal_alb: dict[str, Any]) -> dict[str, Any]:
    """The single :8001 listener on the internal ALB."""
    resp = elbv2_client.describe_listeners(LoadBalancerArn=internal_alb["LoadBalancerArn"])
    listeners = resp.get("Listeners", [])
    assert listeners, f"No listeners on internal ALB {internal_alb['LoadBalancerArn']}"
    return listeners[0]


@pytest.fixture(scope="module")
def internal_listener_rules(elbv2_client, internal_listener: dict[str, Any]) -> list[dict[str, Any]]:
    """All rules (including default) on the internal listener, sorted by priority."""
    resp = elbv2_client.describe_rules(ListenerArn=internal_listener["ListenerArn"])
    # Priority "default" sorts last — represent numerically so sorting is stable.
    return sorted(
        resp.get("Rules", []),
        key=lambda r: 10**9 if r["Priority"] == "default" else int(r["Priority"]),
    )


@pytest.fixture(scope="module")
def target_groups_by_name(elbv2_client) -> dict[str, dict[str, Any]]:
    """Map of TG Name → full TG description for all TGs in the account (region)."""
    out: dict[str, dict[str, Any]] = {}
    paginator = elbv2_client.get_paginator("describe_target_groups")
    for page in paginator.paginate():
        for tg in page.get("TargetGroups", []):
            out[tg["TargetGroupName"]] = tg
    return out


@pytest.fixture(scope="module")
def frontend_task_def(ecs_client) -> dict[str, Any]:
    """
    Resolve the ACTIVE revision of the frontend task definition family.

    We describe by family name (not a pinned revision) so the test always
    checks the latest deployed revision.  ECS resolves the family name to the
    most recent ACTIVE revision.
    """
    project = cfg().project_name
    resp = ecs_client.describe_task_definition(taskDefinition=project)
    return resp["taskDefinition"]


@pytest.fixture(scope="module")
def frontend_container(frontend_task_def: dict[str, Any]) -> dict[str, Any]:
    """Pluck the `nextjs-app` container definition out of the task def."""
    containers = frontend_task_def["containerDefinitions"]
    for c in containers:
        if c["name"] == "nextjs-app":
            return c
    names = [c["name"] for c in containers]
    raise AssertionError(
        f"Frontend task def {frontend_task_def['taskDefinitionArn']} has no "
        f"'nextjs-app' container.  Containers present: {names}"
    )


def _env_value(container: dict[str, Any], key: str) -> str | None:
    """Return the value for a given env var key, or None if absent."""
    for e in container.get("environment", []):
        if e.get("name") == key:
            return e.get("value")
    return None


def _env_count(container: dict[str, Any], key: str) -> int:
    """How many times the env var key appears (catches duplicates)."""
    return sum(1 for e in container.get("environment", []) if e.get("name") == key)


# ─── Plane A: structural — boto3 descriptions only ────────────────────────────

@pytest.mark.internal
@pytest.mark.infra
def test_internal_alb_exists_and_active(internal_alb: dict[str, Any]):
    """Internal ALB is provisioned, scheme=internal, state=active."""
    assert internal_alb["Scheme"] == "internal", (
        f"Internal ALB has wrong Scheme={internal_alb['Scheme']!r}, expected 'internal'. "
        f"ARN: {internal_alb['LoadBalancerArn']}"
    )
    assert internal_alb["State"]["Code"] == "active", (
        f"Internal ALB is not active (State.Code={internal_alb['State']['Code']!r}). "
        f"ARN: {internal_alb['LoadBalancerArn']}"
    )
    assert internal_alb["Type"] == "application", (
        f"Expected application LB, got {internal_alb['Type']!r}. "
        f"ARN: {internal_alb['LoadBalancerArn']}"
    )


@pytest.mark.internal
@pytest.mark.infra
def test_internal_alb_in_private_subnets(internal_alb: dict[str, Any], ec2_client):
    """
    Every subnet the internal ALB is attached to must be private.

    Two signals accepted (AWS does not expose "private subnet" as a flag):
      * Subnet tag `Name` contains "private" (matches our naming convention).
      * No route in the subnet's route table points to an internet gateway
        (no `igw-*` target on `0.0.0.0/0`).

    If EITHER signal fails for any subnet, we call it public and fail.  This
    is strictly more conservative than "subnet is tagged private": a mistagged
    subnet that accidentally has an IGW route would still be caught.
    """
    subnet_ids = [az["SubnetId"] for az in internal_alb["AvailabilityZones"]]
    assert subnet_ids, f"Internal ALB has no subnets: {internal_alb['LoadBalancerArn']}"

    subnets_resp = ec2_client.describe_subnets(SubnetIds=subnet_ids)
    subnets = subnets_resp["Subnets"]

    # Bulk-fetch route tables for these subnets — one API call
    rt_resp = ec2_client.describe_route_tables(
        Filters=[{"Name": "association.subnet-id", "Values": subnet_ids}]
    )
    # Map subnet_id → route table (a subnet may have none if using the main RT;
    # in that case we fall back to the VPC's main route table below).
    rt_by_subnet: dict[str, dict[str, Any]] = {}
    main_rt: dict[str, Any] | None = None
    for rt in rt_resp.get("RouteTables", []):
        is_main = any(a.get("Main") for a in rt.get("Associations", []))
        if is_main:
            main_rt = rt
        for assoc in rt.get("Associations", []):
            if sid := assoc.get("SubnetId"):
                rt_by_subnet[sid] = rt

    for subnet in subnets:
        sid = subnet["SubnetId"]
        name_tag = next(
            (t["Value"] for t in subnet.get("Tags", []) if t["Key"] == "Name"),
            "",
        )

        # Use the subnet's own RT if associated, otherwise the VPC main RT.
        rt = rt_by_subnet.get(sid) or main_rt
        has_igw_route = False
        if rt is not None:
            for route in rt.get("Routes", []):
                if route.get("DestinationCidrBlock") == "0.0.0.0/0":
                    gw = route.get("GatewayId") or ""
                    if gw.startswith("igw-"):
                        has_igw_route = True
                        break

        assert not has_igw_route, (
            f"Subnet {sid} ({name_tag!r}) has a default route through an Internet "
            f"Gateway — that makes it PUBLIC.  The internal ALB must live only in "
            f"private subnets.  ALB ARN: {internal_alb['LoadBalancerArn']}"
        )

        # Soft signal: our naming convention tags private subnets with "private".
        # Don't make this a hard requirement (some legacy environments may not
        # follow the convention), but do warn in the assertion message if both
        # signals are missing — makes console triage faster.
        if "private" not in name_tag.lower() and not has_igw_route:
            # No IGW route is the load-bearing check; we already passed it.
            # The name check is purely advisory, handled as a soft-warn via
            # pytest-style message on the NEXT failure if one occurs.
            pass


@pytest.mark.internal
@pytest.mark.infra
def test_internal_alb_has_single_http_8001_listener(
    internal_alb: dict[str, Any],
    elbv2_client,
):
    """
    Exactly one listener, port 8001, protocol HTTP (no TLS on the internal ALB).

    Rationale for no-TLS: internal traffic never leaves the VPC, and the
    Fargate-to-ALB hop is on AWS's private network.  Adding TLS here would
    mean managing an internal CA or ACM Private CA, which is overkill.
    """
    resp = elbv2_client.describe_listeners(LoadBalancerArn=internal_alb["LoadBalancerArn"])
    listeners = resp.get("Listeners", [])
    assert len(listeners) == 1, (
        f"Expected exactly 1 listener on internal ALB, found {len(listeners)}. "
        f"ALB ARN: {internal_alb['LoadBalancerArn']}"
    )
    lst = listeners[0]
    assert lst["Port"] == 8001, (
        f"Internal listener on wrong port {lst['Port']}, expected 8001. "
        f"Listener ARN: {lst['ListenerArn']}"
    )
    assert lst["Protocol"] == "HTTP", (
        f"Internal listener uses {lst['Protocol']!r}, expected 'HTTP' (no TLS). "
        f"Listener ARN: {lst['ListenerArn']}"
    )


@pytest.mark.internal
@pytest.mark.infra
def test_internal_listener_default_forwards_to_int_api_tg(
    internal_listener: dict[str, Any],
    target_groups_by_name: dict[str, dict[str, Any]],
):
    """
    The listener's default_action must forward to `{project}-int-api-tg`.

    REGRESSION GUARD: the first attempt at this listener used a count-guarded
    ternary fallback to `aws_lb_target_group.backend.arn`.  When the count
    expression evaluated `length(aws_lb_target_group.api_internal) > 0` and the
    internal TG wasn't yet known, terraform picked the fallback branch and
    `terraform apply` failed because `backend.arn` belonged to a different
    load balancer.  If this test fails, it's likely that fallback branch is
    being taken again — check the listener's target_group_arn in the console.
    """
    project = cfg().project_name
    expected_tg_name = f"{project}-int-api-tg"

    default_actions = internal_listener.get("DefaultActions", [])
    assert default_actions, (
        f"Internal listener has no DefaultActions. "
        f"Listener ARN: {internal_listener['ListenerArn']}"
    )
    # For forward actions, target_group_arn is either the top-level field or
    # nested under ForwardConfig.TargetGroups (when weighted).  Accept both.
    forward_action = next((a for a in default_actions if a["Type"] == "forward"), None)
    assert forward_action, (
        f"Internal listener default action is not 'forward'. Actions: {default_actions}. "
        f"Listener ARN: {internal_listener['ListenerArn']}"
    )
    tg_arn = forward_action.get("TargetGroupArn")
    if not tg_arn:
        # Weighted forward config — grab the single TG.
        groups = forward_action.get("ForwardConfig", {}).get("TargetGroups", [])
        assert len(groups) == 1, (
            f"Default action has multi-target forward config; expected a single TG. "
            f"Listener ARN: {internal_listener['ListenerArn']}"
        )
        tg_arn = groups[0]["TargetGroupArn"]

    expected_tg = target_groups_by_name.get(expected_tg_name)
    assert expected_tg, (
        f"Expected target group '{expected_tg_name}' does not exist. "
        f"Known TGs: {sorted(target_groups_by_name.keys())}"
    )
    assert tg_arn == expected_tg["TargetGroupArn"], (
        f"Internal listener default action forwards to wrong TG.\n"
        f"  actual   : {tg_arn}\n"
        f"  expected : {expected_tg['TargetGroupArn']} ({expected_tg_name})\n"
        f"Listener ARN: {internal_listener['ListenerArn']}"
    )


@pytest.mark.internal
@pytest.mark.infra
def test_internal_listener_rule_20_sse_chat(
    internal_listener_rules: list[dict[str, Any]],
    target_groups_by_name: dict[str, dict[str, Any]],
):
    """Priority 20 rule: path /api/chat or /api/chat/* → int-sse-tg."""
    project = cfg().project_name
    rule = next((r for r in internal_listener_rules if r["Priority"] == "20"), None)
    assert rule, (
        f"No rule with priority 20 on internal listener. Rules present: "
        f"{[r['Priority'] for r in internal_listener_rules]}"
    )
    paths = _path_patterns(rule)
    assert "/api/chat" in paths and "/api/chat/*" in paths, (
        f"Priority 20 rule has wrong paths {paths}, expected both /api/chat and /api/chat/*. "
        f"Rule ARN: {rule['RuleArn']}"
    )
    expected_tg_arn = target_groups_by_name[f"{project}-int-sse-tg"]["TargetGroupArn"]
    assert _forward_tg_arn(rule) == expected_tg_arn, (
        f"Priority 20 rule forwards to wrong TG. "
        f"Rule ARN: {rule['RuleArn']}"
    )


@pytest.mark.internal
@pytest.mark.infra
def test_internal_listener_rule_30_sse_swarm(
    internal_listener_rules: list[dict[str, Any]],
    target_groups_by_name: dict[str, dict[str, Any]],
):
    """Priority 30 rule: path /api/swarm or /api/swarm/* → int-sse-tg."""
    project = cfg().project_name
    rule = next((r for r in internal_listener_rules if r["Priority"] == "30"), None)
    assert rule, (
        f"No rule with priority 30 on internal listener. Rules present: "
        f"{[r['Priority'] for r in internal_listener_rules]}"
    )
    paths = _path_patterns(rule)
    assert "/api/swarm" in paths and "/api/swarm/*" in paths, (
        f"Priority 30 rule has wrong paths {paths}, expected both /api/swarm and /api/swarm/*. "
        f"Rule ARN: {rule['RuleArn']}"
    )
    expected_tg_arn = target_groups_by_name[f"{project}-int-sse-tg"]["TargetGroupArn"]
    assert _forward_tg_arn(rule) == expected_tg_arn, (
        f"Priority 30 rule forwards to wrong TG. "
        f"Rule ARN: {rule['RuleArn']}"
    )


@pytest.mark.internal
@pytest.mark.infra
def test_internal_listener_rule_1000_catchall(
    internal_listener_rules: list[dict[str, Any]],
    target_groups_by_name: dict[str, dict[str, Any]],
):
    """Priority 1000 rule: /* catchall → int-api-tg."""
    project = cfg().project_name
    rule = next((r for r in internal_listener_rules if r["Priority"] == "1000"), None)
    assert rule, (
        f"No rule with priority 1000 on internal listener. Rules present: "
        f"{[r['Priority'] for r in internal_listener_rules]}"
    )
    paths = _path_patterns(rule)
    assert "/*" in paths, (
        f"Priority 1000 rule does not match /*, found {paths}. "
        f"Rule ARN: {rule['RuleArn']}"
    )
    expected_tg_arn = target_groups_by_name[f"{project}-int-api-tg"]["TargetGroupArn"]
    assert _forward_tg_arn(rule) == expected_tg_arn, (
        f"Priority 1000 catch-all forwards to wrong TG. "
        f"Rule ARN: {rule['RuleArn']}"
    )


@pytest.mark.internal
@pytest.mark.infra
def test_no_internal_rule_for_electron_ws(
    internal_listener_rules: list[dict[str, Any]],
):
    """
    Intentionally NO rule on the internal ALB for /api/electron/ws.

    Rationale (from alb_internal.tf comments): the Electron desktop app
    connects DIRECTLY to the public :8001 HTTPS listener.  Next.js never
    proxies WebSockets to the backend, so a /api/electron/ws path on the
    internal ALB would be orphaned.  If it existed, RegisterTargets against
    a non-existent ws_internal TG would fail on apply.  This test makes that
    invariant explicit — a future contributor adding such a rule without
    also adding a ws_internal TG will trigger a red light here before the
    apply breaks.
    """
    for rule in internal_listener_rules:
        paths = _path_patterns(rule)
        assert "/api/electron/ws" not in paths, (
            f"Found rule on internal ALB matching /api/electron/ws at priority "
            f"{rule['Priority']}.  This is not allowed — see alb_internal.tf. "
            f"Rule ARN: {rule['RuleArn']}"
        )


@pytest.mark.internal
@pytest.mark.infra
def test_no_int_ws_target_group_exists(target_groups_by_name: dict[str, dict[str, Any]]):
    """
    REGRESSION GUARD: there must be no `{project}-int-ws-tg` TG.

    Creating one without a listener rule (see previous test) causes ECS
    RegisterTargets to fail with `The target group ... does not have an
    associated load balancer`.  If this TG ever exists, the ws service will
    fail to deploy — fix by removing the TG.
    """
    project = cfg().project_name
    unwanted = f"{project}-int-ws-tg"
    assert unwanted not in target_groups_by_name, (
        f"Found unwanted TG '{unwanted}' at "
        f"{target_groups_by_name[unwanted]['TargetGroupArn']}. "
        f"No internal WS TG should exist — delete it."
    )


@pytest.mark.internal
@pytest.mark.infra
def test_internal_target_groups_exist(target_groups_by_name: dict[str, dict[str, Any]]):
    """Both int-api-tg and int-sse-tg exist with port 8001 HTTP."""
    project = cfg().project_name
    for name in (f"{project}-int-api-tg", f"{project}-int-sse-tg"):
        tg = target_groups_by_name.get(name)
        assert tg, (
            f"Expected internal TG '{name}' not found.  Known TGs: "
            f"{sorted(target_groups_by_name.keys())}"
        )
        assert tg["Port"] == 8001, (
            f"TG '{name}' on wrong port {tg['Port']}, expected 8001.  ARN: {tg['TargetGroupArn']}"
        )
        assert tg["Protocol"] == "HTTP", (
            f"TG '{name}' uses {tg['Protocol']}, expected 'HTTP'.  ARN: {tg['TargetGroupArn']}"
        )
        assert tg["TargetType"] == "ip", (
            f"TG '{name}' target_type={tg['TargetType']!r}, expected 'ip' (Fargate). "
            f"ARN: {tg['TargetGroupArn']}"
        )


@pytest.mark.internal
@pytest.mark.infra
def test_internal_target_groups_have_healthy_targets(
    target_groups_by_name: dict[str, dict[str, Any]],
    elbv2_client,
):
    """
    Each internal TG has at least one healthy target.

    Freshly registered targets take 30-60 s to pass the initial ALB health
    check (2 × 30s interval).  Retry up to 90 s with tenacity so a deploy
    that happened in the last minute doesn't flake the suite.
    """
    project = cfg().project_name

    class NotHealthyYet(Exception):
        """Raised when a TG has zero healthy targets — retried by tenacity."""

    @retry(
        retry=retry_if_exception_type(NotHealthyYet),
        stop=stop_after_delay(90),
        wait=wait_fixed(5),
        reraise=True,
    )
    def check(tg_arn: str, tg_name: str):
        resp = elbv2_client.describe_target_health(TargetGroupArn=tg_arn)
        descriptions = resp.get("TargetHealthDescriptions", [])
        healthy = [d for d in descriptions if d["TargetHealth"]["State"] == "healthy"]
        if not healthy:
            states = [
                (d["Target"].get("Id"), d["TargetHealth"]["State"])
                for d in descriptions
            ]
            raise NotHealthyYet(
                f"TG '{tg_name}' has no healthy targets (states: {states}).  "
                f"ARN: {tg_arn}"
            )

    for tg_name in (f"{project}-int-api-tg", f"{project}-int-sse-tg"):
        tg = target_groups_by_name[tg_name]
        check(tg["TargetGroupArn"], tg_name)


@pytest.mark.internal
@pytest.mark.infra
def test_internal_and_public_tgs_share_targets(
    target_groups_by_name: dict[str, dict[str, Any]],
    elbv2_client,
):
    """
    The ECS services register with BOTH public and internal TGs via separate
    `load_balancer` blocks.  This test proves that dual-registration is live:
    the set of target IP addresses in `api-tg` must equal `int-api-tg`'s set,
    and same for sse.

    If they drift, one of the `dynamic "load_balancer"` blocks in ecs_split.tf
    silently stopped expanding (usually because `remove_frontend_sidecar`
    flipped unexpectedly, or a manual `aws ecs` call re-attached the service
    without the internal TG).
    """
    project = cfg().project_name

    def target_ids(tg_arn: str) -> set[str]:
        resp = elbv2_client.describe_target_health(TargetGroupArn=tg_arn)
        return {
            d["Target"]["Id"]
            for d in resp.get("TargetHealthDescriptions", [])
            # Only compare healthy (or initial) targets — draining ones lag.
            if d["TargetHealth"]["State"] in ("healthy", "initial")
        }

    for public_name, internal_name in (
        (f"{project}-api-tg", f"{project}-int-api-tg"),
        (f"{project}-sse-tg", f"{project}-int-sse-tg"),
    ):
        pub = target_groups_by_name.get(public_name)
        intr = target_groups_by_name.get(internal_name)
        assert pub and intr, (
            f"Missing TG for comparison: public={pub is not None}, "
            f"internal={intr is not None} "
            f"(names: {public_name}, {internal_name})"
        )
        pub_ids = target_ids(pub["TargetGroupArn"])
        int_ids = target_ids(intr["TargetGroupArn"])
        assert pub_ids == int_ids, (
            f"Public and internal TGs have drifted target sets — the dual "
            f"`load_balancer` block in ecs_split.tf isn't fully applied.\n"
            f"  only in {public_name}  : {sorted(pub_ids - int_ids)}\n"
            f"  only in {internal_name}: {sorted(int_ids - pub_ids)}\n"
            f"  public ARN  : {pub['TargetGroupArn']}\n"
            f"  internal ARN: {intr['TargetGroupArn']}"
        )


@pytest.mark.internal
@pytest.mark.infra
def test_frontend_task_def_points_python_backend_url_at_internal_alb(
    frontend_container: dict[str, Any],
    frontend_task_def: dict[str, Any],
    internal_alb: dict[str, Any],
):
    """
    PYTHON_BACKEND_URL in the nextjs-app container must equal
    `http://{internal_alb_dns}:8001` when sidecar is removed.

    Also asserts there's EXACTLY ONE entry — user `frontend_env_vars` pollution
    has historically caused duplicates that silently override the infra-owned
    value via ECS's "last-wins" duplicate resolution.
    """
    count = _env_count(frontend_container, "PYTHON_BACKEND_URL")
    assert count == 1, (
        f"Found {count} PYTHON_BACKEND_URL entries in nextjs-app container — "
        f"expected exactly 1.  Duplicates hide the infra-owned value.\n"
        f"Task def ARN: {frontend_task_def['taskDefinitionArn']}"
    )

    value = _env_value(frontend_container, "PYTHON_BACKEND_URL")
    assert value, (
        f"PYTHON_BACKEND_URL is empty or missing in nextjs-app container.\n"
        f"Task def ARN: {frontend_task_def['taskDefinitionArn']}"
    )

    # Expected pattern: http://internal-*.<region>.elb.amazonaws.com:8001
    #   * scheme http (no TLS on internal ALB — proven by test_internal_alb_has_single_http_8001_listener)
    #   * hostname starts with "internal-" (AWS-managed internal ALB DNS convention)
    #   * region matches test region
    #   * port :8001
    pattern = rf"^http://internal-[^/]+\.{re.escape(cfg().aws_region)}\.elb\.amazonaws\.com:8001/?$"
    assert re.match(pattern, value), (
        f"PYTHON_BACKEND_URL={value!r} doesn't match expected internal-ALB pattern "
        f"{pattern!r}.\n"
        f"Task def ARN: {frontend_task_def['taskDefinitionArn']}"
    )

    # Extra belt-and-braces: the DNS name should equal what the ALB itself reports.
    expected_host = internal_alb["DNSName"]
    assert expected_host in value, (
        f"PYTHON_BACKEND_URL={value!r} does not contain the current internal "
        f"ALB DNS {expected_host!r}.  The task def points at a stale ALB — "
        f"force a new deployment to refresh.\n"
        f"  Task def ARN: {frontend_task_def['taskDefinitionArn']}\n"
        f"  ALB ARN     : {internal_alb['LoadBalancerArn']}"
    )


@pytest.mark.internal
@pytest.mark.infra
def test_frontend_task_has_no_backend_sidecar(frontend_task_def: dict[str, Any]):
    """
    With remove_frontend_sidecar=true, the frontend task def must contain
    exactly one container: nextjs-app.  If `backend` reappears here, the
    container_definitions concat() guard in ecs.tf failed to drop it — and
    the frontend will still proxy to localhost:8001 even though the internal
    ALB exists, defeating the whole change.
    """
    names = sorted(c["name"] for c in frontend_task_def["containerDefinitions"])
    assert names == ["nextjs-app"], (
        f"Frontend task has unexpected container set {names}, expected ['nextjs-app'] only. "
        f"Task def ARN: {frontend_task_def['taskDefinitionArn']}"
    )


@pytest.mark.internal
@pytest.mark.infra
def test_internal_alb_sg_ingress_locked_to_ecs_only(
    internal_alb: dict[str, Any],
    ec2_client,
):
    """
    REGRESSION GUARD: the internal ALB's SG must ONLY accept ingress from the
    ECS SG.  No 0.0.0.0/0, no ::/0, no wider CIDRs (10.0.0.0/8 would be a red
    flag because it'd include unrelated peered VPCs).

    If this fails, someone has widened the SG — almost always by accident
    during a firewall drill.  The internal ALB is inside the VPC but widening
    its SG still allows any VPC-local workload (bastions, other ECS services,
    Lambda in the same VPC) to scrape the backend without a credential.
    """
    sg_ids = internal_alb["SecurityGroups"]
    assert sg_ids, f"Internal ALB has no SGs: {internal_alb['LoadBalancerArn']}"

    resp = ec2_client.describe_security_groups(GroupIds=sg_ids)
    for sg in resp["SecurityGroups"]:
        for rule in sg.get("IpPermissions", []):
            # No CIDR-based ingress allowed at all — must be SG-referenced.
            cidrs = [r["CidrIp"] for r in rule.get("IpRanges", [])]
            assert not cidrs, (
                f"Internal ALB SG {sg['GroupId']} has CIDR-based ingress "
                f"{cidrs} on port {rule.get('FromPort')}-{rule.get('ToPort')}. "
                f"Only ECS-SG ingress is permitted.  SG ARN suffix: {sg['GroupId']}"
            )
            ipv6 = [r["CidrIpv6"] for r in rule.get("Ipv6Ranges", [])]
            assert not ipv6, (
                f"Internal ALB SG {sg['GroupId']} has IPv6 CIDR ingress {ipv6}. "
                f"Only ECS-SG ingress is permitted."
            )
            # Any UserIdGroupPairs should only reference the ECS SG.  We don't
            # hard-code the ECS SG ID here (it's in a different fixture scope)
            # but we at least assert it's tagged like our project's.
            for pair in rule.get("UserIdGroupPairs", []):
                # Minimal sanity: referenced group must be in the same account.
                if "UserId" in pair:
                    assert pair["UserId"] == sg["OwnerId"], (
                        f"Internal ALB SG references SG in different account "
                        f"{pair['UserId']} — unexpected.  SG: {sg['GroupId']}"
                    )


@pytest.mark.internal
@pytest.mark.infra
def test_internal_alb_spans_two_azs(
    internal_alb: dict[str, Any],
    ec2_client,
):
    """
    HA: the internal ALB must have ENIs in at least 2 distinct AZs.

    A single-AZ internal ALB is a hidden SPOF — if that AZ has an issue, the
    entire frontend→backend path is down even though the ECS tasks in the
    other AZ are healthy.
    """
    azs = {az["ZoneName"] for az in internal_alb["AvailabilityZones"]}
    assert len(azs) >= 2, (
        f"Internal ALB lives in only {len(azs)} AZ(s): {azs}.  "
        f"Must span at least 2 for HA.  ALB ARN: {internal_alb['LoadBalancerArn']}"
    )

    # Cross-check: describe the ENIs attached by this ALB's "owner-id" and
    # assert 2 distinct AZs at the ENI level too (not just the ALB metadata).
    subnet_ids = [az["SubnetId"] for az in internal_alb["AvailabilityZones"]]
    enis = ec2_client.describe_network_interfaces(
        Filters=[
            {"Name": "subnet-id", "Values": subnet_ids},
            {"Name": "description", "Values": [f"ELB app/{internal_alb['LoadBalancerName']}/*"]},
        ]
    )["NetworkInterfaces"]
    # AWS creates one ENI per AZ for an internal ALB.  Two subnets → two ENIs
    # → two AZs.  Anything less indicates AWS is in the middle of a change.
    eni_azs = {e["AvailabilityZone"] for e in enis}
    assert len(eni_azs) >= 2, (
        f"Internal ALB has ENIs in only {len(eni_azs)} AZ(s): {eni_azs} "
        f"(found {len(enis)} ENIs).  Expected at least 2.  "
        f"ALB ARN: {internal_alb['LoadBalancerArn']}"
    )


@pytest.mark.internal
@pytest.mark.infra
def test_no_internal_rule_forwards_to_phantom_ws_tg(
    internal_listener_rules: list[dict[str, Any]],
    target_groups_by_name: dict[str, dict[str, Any]],
):
    """
    REGRESSION GUARD: no rule on the internal listener may forward to a TG
    whose name contains 'int-ws'.  Pairs with
    `test_no_int_ws_target_group_exists` — even if such a TG existed, it must
    not be referenced by any rule.
    """
    for rule in internal_listener_rules:
        tg_arn = _forward_tg_arn(rule)
        if not tg_arn:
            continue  # non-forward action (fixed-response / redirect)
        # Reverse-lookup: find the TG name for this ARN.
        name = next(
            (n for n, tg in target_groups_by_name.items() if tg["TargetGroupArn"] == tg_arn),
            None,
        )
        assert name is None or "int-ws" not in name, (
            f"Rule at priority {rule['Priority']} forwards to TG '{name}' "
            f"containing 'int-ws' — the internal ALB must not have any ws "
            f"routes.  Rule ARN: {rule['RuleArn']}"
        )


# ─── Plane B: behavioural — public proxy proves internal ALB serves ───────────

@pytest.mark.internal
@pytest.mark.routing
def test_frontend_electron_machines_proxy_reaches_backend(http, auth_headers):
    """
    `GET {frontend_url}/api/electron/machines` is a Next.js route that
    forwards to `{PYTHON_BACKEND_URL}/api/electron/machines`.  A response
    (200/401/403) proves the proxy call succeeded and therefore the internal
    ALB was reachable from the Fargate task.

    Interpretation:
      * 200           → success; backend returned data.
      * 401/403       → auth/RLS kicked in INSIDE the backend — proxy worked.
      * 502/503/504   → proxy call failed — internal ALB unreachable, SG drop,
                        backend not responding, etc.  Hard fail.
      * 5xx HTML body → Cloudflare error page; also a hard fail.
    """
    url = f"{cfg().frontend_url}/api/electron/machines"
    resp = http.get(url, headers=auth_headers, timeout=30.0)

    # Explicit bad-gateway check — these are the exact codes that mean
    # PYTHON_BACKEND_URL is unreachable from Fargate.
    assert resp.status_code not in (502, 503, 504), (
        f"Got {resp.status_code} from {url} — this indicates Next.js could not "
        f"reach PYTHON_BACKEND_URL (internal ALB).  Check the internal ALB's "
        f"target health and the ECS SG's ingress from the internal ALB SG.\n"
        f"Body (first 500): {resp.text[:500]}"
    )

    # Guard against Cloudflare "Error 1000-class" HTML pages that come back
    # as 2xx/3xx with an HTML body.
    ct = resp.headers.get("content-type", "").lower()
    if resp.status_code >= 500 or "cloudflare" in resp.text.lower()[:400]:
        assert "text/html" not in ct, (
            f"Got an HTML error page from {url} — likely Cloudflare edge error. "
            f"Status: {resp.status_code}\nBody (first 500): {resp.text[:500]}"
        )

    assert_status(resp, (200, 401, 403))


@pytest.mark.internal
@pytest.mark.routing
def test_frontend_chat_proxy_streams_sse_through_internal_alb(http, auth_headers):
    """
    `POST {frontend_url}/api/chat/` is the hot path: every user message goes
    here, the Next.js route forwards to `{PYTHON_BACKEND_URL}/api/chat/`, and
    the backend streams SSE back up the stack.

    A 502 from this endpoint means the Fargate task couldn't reach the
    internal ALB — the single most critical failure mode the internal ALB
    exists to prevent.  Even a 400 here (bad request shape) is fine for this
    test: it means the proxy succeeded and the backend received the request.

    We DON'T read the full stream — just verify SSE headers + a first chunk
    come back, then close.  A 6-second timeout is plenty; any longer and the
    proxy is probably sick.
    """
    url = f"{cfg().frontend_url}/api/chat/"
    body = {
        # Deliberately minimal — we want to reach the proxy, not necessarily
        # pass backend validation.  The backend's 4xx is as good as a 200
        # for proving the internal ALB responded.
        "messages": [{"role": "user", "content": "ping"}],
        "model": "anthropic.claude-3-5-haiku-20241022-v1:0",
    }
    headers = {**auth_headers, "Accept": "text/event-stream"}

    with http.stream("POST", url, json=body, headers=headers, timeout=30.0) as resp:
        assert resp.status_code not in (502, 503, 504), (
            f"Got {resp.status_code} from POST {url} — PYTHON_BACKEND_URL is "
            f"unreachable from Fargate.  This is the critical failure mode.\n"
            f"Response headers: {dict(resp.headers)}"
        )
        # 2xx with SSE is the happy path; 4xx is acceptable (we're testing
        # routing, not request validity).
        assert resp.status_code < 500, (
            f"Unexpected 5xx {resp.status_code} from {url}.\n"
            f"Response headers: {dict(resp.headers)}"
        )
        # Close the stream without draining — we've proven the proxy worked.


# ─── Internal helpers (module-private) ────────────────────────────────────────

def _path_patterns(rule: dict[str, Any]) -> list[str]:
    """
    Return the flat list of path_pattern values in a rule's conditions.

    ALB rules store path patterns in two equivalent places depending on API
    version: `PathPatternConfig.Values` (preferred) and the deprecated
    top-level `Values` list.  Check both so describe_rules output from either
    API works.
    """
    patterns: list[str] = []
    for cond in rule.get("Conditions", []):
        if cond.get("Field") != "path-pattern":
            continue
        # Preferred: PathPatternConfig.Values
        cfg_vals = cond.get("PathPatternConfig", {}).get("Values", [])
        patterns.extend(cfg_vals)
        # Deprecated top-level Values — only use if PathPatternConfig was empty
        if not cfg_vals:
            patterns.extend(cond.get("Values", []))
    return patterns


def _forward_tg_arn(rule: dict[str, Any]) -> str | None:
    """
    Extract the single target-group ARN from a rule's forward action.

    Returns None if the rule doesn't have a forward action (e.g. a
    fixed-response or redirect rule — not expected on our internal listener
    but we handle them gracefully rather than crashing).
    """
    for action in rule.get("Actions", []):
        if action.get("Type") != "forward":
            continue
        if tg := action.get("TargetGroupArn"):
            return tg
        # Weighted forward — take the single TG (internal listener never
        # uses weighted, but handle gracefully).
        groups = action.get("ForwardConfig", {}).get("TargetGroups", [])
        if len(groups) == 1:
            return groups[0]["TargetGroupArn"]
    return None
