import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { minifyRuleExpression, validateRuleExpressionSyntax } from '@libreflare/worker-runtime/rule-evaluator';
import { parse as parseJsonc } from 'jsonc-parser';
import * as yaml from 'yaml';

const CONFIG_PATH = 'libreflare.config.yaml';
const BASE_WRANGLER_PATH = 'wrangler.jsonc';
const GENERATED_WRANGLER_PATH = 'wrangler.generated.jsonc';
const WRANGLER_DEPLOY_CONFIG_PATH = '.wrangler/deploy/config.json';
const LOG_AUTH_HEADERS_BINDING = 'LOG_API_AUTH_HEADERS_JSON';
const LOG_STATIC_HEADERS_BINDING = 'LOG_API_HEADERS_JSON';
const MAX_CLOUDFLARE_RULE_LENGTH = 4096;

interface LibreflareConfig {
	version: 1;
	worker: WorkerConfig;
	logging: LoggingConfig;
	rewriteRule: {
		version: number;
		expression: string;
	};
}

type WorkerConfig =
	| { managed: false }
	| {
			managed: true;
			zoneName?: string;
			domain: string;
			routePrefix: string;
	  };

interface AuthHeadersSecretConfig {
	binding: string;
	storeId: string;
	secretName: string;
}

type LoggingConfig =
	| { managed: false }
	| {
			managed: true;
			apiUrl: string;
			sourceKey: string;
			varyByMonth: boolean;
			auth: boolean;
			headers?: Record<string, string>;
			authHeadersSecret?: AuthHeadersSecretConfig;
	  };

const config = maybeReadLibreflareConfig();
const wranglerConfig = readBaseWranglerConfig();

if (config) {
	const validation = validateRuleExpressionSyntax(config.rewriteRule.expression);
	if (validation.errors.length > 0) throw new Error(`Rewrite rule expression is invalid:\n${validation.errors.join('\n')}`);
	if (validation.minifiedLength > MAX_CLOUDFLARE_RULE_LENGTH) {
		throw new Error(`Minified rewrite rule expression is ${validation.minifiedLength} characters; Cloudflare limit is ${MAX_CLOUDFLARE_RULE_LENGTH}.`);
	}
	const minifiedExpression = minifyRuleExpression(config.rewriteRule.expression).expression;

	const vars: Record<string, unknown> = {
		...(isRecord(wranglerConfig.vars) ? wranglerConfig.vars : {}),
		LIBREFLARE_RULE_EXPRESSION: minifiedExpression,
	};
	wranglerConfig.vars = vars;

	if (config.worker.managed) {
		const routeHost = config.worker.zoneName ? config.worker.domain : `*${config.worker.domain}`;
		wranglerConfig.routes = [
			{
				pattern: `${routeHost}${config.worker.routePrefix}/*`,
				zone_name: config.worker.zoneName ?? config.worker.domain,
			},
		];
		vars.WORKER_ROUTE_PREFIX = config.worker.routePrefix;
	}

	if (config.logging.managed) {
		vars.LOG_API_URL = config.logging.apiUrl;
		vars.LOG_SOURCE_KEY = config.logging.sourceKey;
		vars.LOG_VARY_BY_MONTH = config.logging.varyByMonth;
		vars[LOG_STATIC_HEADERS_BINDING] = config.logging.headers ?? {};

		if (config.logging.authHeadersSecret) {
			delete vars.LOG_API_AUTH_HEADERS_JSON;
			removeRequiredSecret(wranglerConfig, config.logging.authHeadersSecret.binding);
			wranglerConfig.secrets_store_secrets = upsertSecretsStoreBinding(wranglerConfig.secrets_store_secrets, {
				binding: config.logging.authHeadersSecret.binding,
				store_id: config.logging.authHeadersSecret.storeId,
				secret_name: config.logging.authHeadersSecret.secretName,
			});
		} else {
			wranglerConfig.secrets_store_secrets = removeSecretsStoreBinding(wranglerConfig.secrets_store_secrets, LOG_AUTH_HEADERS_BINDING);
		}

		if (config.logging.auth && !config.logging.authHeadersSecret) {
			delete vars.LOG_API_AUTH_HEADERS_JSON;
			wranglerConfig.secrets = {
				...(isRecord(wranglerConfig.secrets) ? wranglerConfig.secrets : {}),
				required: uniqueStrings([
					...(requiredSecrets(wranglerConfig.secrets).filter((secret) => secret !== LOG_AUTH_HEADERS_BINDING)),
					LOG_AUTH_HEADERS_BINDING,
				]),
			};
		} else {
			if (!config.logging.authHeadersSecret) vars.LOG_API_AUTH_HEADERS_JSON = '';
			removeRequiredSecret(wranglerConfig, LOG_AUTH_HEADERS_BINDING);
		}
	}

	writeFileSync(GENERATED_WRANGLER_PATH, `${JSON.stringify(wranglerConfig, null, '\t')}\n`);
	writeDeployConfig('../../wrangler.generated.jsonc');
} else {
	writeDeployConfig('../../wrangler.jsonc');
}

