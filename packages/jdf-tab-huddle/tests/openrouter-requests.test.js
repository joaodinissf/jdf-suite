// What Huddle asks OpenRouter for, model by model, and what it does when
// OpenRouter finds no provider for that: requests built from the catalog's
// supported_parameters (never a temperature), one retry after a strict
// request whatever the refusal says, error copy that does not call a model
// unavailable when only the request was refused, and the recommended models
// checked against the live catalog.

import { organizeSender } from './senders.js';

// supported_parameters as OpenRouter's live catalog lists them (Sept 2026).
const LUNA_PARAMS = ['include_reasoning', 'max_completion_tokens', 'max_tokens', 'reasoning',
  'reasoning_effort', 'response_format', 'seed', 'structured_outputs', 'tool_choice', 'tools'];
const HAIKU_PARAMS = ['include_reasoning', 'max_completion_tokens', 'max_tokens', 'reasoning',
  'response_format', 'stop', 'structured_outputs', 'temperature', 'tool_choice', 'tools', 'top_k', 'top_p'];
const JSON_ONLY_PARAMS = ['response_format', 'temperature'];
// GPT-5.2 Codex and five other picker models cap output only this way.
const CODEX_PARAMS = ['include_reasoning', 'max_completion_tokens', 'reasoning', 'reasoning_effort',
  'response_format', 'seed', 'structured_outputs', 'tool_choice', 'tools'];

const HAIKU = 'anthropic/claude-haiku-4.5';
const DEEPSEEK = 'deepseek/deepseek-v4.1-flash';
const GEMINI = 'google/gemini-3.1-flash-lite';
const LUNA = 'openai/gpt-6-luna';

const schema = { name: 'tab_groups', strict: true, schema: {} };
const ROUTING_404 = 'No endpoints found that can handle the requested parameters. To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection';

// The parameters a body asks a provider to honor (what require_parameters
// checks), as OpenRouter counts them.
const NOT_PARAMETERS = new Set(['model', 'messages', 'stream', 'provider']);
const askedParameters = (body) => Object.keys(body).filter((k) => !NOT_PARAMETERS.has(k));

const okAnswer = (text) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }),
});
const errorAnswer = (status, message) => ({
  ok: false,
  status,
  text: async () => JSON.stringify({ error: { code: status, message } }),
});
const bodyOf = (i) => JSON.parse(global.fetch.mock.calls[i][1].body);

