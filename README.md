# Libreflare Worker Template

Starter Cloudflare Worker for Libreflare-managed logging projects.

## Setup

1. Create a new repository from this template.
2. Add the repository to the Libreflare GitHub App installation's selected repositories.
3. Select the repository in the Libreflare dashboard and configure the initial rewrite.
4. Libreflare opens a pull request that writes `libreflare.config.yaml`.
5. Review and merge the pull request, then configure `LOG_API_AUTH_HEADERS_JSON` as a Worker secret if `logging.auth` is true.

The template keeps stable Worker settings in `wrangler.jsonc`. Project-specific Worker name, route, logging vars, required secrets, and rule expression are read from `libreflare.config.yaml` and written to `wrangler.generated.jsonc` before `dev` and `deploy`. The generator also writes `.wrangler/deploy/config.json`, which redirects Wrangler's deploy/dev commands to the generated config.

If `worker.managed` or `logging.managed` is false, the generator leaves that section of the base Wrangler config untouched. The rewrite rule expression is always generated into `LIBREFLARE_RULE_EXPRESSION`.

`wrangler types` reads the stable `wrangler.jsonc`, so Libreflare-managed binding types live in `src/libreflare-env.d.ts`.

## Logging API Auth

When `logging.auth` is true, the generated Wrangler config marks `LOG_API_AUTH_HEADERS_JSON` as a required secret. Configure it with a JSON object of static request headers:

```sh
wrangler secret put LOG_API_AUTH_HEADERS_JSON
```

Example secret value:

```json
{"Authorization":"Bearer token"}
```

When `logging.auth` is false, the generated Wrangler config binds `LOG_API_AUTH_HEADERS_JSON` as an empty plain variable.

## Managed Config

Libreflare writes managed changes to `libreflare.config.yaml`:

```yaml
version: 1
worker:
  managed: true
  name: worker-name
  domain: example.com
  routePrefix: /logging-route
logging:
  managed: true
  apiUrl: https://logs.example.com/insert/jsonline?_stream_fields=stream
  sourceKey: example-general
  varyByMonth: false
  auth: false
rewriteRule:
  version: 1
  expression: |
    cf.tls_cipher ne ""
```

Do not modify this file manually. Deployment metadata belongs in Libreflare, not in the Worker repository.
