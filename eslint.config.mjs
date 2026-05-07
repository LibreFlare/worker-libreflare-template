import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
			// Allow _-prefixed names to signal intentionally unused parameters/vars.
			'@typescript-eslint/no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
				caughtErrorsIgnorePattern: '^_',
			}],
		},
	},
	{
		// Worker-generated config file - not our code.
		ignores: ['worker-configuration.d.ts'],
	},
);
