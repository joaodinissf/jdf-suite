// Unit tests for OpenRouter model catalog helpers and JSON schema builder.

describe('saveAiConfig key expiry', () => {
  const HOUR = 3600000;
  const DAY = 24 * HOUR;

  // Storage stub that echoes back whatever was last written.
  const withStored = (stored) => {
    let current = stored;
    chrome.storage.local.get.mockImplementation(async () => (
      current ? { aiConfig: current } : {}
    ));
    chrome.storage.local.set.mockImplementation(async ({ aiConfig }) => {
      current = aiConfig;
    });
    return () => current;
  };

  beforeEach(() => {
    chrome.storage.local.get.mockReset();
    chrome.storage.local.set.mockReset();
  });

  test('changing only the model keeps the existing expiry deadline', async () => {
    const expiresAt = Date.now() + 3 * HOUR; // 21h already elapsed on a 24h key
    withStored({
      key: encodeKey('sk-secret'),
      model: 'old/model',
      expiresAt,
      expiryDuration: DAY,
      setupComplete: true,
    });

    const saved = await saveAiConfig({
      key: 'sk-secret',
      model: 'new/model',
      expiryDuration: DAY,
    });

    expect(saved.model).toBe('new/model');
    // The countdown must not silently restart just because the model changed.
    expect(saved.expiresAt).toBe(expiresAt);
  });

  test('re-entering the same key after it expired restarts the countdown', async () => {
    withStored({
      key: encodeKey('sk-same'),
      model: 'm',
      expiresAt: Date.now() - HOUR, // expired an hour ago
      expiryDuration: DAY,
      setupComplete: true,
    });

    const saved = await saveAiConfig({ key: 'sk-same', model: 'm', expiryDuration: DAY });

    expect(isKeyExpired(saved)).toBe(false);
    expect(saved.expiresAt).toBeGreaterThan(Date.now() + DAY - 5000);
  });

  test('a new key restarts the countdown', async () => {
    withStored({
      key: encodeKey('sk-old'),
      model: 'm',
      expiresAt: Date.now() + 3 * HOUR,
      expiryDuration: DAY,
      setupComplete: true,
    });

    const saved = await saveAiConfig({ key: 'sk-new', model: 'm', expiryDuration: DAY });

    expect(saved.expiresAt).toBeGreaterThan(Date.now() + DAY - 5000);
  });

  test('choosing a different expiry policy restarts the countdown', async () => {
    withStored({
      key: encodeKey('sk-same'),
      model: 'm',
      expiresAt: Date.now() + 3 * HOUR,
      expiryDuration: DAY,
      setupComplete: true,
    });

    const saved = await saveAiConfig({ key: 'sk-same', model: 'm', expiryDuration: HOUR });

    expect(saved.expiryDuration).toBe(HOUR);
    expect(saved.expiresAt).toBeGreaterThan(Date.now() + HOUR - 5000);
    expect(saved.expiresAt).toBeLessThan(Date.now() + HOUR + 5000);
  });

  test('switching to never-expires clears the deadline', async () => {
    withStored({
      key: encodeKey('sk-same'),
      model: 'm',
      expiresAt: Date.now() + 3 * HOUR,
      expiryDuration: DAY,
      setupComplete: true,
    });

    const saved = await saveAiConfig({ key: 'sk-same', model: 'm', expiryDuration: null });

    expect(saved.expiresAt).toBeNull();
  });

  test('first-time setup sets a fresh deadline', async () => {
    withStored(null);

    const saved = await saveAiConfig({ key: 'sk-new', model: 'm', expiryDuration: DAY });

    expect(saved.expiresAt).toBeGreaterThan(Date.now() + DAY - 5000);
  });

  // The page sends NaN before its expiry select fills, and messaging turns
  // NaN into null; a missing duration is the same. None of these may become
  // a key that never expires.
  test.each([
    ['NaN', NaN],
    ['undefined', undefined],
    ['a string', ''],
  ])('an unparsable duration (%s) falls back to the 24 h default', async (_label, duration) => {
    withStored(null);

    const saved = await saveAiConfig({ key: 'sk-new', model: 'm', expiryDuration: duration });

    expect(saved.expiryDuration).toBe(DAY);
    expect(saved.expiresAt).toBeGreaterThan(Date.now() + DAY - 5000);
    expect(saved.expiresAt).toBeLessThan(Date.now() + DAY + 5000);
  });
});

