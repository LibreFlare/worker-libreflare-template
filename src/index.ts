import { handleRequest } from '@libreflare/worker-runtime';

export default {
	async fetch(request, env, ctx) {
		const workerRoutePrefix = getWorkerRoutePrefix(env);

		return handleRequest(request, {
			getSourceKey: () => env.LOG_SOURCE_KEY,
			varyByMonth: env.LOG_VARY_BY_MONTH ?? true,

			originFetcher: (request) => {
				const originURL = stripWorkerRoutePrefix(new URL(request.url), workerRoutePrefix);
				return fetch(originURL, request);
			},

			apiURL: env.LOG_API_URL,
			apiAuthHeaders: {
				...(await apiAuthHeaders(env.LOG_API_AUTH_HEADERS_JSON)),
				...env.LOG_API_HEADERS_JSON,
			},
			rulesConfig: runtimeRulesConfig(env.LIBREFLARE_RULE_EXPRESSION),
		}, ctx);
	},
} satisfies ExportedHandler<Env>;

function runtimeRulesConfig(expression: string): string {
	return `version: 1\nexpression: ${JSON.stringify(expression)}\n`;
}

function stripWorkerRoutePrefix(url: URL, workerRoutePrefix: string): URL {
	if (url.pathname === workerRoutePrefix) {
		url.pathname = '/';
		return url;
	}

	if (url.pathname.startsWith(`${workerRoutePrefix}/`)) {
		url.pathname = url.pathname.slice(workerRoutePrefix.length);
	}

	return url;
}

function getWorkerRoutePrefix(env: Env): string {
	const prefix: string = env.WORKER_ROUTE_PREFIX;
	if (!prefix.startsWith('/') || prefix === '/' || prefix.endsWith('/')) {
		throw new Error('WORKER_ROUTE_PREFIX must start with / and must not be / or end with /.');
	}
	return prefix;
}

async function apiAuthHeaders(binding?: string | SecretsStoreSecret): Promise<Record<string, string>> {
	if (!binding) return {};
	if (typeof binding === 'string') return parseApiHeaders(binding);
	if (isSecretsStoreSecret(binding)) return parseApiHeaders(await binding.get());
	throw new Error('LOG_API_AUTH_HEADERS_JSON must be a JSON string or a Secrets Store secret binding.');
}

function parseApiHeaders(value?: string): Record<string, string> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		if (isStringRecord(parsed)) return parsed;
	} catch {
		// The unified error below is clearer than exposing a raw JSON parser exception.
	}
	throw new Error('Logging API header bindings must contain a JSON object of string headers.');
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return Object.values(value).every((item) => typeof item === 'string');
}

function isSecretsStoreSecret(value: unknown): value is SecretsStoreSecret {
	if (!value || typeof value !== 'object') return false;
	return typeof (value as { get?: unknown }).get === 'function';
}