describe('the request follows the model\'s catalog capabilities', () => {
  test.each([
    ['GPT-6 Luna (no temperature)', LUNA_PARAMS],
    ['Claude Haiku 4.5', HAIKU_PARAMS],
    ['a JSON-only model', JSON_ONLY_PARAMS],
    ['a custom id the catalog does not know', null],
  ])('%s: never a temperature', (_label, params) => {
    const body = buildOpenRouterRequestBody('m', [], { params, jsonSchema: schema, maxTokens: 2000 });
    expect(body).not.toHaveProperty('temperature');
    expect(body.stream).toBe(true);
  });

  test('GPT-6 Luna: the exact schema on providers that honor it, and only parameters it takes', () => {
    const body = buildOpenRouterRequestBody(LUNA, [], { params: LUNA_PARAMS, jsonSchema: schema, maxTokens: 2000 });
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: schema });
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.max_tokens).toBe(2000);
    // What require_parameters checks: every asked parameter is one Luna lists.
    expect(askedParameters(body).filter((p) => !LUNA_PARAMS.includes(p))).toEqual([]);
  });

  test('Claude Haiku 4.5: the exact schema, require_parameters and max_tokens', () => {
    const body = buildOpenRouterRequestBody(HAIKU, [], { params: HAIKU_PARAMS, jsonSchema: schema, maxTokens: 2000 });
    expect(body).toMatchObject({
      response_format: { type: 'json_schema', json_schema: schema },
      provider: { require_parameters: true },
      max_tokens: 2000,
    });
  });

  test('a model with response_format but no structured outputs: json_object, any provider', () => {
    const body = buildOpenRouterRequestBody('x/y', [], { params: JSON_ONLY_PARAMS, jsonSchema: schema, maxTokens: 2000 });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.provider).toBeUndefined();
    // Not listed, so not sent: it would narrow the providers for nothing.
    expect(body).not.toHaveProperty('max_tokens');
  });

  test('a custom id with unknown capabilities: json_object and max_tokens, no require_parameters', () => {
    const body = buildOpenRouterRequestBody('acme/custom', [], { params: null, jsonSchema: schema, maxTokens: 2000 });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.provider).toBeUndefined();
    expect(body.max_tokens).toBe(2000);
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  // Uncapped, OpenRouter reserves credit for the model's whole output limit
  // (about $1.79 for GPT-5.2 Codex), which a small balance can't cover.
  test('a model that lists only max_completion_tokens is capped with it', () => {
    for (const strict of [true, false]) {
      const body = buildOpenRouterRequestBody('openai/gpt-5.2-codex', [], { params: CODEX_PARAMS, jsonSchema: schema, strict, maxTokens: 2000 });
      expect(body.max_completion_tokens).toBe(2000);
      expect(body).not.toHaveProperty('max_tokens');
    }
  });

  test('a known model that lists no response_format gets none, strict or not', () => {
    const params = ['max_tokens', 'temperature'];
    for (const strict of [true, false]) {
      const body = buildOpenRouterRequestBody('x/plain', [], { params, jsonSchema: schema, strict, maxTokens: 2000 });
      expect(body).not.toHaveProperty('response_format');
      expect(body.provider).toBeUndefined();
      expect(body.max_tokens).toBe(2000);
    }
  });

  test('the fallback request drops the schema and require_parameters', () => {
    const body = buildOpenRouterRequestBody(LUNA, [], { params: LUNA_PARAMS, jsonSchema: schema, strict: false, maxTokens: 2000 });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.provider).toBeUndefined();
    expect(body.max_tokens).toBe(2000);
  });

  test('the catalog entry keeps what the model accepts', () => {
    const m = normalizeOpenRouterModel({
      id: LUNA,
      name: 'OpenAI: GPT-6 Luna',
      architecture: { output_modalities: ['text'] },
      supported_parameters: LUNA_PARAMS,
    });
    expect(m.supportedParameters).toEqual(LUNA_PARAMS);
  });
});

// L24: with Settings' "Don't use providers that train on my prompts" on (the
// default), every request asks OpenRouter to skip providers that train on
// prompts; a refusal for that names the setting.
// OpenRouter's own texts (2026-10-04): with the request's deny, and from the
// account's privacy settings alone.
const DATA_POLICY_404 = 'No endpoints found matching your data policy (Paid model training). Configure: https://openrouter.ai/settings/privacy';
const ACCOUNT_POLICY_404 = '0 endpoints out of 1 requested are available matching your guardrail restrictions and data policy. '
  + 'We removed them for the following reasons (an endpoint may have matched multiple reasons):\n'
  + 'Paid model training violation (account settings): 1 endpoint excluded; configurable at https://openrouter.ai/settings/privacy';

