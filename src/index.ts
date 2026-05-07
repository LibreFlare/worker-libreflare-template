import { handleRequest } from '@libreflare/worker-runtime';
import rulesConfig from '../libreflare.rules.yaml';

const WORKER_ROUTE_PREFIX = '/logging-route';

export default {
	async fetch(request, env, ctx) {
		return handleRequest(request, {
			getSourceKey: () => env.LOG_SOURCE_KEY,
			varyByMonth: parseOptionalBoolean(env.LOG_VARY_BY_MONTH, true),

			originFetcher: (request) => {
				const originURL = stripWorkerRoutePrefix(new URL(request.url));
				return fetch(originURL, request);
			},

			apiURL: env.LOG_API_URL,
			apiAuthHeaders: parseApiAuthHeaders(env.LOG_API_AUTH_HEADERS_JSON),
			rulesConfig,
		}, ctx);
	},
} satisfies ExportedHandler<Env>;

function stripWorkerRoutePrefix(url: URL): URL {
	if (url.pathname === WORKER_ROUTE_PREFIX) {
		url.pathname = '/';
		return url;
	}

	if (url.pathname.startsWith(`${WORKER_ROUTE_PREFIX}/`)) {
		url.pathname = url.pathname.slice(WORKER_ROUTE_PREFIX.length);
	}

	return url;
}

function parseOptionalBoolean(value: unknown, defaultValue: boolean): boolean {
	if (value === undefined || value === null || value === '') return defaultValue;
	if (typeof value !== 'string') throw new Error('LOG_VARY_BY_MONTH must be "true" or "false".');

	const normalized = value.toLowerCase();
	if (normalized === 'true') return true;
	if (normalized === 'false') return false;
	throw new Error('LOG_VARY_BY_MONTH must be "true" or "false".');
}

function parseApiAuthHeaders(value: unknown): Record<string, string> | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value !== 'string') throw new Error('LOG_API_AUTH_HEADERS_JSON must be a JSON object string.');

	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error('LOG_API_AUTH_HEADERS_JSON must contain a valid JSON object of string headers.');
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('LOG_API_AUTH_HEADERS_JSON must contain a JSON object of string headers.');
	}

	const headers: Record<string, string> = {};
	for (const [headerName, headerValue] of Object.entries(parsed)) {
		if (typeof headerValue !== 'string') {
			throw new Error('LOG_API_AUTH_HEADERS_JSON must contain only string header values.');
		}
		headers[headerName] = headerValue;
	}
	return headers;
}
