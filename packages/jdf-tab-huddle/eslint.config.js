import js from '@eslint/js';

export default [
  {
    files: ['src/**/*.js'],
    ignores: ['node_modules/**', 'tests/**', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        chrome: 'readonly',
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        Map: 'readonly',
        Promise: 'readonly',
        Object: 'readonly',
        Array: 'readonly'
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      // Relaxed rules for Chrome extension development
      'no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_|^(lexHost|getCurrentMode)$', // Allow intentionally unused functions
        caughtErrorsIgnorePattern: '^_' // Ignore unused error parameters prefixed with _
      }],
      'no-console': 'off', // Console is used for debugging in extensions
      'no-undef': 'error',
      'semi': ['error', 'always'],
      'quotes': ['warn', 'single', { allowTemplateLiterals: true }]
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        // Jest globals
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
        global: 'writable',
        
        // Chrome extension globals
        chrome: 'readonly',
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        Map: 'readonly',
        Promise: 'readonly',
        Object: 'readonly',
        Array: 'readonly',
        
        // Node.js globals for test setup
        require: 'readonly',
        eval: 'readonly',
        __dirname: 'readonly',
        
        // Extension functions (loaded by setup.js)
        lexHost: 'readonly',
        getTabGroupsInfo: 'readonly',
        getTabsWithGroupInfo: 'readonly',
        findDuplicateTabs: 'readonly',
        analyzeDomainDistribution: 'readonly',
        getCurrentMode: 'readonly',
        saveUserPreference: 'readonly',
        loadUserPreferences: 'readonly',
        sortAllWindows: 'readonly',
        sortCurrentWindow: 'readonly',
        extractDomain: 'readonly',
        removeDuplicatesWindow: 'readonly',
        removeDuplicatesAllWindows: 'readonly',
        removeDuplicatesGlobally: 'readonly',
        extractAllDomains: 'readonly',
        moveAllToSingleWindow: 'readonly',
        updateContent: 'readonly',
        setupEventListeners: 'readonly',
        respond: 'readonly'
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off', // Tests often have variables for demonstration
      'no-undef': 'error',
      'no-console': 'off'
    }
  }
];