describe('formatModelCost', () => {
  test('unknown / missing pricing', () => {
    expect(formatModelCost(null)).toBe('price unknown');
    expect(formatModelCost({})).toBe('price unknown');
    expect(formatModelCost({ prompt: 'nope' })).toBe('price unknown');
  });

  test('free means input and output both cost nothing', () => {
    expect(formatModelCost({ prompt: '0' })).toBe('free');
    expect(formatModelCost({ prompt: '0', completion: '0' })).toBe('free');
    // Paid output is not free, even with free input.
    expect(formatModelCost({ prompt: '0', completion: '0.00002' })).toBe('$0.00 in · $20.00 out per M');
  });

  test('shows input and output with consistent precision', () => {
    expect(formatModelCost({ prompt: '0.0000008', completion: '0.000004' })).toBe('$0.80 in · $4.00 out per M');
    expect(formatModelCost({ prompt: '0.00000075' })).toBe('$0.75 in per M');
    expect(formatModelCost({ prompt: '0.000000065', completion: '0.0000003' })).toBe('$0.07 in · $0.30 out per M');
    expect(formatModelCost({ prompt: '0.000000004' })).toBe('$0.0040 in per M');
    expect(formatModelCost({ prompt: '0.00000002' })).toBe('$0.02 in per M');
  });

  test('a negative price (a router) reads as variable, never as $-1000000', () => {
    expect(formatModelCost({ prompt: '-1', completion: '-1' })).toBe('variable price');
  });
});

describe('normalizeOpenRouterModel', () => {
  const TEXT_OUT = { input_modalities: ['text'], output_modalities: ['text'] };

  test('returns null without id', () => {
    expect(normalizeOpenRouterModel(null)).toBeNull();
    expect(normalizeOpenRouterModel({})).toBeNull();
  });

  test('maps structured_outputs flag and pricing', () => {
    const m = normalizeOpenRouterModel({
      id: 'acme/model',
      name: 'Acme Model',
      pricing: { prompt: '0.000001' },
      architecture: TEXT_OUT,
      supported_parameters: ['temperature', 'response_format', 'structured_outputs'],
    });
    expect(m).toEqual({
      id: 'acme/model',
      name: 'Acme Model',
      provider: 'Acme',
      cost: '$1.00 in per M',
      supportsStructuredOutputs: true,
      supportedParameters: ['temperature', 'response_format', 'structured_outputs'],
      curated: false,
    });
  });

  test('splits the provider prefix off the name', () => {
    const m = normalizeOpenRouterModel({
      id: 'openai/gpt-6-luna',
      name: 'OpenAI: GPT-6 Luna',
      architecture: TEXT_OUT,
      supported_parameters: ['response_format'],
    });
    expect(m.name).toBe('GPT-6 Luna');
    expect(m.provider).toBe('OpenAI');
  });

  test('structured_outputs false when only response_format is listed', () => {
    const m = normalizeOpenRouterModel({
      id: 'x/y',
      architecture: TEXT_OUT,
      supported_parameters: ['response_format'],
    });
    expect(m.supportsStructuredOutputs).toBe(false);
  });

  test('drops a model without response_format (it cannot answer in JSON)', () => {
    expect(normalizeOpenRouterModel({
      id: 'x/plain',
      architecture: TEXT_OUT,
      supported_parameters: ['temperature', 'structured_outputs'],
    })).toBeNull();
  });

  test('drops a model whose output is not text', () => {
    expect(normalizeOpenRouterModel({
      id: 'x/image-gen',
      architecture: { input_modalities: ['text'], output_modalities: ['image'] },
      supported_parameters: ['response_format'],
    })).toBeNull();
    // Older catalog shape.
    expect(normalizeOpenRouterModel({
      id: 'x/image-gen-old',
      architecture: { modality: 'text->image' },
      supported_parameters: ['response_format'],
    })).toBeNull();
    expect(normalizeOpenRouterModel({
      id: 'x/multi-old',
      architecture: { modality: 'text+image->text' },
      supported_parameters: ['response_format'],
    })).not.toBeNull();
    // No modality information at all: not known to emit text.
    expect(normalizeOpenRouterModel({
      id: 'x/unknown',
      supported_parameters: ['response_format'],
    })).toBeNull();
  });

  test.each([
    ['an id ending in :batch', 'acme/model:batch', 'Acme: Model (batch)'],
    ['an id ending in -batch', 'openai/gpt-6-luna-batch', 'GPT-6 Luna'],
    ['only the name saying (batch)', 'openai/gpt-5.6-luna-pro-b', 'GPT-5.6 Luna Pro (batch)'],
  ])('drops batch models: %s', (_label, id, name) => {
    expect(normalizeOpenRouterModel({
      id,
      name,
      architecture: TEXT_OUT,
      supported_parameters: ['response_format', 'structured_outputs'],
    })).toBeNull();
  });
});

