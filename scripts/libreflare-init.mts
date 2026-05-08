import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { applyEdits, modify, parse, type FormattingOptions, type JSONPath, type ParseError } from 'jsonc-parser';
import { Project, QuoteKind } from 'ts-morph';

const DEFAULT_RULES_CONFIG_PATH = 'libreflare.rules.yaml';
const INDEX_SOURCE_PATH = 'src/index.ts';
const WRANGLER_CONFIG_PATH = 'wrangler.jsonc';

interface InitializationInput {
	requestId: string;
	projectName: string;
	workerName: string;
	domainName: string;
	workerRoutePrefix: string;
	rulesConfigPath: string;
	rulesImport: string;
	expression: string;
	logApiUrl: string;
	logSourceKey: string;
	logVaryByMonth: boolean;
}

const input = readInput();
updateWranglerConfig(input);
updateWorkerSource(input);
writeRulesConfig(input);

function readInput(): InitializationInput {
	const requestId = requiredEnv('LIBREFLARE_REQUEST_ID');
	const projectName = requiredEnv('LIBREFLARE_PROJECT_NAME');
	const workerName = requiredEnv('LIBREFLARE_WORKER_NAME');
	const domainName = requiredEnv('LIBREFLARE_DOMAIN_NAME');
	const workerRoutePrefix = requiredEnv('LIBREFLARE_WORKER_ROUTE_PREFIX');
	const rulesConfigPath = normalizeRulesConfigPath(requiredEnv('LIBREFLARE_RULES_CONFIG_PATH'));
	const expression = requiredEnv('LIBREFLARE_INITIAL_RULE_EXPRESSION');
	const logApiUrl = normalizeLogApiUrl(requiredEnv('LIBREFLARE_LOG_API_URL'));
	const logSourceKey = requiredEnv('LIBREFLARE_LOG_SOURCE_KEY');
	const logVaryByMonth = parseBooleanEnv('LIBREFLARE_LOG_VARY_BY_MONTH', true);

	if (!/^[A-Za-z0-9._-]+$/.test(requestId)) {
		throw new Error('LIBREFLARE_REQUEST_ID may only contain letters, numbers, dots, underscores, and hyphens.');
	}
	if (!projectName) throw new Error('LIBREFLARE_PROJECT_NAME is required.');
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(workerName)) {
		throw new Error('LIBREFLARE_WORKER_NAME must start with a letter or number and may only contain letters, numbers, underscores, and hyphens.');
	}
	if (!/^[A-Za-z0-9.-]+$/.test(domainName) || domainName.includes('..')) {
		throw new Error('LIBREFLARE_DOMAIN_NAME must be a plain domain name.');
	}
	if (!workerRoutePrefix.startsWith('/') || workerRoutePrefix === '/' || workerRoutePrefix.endsWith('/')) {
		throw new Error('LIBREFLARE_WORKER_ROUTE_PREFIX must start with / and must not be / or end with /.');
	}

	return {
		requestId,
		projectName,
		workerName,
		domainName,
		workerRoutePrefix,
		rulesConfigPath,
		rulesImport: rulesConfigPath.startsWith('src/') ? `./${rulesConfigPath.slice(4)}` : `../${rulesConfigPath}`,
		expression,
		logApiUrl,
		logSourceKey,
		logVaryByMonth,
	};
}

