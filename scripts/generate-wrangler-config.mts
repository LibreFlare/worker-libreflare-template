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
			domain: string;
			routePrefix: string;
	  };

type LoggingConfig =
	| { managed: false }
	| {
			managed: true;
			apiUrl: string;
			sourceKey: string;
			varyByMonth: boolean;
			auth: boolean;
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
		wranglerConfig.routes = [
			{
				pattern: `*${config.worker.domain}${config.worker.routePrefix}/*`,
				zone_name: config.worker.domain,
			},
		];
		vars.WORKER_ROUTE_PREFIX = config.worker.routePrefix;
	}

	if (config.logging.managed) {
		vars.LOG_API_URL = config.logging.apiUrl;
		vars.LOG_SOURCE_KEY = config.logging.sourceKey;
		vars.LOG_VARY_BY_MONTH = config.logging.varyByMonth;

		if (config.logging.auth) {
			delete vars.LOG_API_AUTH_HEADERS_JSON;
			wranglerConfig.secrets = {
				...(isRecord(wranglerConfig.secrets) ? wranglerConfig.secrets : {}),
				required: uniqueStrings([
					...(requiredSecrets(wranglerConfig.secrets).filter((secret) => secret !== LOG_AUTH_HEADERS_BINDING)),
					LOG_AUTH_HEADERS_BINDING,
				]),
			};
		} else {
			vars.LOG_API_AUTH_HEADERS_JSON = '';
			const existingSecrets = isRecord(wranglerConfig.secrets) ? { ...wranglerConfig.secrets } : {};
			const required = requiredSecrets(existingSecrets).filter((secret) => secret !== LOG_AUTH_HEADERS_BINDING);
			if (required.length > 0) {
				existingSecrets.required = required;
				wranglerConfig.secrets = existingSecrets;
			} else {
				delete existingSecrets.required;
				wranglerConfig.secrets = Object.keys(existingSecrets).length > 0 ? existingSecrets : undefined;
			}
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
	};
}

function validateLibreflareConfig(config: LibreflareConfig): void {
	if (config.worker.managed) {
		if (!/^[A-Za-z0-9.-]+$/.test(config.worker.domain) || config.worker.domain.includes('..')) {
			throw new Error('worker.domain must be a plain domain name.');
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

function booleanValue(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
	return value;
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

function writeDeployConfig(configPath: string): void {
	mkdirSync(dirname(WRANGLER_DEPLOY_CONFIG_PATH), { recursive: true });
	writeFileSync(WRANGLER_DEPLOY_CONFIG_PATH, `${JSON.stringify({ configPath }, null, '\t')}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
