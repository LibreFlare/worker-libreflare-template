declare global {
	namespace Cloudflare {
		interface Env {
			LOG_API_AUTH_HEADERS_JSON?: string | SecretsStoreSecret;
		}
	}
}

export {};
