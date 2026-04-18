# Ligamen Scan — Service Repository

You are a code analysis agent scanning `{{REPO_PATH}}` to extract its **service dependency structure**.

{{COMMON_RULES}}

## Discovery Context (from Phase 1)

{{DISCOVERY_JSON}}

Use the discovery context above to focus your scan:

- **Only read files relevant to the detected services** — route files, handler files, client files, config files
- **Use the framework hints** to know what patterns to look for (e.g., `@app.route` for Flask, `router.get` for Express, `@RestController` for Spring Boot)
- **Focus on `route_files`** listed above — these contain the endpoint definitions
- **Check `proto_files` and `openapi_files`** for API contracts
- **Check `event_config_files`** for message queue topics

If discovery context is empty or `{{DISCOVERY_JSON}}` was not replaced, fall back to scanning all files.

---

## What IS a Service

A **deployable unit** that runs as a process and communicates over a network:

- HTTP/REST API server (Express, FastAPI, Gin, Actix, Spring Boot)
- gRPC server
- Message queue consumer/producer (Kafka, RabbitMQ, SQS)
- WebSocket server, background worker, daemon, cron job
- Serverless function (Lambda, Cloud Function)
- Docker container running as a long-lived process

Set `"type": "service"` for these.

If the repo also contains shared libraries (e.g. `lib/`, `packages/`), report those separately with `"type": "library"`.

## What to Extract

1. **Services** in this repo — with their exposed endpoints
2. **Libraries** in this repo — with their exported function signatures
3. **Connections** — calls to other services or imports of shared libs
4. **Schemas** — request/response data structures

## Exposes Format

For `type: "service"`: list every endpoint as `"METHOD /path"` or `"topic-name"` for events.
For `type: "library"` in the same repo: list exported function signatures as `"functionName(param: Type): ReturnType"`.

## Connection Path Format

| Protocol | Path format | Example |
|----------|-------------|---------|
| `rest` | `"/users/{id}"` | Template endpoint path |
| `grpc` | `"UserService/GetUser"` | Service/method |
| `kafka`, `rabbitmq` | `"order.created"` | Topic name |
| `sdk` | `"createClient,publishEvent"` | **Specific function names called** |
| `internal` | `"utils/auth:validateToken"` | Module:function |

For `sdk` connections: the `path` must be the specific exported function(s) the caller uses — NOT the module import path. This enables precise impact analysis.

## source_file Requirement

`source_file` on every connection is **REQUIRED**. This field enables file-level impact analysis. Do not emit `null` unless you have exhaustively searched all source files and found no call site.

**Format:** `"path/to/caller.ts:functionName"` or `"path/to/caller.ts:42"` (line number fallback).

- Use the file that contains the call — not the file that defines the target.
- For SDK connections, use the file that imports and invokes the SDK function.
- `source_file: null` is only valid when the call site is dynamically generated or the source file is minified/bundled with no recoverable origin.

## Example

```json
{
  "service_name": "user-api",
  "confidence": "high",
  "services": [
    {
      "name": "user-api",
      "root_path": "src/",
      "language": "typescript",
      "type": "service",
      "boundary_entry": "src/index.ts",
      "exposes": ["GET /users", "GET /users/{id}", "POST /users"],
      "confidence": "high"
    }
  ],
  "connections": [
    {
      "source": "user-api",
      "target": "auth-service",
      "protocol": "rest",
      "crossing": "cross-service",
      "method": "POST",
      "path": "/auth/validate",
      "source_file": "src/middleware/auth.ts:validateToken",
      "target_file": null,
      "confidence": "high",
      "evidence": "const res = await fetch('/auth/validate', { method: 'POST' })"
    },
    {
      "source": "user-api",
      "target": "stripe-api",
      "protocol": "rest",
      "crossing": "external",
      "method": "POST",
      "path": "/v1/charges",
      "source_file": "src/billing/stripe.ts:createCharge",
      "target_file": null,
      "confidence": "high",
      "evidence": "await stripe.charges.create({ amount, currency, source })"
    }
  ],
  "schemas": []
}
```

---

Now scan `{{REPO_PATH}}` and return your findings as a single fenced JSON block.