describe('mergeModelsForPicker', () => {
  test('puts curated first and enriches from remote', () => {
    const remote = [
      {
        id: AI_MODELS[0].id,
        name: 'Remote Name',
        cost: '$9.99/M in',
        supportsStructuredOutputs: true,
        curated: false,
      },
      {
        id: 'other/model',
        name: 'Other',
        cost: 'free',
        supportsStructuredOutputs: false,
        curated: false,
      },
    ];
    const merged = mergeModelsForPicker(remote);
    expect(merged[0].id).toBe(AI_MODELS[0].id);
    expect(merged[0].curated).toBe(true);
    expect(merged[0].name).toBe(AI_MODELS[0].name); // curated display name wins
    expect(merged[0].supportsStructuredOutputs).toBe(true);
    expect(merged[0].cost).toBe('$9.99/M in');
    expect(merged.some((m) => m.id === 'other/model')).toBe(true);
    expect(merged.filter((m) => m.id === AI_MODELS[0].id)).toHaveLength(1);
  });

  test('leaves out batch-only ids, even from an older cache', () => {
    const merged = mergeModelsForPicker([
      { id: 'acme/model', name: 'Acme', cost: 'free', supportsStructuredOutputs: true, curated: false },
      { id: 'acme/model:batch', name: 'Acme (batch)', cost: 'free', supportsStructuredOutputs: true, curated: false },
    ]);
    const ids = merged.map((m) => m.id);
    expect(ids).toContain('acme/model');
    expect(ids).not.toContain('acme/model:batch');
  });

  test('with a live catalog, a curated model it does not list is not recommended', () => {
    const merged = mergeModelsForPicker([
      { id: AI_MODELS[0].id, name: 'Haiku', cost: 'free', supportsStructuredOutputs: true, curated: false },
      { id: 'other/model', name: 'Other', cost: 'free', supportsStructuredOutputs: false, curated: false },
    ]);
    expect(merged.map((m) => m.id)).toEqual([AI_MODELS[0].id, 'other/model']);
  });

  test('leaves out name-only batch variants from a cache', () => {
    const merged = mergeModelsForPicker([
      { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', cost: 'free' },
      { id: 'openai/gpt-6-luna-x', name: 'GPT-6 Luna (batch)', cost: 'free' },
    ]);
    expect(merged.map((m) => m.id)).toEqual(['openai/gpt-6-luna']);
  });

  test('works with empty remote (curated only)', () => {
    const merged = mergeModelsForPicker([]);
    expect(merged.length).toBe(AI_MODELS.length);
    expect(merged.every((m) => m.curated)).toBe(true);
  });
});

describe('getOpenRouterModels', () => {
  beforeEach(() => {
    chrome.storage.local.get.mockReset();
    chrome.storage.local.set.mockReset();
    global.fetch = vi.fn();
  });

  test('returns cached catalog when fresh', async () => {
    const cached = [
      { id: 'cached/m', name: 'Cached', cost: 'free', supportsStructuredOutputs: true, curated: false },
    ];
    const fetchedAt = Date.now() - 1000;
    chrome.storage.local.get.mockResolvedValue({
      [MODELS_CACHE_KEY]: { v: MODELS_CACHE_VERSION, models: cached, fetchedAt },
    });

    const result = await getOpenRouterModels({ forceRefresh: false });
    expect(result.fromCache).toBe(true);
    expect(result.fetchedAt).toBe(fetchedAt);
    expect(result.models.some((m) => m.id === 'cached/m')).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('ignores a cache an older build wrote (no version), and fetches', async () => {
    chrome.storage.local.get.mockResolvedValue({
      [MODELS_CACHE_KEY]: {
        models: [{ id: 'black-forest-labs/flux-luna', name: 'FLUX Luna', cost: 'free' }],
        fetchedAt: Date.now() - 1000,
      },
    });
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await getOpenRouterModels({ forceRefresh: false });
    expect(global.fetch).toHaveBeenCalled();
    expect(result.fallback).toBe(true);
    expect(result.error).toBe('couldn\'t reach OpenRouter');
    expect(result.models.map((m) => m.id)).not.toContain('black-forest-labs/flux-luna');
  });

  test('fetches and writes cache on miss', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    chrome.storage.local.set.mockResolvedValue(undefined);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'new/m',
            name: 'New',
            pricing: { prompt: '0' },
            architecture: { output_modalities: ['text'] },
            supported_parameters: ['response_format', 'structured_outputs'],
          },
          {
            id: 'new/m:batch',
            name: 'New (batch)',
            pricing: { prompt: '0' },
            architecture: { output_modalities: ['text'] },
            supported_parameters: ['response_format', 'structured_outputs'],
          },
          {
            id: 'new/no-json',
            name: 'No JSON',
            pricing: { prompt: '0' },
            architecture: { output_modalities: ['text'] },
            supported_parameters: ['temperature'],
          },
        ],
      }),
    });

    const result = await getOpenRouterModels({ forceRefresh: true });
    expect(result.fromCache).toBe(false);
    expect(result.models.some((m) => m.id === 'new/m' && m.supportsStructuredOutputs)).toBe(true);
    // Only models Huddle can use reach the picker (and the cache).
    expect(result.models.map((m) => m.id)).not.toContain('new/m:batch');
    expect(result.models.map((m) => m.id)).not.toContain('new/no-json');
    expect(chrome.storage.local.set).toHaveBeenCalled();
  });

  test('falls back to stale cache on fetch error', async () => {
    const cached = [
      { id: 'stale/m', name: 'Stale', cost: 'free', supportsStructuredOutputs: false, curated: false },
    ];
    chrome.storage.local.get.mockResolvedValue({
      [MODELS_CACHE_KEY]: { v: MODELS_CACHE_VERSION, models: cached, fetchedAt: Date.now() - MODELS_CACHE_TTL_MS - 1 },
    });
    global.fetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await getOpenRouterModels({ forceRefresh: true });
    expect(result.stale).toBe(true);
    expect(result.fromCache).toBe(true);
    expect(result.models.some((m) => m.id === 'stale/m')).toBe(true);
  });

  test('a catalog body cut off by the timeout reads as no answer, not as unreadable', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); },
    });
    const result = await getOpenRouterModels({ forceRefresh: true });
    expect(result.fallback).toBe(true);
    expect(result.error).toBe('OpenRouter didn\'t answer');
  });

  test('falls back to curated when no cache and fetch fails', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    global.fetch.mockRejectedValue(new Error('network down'));

    const result = await getOpenRouterModels({ forceRefresh: true });
    expect(result.fallback).toBe(true);
    expect(result.models.length).toBe(AI_MODELS.length);
    expect(result.models.every((m) => m.curated)).toBe(true);
  });
});

