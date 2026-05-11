import type { LibreflareRuntimeConfig } from '@libreflare/worker-runtime';

declare global {
	namespace Cloudflare {
		interface Env {
			LIBREFLARE_CONFIG: LibreflareRuntimeConfig;
			LOG_API_AUTH_HEADERS_JSON?: string | SecretsStoreSecret;
		}
	}
}

export {};
