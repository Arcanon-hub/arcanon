#!/usr/bin/env bash
# AllClear Pulse Skill — service health check helper
# Sourced by SKILL.md — not intended for direct execution

set -euo pipefail

# pulse_check_kubectl
# Check if kubectl is available in PATH.
# Returns 0 if found, 1 if not found (with skip message printed to stdout).
pulse_check_kubectl() {
  if ! command -v kubectl > /dev/null 2>&1; then
    echo "kubectl not found in PATH. Install kubectl to use /allclear pulse."
    echo "See: https://kubernetes.io/docs/tasks/tools/"
    return 1
  fi
  return 0
}

# pulse_resolve_namespace [environment]
# Resolve the Kubernetes namespace from the provided environment argument or
# from the current kubectl context. Defaults to "default" if nothing is found.
# Args:
#   $1 — optional environment name (used directly as namespace)
pulse_resolve_namespace() {
  local env_arg="${1:-}"
  if [ -n "$env_arg" ]; then
    printf '%s\n' "$env_arg"
    return 0
  fi
  local detected
  detected=$(kubectl config view --minify -o jsonpath='{.contexts[0].context.namespace}' 2>/dev/null || true)
  printf '%s\n' "${detected:-default}"
}

# pulse_list_deployments <namespace>
# List all deployment names in the given namespace, one per line.
# Args:
#   $1 — namespace
pulse_list_deployments() {
  local ns="$1"
  kubectl get deployments -n "$ns" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true
}

# pulse_get_image_tag <deployment> <namespace>
# Extract the image tag of the first container in a deployment.
# Echoes "latest" if the image has no tag component.
# Args:
#   $1 — deployment name
#   $2 — namespace
pulse_get_image_tag() {
  local deploy="$1"
  local ns="$2"
  local image
  image=$(kubectl get deployment "$deploy" -n "$ns" \
    -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
  if [ -z "$image" ]; then
    printf 'unknown\n'
    return 0
  fi
  # Strip everything up to and including the last ':' to get the tag.
  # If image contains no ':', there is no explicit tag — report "latest".
  if printf '%s' "$image" | grep -q ':'; then
    printf '%s\n' "${image##*:}"
  else
    printf 'latest\n'
  fi
}

# pulse_get_latest_git_tag
# Return the latest git tag in the current repository.
# Echoes "no-tags" if no tags exist.
pulse_get_latest_git_tag() {
  local tag
  tag=$(git describe --tags --abbrev=0 2>/dev/null || true)
  if [ -z "$tag" ]; then
    tag=$(git tag --sort=version:refname 2>/dev/null | tail -1 || true)
  fi
  printf '%s\n' "${tag:-no-tags}"
}

# pulse_get_pod_for_deployment <deployment> <namespace>
# Find a running pod name for the given deployment.
# Tries label selector first ("app=$deploy"), then falls back to name grep.
# Echoes pod name or empty string if none found.
# Args:
#   $1 — deployment name
#   $2 — namespace
pulse_get_pod_for_deployment() {
  local deploy="$1"
  local ns="$2"
  local pod
  pod=$(kubectl get pods -n "$ns" -l "app=$deploy" \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if [ -z "$pod" ]; then
    pod=$(kubectl get pods -n "$ns" \
      -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null \
      | grep "$deploy" | head -1 || true)
  fi
  printf '%s\n' "$pod"
}

# pulse_check_health <deployment> <namespace> <pod>
# Perform a health check on the given pod via kubectl port-forward.
# Tries health endpoints in priority order: /health, /healthz, /actuator/health, /ready.
# Echoes a structured line: "STATUS|endpoint_path|raw_status|components_json_or_empty"
# STATUS is one of: HEALTHY, UNHEALTHY, UNKNOWN
# Args:
#   $1 — deployment name
#   $2 — namespace
#   $3 — pod name
pulse_check_health() {
  local deploy="$1"
  local ns="$2"
  local pod="$3"

  local pf_pid=""
  local http_code=""
  local body=""
  local matched_path=""

  # Start port-forward in background; route its output to stderr to keep stdout clean.
  kubectl port-forward -n "$ns" "pod/$pod" 18080:8080 > /dev/null 2>&1 &
  pf_pid=$!

  # Allow port-forward to establish.
  sleep 1

  # Try each health endpoint path in priority order.
  local path_attempt
  for path_attempt in /health /healthz /actuator/health /ready; do
    http_code=$(curl -s \
      -o /tmp/allclear_health_body \
      -w "%{http_code}" \
      --max-time 5 \
      "http://localhost:18080${path_attempt}" 2>/dev/null || true)
    if [ "$http_code" = "200" ]; then
      body=$(cat /tmp/allclear_health_body 2>/dev/null || true)
      matched_path="$path_attempt"
      break
    fi
  done

  # Always clean up the port-forward process.
  if [ -n "$pf_pid" ]; then
    kill "$pf_pid" 2>/dev/null || true
  fi

  # If no endpoint responded with 200, report unhealthy.
  if [ -z "$matched_path" ]; then
    printf 'UNHEALTHY|none|no-endpoint|\n'
    return 0
  fi

  # Parse health body with jq (PLGN-07 pattern).
  local raw_status
  raw_status=$(printf '%s\n' "$body" | jq -r '.status // empty' 2>/dev/null || true)

  # Normalize status string.
  local health_status
  case "${raw_status,,}" in
    up|ok|healthy|pass)
      health_status="HEALTHY"
      ;;
    down|error|fail*)
      health_status="UNHEALTHY"
      ;;
    "")
      # No JSON status field — fall back to HTTP status code.
      if [ "$http_code" = "200" ]; then
        health_status="HEALTHY"
      else
        health_status="UNHEALTHY"
      fi
      ;;
    *)
      health_status="UNKNOWN"
      ;;
  esac

  # Extract components if present.
  local components
  components=$(printf '%s\n' "$body" | jq -r '.components // empty' 2>/dev/null || true)

  printf '%s|%s|%s|%s\n' "$health_status" "$matched_path" "$raw_status" "$components"
}
