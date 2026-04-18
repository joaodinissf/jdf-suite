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
        navigator: 'readonly',
        setTimeout: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        Promise: 'readonly',
        Object: 'readonly',
        Array: 'readonly',
        fetch: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        JSON: 'readonly',
        String: 'readonly',
        Date: 'readonly',
        parseInt: 'readonly',
        TextDecoder: 'readonly'
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      // Relaxed rules for Chrome extension development
      'no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_|^(lexHost|getCurrentMode|AI_MODELS|DEFAULT_MODEL|EXPIRY_PRESETS|DEFAULT_EXPIRY|VALID_TAB_GROUP_COLORS|encodeKey|decodeKey|isKeyExpired|saveAiConfig|loadAiConfig|aiProposalReadyResolve|stripQueryParams|buildAiPrompt|callOpenRouter|parseAiResponse|handleAiGroupTabs|handleApplyAiProposal|aiOrganize|openAiSettings|updateAiButtonState|COLOR_MAP|handleMessage)$',
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
      sourceType: 'module',
      globals: {
        // Vitest globals
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
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
        eval: 'readonly',
        
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
        copyAllTabs: 'readonly',
        flattenWindow: 'readonly',
        updateStatusBar: 'readonly',
        formatTabsAsText: 'readonly',
        handleCopyAllTabs: 'readonly',
        updateContent: 'readonly',
        setupEventListeners: 'readonly',
        respond: 'readonly',
        encodeKey: 'readonly',
        decodeKey: 'readonly',
        isKeyExpired: 'readonly',
        buildAiPrompt: 'readonly',
        parseAiResponse: 'readonly',
        stripQueryParams: 'readonly',
        AI_MODELS: 'readonly',
        VALID_TAB_GROUP_COLORS: 'readonly',
        aiOrganize: 'readonly',
        openAiSettings: 'readonly',
        updateAiButtonState: 'readonly'
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