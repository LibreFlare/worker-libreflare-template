declare namespace Cloudflare {
	interface Env {
		WORKER_ROUTE_PREFIX: string;
		LOG_API_URL: string;
		LOG_SOURCE_KEY: string;
		LOG_VARY_BY_MONTH: boolean;
		LOG_API_AUTH_HEADERS_JSON: string;
		LIBREFLARE_RULE_EXPRESSION: string;
	}
}