describe('data collection: deny', () => {
  test('the strict request keeps require_parameters and adds data_collection', () => {
    const body = buildOpenRouterRequestBody(LUNA, [], { params: LUNA_PARAMS, jsonSchema: schema, maxTokens: 2000, denyDataCollection: true });
    expect(body.provider).toEqual({ require_parameters: true, data_collection: 'deny' });
    expect(body.response_format.type).toBe('json_schema');
  });

  test('the plain request carries it too', () => {
    for (const opts of [{ params: LUNA_PARAMS, strict: false }, { params: null }, { params: JSON_ONLY_PARAMS }]) {
      const body = buildOpenRouterRequestBody(LUNA, [], { ...opts, jsonSchema: schema, maxTokens: 2000, denyDataCollection: true });
      expect(body.provider).toEqual({ data_collection: 'deny' });
    }
  });

  test('off, the bodies are as before', () => {
    expect(buildOpenRouterRequestBody(LUNA, [], { params: LUNA_PARAMS, jsonSchema: schema, denyDataCollection: false }).provider)
      .toEqual({ require_parameters: true });
    expect(buildOpenRouterRequestBody(LUNA, [], { params: null, jsonSchema: schema }).provider).toBeUndefined();
  });

  test('the plain retry after a strict refusal keeps it', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(errorAnswer(404, ROUTING_404))
      .mockResolvedValueOnce(okAnswer('{"groups":[]}'));
    await callOpenRouter('k', LUNA, [], null, { params: LUNA_PARAMS, jsonSchema: schema, denyDataCollection: true });
    expect(bodyOf(0).provider).toEqual({ require_parameters: true, data_collection: 'deny' });
    expect(bodyOf(1).provider).toEqual({ data_collection: 'deny' });
  });

  test('no provider meets it: the error names the setting and OpenRouter\'s privacy settings, and Change model leads', async () => {
    global.fetch = vi.fn().mockResolvedValue(errorAnswer(404, DATA_POLICY_404));
    const error = await callOpenRouter('k', LUNA, [], null, {
      params: LUNA_PARAMS, jsonSchema: schema, denyDataCollection: true, ctx: { modelName: 'GPT-6 Luna' },
    }).catch((e) => e);
    expect(error.message).toBe('No provider for GPT-6 Luna meets your "Don\'t use providers that train on my prompts" setting '
      + 'or your OpenRouter privacy settings (404: '
      + 'No endpoints found matching your data policy (Paid model training). Configure: https://openrouter.ai/settings/privacy). '
      + 'Pick another model, or change either one.');
    expect(error).toMatchObject({ kind: 'model', retryable: false, status: 404 });
  });

  test('a 400 about the data policy names the setting too', () => {
    const error = mapOpenRouterHttpError(400, { message: DATA_POLICY_404 }, { modelName: 'GPT-6 Luna', denyDataCollection: true });
    expect(error.message).toMatch(/^No provider for GPT-6 Luna meets your "Don't use providers that train on my prompts" setting or your OpenRouter privacy settings \(400: /);
    expect(error).toMatchObject({ kind: 'model', retryable: false });
  });

  test('with the setting off, the account\'s own policy is named, not the setting or Huddle\'s request', () => {
    for (const said of [DATA_POLICY_404, ACCOUNT_POLICY_404]) {
      const error = mapOpenRouterHttpError(404, { message: said }, { modelName: 'GPT-6 Luna' });
      expect(error.message).toMatch(/^No provider for GPT-6 Luna meets your OpenRouter privacy settings \(404: /);
      expect(error.message).toMatch(/Pick another model, or change them at openrouter\.ai\/settings\/privacy\.$/);
      expect(error.message).not.toMatch(/train on my prompts|Huddle's request/);
      expect(error).toMatchObject({ kind: 'model', retryable: false });
    }
  });

  test('with the setting on, the account-settings refusal names both too', () => {
    const error = mapOpenRouterHttpError(404, { message: ACCOUNT_POLICY_404 }, { modelName: 'GPT-6 Luna', denyDataCollection: true });
    expect(error.message).toMatch(/^No provider for GPT-6 Luna meets your "Don't use providers that train on my prompts" setting or your OpenRouter privacy settings/);
  });

  test('a run sends it unless Settings turned it off', async () => {
    const TABS = [{ id: 20, url: 'https://x.com', title: 'X', pinned: false, groupId: -1 }];
    for (const [stored, expected] of [[undefined, 'deny'], [true, 'deny'], [false, undefined]]) {
      global.fetch = vi.fn().mockResolvedValue(okAnswer(JSON.stringify({ groups: [{ name: 'G', color: 'blue', tabIds: [20] }] })));
      chrome.storage.local.get.mockImplementation(async () => ({ aiConfig: { key: btoa('sk-or-test'), expiresAt: null, model: 'acme/custom', denyDataCollection: stored } }));
      chrome.storage.local.set.mockResolvedValue(undefined);
      chrome.tabs.query.mockResolvedValue(TABS);
      chrome.tabGroups.query.mockResolvedValue([]);
      chrome.windows.getCurrent.mockResolvedValue({ id: 1 });
      const posted = [];
      const listeners = [];
      chrome.runtime.onConnect.callListeners({
        name: 'huddle-ai-run',
        sender: { ...organizeSender, tab: { id: 10, windowId: 1 } },
        postMessage: (m) => posted.push(m),
        onMessage: { addListener: (fn) => listeners.push(fn) },
        onDisconnect: { addListener: () => {} },
      });
      listeners.forEach((fn) => fn({ type: 'start', protocol: AI_PROTOCOL, instructions: '', model: 'acme/custom', respectGroups: true }));
      await vi.waitFor(() => expect(posted.some((m) => m.type === 'ai-proposal')).toBe(true));
      const chat = global.fetch.mock.calls.find(([url]) => url.endsWith('/chat/completions'));
      expect(JSON.parse(chat[1].body).provider && JSON.parse(chat[1].body).provider.data_collection).toBe(expected);
    }
  });

  test('stored with the AI config: on by default, kept by a key save, set by a model save that says', async () => {
    let stored = null;
    chrome.storage.local.get.mockImplementation(async () => (stored ? { aiConfig: stored } : {}));
    chrome.storage.local.set.mockImplementation(async ({ aiConfig }) => { stored = aiConfig; });
    await saveAiConfig({ key: 'sk-or-a', expiryDuration: null });
    expect(stored.denyDataCollection).toBe(true);
    await saveAiDefaultModel(HAIKU, { denyDataCollection: false });
    expect(stored.denyDataCollection).toBe(false);
    await saveAiConfig({ key: 'sk-or-b', expiryDuration: null, renew: true });
    expect(stored.denyDataCollection).toBe(false);
    // The organize page's Make default sends no setting: it is kept.
    await saveAiDefaultModel(GEMINI);
    expect(stored.denyDataCollection).toBe(false);
    await saveAiDefaultModel(GEMINI, { denyDataCollection: true });
    expect(stored.denyDataCollection).toBe(true);
  });
});

describe('a strict request OpenRouter refuses is retried once, whatever it says', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  test.each([
    [404, ROUTING_404],
    [400, 'Provider returned error'],
    [422, 'Something OpenRouter has never said before'],
    [501, ''],
  ])('%i "%s": retried with json_object on any provider', async (status, message) => {
    global.fetch
      .mockResolvedValueOnce(errorAnswer(status, message))
      .mockResolvedValueOnce(okAnswer('{"groups":[]}'));
    const text = await callOpenRouter('k', LUNA, [], null, { params: LUNA_PARAMS, jsonSchema: schema, maxTokens: 2000 });
    expect(text).toBe('{"groups":[]}');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(bodyOf(0).provider).toEqual({ require_parameters: true });
    expect(bodyOf(1).response_format).toEqual({ type: 'json_object' });
    expect(bodyOf(1).provider).toBeUndefined();
    expect(bodyOf(1)).not.toHaveProperty('temperature');
  });

  test.each([401, 402, 429])('%i is about the account: never retried', async (status) => {
    global.fetch.mockResolvedValue(errorAnswer(status, ROUTING_404));
    await expect(callOpenRouter('k', LUNA, [], null, { params: LUNA_PARAMS, jsonSchema: schema }))
      .rejects.toMatchObject({ status });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('a plain request has nothing to fall back to: not retried', async () => {
    global.fetch.mockResolvedValue(errorAnswer(404, ROUTING_404));
    await expect(callOpenRouter('k', 'acme/custom', [], null, { params: null, jsonSchema: schema }))
      .rejects.toMatchObject({ status: 404 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('the error says what OpenRouter refused', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  test('no provider after the fallback: says so and what Huddle tried, not that the model is gone', async () => {
    global.fetch.mockResolvedValue(errorAnswer(404, ROUTING_404));
    const error = await callOpenRouter('k', LUNA, [], null, {
      params: LUNA_PARAMS, jsonSchema: schema, ctx: { modelName: 'GPT-6 Luna' },
    }).catch((e) => e);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(error.message).not.toMatch(/isn't available/);
    expect(error.message).toMatch(/^OpenRouter found no provider that can run GPT-6 Luna with Huddle's request \(404: No endpoints found that can handle the requested parameters/);
    expect(error.message).toContain('Huddle asked for its exact JSON answer format, then for any JSON answer.');
    expect(error).toMatchObject({ kind: 'model', retryable: false });
  });

  test('a 400 about parameters on a plain request names only the JSON answer', async () => {
    global.fetch.mockResolvedValue(errorAnswer(400, 'Unsupported parameter: response_format'));
    const error = await callOpenRouter('k', 'acme/custom', [], null, { params: null }).catch((e) => e);
    expect(error.message).toMatch(/^OpenRouter found no provider that can run acme\/custom/);
    expect(error.message).toContain('Huddle asked for a JSON answer.');
  });

  test('a model with no endpoints at all is still called unavailable', () => {
    const error = mapOpenRouterHttpError(404, { message: 'No endpoints found for acme/retired.' }, { modelName: 'Retired' });
    expect(error.message).toMatch(/^Retired isn't available on OpenRouter right now/);
  });
});

describe('recommended models', () => {
  // DeepSeek V4.1 Flash left the list: its only provider trains on prompts.
  test('Claude Haiku 4.5 (the default), Gemini 3.1 Flash Lite, GPT-6 Luna', () => {
    expect(AI_MODELS.map((m) => [m.id, m.name])).toEqual([
      [HAIKU, 'Claude Haiku 4.5'],
      [GEMINI, 'Gemini 3.1 Flash Lite'],
      [LUNA, 'GPT-6 Luna'],
    ]);
    expect(DEFAULT_MODEL).toBe(HAIKU);
  });

  test('offline prices are the catalog\'s', () => {
    expect(AI_MODELS.map((m) => formatModelCost(m.pricing))).toEqual([
      '$1.00 in · $5.00 out per M',
      '$0.25 in · $1.50 out per M',
      '$0.10 in · $0.50 out per M',
    ]);
  });

  test('with a catalog, a recommended model it lacks is not offered', () => {
    const merged = mergeModelsForPicker([
      { id: LUNA, name: 'GPT-6 Luna', cost: 'x' },
      { id: HAIKU, name: 'Claude Haiku 4.5', cost: 'x' },
      { id: 'other/m', name: 'Other', cost: 'x' },
    ]);
    expect(merged.filter((m) => m.curated).map((m) => m.id)).toEqual([HAIKU, LUNA]);
  });

  test('offline, every recommended model is offered', () => {
    expect(mergeModelsForPicker([]).map((m) => m.id)).toEqual(AI_MODELS.map((m) => m.id));
  });
});

describe('maxTokensForTabs', () => {
  test('2000 tokens, plus 100 per tab, capped at 16000', () => {
    expect(maxTokensForTabs(0)).toBe(2000);
    expect(maxTokensForTabs(10)).toBe(3000);
    expect(maxTokensForTabs(200)).toBe(16000);
  });
});

describe('resolveDefaultModel', () => {
  const catalog = (...ids) => new Set(ids);

  test('a listed default is used', () => {
    expect(resolveDefaultModel({ model: LUNA }, catalog(HAIKU, LUNA))).toMatchObject({ model: LUNA, missing: null });
  });

  test('a saved default the catalog dropped gives way to the first recommended model listed', () => {
    expect(resolveDefaultModel({ model: 'qwen/qwen3.5-flash-20260224' }, catalog(HAIKU, DEEPSEEK)))
      .toEqual({ model: HAIKU, missing: 'qwen/qwen3.5-flash-20260224', mine: true });
  });

  test('Huddle\'s own default gone: the next recommended model', () => {
    expect(resolveDefaultModel(null, catalog(LUNA, GEMINI, DEEPSEEK)))
      .toEqual({ model: GEMINI, missing: HAIKU, mine: false });
  });

  test('no catalog: kept as it is', () => {
    expect(resolveDefaultModel({ model: 'qwen/qwen3.5-flash-20260224' }, null))
      .toMatchObject({ model: 'qwen/qwen3.5-flash-20260224', missing: null });
  });

  test('an id the user kept although it was unlisted stays', () => {
    expect(resolveDefaultModel({ model: 'acme/private', unlistedModel: 'acme/private' }, catalog(HAIKU)))
      .toMatchObject({ model: 'acme/private', missing: null });
  });

  test('saving a default with allowUnlisted marks it kept; a listed save clears it', async () => {
    let stored = null;
    chrome.storage.local.get.mockImplementation(async () => (stored ? { aiConfig: stored } : {}));
    chrome.storage.local.set.mockImplementation(async ({ aiConfig }) => { stored = aiConfig; });
    await saveAiDefaultModel('acme/private', { allowUnlisted: true });
    expect(stored.unlistedModel).toBe('acme/private');
    await saveAiDefaultModel(HAIKU);
    expect(stored.unlistedModel).toBeNull();
  });

  test('saving a new key keeps a confirmed unlisted default; a different model clears it', async () => {
    let stored = { key: btoa('sk-or-old'), model: 'acme/private', unlistedModel: 'acme/private', expiresAt: null, expiryDuration: null };
    chrome.storage.local.get.mockImplementation(async () => ({ aiConfig: stored }));
    chrome.storage.local.set.mockImplementation(async ({ aiConfig }) => { stored = aiConfig; });
    // The organize page's inline key form sends no model.
    await saveAiConfig({ key: 'sk-or-new', expiryDuration: null, renew: true });
    expect(stored).toMatchObject({ model: 'acme/private', unlistedModel: 'acme/private' });
    await saveAiConfig({ key: 'sk-or-new', model: HAIKU, expiryDuration: null });
    expect(stored).toMatchObject({ model: HAIKU, unlistedModel: null });
  });
});

describe('a run builds its request from the cached catalog', () => {
  const TABS = [
    { id: 20, url: 'https://x.com', title: 'X', pinned: false, groupId: -1 },
    { id: 21, url: 'https://y.com', title: 'Y', pinned: false, groupId: -1 },
  ];
  const entry = (id, params) => ({ id, name: id, cost: 'x', supportsStructuredOutputs: params.includes('structured_outputs'), supportedParameters: params });
  let aiConfig;
  let cacheModels;

  function makePort() {
    const onMessage = [];
    const port = {
      name: 'huddle-ai-run',
      sender: { ...organizeSender, tab: { id: 10, windowId: 1 } },
      postMessage: vi.fn(),
      onMessage: { addListener: (fn) => onMessage.push(fn) },
      onDisconnect: { addListener: () => {} },
      send: (msg) => onMessage.forEach((fn) => fn(msg)),
      posted: () => port.postMessage.mock.calls.map((c) => c[0]),
    };
    chrome.runtime.onConnect.callListeners(port);
    return port;
  }

  async function run(model = null) {
    const port = makePort();
    port.send({ type: 'start', protocol: AI_PROTOCOL, instructions: '', model, respectGroups: true });
    await vi.waitFor(() => expect(port.posted().some((m) => m.type === 'ai-proposal' || m.type === 'ai-error')).toBe(true));
    return port;
  }

  beforeEach(() => {
    aiConfig = { key: btoa('sk-or-test'), expiresAt: null, model: LUNA };
    cacheModels = [entry(HAIKU, HAIKU_PARAMS), entry(DEEPSEEK, HAIKU_PARAMS), entry(LUNA, LUNA_PARAMS)];
    chrome.storage.local.get.mockImplementation(async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      if (list.includes('aiConfig')) out.aiConfig = aiConfig;
      if (list.includes(MODELS_CACHE_KEY)) out[MODELS_CACHE_KEY] = { v: MODELS_CACHE_VERSION, models: cacheModels, fetchedAt: Date.now() };
      return out;
    });
    chrome.storage.local.set.mockResolvedValue(undefined);
    chrome.tabs.query.mockResolvedValue(TABS);
    chrome.tabGroups.query.mockResolvedValue([]);
    chrome.windows.getCurrent.mockResolvedValue({ id: 1 });
    global.fetch = vi.fn().mockResolvedValue(okAnswer(JSON.stringify({ groups: [{ name: 'G', color: 'blue', tabIds: [20, 21] }] })));
  });

  test('GPT-6 Luna reaches a proposal with a request its providers take', async () => {
    const port = await run();
    expect(port.posted().at(-1).type).toBe('ai-proposal');
    const body = bodyOf(0);
    expect(body.model).toBe(LUNA);
    expect(body).not.toHaveProperty('temperature');
    expect(body.response_format.type).toBe('json_schema');
    // The Settings checkbox is on until turned off.
    expect(body.provider).toEqual({ require_parameters: true, data_collection: 'deny' });
  });

  test('a saved default the catalog dropped runs with the first recommended model listed', async () => {
    aiConfig = { ...aiConfig, model: 'qwen/qwen3.5-flash-20260224' };
    const port = await run();
    expect(bodyOf(0).model).toBe(HAIKU);
    expect(port.posted().at(-1)).toMatchObject({ type: 'ai-proposal', model: HAIKU });
  });

  test('a model picked for the run is used as it is', async () => {
    aiConfig = { ...aiConfig, model: 'qwen/qwen3.5-flash-20260224' };
    await run('acme/custom');
    expect(bodyOf(0).model).toBe('acme/custom');
    expect(bodyOf(0).response_format).toEqual({ type: 'json_object' });
    expect(bodyOf(0).provider).toEqual({ data_collection: 'deny' });
  });
});