function maybeReadLibreflareConfig(): LibreflareConfig | null {
	if (!existsSync(CONFIG_PATH)) return null;
	const parsed = yaml.parse(readFileSync(CONFIG_PATH, 'utf8')) as unknown;
	if (!isRecord(parsed)) throw new Error(`${CONFIG_PATH} must contain a YAML object.`);
	if (parsed.version !== 1) throw new Error(`${CONFIG_PATH} version must be 1.`);
	const worker = parsed.worker;
	const logging = parsed.logging;
	const rewriteRule = parsed.rewriteRule;
	if (!isRecord(rewriteRule)) throw new Error(`${CONFIG_PATH} rewriteRule must be an object.`);

	const config = {
		version: 1 as const,
		worker: workerConfig(worker),
		logging: loggingConfig(logging),
		rewriteRule: {
			version: numberValue(rewriteRule.version, 'rewriteRule.version'),
			expression: stringValue(rewriteRule.expression, 'rewriteRule.expression'),
		},
	};
	validateLibreflareConfig(config);
	return config;
}

function readBaseWranglerConfig(): Record<string, unknown> {
	const parsed = parseJsonc(readFileSync(BASE_WRANGLER_PATH, 'utf8')) as unknown;
	if (!isRecord(parsed)) throw new Error(`${BASE_WRANGLER_PATH} must contain a JSON object.`);
	return parsed;
}

function workerConfig(value: unknown): WorkerConfig {
	if (value === undefined || value === null) return { managed: false };
	if (!isRecord(value)) throw new Error(`${CONFIG_PATH} worker must be an object.`);
	const managed = value.managed === undefined ? true : booleanValue(value.managed, 'worker.managed');
	if (!managed) return { managed: false };
	return {
		managed: true,
		zoneName: optionalStringValue(value.zoneName, 'worker.zoneName'),
		domain: stringValue(value.domain, 'worker.domain'),
		routePrefix: stringValue(value.routePrefix, 'worker.routePrefix'),
	};
}

function loggingConfig(value: unknown): LoggingConfig {
	if (value === undefined || value === null) return { managed: false };
	if (!isRecord(value)) throw new Error(`${CONFIG_PATH} logging must be an object.`);
	const managed = value.managed === undefined ? true : booleanValue(value.managed, 'logging.managed');
	if (!managed) return { managed: false };
	return {
		managed: true,
		apiUrl: stringValue(value.apiUrl, 'logging.apiUrl'),
		sourceKey: stringValue(value.sourceKey, 'logging.sourceKey'),
		varyByMonth: booleanValue(value.varyByMonth, 'logging.varyByMonth'),
		auth: booleanValue(value.auth, 'logging.auth'),
		headers: optionalStringRecord(value.headers, 'logging.headers'),
		authHeadersSecret: optionalAuthHeadersSecret(value.authHeadersSecret),
	};
}

function validateLibreflareConfig(config: LibreflareConfig): void {
	if (config.worker.managed) {
		const zoneName = config.worker.zoneName;
		if (zoneName && !isPlainDomain(zoneName)) {
			throw new Error('worker.zoneName must be a plain domain name.');
		}
		if (zoneName) {
			if (!validRouteDomain(config.worker.domain, zoneName)) {
				throw new Error('worker.domain must be the zone name, a wildcard subdomain, or a subdomain of worker.zoneName.');
			}
		} else if (!isPlainDomain(config.worker.domain)) {
			throw new Error('worker.domain must be a plain domain name when worker.zoneName is not set.');
		}
		if (!config.worker.routePrefix.startsWith('/') || config.worker.routePrefix === '/' || config.worker.routePrefix.endsWith('/')) {
			throw new Error('worker.routePrefix must start with / and must not be / or end with /.');
		}
	}
	if (config.logging.managed) {
		try {
			const url = new URL(config.logging.apiUrl);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
		} catch {
			throw new Error('logging.apiUrl must be an absolute http or https URL.');
		}
		if (!config.logging.sourceKey.trim()) throw new Error('logging.sourceKey is required.');
		if (config.logging.authHeadersSecret && config.logging.authHeadersSecret.binding !== LOG_AUTH_HEADERS_BINDING) {
			throw new Error(`logging.authHeadersSecret.binding must be ${LOG_AUTH_HEADERS_BINDING}.`);
		}
	}
	if (!Number.isInteger(config.rewriteRule.version) || config.rewriteRule.version < 1) {
		throw new Error('rewriteRule.version must be a positive integer.');
	}
	if (!config.rewriteRule.expression.trim()) throw new Error('rewriteRule.expression is required.');
}

