---
name: pulse
description: This skill should be used when the user asks to "check service health", "check if services are running", "run pulse", "check cluster health", "are my services healthy", or asks about the status of running Kubernetes services.
disable-model-invocation: true
allowed-tools: Bash
argument-hint: "[environment] [service-name]"
---

# AllClear Pulse Skill

## Overview

Check the health and version status of Kubernetes services. Query pod health endpoints and compare running image tags to the latest git tag. Report a structured health table with one row per service showing health status, the endpoint that responded, the running image version, and whether it is in sync with the latest release tag.

This skill reads from the cluster but does not modify any resources.

---

## Step 1: Check kubectl Availability

Source the helper library and verify kubectl is present before attempting any cluster operations.

Run:

```bash
source "${CLAUDE_PLUGIN_ROOT}/scripts/pulse-check.sh"
```

Then call `pulse_check_kubectl`. If it returns a non-zero exit code, display the skip message that the function already printed and stop. Do not proceed with any further steps. The function will have already printed:

> kubectl not found in PATH. Install kubectl to use /allclear pulse.
> See: https://kubernetes.io/docs/tasks/tools/

---

## Step 2: Parse Arguments and Resolve Target Namespace

Parse `$ARGUMENTS` to determine the target namespace and whether a specific service was requested.

Argument parsing rules:

- If `$ARGUMENTS` contains two words (e.g., `staging api`): the first word is the environment (namespace), the second is the service name to check.
- If `$ARGUMENTS` contains one word: check whether it looks like an environment name. Treat it as an environment if it matches one of `dev`, `staging`, `prod`, `default`, `development`, `production`. Otherwise treat it as a service name and use the detected namespace.
- If `$ARGUMENTS` is empty: check all deployments in the current kubectl context namespace.

Store the environment argument in `ENV_ARG` and the service name (if any) in `SERVICE_FILTER`.

Call `pulse_resolve_namespace "$ENV_ARG"` and store the result in `NS`. This function reads from the current kubectl context when `ENV_ARG` is empty, and defaults to `"default"` if the context has no namespace set.

---

## Step 3: Discover Deployments

Determine the list of deployments to check.

If `SERVICE_FILTER` is set, use only that deployment name. Set `DEPLOYMENTS="$SERVICE_FILTER"`.

Otherwise call `pulse_list_deployments "$NS"` to get all deployment names in the namespace, one per line. Store the result in `DEPLOYMENTS`.

If `DEPLOYMENTS` is empty after the call, report the following and stop:

> No deployments found in namespace `$NS`.

Do not continue. There is nothing to check.

---

## Step 4: Health Check — For Each Deployment

For each deployment name in `DEPLOYMENTS`:

1. Call `pulse_get_pod_for_deployment "$DEPLOY" "$NS"` and store the result in `POD`. The function tries the label selector `app=$DEPLOY` first, then falls back to a name-based grep across all pods in the namespace.

2. If `POD` is empty, record the result for this service as:
   - Health: `-`
   - Endpoint: `no pod`
   - Raw status: `—`

   Continue to the next deployment.

3. If `POD` is found, call `pulse_check_health "$DEPLOY" "$NS" "$POD"`.

   The function returns a pipe-delimited string: `STATUS|endpoint_path|raw_status|components_json_or_empty`

   Parse the four fields:
   - `HEALTH_STATUS` — one of `HEALTHY`, `UNHEALTHY`, `UNKNOWN`
   - `HEALTH_ENDPOINT` — the path that responded (e.g., `/health`)
   - `RAW_STATUS` — the raw `.status` value from the JSON body (may be empty for plain-text endpoints)
   - `COMPONENTS` — JSON object of components, or empty string

4. If `HEALTH_ENDPOINT` is `none`, the port-forward succeeded but no health endpoint responded. Record health as `UNHEALTHY (no endpoint responded)`.

5. If the call times out or port-forward fails, record health as `UNHEALTHY (health check timed out)` and continue.

---

## Step 5: Version Comparison — For Each Deployment

For each deployment name in `DEPLOYMENTS`:

1. Call `pulse_get_image_tag "$DEPLOY" "$NS"` and store the result in `RUNNING_TAG`.

