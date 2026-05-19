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

The template keeps stable Worker settings, including the Worker name, in `wrangler.jsonc`. Project-specific routes, required secrets, and rule expressions are read from `libreflare.config.yaml` and written to `wrangler.generated.jsonc` before `dev` and `deploy` by `@libreflare/worker-cli`. Runtime route/logging config is written to `src/libreflare-runtime-config.generated.json` and bundled with the Worker. The CLI also writes `.wrangler/deploy/config.json`, which redirects Wrangler's deploy/dev commands to the generated config.

Before Libreflare writes `libreflare.config.yaml`, `libreflare-worker config generate` points Wrangler at the base `wrangler.jsonc` and writes a runtime config JSON stub so the first Workers Build deployment can create the Worker without routes.

Managed logging config is generated into `src/libreflare-runtime-config.generated.json`, avoiding Worker variable size limits for projects with many routes.

`wrangler types` reads the stable `wrangler.jsonc`, so Libreflare-managed binding types live in `src/libreflare-env.d.ts`.

## Logging API Auth

`logging.headers` is written into the generated runtime config's `logging.headers` as a JSON object, not a stringified JSON value. Libreflare uses this for the signed `X-Libreflare-Tenant-JWT` header consumed by vmauth.

For fully managed Libreflare logging, VictoriaLogs `AccountID` is assigned per Libreflare organization and `ProjectID` is assigned per domain. Libreflare signs those values into `X-Libreflare-Tenant-JWT`; vmauth verifies the signature and forwards the mapped `AccountID` and `ProjectID` headers to VictoriaLogs. The Cloudflare Access Service Credential remains separate and is used for immediate access revocation.

When `logging.auth` is true without `logging.authHeadersSecret`, the generated Wrangler config marks `LOG_API_AUTH_HEADERS_JSON` as a required secret. Configure it with a JSON object of static request headers:

```sh
wrangler secret put LOG_API_AUTH_HEADERS_JSON
```

Example secret value:

```json
{"Authorization":"Bearer token"}
```

When `logging.authHeadersSecret` is present, the generated Wrangler config binds `LOG_API_AUTH_HEADERS_JSON` from Cloudflare Secrets Store instead of requiring a Worker secret. The generated runtime config's `logging.authHeadersBinding` points to that binding. Fully managed Libreflare logging uses this mode for the generated Cloudflare Access Service Credential.

When `logging.auth` is false and no `authHeadersSecret` is present, no auth header binding is generated.

## Runtime Config

Managed logging deployments generate one JSON file:

```json
{
	"version": 2,
	"logging": {
		"apiUrl": "https://logs.example.com/insert/jsonline?_stream_fields=stream",
		"headers": {
			"X-Libreflare-Tenant-JWT": "Bearer eyJ..."
		},
		"authHeadersBinding": "LOG_API_AUTH_HEADERS_JSON"
	},
	"routes": [
		{
			"prefix": "/logging-route",
			"logging": {
				"sourceKey": "example-general",
				"sourceKeyRules": [
					{
						"expression": "cf.verified_bot_category eq\"AI Crawler\"",
						"sourceKey": "example-ai-crawler"
					}
				],
				"varyByMonth": false
			},
			"rule": "cf.tls_cipher ne \"\""
		}
	]
}
```

Custom Workers can override the static source key in code:

```ts
return handleLibreflareRequest(request, env, ctx, {
	runtimeConfig: libreflareRuntimeConfig,
	getSourceKey: (request) => new URL(request.url).hostname,
});
```

## Managed Config

Libreflare writes managed changes to `libreflare.config.yaml`:

```yaml
version: 2
zoneName: example.com
logging:
  apiUrl: https://logs.example.com/insert/jsonline?_stream_fields=stream
  auth: true
  headers:
    X-Libreflare-Tenant-JWT: "Bearer eyJ..."
  authHeadersSecret:
    binding: LOG_API_AUTH_HEADERS_JSON
    storeId: 00000000000000000000000000000000
    secretName: LIBREFLARE_LOGGING_AUTH_HEADERS
routes:
  - prefix: /logging-route
    domains:
      - example.com
      - "*.example.com"
    logging:
      sourceKey: example-general
      sourceKeyRules:
        - expression: cf.verified_bot_category eq "AI Crawler"
          sourceKey: example-ai-crawler
      varyByMonth: false
    rule: |
      cf.tls_cipher ne ""
```

Do not modify this file manually. Deployment metadata belongs in Libreflare, not in the Worker repository.

Each route contains the hostnames Libreflare should route to the Worker plus the prefix the runtime uses for matching. Values may include the bare zone name, `*.example.com`, concrete subdomains under `zoneName`, or explicit Cloudflare for SaaS custom hostnames.

`logging.sourceKey` is the default stream key. Optional `logging.sourceKeyRules`
are ordered Worker-side expressions that can select a more specific key before
origin fetch. They use native Cloudflare Rules syntax, do not support rule
fragments, and cannot reference Cloudflare lists such as `$known_crawlers`.
