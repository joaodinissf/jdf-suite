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
});

describe('formatModelCost', () => {
  test('unknown / missing pricing', () => {
    expect(formatModelCost(null)).toBe('price unknown');
    expect(formatModelCost({})).toBe('price unknown');
    expect(formatModelCost({ prompt: 'nope' })).toBe('price unknown');
  });

  test('free and normal rates', () => {
    expect(formatModelCost({ prompt: '0' })).toBe('free');
    expect(formatModelCost({ prompt: '0.0000008' })).toBe('$0.800/M in');
    expect(formatModelCost({ prompt: '0.000001' })).toBe('$1.00/M in');
    expect(formatModelCost({ prompt: '0.000000001' })).toBe('$0.0010/M in');
  });
});

describe('normalizeOpenRouterModel', () => {
  test('returns null without id', () => {
    expect(normalizeOpenRouterModel(null)).toBeNull();
    expect(normalizeOpenRouterModel({})).toBeNull();
  });

  test('maps structured_outputs flag and pricing', () => {
    const m = normalizeOpenRouterModel({
      id: 'acme/model',
      name: 'Acme Model',
      pricing: { prompt: '0.000001' },
      supported_parameters: ['temperature', 'structured_outputs'],
    });
    expect(m).toEqual({
      id: 'acme/model',
      name: 'Acme Model',
      cost: '$1.00/M in',
      supportsStructuredOutputs: true,
      curated: false,
    });
  });

  test('structured_outputs false when only response_format is listed', () => {
    const m = normalizeOpenRouterModel({
      id: 'x/y',
      supported_parameters: ['response_format'],
    });
    expect(m.supportsStructuredOutputs).toBe(false);
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
      [MODELS_CACHE_KEY]: { models: cached, fetchedAt },
    });

    const result = await getOpenRouterModels({ forceRefresh: false });
    expect(result.fromCache).toBe(true);
    expect(result.fetchedAt).toBe(fetchedAt);
    expect(result.models.some((m) => m.id === 'cached/m')).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
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
            supported_parameters: ['structured_outputs'],
          },
        ],
      }),
    });

    const result = await getOpenRouterModels({ forceRefresh: true });
    expect(result.fromCache).toBe(false);
    expect(result.models.some((m) => m.id === 'new/m' && m.supportsStructuredOutputs)).toBe(true);
    expect(chrome.storage.local.set).toHaveBeenCalled();
  });

  test('falls back to stale cache on fetch error', async () => {
    const cached = [
      { id: 'stale/m', name: 'Stale', cost: 'free', supportsStructuredOutputs: false, curated: false },
    ];
    chrome.storage.local.get.mockResolvedValue({
      [MODELS_CACHE_KEY]: { models: cached, fetchedAt: Date.now() - MODELS_CACHE_TTL_MS - 1 },
    });
    global.fetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await getOpenRouterModels({ forceRefresh: true });
    expect(result.stale).toBe(true);
    expect(result.fromCache).toBe(true);
    expect(result.models.some((m) => m.id === 'stale/m')).toBe(true);
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

describe('modelSupportsStructuredOutputs', () => {
  beforeEach(() => {
    chrome.storage.local.get.mockReset();
  });

  test('reads flag from cache', async () => {
    chrome.storage.local.get.mockResolvedValue({
      [MODELS_CACHE_KEY]: {
        models: [
          { id: 'a/b', supportsStructuredOutputs: true },
          { id: 'c/d', supportsStructuredOutputs: false },
        ],
        fetchedAt: Date.now(),
      },
    });
    expect(await modelSupportsStructuredOutputs('a/b')).toBe(true);
    expect(await modelSupportsStructuredOutputs('c/d')).toBe(false);
    expect(await modelSupportsStructuredOutputs('missing/x')).toBe(false);
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
      useJsonSchema: true,
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
      useJsonSchema: true,
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
      callOpenRouter('k', 'm', [], null, { useJsonSchema: true, jsonSchema: schema })
    ).rejects.toThrow();

    expect(global.fetch).toHaveBeenCalledTimes(1);
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
      callOpenRouter('k', 'm', [], null, { useJsonSchema: true, jsonSchema: schema })
    ).rejects.toThrow('connection dropped mid-stream');

    // A retry here would append a second generation to chunks already on screen.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
