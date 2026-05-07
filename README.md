# Libreflare Worker Template

Starter Cloudflare Worker for Libreflare-managed logging projects.

## Setup

1. Create a new repository from this template.
2. Rename the package and Worker in `package.json` and `wrangler.jsonc`.
3. Update the `routes` entry in `wrangler.jsonc` for your domain.
4. Set `LOG_API_URL` and `LOG_SOURCE_KEY` in `wrangler.jsonc`.
5. Run `npm install`.
6. Run `npm run cf-typegen` after changing Worker bindings or vars.
7. Connect the repository in the Libreflare dashboard and keep the rules config path set to `libreflare.rules.yaml`.

The dashboard default Worker route prefix is `/logging-route`. Keep that prefix unless you also update `WORKER_ROUTE_PREFIX` in `src/index.ts` and the project route prefix in Libreflare.

## Logging API Auth

If the logging API needs static request headers, configure `LOG_API_AUTH_HEADERS_JSON` as a Worker secret containing a JSON object:

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
