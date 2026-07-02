# Arcanon Scan — Library / SDK Repository

You are a code analysis agent scanning `{{REPO_PATH}}` to extract its **library API surface and dependency structure**.

This repo is a **shared library or SDK** — not a deployable service. Your job is to catalog what it exports so downstream impact analysis knows exactly which callers are affected when a function changes.

{{COMMON_RULES}}

## Discovery Context (from Stage 1)

{{DISCOVERY_JSON}}

Use the discovery context above to focus your scan:

- **Only read files relevant to the detected services** — route files, handler files, client files, config files
- **Use the framework hints** to know what patterns to look for (e.g., `@app.route` for Flask, `router.get` for Express, `@RestController` for Spring Boot)
- **Focus on `route_files`** listed above — these contain the endpoint definitions
- **Check `proto_files` and `openapi_files`** for API contracts
- **Check `event_config_files`** for message queue topics

If discovery context is empty or `{{DISCOVERY_JSON}}` was not replaced, fall back to scanning all files.

---

## What to Extract

1. **The library itself** — as a single `"type": "library"` or `"type": "sdk"` entry
2. **Exported public API** — every function, class, or type exported from the entry point
3. **Connections** — if this library calls external services (REST, gRPC, events), report those
4. **Schemas** — exported types/interfaces that callers depend on

## Exposes Format

List **every public exported function** with signatures:

```
"functionName(param: Type, param2: Type): ReturnType"
```

Include exported types/interfaces by name: `"EventConfig"`, `"ClientOptions"`

At minimum, list `"functionName"` if types are not visible.

**Where to look for exports:**
- `src/index.ts` or `src/index.js` — barrel exports
- `__init__.py` — Python package exports
- `lib.rs` — Rust crate root
- `main.go` with exported (capitalized) functions

## Connection Path Format

If the library calls external services internally, report those connections:

**Canonical protocol vocabulary:** emit one of `rest · grpc · events · db · internal · sdk`.
Pub/sub + streaming (kafka, rabbitmq, nats, sqs, sse) fold into `events`;
datastores (postgres, mysql, mongodb, redis, sql) fold into `db`; graphql/http
fold into `rest`. Name the specific technology in `evidence` if useful.

| Protocol | Path format | Example |
|----------|-------------|---------|
| `rest` | `"/events/{id}"` | Template endpoint path (graphql/http fold here) |
| `events` | `"events.published"` | Topic name (kafka/rabbitmq/nats/sqs/sse) |
| `db` | `"orders"` | Datastore dependency — table/collection/key namespace |

## source_file + source_symbol Requirement

`source_file` on every connection is **REQUIRED**. This field enables file-level impact analysis. Do not emit `null` unless you have exhaustively searched all source files and found no call site.

**Format:** emit the path and symbol as SEPARATE fields:

- `"source_file": "path/to/caller.ts"` — the relative file path ONLY (no colon, no symbol suffix)
- `"source_symbol": "functionName"` — the function or symbol name at the call site (optional; omit or null if not applicable)

For a line-number fallback, use `"source_symbol": "42"`.

- Use the file that contains the call — not the file that defines the target.
- For SDK connections, use the file that imports and invokes the SDK function.
- `source_file: null` is only valid when the call site is dynamically generated or the source file is minified/bundled with no recoverable origin.

## Example

```json
{
  "service_name": "edgeworks-sdk",
  "confidence": "high",
  "services": [
    {
      "name": "edgeworks-sdk",
      "root_path": ".",
      "language": "typescript",
      "type": "library",
      "boundary_entry": "src/index.ts",
      "exposes": [
        "createClient(config: ClientConfig): EdgeworksClient",
        "publishEvent(client: EdgeworksClient, topic: string, payload: object): Promise<void>",
        "subscribeEvents(client: EdgeworksClient, topic: string, handler: EventHandler): Subscription",
        "ClientConfig",
        "EdgeworksClient",
        "EventHandler",
        "Subscription"
      ],
      "confidence": "high"
    }
  ],
  "connections": [
    {
      "source": "edgeworks-sdk",
      "target": "event-journal",
      "protocol": "rest",
      "crossing": "cross-service",
      "method": "POST",
      "path": "/events",
      "source_file": "src/client.ts",
      "source_symbol": "publishEvent",
      "target_file": null,
      "confidence": "high",
      "evidence": "await this.http.post(`${this.baseUrl}/events`, { topic, payload })"
    }
  ],
  "schemas": [
    {
      "connection_index": 0,
      "name": "PublishEventPayload",
      "role": "request",
      "file": "src/types/event.ts",
      "fields": [
        { "name": "topic", "type": "string", "required": true },
        { "name": "payload", "type": "object", "required": true }
      ]
    }
  ]
}
```

---

Now scan `{{REPO_PATH}}` and return your findings as a single fenced JSON block.