describe('modelInfo', () => {
  beforeEach(() => {
    chrome.storage.local.get.mockReset();
  });

  test('reads the structured-output flag from the cache', async () => {
    chrome.storage.local.get.mockResolvedValue({
      [MODELS_CACHE_KEY]: {
        v: MODELS_CACHE_VERSION,
        models: [
          { id: 'a/b', supportsStructuredOutputs: true },
          { id: 'c/d', supportsStructuredOutputs: false },
        ],
        fetchedAt: Date.now(),
      },
    });
    expect((await modelInfo('a/b')).supportsStructuredOutputs).toBe(true);
    expect((await modelInfo('c/d')).supportsStructuredOutputs).toBe(false);
    expect(await modelInfo('missing/x')).toMatchObject({ supportsStructuredOutputs: false, listed: false, catalogKnown: true });
  });
});

describe('buildTabGroupsJsonSchema', () => {
  test('includes color enum and tab id enum', () => {
    const schema = buildTabGroupsJsonSchema([10, 20, 30]);
    expect(schema.name).toBe('tab_groups');
    expect(schema.strict).toBe(true);
    expect(schema.schema.required).toContain('groups');
    const groupProps = schema.schema.properties.groups.items.properties;
    expect(groupProps.color.enum).toEqual(VALID_TAB_GROUP_COLORS);
    expect(groupProps.tabIds.items.enum).toEqual([10, 20, 30]);
  });

  test('empty tab list uses plain integer items', () => {
    const schema = buildTabGroupsJsonSchema([]);
    expect(schema.schema.properties.groups.items.properties.tabIds.items).toEqual({
      type: 'integer',
    });
  });
});

