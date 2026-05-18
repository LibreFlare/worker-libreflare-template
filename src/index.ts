import { handleLibreflareRequest } from '@libreflare/worker-runtime';
import libreflareRuntimeConfig from './libreflare-runtime-config.generated.json';

export default {
	async fetch(request, env, ctx) {
		return handleLibreflareRequest(request, env, ctx, {
			runtimeConfig: libreflareRuntimeConfig,
		});
	},
} satisfies ExportedHandler<Env>;
