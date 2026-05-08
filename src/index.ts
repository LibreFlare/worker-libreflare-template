import { handleRequest } from '@libreflare/worker-runtime';
import rulesConfig from '../libreflare.rules.yaml';

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
			apiAuthHeaders: parseApiAuthHeaders(env.LOG_API_AUTH_HEADERS_JSON),
			rulesConfig,
		}, ctx);
	},
} satisfies ExportedHandler<Env>;

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

function parseApiAuthHeaders(value?: string): Record<string, string> | undefined {
	if (!value) return undefined;
	try {
		const parsed = JSON.parse(value) as unknown;
		if (isStringRecord(parsed)) return parsed;
	} catch {
		// The unified error below is clearer than exposing a raw JSON parser exception.
	}
	throw new Error('LOG_API_AUTH_HEADERS_JSON must contain a JSON object of string headers.');
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return Object.values(value).every((item) => typeof item === 'string');
}
