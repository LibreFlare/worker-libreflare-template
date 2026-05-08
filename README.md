# Libreflare Worker Template

Starter Cloudflare Worker for Libreflare-managed logging projects.

## Setup

1. Create a new repository from this template.
2. Add the repository to the Libreflare GitHub App installation's selected repositories.
3. Select the repository in the Libreflare dashboard and configure the initial rewrite.
4. Libreflare dispatches `.github/workflows/libreflare-init.yml`.
5. The workflow updates the Worker config and opens an initialization pull request.
6. Review and merge the pull request, then configure any required Worker secrets.

The initialization workflow updates `wrangler.jsonc`, `src/index.ts`, and the selected rules YAML path. If you use an existing repository instead of this template, keep `.github/workflows/libreflare-init.yml`, `scripts/libreflare-init.mts`, `jsonc-parser`, and `ts-morph` available on the selected production branch.

The template starts with `/logging-route` in `wrangler.jsonc`. The workflow keeps `WORKER_ROUTE_PREFIX`, the Worker route pattern, and the project route prefix in Libreflare aligned.

## Logging API Auth

`LOG_API_URL` and `LOG_SOURCE_KEY` are written to `wrangler.jsonc` by the initialization workflow. If the logging API needs static request headers, configure `LOG_API_AUTH_HEADERS_JSON` as a Worker secret containing a JSON object:

```sh
wrangler secret put LOG_API_AUTH_HEADERS_JSON
```

Example secret value:

```json
{"Authorization":"Bearer token"}
```

## Rules

Libreflare writes managed rule changes to `libreflare.rules.yaml`:

```yaml
version: 1
expression: cf.tls_cipher ne ""
```

Do not modify this file manually. Deployment metadata belongs in Libreflare, not in the Worker repository.