2. Call `pulse_get_latest_git_tag` and store the result in `LATEST_TAG`.

3. Apply comparison logic:
   - If `RUNNING_TAG` equals `LATEST_TAG`: record version status as `UP TO DATE`.
   - If `RUNNING_TAG` differs from `LATEST_TAG`: record version status as `DRIFT (running: $RUNNING_TAG, latest: $LATEST_TAG)`.

4. Handle edge cases:
   - If `LATEST_TAG` is `no-tags`: record version status as `cannot compare — no git tags`.
   - If `RUNNING_TAG` contains `sha256` (digest-based image): record version status as `uses digest — cannot compare to semver tag`.
   - If `RUNNING_TAG` is `unknown`: record version status as `image not found`.
   - If `RUNNING_TAG` equals `latest`: record version status as `uses 'latest' tag — no drift detection`.

---

## Step 6: Present Results

Present the collected results as a formatted Markdown table.

Table format:

```
## Pulse: Service Health Report

Namespace: {NS}

| Service | Health | Endpoint | Version | Status |
|---------|--------|----------|---------|--------|
| api     | HEALTHY | /health | v1.2.3  | UP TO DATE |
| worker  | UNHEALTHY | /healthz | v1.2.0 | DRIFT (running: v1.2.0, latest: v1.2.3) |
| frontend | - | no pod | v1.2.3 | UP TO DATE |
```

Column definitions:

- **Service** — deployment name
- **Health** — `HEALTHY`, `UNHEALTHY`, `UNKNOWN`, or `-` (no pod)
- **Endpoint** — health endpoint path that responded, `no pod`, or `none`
- **Version** — the running image tag
- **Status** — version comparison result

If component details were found in any health response (non-empty `COMPONENTS` field), add a "Component Details" subsection below the table:

```
### Component Details

**{service-name}:**
{formatted component list extracted from the COMPONENTS JSON}
```

Use `jq -r 'to_entries[] | "\(.key): \(.value.status)"'` to format component entries.

---

## Step 7: Summary Line

After the table, add a summary line based on the results:

- If all services are `HEALTHY` and `UP TO DATE`: print `All {N} services healthy and up to date.`
- If any service is `UNHEALTHY`: print `{N} service(s) unhealthy — review health column above.`
- If any service shows `DRIFT`: print `{N} service(s) running outdated versions — review status column above.`
- Multiple conditions can apply; list each on a separate line.

---

## Error Handling

Apply these rules throughout execution:

- **kubectl command failure for a specific service:** Report `kubectl error for {service}` in that service row. Continue to the next service. Do not stop.
- **Port-forward timeout or connection refused:** Record health as `UNHEALTHY (health check timed out)`. Continue.
- **No deployments at all:** Output a single message (not a table): `No deployments found in namespace {NS}.`
- **`pulse_get_image_tag` returns empty or error:** Record version as `unknown` and version status as `image not found`.
- **Namespace does not exist:** kubectl will return an error. Catch it, report `Namespace {NS} not found or no access`, and stop.
- **All services healthy:** Include the "All N services healthy and up to date" summary line.

Route all diagnostic messages to stderr when inside helper functions. Surface only the final table and summary to the user.

---

## Implementation Notes

- Always pass `-n "$NS"` to every kubectl command. Never rely on kubectl's implicit default namespace.
- The port-forward in `pulse_check_health` uses local port 18080 to avoid collisions with common development servers. The function handles cleanup automatically — the `kill $PF_PID` call is inside `pulse-check.sh`.
- The health endpoint priority order is: `/health`, `/healthz`, `/actuator/health`, `/ready`. This order prefers application-level health endpoints over Kubernetes control-plane style endpoints.
- Plain-text health responses (e.g., `ok` from `/healthz`) are handled by the helper: if HTTP 200 but no JSON status, the result is `HEALTHY`.
- For multi-cluster setups: this skill uses the current kubectl context. The user must run `kubectl config use-context {cluster}` before invoking pulse for a different cluster. Multi-context support is deferred to v2.
- Container port: `pulse_check_health` always forwards to container port 8080. Services using non-standard ports will time out on the health check. This is a known v1 limitation.
