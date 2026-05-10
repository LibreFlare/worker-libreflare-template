# Libreflare Worker Template

Starter Cloudflare Worker for Libreflare-managed logging projects.

## Setup

1. Create a new repository from this template.
2. Update `name` in `wrangler.jsonc` to the Cloudflare Worker name you want to use.
3. Create the Worker from this repository in the Cloudflare dashboard. Use Workers Build, set Deploy command to `npm run deploy`, keep Build root directory as `/`, and do not assign routes.
4. Add the repository to the Libreflare GitHub App installation's selected repositories.
5. Select the unrouted Cloudflare Worker in the Libreflare dashboard and configure the initial rewrite.
6. Libreflare opens a pull request that writes `libreflare.config.yaml`.
7. Review and merge the pull request, then configure `LOG_API_AUTH_HEADERS_JSON` as a Worker secret if `logging.auth` is true and Libreflare did not supply an `authHeadersSecret`.

The template keeps stable Worker settings, including the Worker name, in `wrangler.jsonc`. Project-specific route, logging vars, required secrets, and rule expression are read from `libreflare.config.yaml` and written to `wrangler.generated.jsonc` before `dev` and `deploy`. The generator also writes `.wrangler/deploy/config.json`, which redirects Wrangler's deploy/dev commands to the generated config.

Before Libreflare writes `libreflare.config.yaml`, the generator points Wrangler at the base `wrangler.jsonc` so the first Workers Build deployment can create the Worker without routes.

If `worker.managed` or `logging.managed` is false, the generator leaves that section of the base Wrangler config untouched. The rewrite rule expression is always generated into `LIBREFLARE_RULE_EXPRESSION`.

`wrangler types` reads the stable `wrangler.jsonc`, so Libreflare-managed binding types live in `src/libreflare-env.d.ts`.

## Logging API Auth

`logging.headers` is written into `LOG_API_HEADERS_JSON` as static request headers. Libreflare uses this for tenant headers such as VictoriaLogs `AccountID` and `ProjectID`.

For fully managed Libreflare logging, VictoriaLogs `AccountID` is assigned per Libreflare organization and `ProjectID` is assigned per domain. Libreflare generates each value locally as a random non-zero unsigned 32-bit integer serialized as a decimal string, in the range `1` through `4294967295`. `AccountID` is globally unique across Libreflare organizations; `ProjectID` is unique within its organization.

When `logging.auth` is true without `logging.authHeadersSecret`, the generated Wrangler config marks `LOG_API_AUTH_HEADERS_JSON` as a required secret. Configure it with a JSON object of static request headers:

```sh
wrangler secret put LOG_API_AUTH_HEADERS_JSON
```

Example secret value:

```json
{"Authorization":"Bearer token"}
```

When `logging.authHeadersSecret` is present, the generated Wrangler config binds `LOG_API_AUTH_HEADERS_JSON` from Cloudflare Secrets Store instead of requiring a Worker secret. Fully managed Libreflare logging uses this mode for the generated Cloudflare Access Service Credential.

When `logging.auth` is false and no `authHeadersSecret` is present, the generated Wrangler config binds `LOG_API_AUTH_HEADERS_JSON` as an empty plain variable.

## Managed Config

Libreflare writes managed changes to `libreflare.config.yaml`:

```yaml
version: 1
worker:
  managed: true
  domain: example.com
  routePrefix: /logging-route
logging:
  managed: true
  apiUrl: https://logs.example.com/insert/jsonline?_stream_fields=stream
  sourceKey: example-general
  varyByMonth: false
  auth: false
  headers:
    AccountID: "123456789"
    ProjectID: "987654321"
  authHeadersSecret:
    binding: LOG_API_AUTH_HEADERS_JSON
    storeId: 00000000000000000000000000000000
    secretName: LIBREFLARE_LOGGING_AUTH_HEADERS
rewriteRule:
  version: 1
  expression: |
    cf.tls_cipher ne ""
```

Do not modify this file manually. Deployment metadata belongs in Libreflare, not in the Worker repository.
