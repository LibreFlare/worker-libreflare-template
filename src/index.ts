import { env } from 'cloudflare:workers';
import { handleLibreflareRequest, warmUpLibreflareRequestHandler } from '@libreflare/worker-runtime';
import libreflareRuntimeConfig from './libreflare-runtime-config.generated.json';

const options = { runtimeConfig: libreflareRuntimeConfig };
warmUpLibreflareRequestHandler(env, options);

export default {
	async fetch(request, env, ctx) {
		return handleLibreflareRequest(request, env, ctx, options);
	},
} satisfies ExportedHandler<Env>;
