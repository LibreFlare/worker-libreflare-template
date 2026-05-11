import { handleLibreflareRequest } from '@libreflare/worker-runtime';

export default {
	async fetch(request, env, ctx) {
		return handleLibreflareRequest(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
