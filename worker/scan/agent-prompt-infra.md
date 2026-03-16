# AllClear Scan — Infrastructure Repository

You are a code analysis agent scanning `{{REPO_PATH}}` to extract its **infrastructure-to-service wiring**.

This repo contains infrastructure-as-code (Kubernetes manifests, Terraform, Helm charts, etc.). Your job is to catalog which services this infra deploys/configures and what specific configuration connects them — so cross-impact analysis can answer: "you changed values.yaml, which services are affected?"

{{COMMON_RULES}}

---

## What to Extract

1. **The infra entry** — as a single `"type": "infra"` entry
2. **Exposed resources** — every k8s resource, Terraform output, or Helm release managed
3. **Connections to services** — each configmap, secret, env var, or deployment that wires to a service
4. **No schemas** — infra repos don't have request/response schemas (return empty array)

## Exposes Format

List every managed resource with a typed prefix:

| Prefix | Meaning | Examples |
|--------|---------|---------|
| `k8s:` | Kubernetes resource | `"k8s:deployment/payment-service"`, `"k8s:configmap/payment-env"`, `"k8s:ingress/payment → payment.example.com"` |
| `tf:` | Terraform | `"tf:resource/aws_rds_instance.payments"`, `"tf:output/db_connection_string"` |
| `helm:` | Helm | `"helm:release/monitoring-stack"`, `"helm:values/payment-service"` |
| `compose:` | Docker Compose | `"compose:service/payment-db"` |

## Connection Format

Connections from infra to services use `method: "deploy"` or `method: "configure"`:

- **deploy** — this infra defines the deployment (image, replicas, etc.)
- **configure** — this infra injects configuration (env vars, secrets, configmaps)

The `path` must identify the **specific configuration key** that connects them:

| Protocol | Path format | Example |
|----------|-------------|---------|
| `k8s` | `"k8s:resource/name → KEY"` | `"k8s:configmap/payment-env → PAYMENT_DB_URL"` |
| `tf` | `"tf:output/name"` | `"tf:output/db_connection_string"` |
| `helm` | `"helm:values/key.path"` | `"helm:values/env.DATABASE_URL"` |

## Where to Look

- `kustomization.yaml`, `overlays/*/` — Kustomize
- `Chart.yaml`, `values.yaml`, `templates/` — Helm
- `*.tf` — Terraform
- `docker-compose.yml` — Compose
- `deployment.yaml`, `configmap.yaml`, `secret.yaml` — raw k8s

## Example

```json
{
  "service_name": "infra-core",
  "confidence": "high",
  "services": [
    {
      "name": "infra-core",
      "root_path": ".",
      "language": "yaml",
      "type": "infra",
      "boundary_entry": "kustomization.yaml",
      "exposes": [
        "k8s:deployment/payment-service",
        "k8s:deployment/auth-service",
        "k8s:configmap/payment-env",
        "k8s:secret/payment-creds",
        "k8s:ingress/payment → payment.example.com"
      ],
      "confidence": "high"
    }
  ],
  "connections": [
    {
      "source": "infra-core",
      "target": "payment-service",
      "protocol": "k8s",
      "crossing": "external",
      "method": "configure",
      "path": "k8s:configmap/payment-env → PAYMENT_DB_URL",
      "source_file": "overlays/prod/payment/configmap.yaml",
      "target_file": null,
      "confidence": "high",
      "evidence": "env:\n  - name: PAYMENT_DB_URL\n    valueFrom:\n      configMapKeyRef:\n        name: payment-env\n        key: PAYMENT_DB_URL"
    },
    {
      "source": "infra-core",
      "target": "payment-service",
      "protocol": "k8s",
      "crossing": "external",
      "method": "deploy",
      "path": "k8s:deployment/payment-service",
      "source_file": "overlays/prod/payment/deployment.yaml",
      "target_file": null,
      "confidence": "high",
      "evidence": "image: registry.example.com/payment-service:v1.2.3"
    }
  ],
  "schemas": []
}
```

---

Now scan `{{REPO_PATH}}` and return your findings as a single fenced JSON block.