describe('buildOpenRouterRequestBody', () => {
  test('json_object by default', () => {
    const body = buildOpenRouterRequestBody('m', [], {});
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.provider).toBeUndefined();
    expect(body.stream).toBe(true);
  });

  test('json_schema when requested', () => {
    const jsonSchema = buildTabGroupsJsonSchema([1]);
    const body = buildOpenRouterRequestBody('m', [], {
      params: ['response_format', 'structured_outputs'],
      jsonSchema,
    });
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: jsonSchema,
    });
    expect(body.provider).toEqual({ require_parameters: true });
  });
});

describe('curated structured-output support is unknown, not false', () => {
  test('curated entries pass the flag through as undefined', () => {
    const entries = curatedModelsAsPickerEntries();
    // Guard the premise: none of the curated defaults declare the flag.
    expect(AI_MODELS.every((m) => m.supportsStructuredOutputs === undefined)).toBe(true);
    expect(entries.every((m) => m.supportsStructuredOutputs === undefined)).toBe(true);
  });

  test('merge leaves uncatalogued curated models unknown but takes catalog facts', () => {
    const uncatalogued = mergeModelsForPicker([]);
    expect(uncatalogued[0].supportsStructuredOutputs).toBeUndefined();

    const catalogued = mergeModelsForPicker([
      { id: AI_MODELS[0].id, name: 'R', cost: 'free', supportsStructuredOutputs: true },
    ]);
    expect(catalogued[0].supportsStructuredOutputs).toBe(true);
  });
});

describe('callOpenRouter schema fallback', () => {
  const schema = { name: 'tab_groups', strict: true, schema: {} };
  const STRICT = ['max_tokens', 'response_format', 'structured_outputs'];
  const sseResponse = (text) => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ choices: [{ message: { content: text } }] }),
  });

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  const bodyOf = (callIndex) => JSON.parse(global.fetch.mock.calls[callIndex][1].body);

  test('retries without the schema when the endpoint refuses the payload (400)', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce(sseResponse('{"groups":[]}'));

    const text = await callOpenRouter('k', 'm', [], null, {
      params: STRICT,
      jsonSchema: schema,
    });

    expect(text).toBe('{"groups":[]}');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(bodyOf(0).response_format.type).toBe('json_schema');
    expect(bodyOf(1).response_format).toEqual({ type: 'json_object' });
  });

  test.each([
    ['invalid key', 401],
    ['insufficient credits', 402],
    ['rate limited', 429],
  ])('does not retry on %s (%i) — the schema is not the problem', async (_label, status) => {
    global.fetch.mockResolvedValue({ ok: false, status });

    await expect(
      callOpenRouter('k', 'm', [], null, { params: STRICT, jsonSchema: schema })
    ).rejects.toThrow();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  const errorResponse = (status, message) => ({
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { code: status, message } }),
  });

  test('retries when the refusal is about the schema', async () => {
    global.fetch
      .mockResolvedValueOnce(errorResponse(404, 'No endpoints found that support the provided \'response_format\' parameter (json_schema).'))
      .mockResolvedValueOnce(sseResponse('{"groups":[]}'));
    await callOpenRouter('k', 'm', [], null, { params: STRICT, jsonSchema: schema });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['a batch model', 400, 'openai/x-batch is a batch model and cannot serve chat completions'],
    ['an unknown id', 400, 'acme/typo is not a valid model ID'],
    ['a context overflow', 400, 'This endpoint\'s maximum context length is 8192 tokens'],
  ])('retries %s once, then reports what OpenRouter said', async (_label, status, message) => {
    global.fetch.mockResolvedValue(errorResponse(status, message));
    await expect(
      callOpenRouter('k', 'm', [], null, { params: STRICT, jsonSchema: schema })
    ).rejects.toThrow(message.replace(/\.$/, ''));
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).provider).toBeUndefined();
  });

  test('does not re-request once the response is already streaming', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => {
        throw new Error('connection dropped mid-stream');
      },
    });

    await expect(
      callOpenRouter('k', 'm', [], null, { params: STRICT, jsonSchema: schema })
    ).rejects.toThrow(/isn't an API response/);

    // A retry here would append a second generation to chunks already on screen.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