function stringValue(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new Error(`${path} must be a string.`);
	return value;
}

function optionalStringValue(value: unknown, path: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	return stringValue(value, path);
}

function booleanValue(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
	return value;
}

function validRouteDomain(domain: string, zoneName: string): boolean {
	const normalizedDomain = domain.toLowerCase();
	const normalizedZone = zoneName.toLowerCase();
	if (normalizedDomain === normalizedZone) return true;
	if (normalizedDomain === `*.${normalizedZone}`) return true;
	if (normalizedDomain.includes('*')) return false;
	return isPlainDomain(normalizedDomain) && normalizedDomain.endsWith(`.${normalizedZone}`);
}

function isPlainDomain(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (normalized.includes('..')) return false;
	const labels = normalized.split('.');
	if (labels.length < 2) return false;
	return labels.every((label) => Boolean(label) && /^[a-z0-9-]+$/.test(label) && !label.startsWith('-') && !label.endsWith('-'));
}

function numberValue(value: unknown, path: string): number {
	if (typeof value !== 'number') throw new Error(`${path} must be a number.`);
	return value;
}

function requiredSecrets(value: unknown): string[] {
	if (!isRecord(value) || !Array.isArray(value.required)) return [];
	return value.required.filter((item): item is string => typeof item === 'string');
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values)];
}

function removeRequiredSecret(config: Record<string, unknown>, binding: string): void {
	const existingSecrets = isRecord(config.secrets) ? { ...config.secrets } : {};
	const required = requiredSecrets(existingSecrets).filter((secret) => secret !== binding);
	if (required.length > 0) {
		existingSecrets.required = required;
		config.secrets = existingSecrets;
	} else {
		delete existingSecrets.required;
		config.secrets = Object.keys(existingSecrets).length > 0 ? existingSecrets : undefined;
	}
}

function upsertSecretsStoreBinding(value: unknown, binding: { binding: string; store_id: string; secret_name: string }): Array<Record<string, string>> {
	return [
		...secretsStoreBindings(value).filter((item) => item.binding !== binding.binding),
		binding,
	];
}

function removeSecretsStoreBinding(value: unknown, binding: string): Array<Record<string, string>> | undefined {
	const bindings = secretsStoreBindings(value).filter((item) => item.binding !== binding);
	return bindings.length > 0 ? bindings : undefined;
}

function secretsStoreBindings(value: unknown): Array<Record<string, string>> {
	if (!Array.isArray(value)) return [];
	return value
		.filter(isRecord)
		.map((item) => ({
			binding: stringValue(item.binding, 'secrets_store_secrets.binding'),
			store_id: stringValue(item.store_id, 'secrets_store_secrets.store_id'),
			secret_name: stringValue(item.secret_name, 'secrets_store_secrets.secret_name'),
		}));
}

function optionalStringRecord(value: unknown, path: string): Record<string, string> | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) throw new Error(`${path} must be an object.`);
	const record: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item !== 'string') throw new Error(`${path}.${key} must be a string.`);
		record[key] = item;
	}
	return record;
}

function optionalAuthHeadersSecret(value: unknown): AuthHeadersSecretConfig | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) throw new Error('logging.authHeadersSecret must be an object.');
	return {
		binding: stringValue(value.binding, 'logging.authHeadersSecret.binding'),
		storeId: stringValue(value.storeId, 'logging.authHeadersSecret.storeId'),
		secretName: stringValue(value.secretName, 'logging.authHeadersSecret.secretName'),
	};
}

function writeDeployConfig(configPath: string): void {
	mkdirSync(dirname(WRANGLER_DEPLOY_CONFIG_PATH), { recursive: true });
	writeFileSync(WRANGLER_DEPLOY_CONFIG_PATH, `${JSON.stringify({ configPath }, null, '\t')}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