function updateWranglerConfig({
	domainName,
	logApiUrl,
	logSourceKey,
	logVaryByMonth,
	workerName,
	workerRoutePrefix,
}: InitializationInput): void {
	let source = readFileSync(WRANGLER_CONFIG_PATH, 'utf8');
	let config = parseJsoncObject(source, WRANGLER_CONFIG_PATH);
	if (!Array.isArray(config.routes) || !isPlainObject(config.routes[0])) {
		source = setJsoncValue(source, ['routes'], [{}]);
		config = parseJsoncObject(source, WRANGLER_CONFIG_PATH);
	}
	if (!isPlainObject(config.vars)) {
		source = setJsoncValue(source, ['vars'], {});
	}

	source = setJsoncValue(source, ['name'], workerName);
	source = setJsoncValue(source, ['routes', 0, 'pattern'], `*${domainName}${workerRoutePrefix}/*`);
	source = setJsoncValue(source, ['routes', 0, 'zone_name'], domainName);
	source = setJsoncValue(source, ['vars', 'WORKER_ROUTE_PREFIX'], workerRoutePrefix);
	source = setJsoncValue(source, ['vars', 'LOG_API_URL'], logApiUrl);
	source = setJsoncValue(source, ['vars', 'LOG_SOURCE_KEY'], logSourceKey);
	source = setJsoncValue(source, ['vars', 'LOG_VARY_BY_MONTH'], logVaryByMonth);
	writeFileSync(WRANGLER_CONFIG_PATH, source);
}

function updateWorkerSource({ rulesImport }: InitializationInput): void {
	const project = new Project({
		manipulationSettings: { quoteKind: QuoteKind.Single },
		skipAddingFilesFromTsConfig: true,
	});
	const sourceFile = project.addSourceFileAtPath(INDEX_SOURCE_PATH);
	const rulesImportDeclaration = sourceFile
		.getImportDeclarations()
		.find((declaration) => declaration.getDefaultImport()?.getText() === 'rulesConfig');
	if (!rulesImportDeclaration) throw new Error(`${INDEX_SOURCE_PATH} must import rulesConfig.`);
	rulesImportDeclaration.setModuleSpecifier(rulesImport);

	sourceFile.saveSync();
}

function writeRulesConfig({ expression, rulesConfigPath }: InitializationInput): void {
	const parent = dirname(rulesConfigPath);
	if (parent !== '.') mkdirSync(parent, { recursive: true });
	writeFileSync(rulesConfigPath, `version: 1\nexpression: ${JSON.stringify(expression)}\n`);
	if (rulesConfigPath !== DEFAULT_RULES_CONFIG_PATH && existsSync(DEFAULT_RULES_CONFIG_PATH)) {
		rmSync(DEFAULT_RULES_CONFIG_PATH);
	}
}

function setJsoncValue(source: string, path: JSONPath, value: unknown): string {
	const edits = modify(source, path, value, {
		formattingOptions: formattingOptionsFor(source),
	});
	return applyEdits(source, edits);
}

function parseJsoncObject(source: string, path: string): Record<string, unknown> {
	const errors: ParseError[] = [];
	const parsed = parse(source, errors, { allowTrailingComma: true, disallowComments: false });
	if (errors.length > 0) throw new Error(`${path} contains invalid JSONC.`);
	if (!isPlainObject(parsed)) throw new Error(`${path} must contain a JSON object.`);
	return parsed;
}

function formattingOptionsFor(source: string): FormattingOptions {
	return {
		eol: source.includes('\r\n') ? '\r\n' : '\n',
		insertSpaces: !source.includes('\t'),
		tabSize: source.includes('\t') ? 1 : 2,
	};
}

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim() ?? '';
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

function normalizeRulesConfigPath(value: string): string {
	const path = value.trim();
	const segments = path.split('/');
	if (
		path.startsWith('/') ||
		path.endsWith('/') ||
		path.includes('\\') ||
		segments.some((segment) => !segment || segment === '.' || segment === '..') ||
		!/\.(yaml|yml)$/i.test(path)
	) {
		throw new Error('LIBREFLARE_RULES_CONFIG_PATH must be a relative .yaml or .yml path without dot segments.');
	}
	return path;
}

function normalizeLogApiUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error('LIBREFLARE_LOG_API_URL must be an absolute http or https URL.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('LIBREFLARE_LOG_API_URL must be an absolute http or https URL.');
	}
	return url.toString();
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
	const raw = process.env[name];
	if (raw === undefined || raw === '') return defaultValue;
	const value = raw.trim().toLowerCase();
	if (value === 'true') return true;
	if (value === 'false') return false;
	throw new Error(`${name} must be true or false.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
