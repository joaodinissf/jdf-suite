// Background service worker for persistent logging
console.log('Huddle service worker starting...');

// ============================================================
// AI Tab Grouping — Constants and Helpers
// ============================================================

// Bumped whenever the messages between the organize page and this worker
// change shape. Must equal HuddleAi.PROTOCOL in ai-config.js: Chrome keeps
// running an unpacked extension's old worker after its files change on disk
// (a git checkout), while pages load the new files, and the page uses this
// number to say "reload Huddle" instead of failing in odd ways.
const AI_PROTOCOL = 2;
// The organize page runs organize over a port with this name (see onConnect).
const AI_RUN_PORT = 'huddle-ai-run';
const APP_TITLE = 'Huddle';
const OPENROUTER_API = 'https://openrouter.ai/api/v1';

// Curated defaults, in the order the picker recommends them; the first is the
// default model. Offered while the live catalog lists them, and on their own
// when the catalog cannot be loaded. Prices are OpenRouter's, per token, and
// only used offline; the catalog's own prices win.
const AI_MODELS = [
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', provider: 'Anthropic',
    pricing: { prompt: '0.000001', completion: '0.000005' } },
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', provider: 'DeepSeek',
    pricing: { prompt: '0.0000003', completion: '0.0000012' } },
  { id: 'google/gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', provider: 'Google',
    pricing: { prompt: '0.00000025', completion: '0.0000015' } },
  { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', provider: 'OpenAI',
    pricing: { prompt: '0.0000001', completion: '0.0000005' } },
];
const DEFAULT_MODEL = AI_MODELS[0].id;

const EXPIRY_PRESETS = [
  { label: '1 hour', value: 3600000 },
  { label: '24 hours', value: 86400000 },
  { label: '7 days', value: 604800000 },
  { label: '30 days', value: 2592000000 },
  { label: 'Never expires', value: null },
];
const DEFAULT_EXPIRY = 86400000; // 24 hours
const AI_KEY_ALARM = 'huddle-ai-key-expiry';

const VALID_TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

// OpenRouter model catalog cache (chrome.storage.local). The version changes
// whenever the rules for which models Huddle keeps change, so a cache an
// older build wrote (with image, batch or no-JSON models in it, or without
// each model's supported parameters) is dropped.
const MODELS_CACHE_KEY = 'openRouterModelsCache';
const MODELS_CACHE_VERSION = 4;
const MODELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MODELS_FETCH_TIMEOUT_MS = 10000;

// A chat request that sends nothing back for this long is given up on.
const CHAT_FIRST_BYTE_TIMEOUT_MS = 60000;
const CHAT_IDLE_TIMEOUT_MS = 45000;

// Dollars per million tokens, always with cents ($15.00, $1.50, $0.07, $0.00),
// and two significant digits below a cent ($0.0040).
function formatPerMillion(perToken) {
  // Rounded first: 0.0000001 * 1e6 is 0.09999999999999999.
  const v = Number((perToken * 1e6).toPrecision(6));
  if (v === 0 || v >= 0.01) return v.toFixed(2);
  return v.toPrecision(2);
}

// "$1.00 in · $5.00 out per M", "free" (input and output both cost nothing)
// or "variable price" (OpenRouter's -1 for routers that pick a model).
function formatModelCost(pricing) {
  if (!pricing) return 'price unknown';
  const read = (v) => (v == null || v === '' ? null : Number(v));
  const prompt = read(pricing.prompt);
  const completion = read(pricing.completion);
  const known = [prompt, completion].filter((v) => v !== null && Number.isFinite(v));
  if (known.length === 0) return 'price unknown';
  if (known.some((v) => v < 0)) return 'variable price';
  if (known.every((v) => v === 0)) return 'free';
  const parts = [];
  if (prompt !== null && Number.isFinite(prompt)) parts.push(`$${formatPerMillion(prompt)} in`);
  if (completion !== null && Number.isFinite(completion)) parts.push(`$${formatPerMillion(completion)} out`);
  return `${parts.join(' · ')} per M`;
}

// Batch-only variants cannot answer a chat request. OpenRouter marks them in
// the id (":batch", "-batch") or only in the name ("GPT-6 Luna (batch)").
function isBatchModel(model) {
  if (!model) return false;
  const id = typeof model === 'string' ? model : model.id;
  const name = typeof model === 'string' ? '' : (model.name || '');
  return (typeof id === 'string' && /[:-]batch$/i.test(id)) || /\(batch\)/i.test(name);
}

// How providers write their own names, for ids whose model name has no
// "Provider:" prefix. Any other slug gets a capital first letter.
const PROVIDER_NAMES = {
  openrouter: 'OpenRouter', openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google',
  'meta-llama': 'Meta', mistralai: 'Mistral', deepseek: 'DeepSeek', qwen: 'Qwen',
  'x-ai': 'xAI', 'z-ai': 'Z.ai', nousresearch: 'Nous Research', sao10k: 'Sao10K',
  moonshotai: 'MoonshotAI', cohere: 'Cohere', microsoft: 'Microsoft', amazon: 'Amazon',
};

function providerFromId(id) {
  if (typeof id !== 'string' || !id.includes('/')) return '';
  const slug = id.split('/')[0];
  return PROVIDER_NAMES[slug.toLowerCase()] || (slug.charAt(0).toUpperCase() + slug.slice(1));
}

// "OpenAI: GPT-6 Luna" -> { name: 'GPT-6 Luna', provider: 'OpenAI' }. Names
// without a prefix take the provider from the id ("openrouter/auto" ->
// "OpenRouter").
function splitModelName(rawName, id) {
  const fallbackProvider = providerFromId(id);
  const name = (rawName || id || '').trim();
  const m = /^([^:/]{1,40}):\s+(.+)$/.exec(name);
  if (m) return { name: m[2].trim(), provider: m[1].trim() };
  return { name, provider: fallbackProvider };
}

// Huddle needs a text reply in JSON, so a model must emit text and accept
// response_format. Models the catalog says cannot do both are left out.
function canHuddleUseModel(raw) {
  if (!raw || isBatchModel(raw)) return false;
  const params = raw.supported_parameters || [];
  if (!params.includes('response_format')) return false;
  const arch = raw.architecture || {};
  if (Array.isArray(arch.output_modalities)) return arch.output_modalities.includes('text');
  // Older catalog shape: "text+image->text".
  if (typeof arch.modality === 'string') {
    const output = arch.modality.split('->')[1] || '';
    return output.split('+').includes('text');
  }
  return false;
}

function normalizeOpenRouterModel(raw) {
  if (!raw || !raw.id) return null;
  if (!canHuddleUseModel(raw)) return null;
  const params = raw.supported_parameters || [];
  const { name, provider } = splitModelName(raw.name, raw.id);
  return {
    id: raw.id,
    name,
    provider,
    cost: formatModelCost(raw.pricing),
    supportsStructuredOutputs: params.includes('structured_outputs'),
    // What the model accepts, so a request only carries parameters some
    // provider of it takes (see buildOpenRouterRequestBody).
    supportedParameters: params.filter((p) => typeof p === 'string'),
    curated: false,
  };
}

// The curated entries on their own (no catalog): the structured-output flag
// stays undefined so the UI can say "unknown" rather than a wrong "no".
function curatedModelsAsPickerEntries() {
  return AI_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    cost: formatModelCost(m.pricing),
    supportsStructuredOutputs: undefined,
    curated: true,
  }));
}

// With a live catalog, a curated model is recommended only while the catalog
// lists it (and so passed canHuddleUseModel), with the catalog's facts. Only
// with no catalog at all do the hardcoded entries stand in.
function mergeModelsForPicker(remoteModels) {
  const remote = (Array.isArray(remoteModels) ? remoteModels : [])
    .filter((m) => m && m.id && !isBatchModel(m));
  if (remote.length === 0) return curatedModelsAsPickerEntries();
  const byId = new Map(remote.map((m) => [m.id, m]));
  const curated = AI_MODELS.filter((c) => byId.has(c.id)).map((c) => {
    const hit = byId.get(c.id);
    return {
      id: c.id,
      name: c.name,
      provider: c.provider,
      cost: hit.cost || formatModelCost(c.pricing),
      supportsStructuredOutputs: !!hit.supportsStructuredOutputs,
      curated: true,
    };
  });
  const curatedIds = new Set(curated.map((m) => m.id));
  const rest = remote
    .filter((m) => !curatedIds.has(m.id))
    .map((m) => ({ ...m, curated: false }))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)
      || (a.provider || '').localeCompare(b.provider || ''));
  return curated.concat(rest);
}

// OpenRouter's JSON error body ({ error: { code, message, metadata } }), read
// once. Falls back to a short plain-text body; an HTML page is not a message.
async function readOpenRouterErrorDetail(response) {
  let text;
  try {
    text = await response.text();
  } catch (_e) {
    return {};
  }
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    const err = (data && data.error) || {};
    const metadata = err.metadata || {};
    return {
      message: typeof err.message === 'string' ? err.message.trim() : '',
      provider: typeof metadata.provider_name === 'string' ? metadata.provider_name : '',
    };
  } catch (_e) {
    if (/^\s*</.test(text)) return {};
    return { message: text.trim().slice(0, 160) };
  }
}

function openRouterHeaders(extra = {}) {
  return {
    'Accept': 'application/json',
    'HTTP-Referer': chrome.runtime.getURL(''),
    'X-Title': APP_TITLE,
    ...extra,
  };
}

async function fetchOpenRouterModels() {
  let response;
  try {
    response = await fetch(`${OPENROUTER_API}/models`, {
      method: 'GET',
      headers: openRouterHeaders(),
      signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[Huddle] Models catalog network error:', err);
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new Error(timedOut ? 'OpenRouter didn\'t answer' : 'couldn\'t reach OpenRouter', { cause: err });
  }

  if (!response.ok) {
    const detail = await readOpenRouterErrorDetail(response);
    console.error('[Huddle] Models catalog HTTP', response.status, detail.message || '');
    throw new Error(`OpenRouter ${response.status}${detail.message ? `: ${detail.message}` : ''}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error('[Huddle] Models catalog JSON parse error:', err);
    throw new Error('OpenRouter sent a catalog Huddle can\'t read', { cause: err });
  }

  const list = Array.isArray(data.data) ? data.data : [];
  if (list.length === 0) {
    throw new Error('OpenRouter sent an empty catalog');
  }
  return list.map(normalizeOpenRouterModel).filter(Boolean);
}

// The cache as this build wrote it, or null (none, or an older build's).
async function readModelsCache() {
  const stored = await chrome.storage.local.get([MODELS_CACHE_KEY]);
  const cache = stored && stored[MODELS_CACHE_KEY];
  if (!cache || cache.v !== MODELS_CACHE_VERSION
      || !Array.isArray(cache.models) || cache.models.length === 0
      || typeof cache.fetchedAt !== 'number') {
    return null;
  }
  return cache;
}

async function getOpenRouterModels({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cache = await readModelsCache();
    if (cache && (Date.now() - cache.fetchedAt) < MODELS_CACHE_TTL_MS) {
      return {
        models: mergeModelsForPicker(cache.models),
        fetchedAt: cache.fetchedAt,
        fromCache: true,
      };
    }
  }

  try {
    const remote = await fetchOpenRouterModels();
    const fetchedAt = Date.now();
    try {
      await chrome.storage.local.set({
        [MODELS_CACHE_KEY]: { v: MODELS_CACHE_VERSION, models: remote, fetchedAt },
      });
    } catch (cacheErr) {
      // Still return the live catalog even if caching fails (quota, etc.).
      console.warn('[Huddle] Models catalog cache write failed:', cacheErr);
    }
    return {
      models: mergeModelsForPicker(remote),
      fetchedAt,
      fromCache: false,
    };
  } catch (error) {
    console.error('[Huddle] getOpenRouterModels failed:', error);
    const cache = await readModelsCache();
    if (cache) {
      return {
        models: mergeModelsForPicker(cache.models),
        fetchedAt: cache.fetchedAt,
        fromCache: true,
        stale: true,
        error: error.message,
      };
    }
    return {
      models: curatedModelsAsPickerEntries(),
      fetchedAt: null,
      fromCache: false,
      fallback: true,
      error: error.message,
    };
  }
}

function catalogReply(catalog) {
  return {
    success: !catalog.fallback,
    models: Array.isArray(catalog.models) ? catalog.models : curatedModelsAsPickerEntries(),
    modelsMeta: {
      fetchedAt: catalog.fetchedAt,
      fromCache: !!catalog.fromCache,
      stale: !!catalog.stale,
      fallback: !!catalog.fallback,
      error: catalog.error || null,
    },
  };
}

// What Huddle knows about a model id: its display name, whether it takes a
// strict JSON schema, and the parameters it accepts (params: null when only
// the cached catalog could say and it does not list the id).
async function modelInfo(modelId) {
  const curated = AI_MODELS.find((m) => m.id === modelId);
  const cache = modelId ? await readModelsCache() : null;
  const hit = cache ? cache.models.find((m) => m.id === modelId) : null;
  return {
    id: modelId,
    name: (curated && curated.name) || (hit && hit.name) || modelId,
    listed: !!hit,
    catalogKnown: !!cache,
    supportsStructuredOutputs: !!(hit && hit.supportsStructuredOutputs),
    params: hit && Array.isArray(hit.supportedParameters) ? hit.supportedParameters : null,
  };
}

// The model a run uses when none is picked: the saved default, else
// DEFAULT_MODEL. When a catalog is known and does not list it, the first
// recommended model it does list stands in, and `missing` names the one it
// replaces (mine: the user saved it). An id the user kept although the
// catalog did not list it (config.unlistedModel) is theirs to keep. With no
// catalog there is nothing to check against.
function resolveDefaultModel(config, catalogIds) {
  const saved = (config && typeof config.model === 'string' && config.model) || null;
  const wanted = saved || DEFAULT_MODEL;
  const keep = { model: wanted, missing: null, mine: !!saved };
  if (!catalogIds || catalogIds.has(wanted)) return keep;
  if (saved && config.unlistedModel === saved) return keep;
  const first = AI_MODELS.find((m) => catalogIds.has(m.id));
  if (!first || first.id === wanted) return keep;
  return { model: first.id, missing: wanted, mine: !!saved };
}

async function resolveDefaultModelFromCache(config) {
  const cache = await readModelsCache();
  return resolveDefaultModel(config, cache ? new Set(cache.models.map((m) => m.id)) : null);
}

function buildTabGroupsJsonSchema(tabIds) {
  const ids = Array.isArray(tabIds) ? tabIds.filter((id) => typeof id === 'number') : [];
  return {
    name: 'tab_groups',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['groups'],
      properties: {
        groups: {
          type: 'array',
          description: 'Logical tab groups; every input tab id should appear in exactly one group',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'color', 'tabIds'],
            properties: {
              name: {
                type: 'string',
                description: 'Short group name (2-4 words)',
              },
              color: {
                type: 'string',
                enum: VALID_TAB_GROUP_COLORS.slice(),
                description: 'Chrome tab group color',
              },
              tabIds: {
                type: 'array',
                description: 'Tab IDs belonging to this group',
                items: ids.length > 0
                  ? { type: 'integer', enum: ids }
                  : { type: 'integer' },
              },
            },
          },
        },
      },
    },
  };
}

// ============================================================
// AI key and default model (chrome.storage.local 'aiConfig')
// ============================================================

function encodeKey(plaintext) {
  return btoa(plaintext);
}

function decodeKey(encoded) {
  return atob(encoded);
}

function isKeyExpired(aiConfig) {
  if (!aiConfig || !aiConfig.key) return true;
  if (aiConfig.expiresAt === null) return false;
  return typeof aiConfig.expiresAt === 'number' && Date.now() > aiConfig.expiresAt;
}

// An alarm at the key's deadline removes it from storage then, not just the
// next time something reads it.
function scheduleKeyExpiryAlarm(aiConfig) {
  if (!chrome.alarms) return;
  const at = aiConfig && aiConfig.key ? aiConfig.expiresAt : null;
  Promise.resolve(chrome.alarms.clear(AI_KEY_ALARM)).catch(() => {});
  if (typeof at === 'number') {
    Promise.resolve(chrome.alarms.create(AI_KEY_ALARM, { when: Math.max(at, Date.now() + 1000) })).catch(() => {});
  }
}

// config: { key, expiryDuration, renew?, model? }. A newly typed key (renew)
// or a changed expiry policy starts a fresh countdown; re-saving the kept key
// with the same policy keeps its deadline.
async function saveAiConfig(config) {
  const key = encodeKey(config.key);
  const previous = await loadAiConfig();
  // A missing or unparsable duration must not become a key that never expires.
  const expiryDuration = config.expiryDuration === null
    ? null
    : (Number.isFinite(config.expiryDuration) && config.expiryDuration > 0
      ? config.expiryDuration
      : DEFAULT_EXPIRY);

  const keptKey = !config.renew
    && !!previous
    && previous.key === key
    && previous.expiryDuration === expiryDuration
    && previous.expiresAt !== undefined
    && !isKeyExpired(previous);

  const expiresAt = keptKey
    ? previous.expiresAt
    : (expiryDuration !== null ? Date.now() + expiryDuration : null);

  // A key saved without a model (the organize page's inline key form) keeps
  // the default model already chosen in Settings.
  const model = config.model || (previous && previous.model) || DEFAULT_MODEL;
  const aiConfig = {
    key,
    model,
    unlistedModel: previous && previous.unlistedModel === model ? model : null,
    expiresAt,
    expiryDuration,
    keyExpiredAt: null,
    setupComplete: true,
  };

  await chrome.storage.local.set({ aiConfig });
  scheduleKeyExpiryAlarm(aiConfig);
  return aiConfig;
}

// Reads the config, and deletes a key whose deadline has passed: expiry
// removes the secret from the profile, it does not just hide it. The model,
// the expiry policy and keyExpiredAt (so pages can say "expired") stay.
async function loadAiConfig() {
  const result = await chrome.storage.local.get(['aiConfig']);
  const aiConfig = (result && result.aiConfig) || null;
  if (aiConfig && aiConfig.key && typeof aiConfig.expiresAt === 'number' && Date.now() > aiConfig.expiresAt) {
    const purged = { ...aiConfig, key: null, expiresAt: null, keyExpiredAt: aiConfig.expiresAt };
    await chrome.storage.local.set({ aiConfig: purged });
    return purged;
  }
  return aiConfig;
}

// The default model can be chosen before any key is on file, so it is stored
// on its own: a config without a key still reads as "no key". An id the
// catalog does not list (a typo, a retired model) is refused unless the user
// confirmed it (allowUnlisted); with no catalog to check against it is kept.
async function saveAiDefaultModel(model, { allowUnlisted = false } = {}) {
  const id = typeof model === 'string' ? model.trim() : '';
  if (!id) throw new Error('Choose a model first.');
  if (isBatchModel(id)) {
    throw new Error('Batch models can\'t organize tabs. Pick another model.');
  }
  if (!allowUnlisted && !AI_MODELS.some((m) => m.id === id)) {
    const info = await modelInfo(id);
    if (info.catalogKnown && !info.listed) {
      const err = new Error(`${id} isn't in OpenRouter's list of models Huddle can use.`);
      err.unlisted = true;
      throw err;
    }
  }
  // A kept unlisted id is never swapped for a recommended model later (see
  // resolveDefaultModel): the user chose it knowing the catalog lacked it.
  const unlistedModel = allowUnlisted ? id : null;
  const previous = await loadAiConfig();
  const aiConfig = previous
    ? { ...previous, model: id, unlistedModel }
    : { key: null, model: id, unlistedModel, expiresAt: null, expiryDuration: DEFAULT_EXPIRY, setupComplete: false };
  await chrome.storage.local.set({ aiConfig });
  return aiConfig;
}

// Deleting the key keeps the default model and the expiry policy.
async function deleteAiKey() {
  const previous = await loadAiConfig();
  if (!previous) return null;
  const aiConfig = { ...previous, key: null, expiresAt: null, keyExpiredAt: null };
  await chrome.storage.local.set({ aiConfig });
  scheduleKeyExpiryAlarm(aiConfig);
  return aiConfig;
}

// 'missing' or 'expired' when organize cannot run with the stored key.
function aiKeyState(config) {
  if (!config || !config.key) return config && config.keyExpiredAt ? 'expired' : 'missing';
  return isKeyExpired(config) ? 'expired' : null;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === AI_KEY_ALARM) loadAiConfig().catch(() => {});
});

// ============================================================
// AI Tab Grouping — Prompt Building and Response Parsing
// ============================================================

function stripQueryParams(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch (_e) {
    return url;
  }
}

function buildAiPrompt(tabs, instructions) {
  // Pre-sort tabs by domain for easier clustering
  const sortedTabs = [...tabs].sort((a, b) => {
    const domainA = lexHost(a.url);
    const domainB = lexHost(b.url);
    return domainA.localeCompare(domainB);
  });

  const tabLines = sortedTabs.map(tab => {
    const domain = lexHost(tab.url);
    const title = tab.title || '(no title)';
    const cleanUrl = stripQueryParams(tab.pendingUrl || tab.url);
    return `[id:${tab.id}] ${domain} — "${title}" — ${cleanUrl}`;
  }).join('\n');

  const systemMessage = {
    role: 'system',
    content: 'You organize browser tabs into logical groups. Return ONLY valid JSON, no other text.'
  };

  const userMessage = {
    role: 'user',
    content: `Group these browser tabs into logical categories based on their content and purpose.
Each group should have a short descriptive name (2-4 words max).

Return JSON in this exact format:
{"groups": [{"name": "Group Name", "color": "blue", "tabIds": [1, 2, 3]}]}

Available colors: ${VALID_TAB_GROUP_COLORS.join(', ')}

Every tab must be assigned to exactly one group. Do not omit any tabs.
${instructions ? '\nAdditional instructions from user: ' + instructions + '\n' : ''}
Tabs (sorted by domain):
${tabLines}`
  };

  return [systemMessage, userMessage];
}

// Room for the answer (and a reasoning model's thinking) without asking
// OpenRouter to reserve credit for the model's whole output limit, which is
// what turns a small balance into a 402 for a few hundred tokens of JSON.
function maxTokensForTabs(tabCount) {
  return Math.min(16000, 2000 + 100 * Math.max(0, tabCount || 0));
}

// The request carries only parameters the model accepts, as the catalog lists
// them (params; null when unknown, as for a custom id). OpenRouter treats a
// parameter no provider of a model takes as a reason to route nowhere once
// require_parameters is on, so Huddle sends no sampling settings at all
// (GPT-6 Luna, for one, takes no temperature).
//   structured_outputs listed: the exact json_schema, and only providers
//     that honor it (require_parameters)
//   response_format listed, or unknown: json_object, any provider
// strict: false drops the json_schema and require_parameters (the fallback).
function buildOpenRouterRequestBody(model, messages, { params = null, jsonSchema = null, strict = true, maxTokens = null } = {}) {
  const known = Array.isArray(params);
  const takes = (name) => !known || params.includes(name);
  const body = {
    model,
    messages,
    stream: true,
  };
  if (Number.isFinite(maxTokens) && maxTokens > 0 && takes('max_tokens')) body.max_tokens = maxTokens;

  if (strict && jsonSchema && known && params.includes('structured_outputs')) {
    body.response_format = {
      type: 'json_schema',
      json_schema: jsonSchema,
    };
    body.provider = { require_parameters: true };
  } else if (takes('response_format')) {
    body.response_format = { type: 'json_object' };
  }

  return body;
}

// What a request asked OpenRouter for, in words, for an error that says so.
function describeRequestTried(tried) {
  const strict = tried.includes('strict');
  const plain = tried.includes('plain');
  if (strict && plain) return 'Huddle asked for its exact JSON answer format, then for any JSON answer';
  if (strict) return 'Huddle asked for its exact JSON answer format';
  return 'Huddle asked for a JSON answer';
}

// A refusal about the request's parameters or routing, not the model itself:
// "No endpoints found that can handle the requested parameters", "...that
// support the provided 'response_format' parameter", provider routing.
const ROUTING_REFUSAL_TEXT = /parameter|require_parameters|routing|no endpoints found (that|matching)/i;

function aiError(message, kind, extra = {}) {
  const error = new Error(message);
  error.kind = kind;
  Object.assign(error, extra);
  return error;
}

// "(401: User not found.)" or "(401)".
function statusWithDetail(status, said) {
  return said ? `${status}: ${said.replace(/\.$/, '')}` : String(status);
}

// An OpenRouter error as a sentence the user can act on, with a kind the
// organize page turns into the right buttons:
//   model     another model is the fix (Change model, Retry)
// retryable: false marks a failure the same request meets again (a 4xx about
// the model or the request, a provider refusing it, too few credits): the
// page makes the fix its primary button instead of Retry.
//   auth      a 401 not yet pinned on the key or the model (see classifyAuthError)
//   credits   the account needs credits
//   transient try again (rate limits, timeouts, server errors)
// ctx: { model, modelName, tried: ['strict'?, 'plain'?] (what was sent) }
function mapOpenRouterHttpError(status, detail = {}, ctx = {}) {
  const said = detail.message || '';
  const provider = detail.provider || '';
  const who = ctx.modelName || ctx.model || 'this model';
  const code = statusWithDetail(status, said);
  let error;
  if (status === 401) {
    error = provider
      ? aiError(`${provider}, the provider serving ${who}, refused the request (${code}). Your key works; pick another model.`, 'model', { retryable: false })
      : aiError(`OpenRouter refused the request (${code}).`, 'auth');
  } else if (status === 402) {
    // Retrying before adding credits fails the same way: Add credits leads.
    error = aiError(`OpenRouter needs more credits to run ${who} (${code}). Add credits on OpenRouter, or pick a cheaper model.`, 'credits', { retryable: false });
  } else if (status === 403) {
    // Moderation or a region/provider block: the same request is refused again.
    error = aiError(`OpenRouter refused this request for ${who} (${code}). Pick another model.`, 'model', { retryable: false });
  } else if ((status === 404 || status === 400) && ROUTING_REFUSAL_TEXT.test(said)) {
    // The model exists; no provider of it takes what the request asked for.
    const tried = Array.isArray(ctx.tried) && ctx.tried.length ? ` ${describeRequestTried(ctx.tried)}.` : '';
    error = aiError(`OpenRouter found no provider that can run ${who} with Huddle's request (${code}).${tried} Pick another model.`, 'model', { retryable: false });
  } else if (status === 404) {
    // Retrying the same model finds no endpoint again: Change model leads.
    error = aiError(`${who} isn't available on OpenRouter right now (${code}). Pick another model.`, 'model', { retryable: false });
  } else if (status === 408 || status === 429 || status >= 500) {
    const lead = status === 429
      ? 'OpenRouter is rate limiting this request'
      : status === 408 ? 'OpenRouter timed out'
        : `OpenRouter or ${provider ? `${provider}, the provider serving ${who},` : `the provider serving ${who}`} had a problem`;
    error = aiError(`${lead} (${code}). Try again in a moment.`, 'transient');
  } else {
    // 400 and the like: an unknown model id, a context too long for it, an
    // unsupported parameter. None of them changes on a retry.
    error = aiError(`OpenRouter couldn't run ${who} with this request (${code}). Pick another model.`, 'model', { retryable: false });
  }
  error.status = status;
  error.openRouterError = { message: said, provider };
  return error;
}

// A 401 that names no provider is either the key or the model. Asking
// OpenRouter about the key itself tells them apart.
async function classifyAuthError(error, apiKey, ctx = {}) {
  let probe;
  try {
    probe = await fetch(`${OPENROUTER_API}/key`, {
      method: 'GET',
      headers: openRouterHeaders({ 'Authorization': `Bearer ${apiKey}` }),
      signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
    });
  } catch (_e) {
    return error;
  }
  const said = (error.openRouterError && error.openRouterError.message) || '';
  if (probe.status === 401 || probe.status === 403) {
    return aiError(
      `OpenRouter rejected your saved key (${statusWithDetail(401, said)}). Enter a new key to organize.`,
      'key', { needsKey: 'rejected', status: 401 },
    );
  }
  if (probe.ok) {
    const who = ctx.modelName || ctx.model || 'this model';
    return aiError(
      `OpenRouter refused the request for ${who} (${statusWithDetail(401, said)}). Your key works; pick another model.`,
      'model', { status: 401, retryable: false },
    );
  }
  return error;
}

// Reads a 200 reply: SSE chunks (streamed to onChunk) or a plain JSON body.
// Returns { text, finishReason }. An error OpenRouter reports inside a 200
// (a provider failing after the stream started) is thrown, not returned as
// a partial answer.
async function readOpenRouterResponse(response, onChunk, { onActivity = () => {}, ctx = {} } = {}) {
  const contentType = (response.headers && response.headers.get('content-type')) || '';

  if (!contentType.includes('text/event-stream')) {
    let data;
    try {
      data = await response.json();
    } catch (_e) {
      throw aiError('OpenRouter sent back something that isn\'t an API response (a sign-in or proxy page?). Check your connection, then Retry.', 'network');
    }
    if (data && data.error) {
      throw mapOpenRouterHttpError(Number(data.error.code) || 502,
        { message: data.error.message, provider: data.error.metadata && data.error.metadata.provider_name }, ctx);
    }
    const choice = (data && data.choices && data.choices[0]) || {};
    const content = (choice.message && choice.message.content) || '';
    if (content && onChunk) onChunk(content);
    return { text: content, finishReason: choice.finish_reason || null };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let finishReason = null;

  while (true) {
    const { done, value } = await reader.read();
    onActivity();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5);
      if (payload === '[DONE]') continue;

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch (_e) {
        continue; // skip malformed SSE lines
      }
      const choice = (parsed.choices && parsed.choices[0]) || {};
      if (parsed.error || choice.finish_reason === 'error') {
        const err = parsed.error || {};
        const cause = mapOpenRouterHttpError(Number(err.code) || 502,
          { message: err.message, provider: err.metadata && err.metadata.provider_name }, ctx);
        throw aiError(`The provider stopped mid-answer. ${cause.message}`, cause.kind === 'transient' ? 'transient' : 'model',
          { status: cause.status });
      }
      const content = choice.delta && choice.delta.content;
      if (content) {
        fullText += content;
        if (onChunk) onChunk(content);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }

  return { text: fullText, finishReason };
}

// Statuses OpenRouter uses to refuse the request itself. After a strict
// request (json_schema with require_parameters) any of them earns one retry
// with plain json_object on any provider, whatever the message says: its
// wording changes, and a refusal of the strict request is exactly what the
// plain one avoids. 401/402/429 describe the account, not the payload: they
// would fail identically, so they are never retried.
const STRICT_REFUSAL_STATUSES = new Set([400, 404, 422, 501]);

// options: { params, jsonSchema, maxTokens, signal, ctx, onFinish,
//            firstByteMs, idleMs }
// Resolves with the model's text. See buildOpenRouterRequestBody for what is
// sent, and STRICT_REFUSAL_STATUSES for the one retry.
// Rejects with an error carrying .kind; an abort through `signal` rejects
// with an AbortError.
async function callOpenRouter(apiKey, model, messages, onChunk, options = {}) {
  const ctx = { model, ...(options.ctx || {}) };
  const firstByteMs = options.firstByteMs || CHAT_FIRST_BYTE_TIMEOUT_MS;
  const idleMs = options.idleMs || CHAT_IDLE_TIMEOUT_MS;
  const controller = new AbortController();
  const outer = options.signal || null;
  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }
  let timer = null;
  let timedOut = 0;
  const arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = ms;
      controller.abort();
    }, ms);
  };

  const tried = [];
  ctx.tried = tried;
  const postRequest = async (opts) => {
    const body = buildOpenRouterRequestBody(model, messages, opts);
    const strict = !!(body.provider && body.provider.require_parameters);
    tried.push(strict ? 'strict' : 'plain');
    arm(firstByteMs);
    const response = await fetch(`${OPENROUTER_API}/chat/completions`, {
      method: 'POST',
      headers: openRouterHeaders({
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await readOpenRouterErrorDetail(response);
      console.error('[Huddle] OpenRouter request failed:', {
        status: response.status,
        model,
        responseFormat: body.response_format ? body.response_format.type : 'none',
        requireParameters: strict,
        detail,
      });
      const error = mapOpenRouterHttpError(response.status, detail, ctx);
      error.strictRequest = strict;
      throw error;
    }
    return response;
  };

  try {
    const base = {
      params: Array.isArray(options.params) ? options.params : null,
      jsonSchema: options.jsonSchema || null,
      maxTokens: options.maxTokens || null,
    };
    let response;
    try {
      response = await postRequest(base);
    } catch (error) {
      if (!error || !error.strictRequest || !STRICT_REFUSAL_STATUSES.has(error.status)) throw error;
      console.warn('[Huddle] OpenRouter refused the strict request; retrying with json_object on any provider:', error.message);
      response = await postRequest({ ...base, strict: false });
    }

    // Past this point the response is streaming into onChunk, and the page has
    // already rendered those chunks. A retry here would append a second
    // generation onto the partial text on screen, so failures must propagate.
    arm(idleMs);
    const result = await readOpenRouterResponse(response, onChunk, { onActivity: () => arm(idleMs), ctx });
    if (options.onFinish) options.onFinish(result.finishReason);
    return result.text;
  } catch (error) {
    if (outer && outer.aborted) {
      const abort = new Error('The run was stopped.');
      abort.name = 'AbortError';
      throw abort;
    }
    if (timedOut) {
      throw aiError(`OpenRouter didn't answer within ${Math.round(timedOut / 1000)} s. Try again, or pick a faster model.`, 'transient');
    }
    if (error && error.kind) throw error;
    if (error instanceof TypeError) {
      throw aiError('Couldn\'t reach OpenRouter. Check your connection, then Retry.', 'network');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onOuterAbort);
  }
}

function parseAiResponse(responseText, originalTabs) {
  // Extract JSON — handle markdown code fences
  let jsonStr = responseText.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (_e) {
    return { success: false, error: 'AI returned invalid JSON. Please try again.' };
  }

  if (!parsed.groups || !Array.isArray(parsed.groups)) {
    return { success: false, error: 'AI response missing "groups" array.' };
  }

  const validTabIds = new Set(originalTabs.map(t => t.id));
  const assignedTabIds = new Set();
  const groups = [];
  let unknownIds = 0;

  for (const group of parsed.groups) {
    if (!group.name || !Array.isArray(group.tabIds)) continue;

    // Validate and filter tab IDs
    unknownIds += group.tabIds.filter(id => !validTabIds.has(id)).length;
    const validIds = group.tabIds
      .filter(id => validTabIds.has(id) && !assignedTabIds.has(id));
    validIds.forEach(id => assignedTabIds.add(id));

    if (validIds.length === 0) continue;

    // Normalize color
    const color = VALID_TAB_GROUP_COLORS.includes(group.color) ? group.color : 'grey';

    groups.push({
      name: String(group.name).slice(0, 40),
      color,
      tabIds: validIds,
    });
  }

  // A plan with no groups would Apply as "nothing happened".
  if (groups.length === 0) {
    return {
      success: false,
      error: unknownIds > 0
        ? 'The model didn\'t put any of your tabs in a group (it listed tabs that aren\'t open). Try again, add instructions or pick another model.'
        : 'The model didn\'t put any of your tabs in a group. Try again, add instructions or pick another model.',
    };
  }

  // Collect unassigned tabs into "Ungrouped"
  const unassignedIds = originalTabs
    .map(t => t.id)
    .filter(id => !assignedTabIds.has(id));

  return {
    success: true,
    groups,
    ungroupedTabIds: unassignedIds,
  };
}

// ============================================================
// AI Tab Grouping — Runs and Message Handlers
// ============================================================

// The organize page for a window, if one is open.
async function findOrganizeTab(windowId) {
  try {
    const tabs = await chrome.tabs.query({ windowId, url: chrome.runtime.getURL('ai-proposal.html') + '*' });
    return (tabs && tabs[0]) || null;
  } catch (_e) {
    return null;
  }
}

// The popup's O: opens the organize page for its window, or brings back the
// one already open there (telling it the popup's Groups/Flat choice). The
// page starts its own runs.
async function handleAiGroupTabs(message, sendResponse) {
  try {
    const respectGroups = message.respectGroups !== undefined ? message.respectGroups : true;
    const win = await chrome.windows.getCurrent();
    const windowId = win && typeof win.id === 'number' ? win.id : undefined;
    const existing = typeof windowId === 'number' ? await findOrganizeTab(windowId) : null;
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      chrome.tabs.sendMessage(existing.id, { type: 'ai-set-mode', respectGroups }).catch(() => {});
      sendResponse({ success: true, action: 'focused' });
      return;
    }
    const params = new URLSearchParams({ respectGroups: respectGroups ? 'true' : 'false' });
    const createProps = { url: chrome.runtime.getURL(`ai-proposal.html?${params}`), active: true };
    if (typeof windowId === 'number') createProps.windowId = windowId;
    await chrome.tabs.create(createProps);
    sendResponse({ success: true, action: 'opened' });
  } catch (error) {
    console.error('[Huddle] Error in AI group tabs:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// The run each organize tab has going, so a new one (or the tab closing)
// aborts it. In memory only: runs live on their page's port, and a worker
// restart closes those ports, which the page sees and reports.
const aiRuns = new Map(); // tabId -> { controller }

// One organize run for the organize page in tabId. post() sends to that
// page's port; signal aborts the run (Stop, reload, tab closed, new run).
// start: { instructions, model (null: the default), respectGroups }
async function runAiOrganize({ tabId, windowId, start, signal, post }) {
  const respectGroups = start.respectGroups !== false;
  let apiKey = null;
  let ctx = {};
  try {
    const config = await loadAiConfig();
    const keyState = aiKeyState(config);
    if (keyState) {
      post({
        type: 'ai-error',
        kind: 'key',
        needsKey: keyState,
        error: keyState === 'expired'
          ? 'Your OpenRouter key has expired. Enter it again to organize.'
          : 'Huddle has no OpenRouter key yet. Add one to organize.',
      });
      return;
    }
    const picked = typeof start.model === 'string' && start.model.trim();
    const model = picked || (await resolveDefaultModelFromCache(config)).model;
    const info = await modelInfo(model);
    ctx = { model, modelName: info.name };
    if (isBatchModel({ id: model, name: info.name })) {
      // No retry can help: the page offers Change model instead.
      post({ type: 'ai-error', kind: 'model', retryable: false, error: `${info.name} is a batch model, and batch models can't organize tabs. Pick another model.` });
      return;
    }

    post({ type: 'ai-status', text: 'Gathering tabs…' });
    const targetWindowId = typeof windowId === 'number'
      ? windowId
      : (await chrome.windows.getCurrent()).id;
    const tabs = await getTabsWithGroupInfo(targetWindowId);

    // Groups mode: only organize ungrouped tabs. Flat mode: all tabs. Huddle's
    // own pages (this one, a second organize tab, Settings) are never sent.
    const ownPages = chrome.runtime.getURL('');
    const unpinnedTabs = tabs.filter(t => {
      if (t.pinned || t.id === tabId) return false;
      const url = t.pendingUrl || t.url || '';
      if (url.startsWith(ownPages)) return false;
      if (respectGroups && t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return false;
      return true;
    });

    if (unpinnedTabs.length === 0) {
      post(respectGroups
        ? { type: 'ai-error', kind: 'no-tabs', error: 'Every tab in this window is already in a group, so Groups mode has nothing to organize. Organize all tabs (Flat) to regroup them.' }
        : { type: 'ai-error', kind: 'none', error: 'There are no unpinned tabs in this window to organize.' });
      return;
    }

    const messages = buildAiPrompt(unpinnedTabs, start.instructions || '');
    const useJsonSchema = !!(info.params && info.params.includes('structured_outputs'));
    const tabIds = unpinnedTabs.map((t) => t.id);
    const jsonSchema = useJsonSchema ? buildTabGroupsJsonSchema(tabIds) : null;
    post({
      type: 'ai-debug',
      model,
      modelName: info.name,
      messages,
      respectGroups,
      useJsonSchema,
    });
    post({ type: 'ai-status', text: `Asking ${info.name}…` });

    apiKey = decodeKey(config.key);
    let finishReason = null;
    const responseText = await callOpenRouter(
      apiKey,
      model,
      messages,
      (chunk) => post({ type: 'ai-chunk', text: chunk }),
      {
        params: info.params,
        jsonSchema,
        maxTokens: maxTokensForTabs(unpinnedTabs.length),
        signal,
        ctx,
        onFinish: (reason) => { finishReason = reason; },
      },
    );

    if (!responseText.trim()) {
      post({
        type: 'ai-error',
        kind: 'model',
        error: `${info.name} returned an empty answer${finishReason ? ` (stopped: ${finishReason})` : ''}. Try again or pick another model.`,
      });
      return;
    }

    post({ type: 'ai-status', text: 'Reading the proposal…' });
    const result = parseAiResponse(responseText, unpinnedTabs);

    if (!result.success) {
      const error = finishReason === 'length'
        ? `${info.name} ran out of room before finishing its answer. Try again, or pick another model.`
        : /invalid JSON|missing "groups"/.test(result.error)
          ? `${info.name} didn't answer in the JSON format Huddle needs. Try again or pick another model.`
          : result.error;
      post({ type: 'ai-error', kind: 'model', error });
      return;
    }

    const tabMeta = unpinnedTabs.map(t => ({
      id: t.id,
      title: t.title || '(no title)',
      url: t.pendingUrl || t.url,
      favIconUrl: t.favIconUrl || '',
    }));

    post({
      type: 'ai-proposal',
      groups: result.groups,
      ungroupedTabIds: result.ungroupedTabIds,
      tabs: tabMeta,
      windowId: targetWindowId,
      respectGroups,
      model,
      modelName: info.name,
    });
  } catch (error) {
    if (signal.aborted) return; // Stopped, reloaded or closed: nobody to tell.
    let err = error;
    if (err && err.kind === 'auth' && apiKey) err = await classifyAuthError(err, apiKey, ctx);
    if (signal.aborted) return;
    console.error('[Huddle] Error in AI organize run:', err);
    post({
      type: 'ai-error',
      kind: (err && err.kind) || 'model',
      needsKey: err && err.needsKey,
      retryable: err && err.retryable === false ? false : undefined,
      error: (err && err.message) || String(err),
    });
  }
}

// The organize page opens a port per run and sends { type: 'start', ... }.
// The port is the run: messages go back on it, its disconnect (Stop, reload,
// tab closed) aborts the request, and the page sees this worker stopping as
// the port closing. The page pings while it waits, which keeps the worker
// awake through a slow answer.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== AI_RUN_PORT) return;
  const tab = port.sender && port.sender.tab;
  let run = null;
  const post = (msg) => {
    if (run && run.controller.signal.aborted) return;
    try {
      port.postMessage(msg);
    } catch (_e) {
      // the page went away
    }
  };

  port.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'start' || run) return;
    if (msg.protocol !== AI_PROTOCOL) {
      post({ type: 'ai-error', kind: 'stale', protocol: AI_PROTOCOL, error: 'Huddle was updated. Reload it to continue.' });
      return;
    }
    if (!tab || typeof tab.id !== 'number') {
      post({ type: 'ai-error', kind: 'none', error: 'Organize only runs from the organize page.' });
      return;
    }
    const previous = aiRuns.get(tab.id);
    if (previous) previous.controller.abort();
    run = { controller: new AbortController() };
    aiRuns.set(tab.id, run);
    post({ type: 'started', protocol: AI_PROTOCOL });
    const mine = run;
    runAiOrganize({
      tabId: tab.id,
      windowId: tab.windowId,
      start: {
        instructions: typeof msg.instructions === 'string' ? msg.instructions : '',
        model: typeof msg.model === 'string' && msg.model.trim() ? msg.model.trim() : null,
        respectGroups: msg.respectGroups !== false,
      },
      signal: mine.controller.signal,
      post,
    }).finally(() => {
      if (aiRuns.get(tab.id) === mine) aiRuns.delete(tab.id);
    });
  });

  port.onDisconnect.addListener(() => {
    if (!run) return;
    run.controller.abort();
    if (tab && aiRuns.get(tab.id) === run) aiRuns.delete(tab.id);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const run = aiRuns.get(tabId);
  if (run) {
    run.controller.abort();
    aiRuns.delete(tabId);
  }
});

// Groups the tabs still in the window. Tabs closed or moved away since the
// proposal was made are left out and counted; the page is closed only when
// everything proposed was grouped, and never when it is the window's last tab.
async function handleApplyAiProposal(message, sender, sendResponse) {
  try {
    const { groups, windowId } = message;

    // Grouping can pull a split's halves apart; record the pairs first. The
    // sort below records and restores again for the moves it makes.
    const splitPairs = await captureSplitPairs([windowId]);

    const windowTabs = await chrome.tabs.query({ windowId });
    const stillHere = new Map(windowTabs.map(t => [t.id, t]));

    let proposed = 0;
    const usable = (groups || []).map((group) => {
      const ids = group.tabIds || [];
      proposed += ids.length;
      return { ...group, tabIds: ids.filter(id => stillHere.has(id)) };
    }).filter((group) => group.tabIds.length > 0);
    const grouped = usable.reduce((n, g) => n + g.tabIds.length, 0);
    // Tabs the page already took out of the proposal count as left out too.
    const leftOut = Number.isInteger(message.leftOut) && message.leftOut > 0 ? message.leftOut : 0;
    const skipped = proposed - grouped + leftOut;

    if (grouped === 0) {
      sendResponse({
        success: false,
        error: proposed > 0
          ? 'None of the proposed tabs are still in this window.'
          : 'There are no groups to apply.',
      });
      return;
    }

    // Flat mode: tabs left in (or moved to) Ungrouped leave their old groups.
    if (message.respectGroups === false && Array.isArray(message.ungroupedTabIds)) {
      const toUngroup = message.ungroupedTabIds.filter(id => {
        const tab = stillHere.get(id);
        return tab && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
      });
      if (toUngroup.length > 0) {
        await chrome.tabs.ungroup(toUngroup);
      }
    }

    // Apply groups with a small delay between each to avoid overwhelming Chrome
    for (const group of usable) {
      const groupId = await chrome.tabs.group({
        tabIds: group.tabIds,
        createProperties: { windowId },
      });

      await chrome.tabGroups.update(groupId, {
        title: group.name || '',
        color: VALID_TAB_GROUP_COLORS.includes(group.color) ? group.color : 'grey',
      });

      // Let Chrome settle between group operations
      await new Promise(r => setTimeout(r, 50));
    }

    await restoreSplitPairs(splitPairs);

    // Sort after all groups are created
    await sortWindowTabs(windowId, true);

    const closePage = skipped === 0 && !!sender.tab && windowTabs.some((t) => t.id !== sender.tab.id);
    sendResponse({ success: true, grouped, groups: usable.length, skipped, closing: closePage });
    if (closePage) {
      try {
        await chrome.tabs.remove(sender.tab.id);
      } catch (_e) {
        // the user may have closed it already
      }
    }
  } catch (error) {
    console.error('[Huddle] Error applying AI proposal:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Tab Groups Helper Functions
async function getTabGroupsInfo(windowId = null) {
  try {
    const query = windowId ? { windowId } : {};
    const groups = await chrome.tabGroups.query(query);
    const groupsMap = new Map();
    
    for (const group of groups) {
      groupsMap.set(group.id, group);
    }
    
    return groupsMap;
  } catch (error) {
    console.error('[Huddle] Error getting tab groups info:', error);
    return new Map();
  }
}

// A failed tab query throws rather than reading as "no tabs": callers would
// otherwise report an empty window (e.g. "Split into 0 windows") as success.
// Missing group details only cost the group info (getTabGroupsInfo copes).
async function getTabsWithGroupInfo(windowId = null) {
  const query = windowId ? { windowId } : {};
  const tabs = await chrome.tabs.query(query);
  const groupsMap = await getTabGroupsInfo(windowId);

  return tabs.map(tab => ({
    ...tab,
    groupInfo: tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? groupsMap.get(tab.groupId) : null
  }));
}

// Helper function to recreate tab groups when moving tabs between windows
async function recreateTabGroup(groupInfo, tabIds, targetWindowId) {
  try {
    if (!groupInfo || tabIds.length === 0) {
      return null;
    }
    
    // Create new group with the tabs
    const newGroupId = await chrome.tabs.group({
      tabIds: tabIds,
      createProperties: {
        windowId: targetWindowId
      }
    });
    
    // Update the group with the original properties
    await chrome.tabGroups.update(newGroupId, {
      title: groupInfo.title || '',
      color: groupInfo.color || 'grey',
      collapsed: groupInfo.collapsed || false
    });
    
    return newGroupId;
  } catch (error) {
    console.error('[Huddle] Error recreating tab group:', error);
    return null;
  }
}

// Helper function to move tabs while preserving group structure. Returns how
// many tabs actually moved: a batch Chrome rejects (a tab closed mid-run, a
// tab that can't be moved right now) is logged and skipped so the rest still
// move, and the caller reports the real count instead of the planned one.
async function moveTabsWithGroups(tabsToMove, targetWindowId) {
  // Group tabs by their original group; ungrouped tabs move first.
  const tabsByGroup = new Map([['ungrouped', []]]);

  for (const tab of tabsToMove) {
    const groupKey = tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? tab.groupId : 'ungrouped';
    if (!tabsByGroup.has(groupKey)) {
      tabsByGroup.set(groupKey, []);
    }
    tabsByGroup.get(groupKey).push(tab);
  }

  let moved = 0;
  for (const [groupKey, groupTabs] of tabsByGroup.entries()) {
    if (groupTabs.length === 0) continue;
    const tabIds = groupTabs.map(tab => tab.id);

    // Move tabs to target window first (grouped ones lose their group membership)
    try {
      await chrome.tabs.move(tabIds, { windowId: targetWindowId, index: -1 });
    } catch (error) {
      console.error('[Huddle] Error moving tabs with groups:', error);
      continue;
    }
    moved += tabIds.length;

    // Recreate the group if we have group info
    if (groupKey !== 'ungrouped' && groupTabs[0].groupInfo) {
      await recreateTabGroup(groupTabs[0].groupInfo, tabIds, targetWindowId);
    }
  }
  return moved;
}

async function handleClumpOpenUrls(message, sender, sendResponse) {
  try {
    const urls = Array.isArray(message.urls) ? message.urls : [];
    if (urls.length === 0) {
      sendResponse({ success: true, opened: 0 });
      return;
    }
    const senderTab = sender && sender.tab;
    const baseIndex = senderTab && typeof senderTab.index === 'number' ? senderTab.index + 1 : 0;
    const windowId = senderTab ? senderTab.windowId : undefined;
    const openerTabId = senderTab ? senderTab.id : undefined;
    for (let i = 0; i < urls.length; i++) {
      const createProps = {
        url: urls[i],
        active: false,
        index: baseIndex + i,
      };
      if (windowId !== undefined) createProps.windowId = windowId;
      if (openerTabId !== undefined) createProps.openerTabId = openerTabId;
      await chrome.tabs.create(createProps);
    }
    sendResponse({ success: true, opened: urls.length });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'log') {
    console.log('[Huddle]', message.data.message, ...message.data.args);
    sendResponse({ success: true });
  } else if (message.action === 'clumpOpenUrls') {
    handleClumpOpenUrls(message, _sender, sendResponse);
    return true; // async response
  } else if (message.action === 'sortAllWindows') {
    handleSortAllWindows(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'sortCurrentWindow') {
    handleSortCurrentWindow(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'removeDuplicatesWindow') {
    handleRemoveDuplicatesWindow(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'removeDuplicatesAllWindows') {
    handleRemoveDuplicatesAllWindows(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'removeDuplicatesGlobally') {
    handleRemoveDuplicatesGlobally(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'extractDomain') {
    handleExtractDomain(message, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'extractAllDomains') {
    handleExtractAllDomains(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'extractAllDomainsConfirmation') {
    handleExtractAllDomainsConfirmation(message, _sender, sendResponse);
    return true; // async response
  } else if (message.action === 'moveAllToSingleWindow') {
    handleMoveAllToSingleWindow(message, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'copyTabs') {
    // scope: 'window' (current window only) | 'all' (every window; default
    // for callers that omit the field).
    handleCopyTabs(message.respectGroups, sendResponse, message.scope || 'all');
    return true; // Keep message channel open for async response
  } else if (message.action === 'flattenWindow') {
    handleFlattenWindow(sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'compactWindow') {
    handleCompactWindow(sendResponse);
    return true;
  } else if (message.action === 'expandWindow') {
    handleExpandWindow(sendResponse);
    return true;
  } else if (message.action === 'aiGroupTabs') {
    handleAiGroupTabs(message, sendResponse);
    return true;
  } else if (message.action === 'applyAiProposal') {
    handleApplyAiProposal(message, _sender, sendResponse);
    return true;
  } else if (message.action === 'cancelAiProposal') {
    if (_sender.tab) {
      chrome.tabs.remove(_sender.tab.id);
    }
    sendResponse({ success: true });
  } else if (message.action === 'saveAiConfig') {
    saveAiConfig(message.config).then(saved => {
      sendResponse({ success: true, config: saved });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  } else if (message.action === 'loadAiConfig') {
    // Only the config: the catalog comes separately (loadOpenRouterModels), so
    // a slow catalog never holds up the key form.
    loadAiConfig().then((config) => {
      sendResponse({ protocol: AI_PROTOCOL, config, expiryPresets: EXPIRY_PRESETS, defaultModel: DEFAULT_MODEL });
    }).catch((err) => {
      // error says the config could not be read, so config: null is not
      // "no key on file".
      sendResponse({
        protocol: AI_PROTOCOL,
        config: null,
        error: err.message,
        expiryPresets: EXPIRY_PRESETS,
        defaultModel: DEFAULT_MODEL,
      });
    });
    return true;
  } else if (message.action === 'loadOpenRouterModels' || message.action === 'refreshOpenRouterModels') {
    // Always a models array, so a picker never gets an empty reply.
    getOpenRouterModels({ forceRefresh: message.action === 'refreshOpenRouterModels' })
      .then((catalog) => sendResponse(catalogReply(catalog)))
      .catch((err) => {
        console.error('[Huddle] catalog handler error:', err);
        sendResponse(catalogReply({ models: curatedModelsAsPickerEntries(), fetchedAt: null, fallback: true, error: err.message || String(err) }));
      });
    return true;
  } else if (message.action === 'saveAiDefaultModel') {
    saveAiDefaultModel(message.model, { allowUnlisted: !!message.allowUnlisted }).then((saved) => {
      sendResponse({ success: true, config: saved });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message, unlisted: !!err.unlisted });
    });
    return true;
  } else if (message.action === 'deleteAiKey') {
    deleteAiKey().then((saved) => {
      sendResponse({ success: true, config: saved });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  } else if (message.action === 'getSnoozePresets') {
    handleGetSnoozePresets(sendResponse);
    return true;
  } else if (message.action === 'snoozeTab') {
    handleSnoozeTab(message, sendResponse);
    return true;
  } else if (message.action === 'snoozeSelected') {
    handleSnoozeSelected(message, sendResponse);
    return true;
  } else if (message.action === 'snoozeWindow') {
    handleSnoozeWindow(message, sendResponse);
    return true;
  } else if (message.action === 'snoozeGroup') {
    handleSnoozeGroup(message, sendResponse);
    return true;
  } else if (message.action === 'listSnoozed') {
    handleListSnoozed(sendResponse);
    return true;
  } else if (message.action === 'wakeSnoozed') {
    handleWakeNow(message, sendResponse);
    return true;
  } else if (message.action === 'cancelSnoozed') {
    handleCancelSnooze(message, sendResponse);
    return true;
  } else if (message.action === 'restoreSnoozed') {
    handleRestoreSnoozed(message, sendResponse);
    return true;
  } else if (message && typeof message.action === 'string') {
    // Every action gets a reply. A page newer than this worker (the files
    // changed on disk, the worker did not) learns that here instead of from
    // a silently closed message port.
    sendResponse({ success: false, error: 'unknown-action', protocol: AI_PROTOCOL });
  }
});

// Give Chrome a moment to settle closed or moved tabs before re-sorting. The
// handlers await this (rather than sorting in a detached timer) so they reply
// only once the work is done, with counts the popup can report.
const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));

async function handleSortAllWindows(respectGroups = true, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Huddle] Sorting tabs in', windows.length, 'windows', respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Sort tabs within each window
    let unsorted = 0;
    for (const window of windows) {
      if (!(await sortWindowTabs(window.id, respectGroups))) unsorted++;
    }
    if (unsorted > 0) {
      throw new Error(`${unsorted} of ${windows.length} windows couldn't be sorted. Try again.`);
    }

    console.log('[Huddle] Completed sortAllWindows');
    sendResponse({
      success: true,
      tabs: windows.reduce((sum, w) => sum + w.tabs.length, 0),
      windows: windows.length,
    });

  } catch (error) {
    console.error('[Huddle] Error in sortAllWindows:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSortCurrentWindow(respectGroups = true, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    console.log('[Huddle] Sorting tabs in current window', respectGroups ? '(preserving groups)' : '(individual tabs)');

    if (!(await sortWindowTabs(tabs[0].windowId, respectGroups))) {
      throw new Error('The window couldn\'t be sorted. Try again.');
    }

    console.log('[Huddle] Completed sortCurrentWindow');
    sendResponse({ success: true, tabs: tabs.length });

  } catch (error) {
    console.error('[Huddle] Error in sortCurrentWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Extract domain from URL with better handling for sleeping tabs
function lexHost(url) {
  try {
    var u = new URL(url);

    if (u.protocol === 'chrome-extension:' || u.protocol === 'moz-extension:') {
      return u.host;
    }

    if (u.protocol === 'file:') {
      return 'file';
    }

    if (u.protocol === 'data:') {
      return 'data';
    }

    if (u.protocol === 'about:' || u.protocol === 'chrome:') {
      return u.host || u.pathname.split('/')[0];
    }

    return u.hostname;
  } catch (_e) {
    return url || '';
  }
}

async function handleExtractDomain(message, sendResponse) {
  try {
    const targetDomain = lexHost(message.url);
    const respectGroups = message.respectGroups !== undefined ? message.respectGroups : true;
    console.log('[Huddle] Extracting domain:', targetDomain, respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Moving tabs to the new window dissolves their splits; record them first.
    const splitPairs = await captureSplitPairs();

    // Create a window with the active tab in it
    const newWindow = await chrome.windows.create({
      tabId: message.tabId,
      focused: true
    });

    // Query tabs based on mode
    const allTabs = respectGroups ? await getTabsWithGroupInfo() : await chrome.tabs.query({});

    const tabsToMove = [];
    for (const tab of allTabs) {
      const tabDomain = lexHost(tab.url);
      // Skip pinned tabs and the active tab that's already in the new window
      if (tabDomain === targetDomain && tab.id !== message.tabId && !tab.pinned) {
        tabsToMove.push(tab);
      }
    }

    // Move matching tabs to the new window
    let moved = 0;
    if (tabsToMove.length > 0) {
      if (respectGroups) {
        moved = await moveTabsWithGroups(tabsToMove, newWindow.id);
      } else {
        // Simple move for individual mode
        const tabIds = tabsToMove.map(tab => tab.id);
        await chrome.tabs.move(tabIds, { windowId: newWindow.id, index: -1 });
        moved = tabIds.length;
      }
      console.log('[Huddle] Moved', moved, 'of', tabsToMove.length, 'tabs to new window');
    }
    await restoreSplitPairs(splitPairs);

    // Wait a moment for tabs to settle, then sort
    await settle();
    const sorted = await sortWindowTabs(newWindow.id, respectGroups);

    // Activate the original active tab
    await chrome.tabs.update(message.tabId, { active: true });

    console.log('[Huddle] Completed extractDomain');

    // The active tab went into the new window too.
    sendResponse({
      success: true,
      moved: moved + 1,
      notMoved: tabsToMove.length - moved,
      domain: targetDomain,
      sortFailed: !sorted,
    });

  } catch (error) {
    console.error('[Huddle] Error in extractDomain:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates within current window only
async function handleRemoveDuplicatesWindow(respectGroups = true, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    console.log('[Huddle] Removing duplicates in current window', respectGroups ? '(respecting groups)' : '(individual tabs)');

    const { tabsToRemove } = findDuplicateTabs([tabs], respectGroups);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Huddle] Removed', tabsToRemove.length, 'duplicate tabs from current window');
    }

    // Sort remaining tabs in the current window
    await settle();
    const sorted = await sortWindowTabs(tabs[0].windowId, respectGroups);
    console.log('[Huddle] Completed removeDuplicatesWindow');

    sendResponse({ success: true, removed: tabsToRemove.length, sortFailed: !sorted });

  } catch (error) {
    console.error('[Huddle] Error in removeDuplicatesWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates within each window separately
async function handleRemoveDuplicatesAllWindows(respectGroups = true, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Huddle] Removing duplicates in', windows.length, 'windows separately', respectGroups ? '(respecting groups)' : '(individual tabs)');

    const windowTabArrays = windows.map(window => window.tabs);
    const { tabsToRemove } = findDuplicateTabs(windowTabArrays, respectGroups);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Huddle] Removed', tabsToRemove.length, 'duplicate tabs across all windows');
    }

    // Sort all windows
    await settle();
    let unsorted = 0;
    for (const window of windows) {
      if (!(await sortWindowTabs(window.id, respectGroups))) unsorted++;
    }
    console.log('[Huddle] Completed removeDuplicatesAllWindows');

    sendResponse({ success: true, removed: tabsToRemove.length, sortFailed: unsorted > 0 });

  } catch (error) {
    console.error('[Huddle] Error in removeDuplicatesAllWindows:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates across all windows globally
async function handleRemoveDuplicatesGlobally(respectGroups = true, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Huddle] Removing duplicates globally across all windows', respectGroups ? '(respecting groups)' : '(individual tabs)');

    // Flatten all tabs from all windows for global deduplication
    const allTabs = windows.flatMap(window => window.tabs);
    const { tabsToRemove } = findDuplicateTabs([allTabs], respectGroups);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Huddle] Removed', tabsToRemove.length, 'duplicate tabs globally');
    }

    // Sort all windows
    await settle();
    let unsorted = 0;
    for (const window of windows) {
      if (!(await sortWindowTabs(window.id, respectGroups))) unsorted++;
    }
    console.log('[Huddle] Completed removeDuplicatesGlobally');

    sendResponse({ success: true, removed: tabsToRemove.length, sortFailed: unsorted > 0 });

  } catch (error) {
    console.error('[Huddle] Error in removeDuplicatesGlobally:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Helper function to find duplicate tabs while considering tab groups
function findDuplicateTabs(tabArrays, respectGroups = true) {
  const urlSeen = new Map();
  const tabsToRemove = [];

  // Process each array of tabs (either per window or globally)
  for (const tabs of tabArrays) {
    const localUrlSeen = new Map();

    // Group tabs by their group membership if respecting groups
    const tabsByGroup = new Map();
    if (respectGroups) {
      for (const tab of tabs) {
        const groupKey = tab.groupId || 'ungrouped';
        if (!tabsByGroup.has(groupKey)) {
          tabsByGroup.set(groupKey, []);
        }
        tabsByGroup.get(groupKey).push(tab);
      }
    } else {
      // Treat all tabs as one group if not respecting groups
      tabsByGroup.set('all', tabs);
    }

    // Process each group separately
    for (const [_groupKey, groupTabs] of tabsByGroup.entries()) {
      const groupUrlSeen = new Map();
      
      for (const tab of groupTabs) {
        // Never remove pinned tabs
        if (tab.pinned) {
          continue;
        }

        const url = tab.pendingUrl || tab.url;

        // For per-window deduplication, track within each window/group
        // For global deduplication, track across all windows but respect groups if enabled
        // Groups mode always dedups per-group (groupUrlSeen is scoped to a single
        // window+group pair), regardless of how many tab arrays were passed in —
        // a URL repeated in two different groups is NOT a duplicate.
        const seenMap = respectGroups
          ? groupUrlSeen
          : (tabArrays.length === 1 ? urlSeen : localUrlSeen);

        if (seenMap.has(url)) {
          // Duplicate. Prefer keeping the copy in a Split View — closing it
          // would pull a page off the user's screen mid-use while a background
          // duplicate survives. (Pinned tabs never reach this point at all.)
          const kept = seenMap.get(url);
          if (tabSplitViewId(tab) !== null && tabSplitViewId(kept) === null) {
            tabsToRemove.push(kept.id);
            seenMap.set(url, tab);
            if (tabArrays.length === 1) {
              urlSeen.set(url, tab);
            }
          } else {
            tabsToRemove.push(tab.id);
          }
        } else {
          // First occurrence - keep it
          seenMap.set(url, tab);
          if (tabArrays.length === 1) {
            // For global deduplication, also track in the global map
            urlSeen.set(url, tab);
          }
        }
      }
    }
  }

  return { tabsToRemove };
}

// Analyze all domains and their tab counts. A failed tab query throws: an
// empty analysis would report "Split into 0 windows" as success.
// excludeTabId leaves one tab out, e.g. the confirmation dialog's own tab,
// which is open while a restarted worker analyses the tabs again.
async function analyzeDomainDistribution(excludeTabId) {
  try {
    const allTabsWithGroups = await getTabsWithGroupInfo();
    const domainTabCounts = new Map();
    const domainTabs = new Map();

    // Count tabs per domain (exclude pinned tabs from extraction consideration)
    for (const tab of allTabsWithGroups) {
      if (tab.pinned) {continue;}
      if (excludeTabId !== undefined && tab.id === excludeTabId) {continue;}

      const domain = lexHost(tab.url);
      if (!domainTabCounts.has(domain)) {
        domainTabCounts.set(domain, 0);
        domainTabs.set(domain, []);
      }
      domainTabCounts.set(domain, domainTabCounts.get(domain) + 1);
      domainTabs.get(domain).push(tab);
    }

    // Separate domains by tab count
    const extractableDomains = [];
    const singleTabDomains = [];

    for (const [domain, count] of domainTabCounts.entries()) {
      if (count >= 2) {
        extractableDomains.push(domain);
      } else {
        singleTabDomains.push(domain);
      }
    }

    return {
      extractableDomains,
      singleTabDomains,
      domainTabCounts,
      domainTabs
    };
  } catch (error) {
    console.error('[Huddle] Error analyzing domain distribution:', error);
    throw error;
  }
}

// Split domains confirmations waiting for their dialog tab, keyed by that
// tab's id. The request itself is also saved in storage.session under
// splitConfirmKey(tabId), which outlives a worker restart; this map does not.
const splitConfirmWaiters = new Map();

function splitConfirmKey(tabId) {
  return `splitConfirm:${tabId}`;
}

// A dialog closed with its tab's X counts as Cancel.
chrome.tabs.onRemoved.addListener((tabId) => {
  const resolve = splitConfirmWaiters.get(tabId);
  if (resolve) {
    splitConfirmWaiters.delete(tabId);
    resolve(false);
  }
  chrome.storage.session.remove(splitConfirmKey(tabId)).catch(() => {});
});

// Create confirmation dialog URL with parameters
function createConfirmationDialogUrl(domainAnalysis) {
  const extractableCount = domainAnalysis.extractableDomains.length;
  const singleTabCount = domainAnalysis.singleTabDomains.length;

  const params = new URLSearchParams({
    extractable: extractableCount.toString(),
    single: singleTabCount.toString()
  });

  return chrome.runtime.getURL(`confirmation-dialog.html?${params.toString()}`);
}

// Handle Extract All Domains functionality
async function handleExtractAllDomains(respectGroups = true, sendResponse) {
  try {
    console.log('[Huddle] Starting Extract All Domains', respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Analyze all domains and their tab counts
    const domainAnalysis = await analyzeDomainDistribution();

    // Check if confirmation is needed (more than 5 total windows would be created)
    const totalWindowsToCreate = domainAnalysis.extractableDomains.length + (domainAnalysis.singleTabDomains.length > 0 ? 1 : 0);
    const needsConfirmation = totalWindowsToCreate > 5;

    if (needsConfirmation) {
      console.log('[Huddle] Many windows would be created, requesting confirmation');

      // Create a confirmation dialog using the separate HTML file
      const confirmationUrl = createConfirmationDialogUrl(domainAnalysis);
      const confirmTab = await chrome.tabs.create({
        url: confirmationUrl,
        active: true
      });

      // The dialog's answer arrives through handleExtractAllDomainsConfirmation.
      // The request is also kept in storage.session, so the answer still
      // works if the worker is stopped while the dialog is open.
      const confirmationPromise = new Promise((resolve) => {
        splitConfirmWaiters.set(confirmTab.id, resolve);
      });
      await chrome.storage.session.set({ [splitConfirmKey(confirmTab.id)]: { respectGroups } })
        .catch((error) => console.error('[Huddle] Could not save the Split domains request:', error));

      const confirmed = await confirmationPromise;
      if (!confirmed) {
        console.log('[Huddle] User cancelled Extract All Domains');
        sendResponse({ success: true, cancelled: true });
        return;
      }
    }

    sendResponse(await extractAndSortAllDomains(domainAnalysis, respectGroups));

  } catch (error) {
    console.error('[Huddle] Error in Extract All Domains:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Extract every domain, then sort all windows. Returns the response to send.
async function extractAndSortAllDomains(domainAnalysis, respectGroups) {
  const { windows: created, notMoved } = await performExtractAllDomains(domainAnalysis, respectGroups);

  // Sort all windows after operations
  await settle();
  const windows = await chrome.windows.getAll({ populate: true });
  let unsorted = 0;
  for (const window of windows) {
    if (!(await sortWindowTabs(window.id, respectGroups))) unsorted++;
  }
  console.log('[Huddle] Completed Extract All Domains');

  return { success: true, windows: created, notMoved, sortFailed: unsorted > 0 };
}

// The dialog's Confirm or Cancel. While handleExtractAllDomains is still
// waiting, it gets the answer. After a worker restart it is gone, so the
// request saved in storage.session is carried out here. With neither, the
// dialog is told the request has ended.
async function handleExtractAllDomainsConfirmation(message, sender, sendResponse) {
  const tabId = sender && sender.tab ? sender.tab.id : undefined;
  const closeDialog = () => {
    if (tabId !== undefined) chrome.tabs.remove(tabId).catch(() => {});
  };
  try {
    const key = splitConfirmKey(tabId);
    const waiter = splitConfirmWaiters.get(tabId);
    const stored = (await chrome.storage.session.get(key))[key];
    splitConfirmWaiters.delete(tabId);
    await chrome.storage.session.remove(key);

    if (waiter) {
      sendResponse({ success: true });
      closeDialog();
      waiter(message.confirmed === true);
      return;
    }
    if (!message.confirmed) {
      sendResponse({ success: true, cancelled: true });
      closeDialog();
      return;
    }
    if (!stored) {
      sendResponse({ success: false, expired: true, error: 'This split request has ended. Close this tab and run Split domains again.' });
      return;
    }
    // Analysed afresh, without the dialog's own tab, which is still open.
    const domainAnalysis = await analyzeDomainDistribution(tabId);
    const result = await extractAndSortAllDomains(domainAnalysis, stored.respectGroups !== false);
    sendResponse(result);
    closeDialog();
  } catch (error) {
    console.error('[Huddle] Error in Extract All Domains confirmation:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Perform the actual extraction logic. Returns { windows, notMoved }: the
// windows it created and the tabs that should have joined one but stayed put.
async function performExtractAllDomains(domainAnalysis, respectGroups = true) {
  let windows = 0;
  let notMoved = 0;
  // Move tabs into a new window, counting the ones that didn't go.
  const moveInto = async (tabs, windowId) => {
    if (tabs.length === 0) return;
    if (respectGroups) {
      notMoved += tabs.length - await moveTabsWithGroups(tabs, windowId);
    } else {
      await chrome.tabs.move(tabs.map(tab => tab.id), { windowId, index: -1 });
    }
  };
  try {
    console.log('[Huddle] Performing extraction for', domainAnalysis.extractableDomains.length, 'domains', respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Moving tabs between windows dissolves their splits; record them first.
    const splitPairs = await captureSplitPairs();

    // Phase 1: Create one window per domain with ≥2 tabs
    for (const domain of domainAnalysis.extractableDomains) {
      const domainTabs = domainAnalysis.domainTabs.get(domain);

      if (domainTabs.length < 2) {continue;}

      // Use the first tab as the anchor for the new window
      const anchorTab = domainTabs[0];

      // Create new window with the anchor tab
      const newWindow = await chrome.windows.create({
        tabId: anchorTab.id,
        focused: false // Don't focus individual domain windows
      });
      windows++;

      // Move other tabs from this domain to the new window
      await moveInto(domainTabs.slice(1), newWindow.id);

      console.log('[Huddle] Created window for domain:', domain, 'with', domainTabs.length, 'tabs');
    }

    // Phase 2: Create one "Miscellaneous" window for all single-tab domains
    if (domainAnalysis.singleTabDomains.length > 0) {
      console.log('[Huddle] Creating miscellaneous window for', domainAnalysis.singleTabDomains.length, 'single-tab domains');

      // Use the first single-tab domain as the anchor
      const firstSingleDomain = domainAnalysis.singleTabDomains[0];
      const firstTab = domainAnalysis.domainTabs.get(firstSingleDomain)[0];

      const miscWindow = await chrome.windows.create({
        tabId: firstTab.id,
        focused: false
      });
      windows++;

      // Move all other single tabs to the miscellaneous window
      const singleTabsToMove = [];
      for (let i = 1; i < domainAnalysis.singleTabDomains.length; i++) {
        const domain = domainAnalysis.singleTabDomains[i];
        const tab = domainAnalysis.domainTabs.get(domain)[0];
        singleTabsToMove.push(tab);
      }

      await moveInto(singleTabsToMove, miscWindow.id);

      console.log('[Huddle] Created miscellaneous window with', domainAnalysis.singleTabDomains.length, 'single-tab domains');
    }

    await restoreSplitPairs(splitPairs);

    console.log('[Huddle] Extract All Domains extraction phase completed');
    return { windows, notMoved };

  } catch (error) {
    console.error('[Huddle] Error in performExtractAllDomains:', error);
    throw error;
  }
}

// Split View pairs share a positive splitViewId; everything else — including
// every tab on Chrome versions without the property, and the API's documented
// "not guaranteed even when split" case — reads as null here, which downstream
// code treats as "not split".
const SPLIT_VIEW_ID_NONE = (chrome.tabs && chrome.tabs.SPLIT_VIEW_ID_NONE) ?? -1;

function tabSplitViewId(tab) {
  const id = tab.splitViewId;
  return (id == null || id === SPLIT_VIEW_ID_NONE) ? null : id;
}

// Sort tabs by URL, but keep Split View pairs together: a pair sorts as one
// unit keyed by its left tab's URL, members staying in left-to-right order.
// Best effort — Chrome may still dissolve a split on programmatic moves, but
// adjacency is the arrangement most likely to preserve it, and the worst case
// is two neighboring tabs. Expects tabs in tab-strip order; a pair whose
// members were partitioned apart (one pinned, different groups) degrades to
// two independent tabs.
function sortTabsAsUnits(tabs) {
  const units = [];
  const unitBySplitId = new Map();

  for (const tab of tabs) {
    const splitId = tabSplitViewId(tab);
    if (splitId !== null && unitBySplitId.has(splitId)) {
      unitBySplitId.get(splitId).push(tab);
    } else {
      const unit = [tab];
      units.push(unit);
      if (splitId !== null) unitBySplitId.set(splitId, unit);
    }
  }

  units.sort((a, b) => {
    const urlA = a[0].pendingUrl || a[0].url;
    const urlB = b[0].pendingUrl || b[0].url;
    return urlA.localeCompare(urlB);
  });

  return units.flat();
}

// Sort a window's tabs. The batch move dissolves every Split View it touches,
// so the pairs are recorded first and split again afterwards; this covers every
// operation that ends in a sort (sort, dedup, AI organize, extract, merge).
// Resolves true once sorted, false if it couldn't be.
async function sortWindowTabs(windowId, respectGroups = true) {
  const splitPairs = await captureSplitPairs([windowId]);
  const sorted = await moveTabsIntoSortedOrder(windowId, respectGroups);
  await restoreSplitPairs(splitPairs);
  return sorted;
}

// A tab that closes between the query and the batch move makes Chrome reject
// the whole move, so the first failure re-queries and tries once more.
async function moveTabsIntoSortedOrder(windowId, respectGroups = true) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await sortWindowTabsOnce(windowId, respectGroups);
      return true;
    } catch (error) {
      console.error(`[Huddle] Error sorting window tabs (attempt ${attempt}):`, error);
    }
  }
  return false;
}

// One pass of sortWindowTabs: query the window's tabs and move them into order.
async function sortWindowTabsOnce(windowId, respectGroups) {
  const tabsWithGroups = respectGroups ? await getTabsWithGroupInfo(windowId) : await chrome.tabs.query({ windowId });
  
  // Separate pinned tabs (never move these)
  const pinnedTabs = tabsWithGroups.filter(tab => tab.pinned);
  const unpinnedTabs = tabsWithGroups.filter(tab => !tab.pinned);
  
  if (!respectGroups) {
    // Simple sort for individual mode (Split View pairs stay together)
    const sortedTabs = sortTabsAsUnits(unpinnedTabs);

    // Move tabs to sorted positions as a batch (omit windowId — tabs are
    // already in this window)
    if (sortedTabs.length > 0) {
      await chrome.tabs.move(
        sortedTabs.map(t => t.id),
        { index: pinnedTabs.length }
      );
    }
    return;
  }

  // Group-aware sorting logic
  const ungroupedTabs = [];
  const groupedTabsMap = new Map();

  for (const tab of unpinnedTabs) {
    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      ungroupedTabs.push(tab);
    } else {
      if (!groupedTabsMap.has(tab.groupId)) {
        groupedTabsMap.set(tab.groupId, []);
      }
      groupedTabsMap.get(tab.groupId).push(tab);
    }
  }

  // Sort ungrouped tabs by URL (Split View pairs stay together)
  const sortedUngrouped = sortTabsAsUnits(ungroupedTabs);

  // Sort tabs within each group by URL (Split View pairs stay together)
  for (const [groupId, groupTabs] of groupedTabsMap.entries()) {
    groupedTabsMap.set(groupId, sortTabsAsUnits(groupTabs));
  }

  // Determine the final order: pinned tabs, then ungrouped tabs, then grouped tabs
  let currentIndex = pinnedTabs.length;

  // Move ungrouped tabs first as a batch (omit windowId — tabs are already
  // in this window, and passing windowId can trigger Chrome's cross-window
  // group migration)
  if (sortedUngrouped.length > 0) {
    await chrome.tabs.move(
      sortedUngrouped.map(t => t.id),
      { index: currentIndex }
    );
  }
  currentIndex += sortedUngrouped.length;

  // Move grouped tabs as a batch per group to avoid Chrome's group migration
  // behavior that can occur with sequential single-tab moves
  for (const [_groupId, groupTabs] of groupedTabsMap.entries()) {
    await chrome.tabs.move(
      groupTabs.map(t => t.id),
      { index: currentIndex }
    );
    currentIndex += groupTabs.length;
  }
}

// Format tabs as text for clipboard copy
function formatTabsAsText(tabs, respectGroups = true) {
  if (tabs.length === 0) return '';

  if (!respectGroups) {
    return tabs.map(tab => tab.pendingUrl || tab.url).join('\n');
  }

  // Check if any tabs actually belong to a group
  const hasAnyGroups = tabs.some(tab => tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE);

  if (!hasAnyGroups) {
    // No groups at all — just list URLs without headers
    return tabs.map(tab => tab.pendingUrl || tab.url).join('\n');
  }

  // Organize tabs by group
  const groups = new Map();
  const ungrouped = [];

  for (const tab of tabs) {
    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      ungrouped.push(tab);
    } else {
      if (!groups.has(tab.groupId)) {
        groups.set(tab.groupId, []);
      }
      groups.get(tab.groupId).push(tab);
    }
  }

  const sections = [];

  // Add grouped sections (URLs only, no headers)
  for (const [_groupId, groupTabs] of groups.entries()) {
    const urls = groupTabs.map(tab => tab.pendingUrl || tab.url);
    urls.sort();
    sections.push(urls.join('\n'));
  }

  // Add ungrouped section
  if (ungrouped.length > 0) {
    const urls = ungrouped.map(tab => tab.pendingUrl || tab.url);
    urls.sort();
    sections.push(urls.join('\n'));
  }

  return sections.join('\n\n');
}

async function handleFlattenWindow(sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groupedTabIds = tabs
      .filter(tab => tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
      .map(tab => tab.id);

    console.log('[Huddle] Flattening current window,', groupedTabIds.length, 'grouped tabs');

    if (groupedTabIds.length > 0) {
      await chrome.tabs.ungroup(groupedTabIds);
    }

    sendResponse({ success: true, ungrouped: groupedTabIds.length });
  } catch (error) {
    console.error('[Huddle] Error in flattenWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Chrome 155+ can create and remove Split Views; older versions only expose
// the read-only splitViewId, and Compact/Expand stay unavailable there.
function splitWriteSupported() {
  return typeof chrome.tabs.createSplit === 'function' &&
    typeof chrome.tabs.unsplit === 'function';
}

// Pair neighbouring tabs for Compact without moving anything. Chrome only
// splits two adjacent tabs that share pinned state and group, so the strip is
// cut into runs at every pinned/group change and at every tab already in a
// split; each run pairs (0,1), (2,3), … and an odd last tab stays unpaired.
function planCompactPairs(tabs) {
  const ordered = [...tabs].sort((a, b) => a.index - b.index);
  const pairs = [];
  let pending = null;

  for (const tab of ordered) {
    if (tabSplitViewId(tab) !== null) {
      pending = null;
      continue;
    }
    if (pending && pending.pinned === tab.pinned && pending.groupId === tab.groupId) {
      pairs.push([pending.id, tab.id]);
      pending = null;
    } else {
      pending = tab;
    }
  }

  return pairs;
}

async function handleCompactWindow(sendResponse) {
  try {
    if (!splitWriteSupported()) {
      sendResponse({ success: false, error: 'unsupported' });
      return;
    }
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const pairs = planCompactPairs(tabs);

    console.log('[Huddle] Compacting current window into', pairs.length, 'split views');

    // One pair at a time: a rejected pair (e.g. a tab closed meanwhile) must
    // not stop the rest.
    let paired = 0;
    let failed = 0;
    for (const pair of pairs) {
      try {
        await chrome.tabs.createSplit(pair);
        paired++;
      } catch (error) {
        failed++;
        console.error('[Huddle] Could not split tabs', pair, error);
      }
    }

    sendResponse({ success: true, paired, failed });
  } catch (error) {
    console.error('[Huddle] Error in compactWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleExpandWindow(sendResponse) {
  try {
    if (!splitWriteSupported()) {
      sendResponse({ success: false, error: 'unsupported' });
      return;
    }
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const splitIds = [...new Set(tabs.map(tabSplitViewId).filter(id => id !== null))];

    console.log('[Huddle] Expanding', splitIds.length, 'split views in current window');

    let unsplit = 0;
    let failed = 0;
    for (const splitId of splitIds) {
      try {
        await chrome.tabs.unsplit(splitId);
        unsplit++;
      } catch (error) {
        failed++;
        console.error('[Huddle] Could not unsplit', splitId, error);
      }
    }

    sendResponse({ success: true, unsplit, failed });
  } catch (error) {
    console.error('[Huddle] Error in expandWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Re-pairing dissolved Split Views (#46). Chrome dissolves a split whenever one
// of its tabs is moved, even by a batch move that leaves the pair adjacent and
// in order, so operations that move tabs record the pairs beforehand and split
// them again afterwards. Only pairs that existed before are restored, and only
// where Chrome's rules allow it; tabs are never moved to make a pair possible.

// The [leftId, rightId] pairs currently split in the given windows (every
// window when windowIds is null). Empty where the write API is missing, since
// nothing could be restored there.
async function captureSplitPairs(windowIds = null) {
  if (!splitWriteSupported()) return [];
  try {
    const tabs = windowIds
      ? (await Promise.all(windowIds.map(windowId => chrome.tabs.query({ windowId })))).flat()
      : await chrome.tabs.query({});
    const bySplit = new Map();
    for (const tab of [...tabs].sort((a, b) => a.windowId - b.windowId || a.index - b.index)) {
      const splitId = tabSplitViewId(tab);
      if (splitId === null) continue;
      if (!bySplit.has(splitId)) bySplit.set(splitId, []);
      bySplit.get(splitId).push(tab.id);
    }
    return [...bySplit.values()].filter(ids => ids.length === 2);
  } catch (error) {
    console.error('[Huddle] Could not record split pairs:', error);
    return [];
  }
}

// Split each recorded pair again when both tabs are still open, unsplit,
// adjacent, and share window, pinned state and group. Returns how many were
// restored; pairs that no longer qualify are left as they are.
async function restoreSplitPairs(pairs) {
  let restored = 0;
  if (!splitWriteSupported()) return restored;
  for (const pair of pairs) {
    let tabs;
    try {
      tabs = await Promise.all(pair.map(id => chrome.tabs.get(id)));
    } catch (_e) {
      continue; // a half was closed
    }
    const [left, right] = tabs.sort((a, b) => a.index - b.index);
    if (tabSplitViewId(left) !== null || tabSplitViewId(right) !== null) continue;
    if (left.windowId !== right.windowId || left.pinned !== right.pinned || left.groupId !== right.groupId) continue;
    if (right.index !== left.index + 1) continue;
    try {
      await chrome.tabs.createSplit([left.id, right.id]);
      restored++;
    } catch (error) {
      console.error('[Huddle] Could not restore split', [left.id, right.id], error);
    }
  }
  return restored;
}

async function handleCopyTabs(respectGroups = true, sendResponse, scope = 'all') {
  try {
    const scopeLabel = scope === 'window' ? 'current window' : 'all windows';
    console.log(
      '[Huddle] Copying tabs from',
      scopeLabel,
      respectGroups ? '(preserving groups)' : '(individual tabs)'
    );

    let tabs;
    if (scope === 'window') {
      // Same "current window" resolution as sort/dedupe/flatten: the last
      // focused window (the one the popup was opened from).
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      tabs = win && win.id != null ? await getTabsWithGroupInfo(win.id) : [];
    } else {
      tabs = await getTabsWithGroupInfo();
    }
    const text = formatTabsAsText(tabs, respectGroups);

    sendResponse({ success: true, text, tabCount: tabs.length });
  } catch (error) {
    console.error('[Huddle] Error in copyTabs:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleMoveAllToSingleWindow(message, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Huddle] Moving tabs from', windows.length, 'windows to single window');

    if (windows.length <= 1) {
      console.log('[Huddle] Only one window exists, nothing to move');
      sendResponse({ success: true, moved: 0 });
      return;
    }

    // Find the target window containing the active tab
    let targetWindow = null;
    if (message.activeTabId) {
      targetWindow = windows.find(w => w.tabs.some(tab => tab.id === message.activeTabId));
    }

    if (!targetWindow) {
      // If no active tab provided or found, use the focused window
      targetWindow = windows.find(w => w.focused);
      if (!targetWindow) {
        // If no focused window, use the first window as target
        targetWindow = windows[0];
      }
    }

    const tabsToMove = [];

    // Collect all unpinned tabs from other windows with their group info
    for (const window of windows) {
      if (window.id !== targetWindow.id) {
        const windowTabsWithGroups = await getTabsWithGroupInfo(window.id);
        for (const tab of windowTabsWithGroups) {
          if (!tab.pinned) {
            tabsToMove.push(tab);
          }
        }
      }
    }

    if (tabsToMove.length === 0) {
      console.log('[Huddle] No unpinned tabs to move');
      sendResponse({ success: true, moved: 0 });
      return;
    }

    // Moving tabs between windows dissolves their splits; record them first.
    const splitPairs = await captureSplitPairs();

    // Move tabs based on mode
    const respectGroups = message.respectGroups !== undefined ? message.respectGroups : true;
    let moved;
    if (respectGroups) {
      moved = await moveTabsWithGroups(tabsToMove, targetWindow.id);
    } else {
      const tabIds = tabsToMove.map(tab => tab.id);
      await chrome.tabs.move(tabIds, { windowId: targetWindow.id, index: -1 });
      moved = tabIds.length;
    }
    await restoreSplitPairs(splitPairs);

    console.log('[Huddle] Moved', moved, 'of', tabsToMove.length, 'unpinned tabs to single window');

    // Wait a moment for tabs to settle, then sort tabs in the target window
    await settle();
    const sorted = await sortWindowTabs(targetWindow.id, respectGroups);

    console.log('[Huddle] Completed moveAllToSingleWindow');

    // Bring the target window into focus
    await chrome.windows.update(targetWindow.id, { focused: true });

    // If we have an active tab ID, make sure it stays active
    if (message.activeTabId) {
      await chrome.tabs.update(message.activeTabId, { active: true });
    }

    sendResponse({ success: true, moved, notMoved: tabsToMove.length - moved, sortFailed: !sorted });

  } catch (error) {
    console.error('[Huddle] Error in moveAllToSingleWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ============================================================
// Tab Snoozing — Constants and Pure Helpers
// ============================================================

const SNOOZE_STORAGE_KEY = 'snoozedItems';
const SNOOZE_ALARM_PREFIX = 'snooze:';

// Ordered list of the five presets. Times are computed on demand by
// computePresetWakeTime — this array holds only key + label metadata.
const SNOOZE_PRESETS = [
  { key: 'laterToday', label: 'Later today' },
  { key: 'tonight', label: 'Tonight' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'weekend', label: 'This weekend' },
  { key: 'nextWeek', label: 'Next week' },
];

// Next occurrence of weekday `targetDow` (0=Sun..6=Sat) at `hour`:00 local time.
// - strictlyAfterToday === false: strictly after `now` (used by `weekend`).
// - strictlyAfterToday === true:  strictly after *today* (used by `nextWeek`).
function nextWeekdayAt(now, targetDow, hour, strictlyAfterToday) {
  const base = new Date(now);
  const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, 0, 0, 0);
  const dayDiff = (targetDow - base.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + dayDiff);
  if (strictlyAfterToday) {
    // "next week" semantics: the target weekday is never today.
    if (dayDiff === 0) {
      candidate.setDate(candidate.getDate() + 7);
    }
  } else if (candidate.getTime() <= now) {
    // "weekend" semantics: allow today if the hour is still ahead.
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate.getTime();
}

// Returns the wake time (epoch ms, local) for a preset key. Throws on unknown.
function computePresetWakeTime(preset, now = Date.now()) {
  const base = new Date(now);
  switch (preset) {
    case 'laterToday':
      return now + 3 * 60 * 60 * 1000;
    case 'tonight': {
      const tonight = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 18, 0, 0, 0);
      if (now >= tonight.getTime()) {
        return now + 60 * 60 * 1000;
      }
      return tonight.getTime();
    }
    case 'tomorrow': {
      const tomorrow = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 9, 0, 0, 0);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.getTime();
    }
    case 'weekend':
      return nextWeekdayAt(now, 6, 9, false);
    case 'nextWeek':
      return nextWeekdayAt(now, 1, 9, true);
    default:
      throw new Error('Unknown snooze preset: ' + preset);
  }
}

// Safety net against clock skew / popup-open drift: never schedule in the past.
function clampWakeAt(wakeAt, now = Date.now()) {
  return Math.max(wakeAt, now + 60000);
}

// Allowlist per the Edge Cases table. Rejects unparseable / null / '' and
// this extension's own pages.
function isSnoozeableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  let u;
  try {
    u = new URL(url);
  } catch (_e) {
    return false;
  }
  const protocol = u.protocol;
  if (protocol === 'http:' || protocol === 'https:' || protocol === 'file:') {
    return true;
  }
  if (protocol === 'about:') {
    return u.pathname === 'blank';
  }
  if (protocol === 'chrome-extension:') {
    // Allow foreign extension pages, but not our own (they cannot be reopened
    // meaningfully and would resurrect the extension's own UI).
    let ownId;
    try {
      ownId = chrome.runtime.getURL('').split('/')[2];
    } catch (_e) {
      ownId = '';
    }
    return u.host !== ownId;
  }
  return false;
}

// Truncate a tab title to the stored maximum (60 chars).
function truncateSnoozeTitle(title) {
  return (title || '').slice(0, 60);
}

// Primary key generator. Uses crypto.randomUUID() (available in MV3 service
// workers); falls back to a UUIDv4 shim in environments that lack it.
function generateSnoozeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// "1 tab" / "3 tabs".
function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// The `summary` string shown in the sleeping list (captured at snooze time).
function buildSnoozeSummary(type, tabs, groupInfo) {
  const n = tabs.length;
  switch (type) {
    case 'tab': {
      const first = tabs[0] || {};
      const title = first.title ? first.title : (first.url || '');
      return truncateSnoozeTitle(title);
    }
    case 'tabs':
      return `${plural(n, 'selected tab')}`;
    case 'group': {
      const title = groupInfo && groupInfo.title ? groupInfo.title : '(unnamed)';
      return `Group "${title}" (${plural(n, 'tab')})`;
    }
    case 'window':
      return `Window (${plural(n, 'tab')})`;
    default:
      return plural(n, 'tab');
  }
}

// Assemble a full snooze record (pure — generates id/createdAt/summary and
// truncates titles). `tabs` may already carry a `groupIndex` (window type).
function createSnoozeRecord({ type, tabs, group, groups, windowId, wakeAt, preset }) {
  const normalizedTabs = tabs
    .map((t) => {
      const entry = {
        url: t.url,
        title: truncateSnoozeTitle(t.title),
        pinned: !!t.pinned,
        index: t.index,
      };
      if (typeof t.groupIndex === 'number') {
        entry.groupIndex = t.groupIndex;
      }
      return entry;
    })
    .sort((a, b) => a.index - b.index);

  const record = {
    id: generateSnoozeId(),
    type,
    summary: buildSnoozeSummary(type, normalizedTabs, group),
    createdAt: Date.now(),
    wakeAt,
    preset,
    windowId,
    tabs: normalizedTabs,
  };

  if (type === 'group' && group) {
    record.group = { title: group.title || '', color: group.color || 'grey' };
  }
  if (type === 'window' && groups && groups.length > 0) {
    record.groups = groups.map((g) => ({ title: g.title || '', color: g.color || 'grey' }));
  }

  return record;
}

// ============================================================
// Tab Snoozing — Storage and Scheduling
// ============================================================

// Serializes all read-modify-write cycles on `snoozedItems` within this worker.
let snoozeLock = Promise.resolve();
function withSnoozeLock(fn) {
  const run = snoozeLock.then(() => fn());
  // Keep the chain alive regardless of whether `fn` resolved or rejected.
  snoozeLock = run.then(() => {}, () => {});
  return run;
}

// Reads the sleeping list. A failed read throws, for every caller: the
// callers that change the list write it back, and writing back an empty list
// read from a failure would erase every snooze. Nothing stored yet reads as [].
async function loadSnoozedItems() {
  const result = await chrome.storage.local.get([SNOOZE_STORAGE_KEY]);
  const items = result && result[SNOOZE_STORAGE_KEY];
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) throw new Error('The sleeping tabs could not be read');
  return items;
}

async function saveSnoozedItems(items) {
  await chrome.storage.local.set({ [SNOOZE_STORAGE_KEY]: items });
}

function scheduleSnoozeAlarm(record) {
  return chrome.alarms.create(SNOOZE_ALARM_PREFIX + record.id, { when: record.wakeAt });
}

// ============================================================
// Tab Snoozing — Snooze Path
// ============================================================

// Resolve the effective wakeAt for an incoming snooze message. Presets are
// clamped to now + 60s; a custom time in the past is rejected outright.
function clampOrRejectWakeAt(message, now = Date.now()) {
  const incoming = message.wakeAt;
  if (message.preset === 'custom') {
    if (typeof incoming !== 'number' || Number.isNaN(incoming) || incoming < now + 60000) {
      return { error: 'Wake time is in the past' };
    }
    return { value: incoming };
  }
  const base = typeof incoming === 'number' && !Number.isNaN(incoming) ? incoming : now;
  return { value: clampWakeAt(base, now) };
}

function handleGetSnoozePresets(sendResponse) {
  const now = Date.now();
  const presets = SNOOZE_PRESETS.map((p) => ({
    key: p.key,
    label: p.label,
    wakeAt: computePresetWakeTime(p.key, now),
  }));
  sendResponse({ success: true, presets });
}

// Build a Map of groupId -> { title, color } for every group represented in
// `tabs` (used to capture window-level group structure).
async function getSnoozeGroupInfoMap(tabs) {
  const map = new Map();
  const groupIds = [
    ...new Set(
      tabs
        .map((t) => t.groupId)
        .filter((id) => id !== undefined && id !== chrome.tabGroups.TAB_GROUP_ID_NONE)
    ),
  ];
  for (const gid of groupIds) {
    try {
      const g = await chrome.tabGroups.get(gid);
      map.set(gid, { title: g.title || '', color: g.color || 'grey' });
    } catch (_e) {
      map.set(gid, { title: '', color: 'grey' });
    }
  }
  return map;
}

// Shared core for all four snooze units. Implements steps 1-8 of the snooze
// flow. `extras` may carry { windowId, groupInfo, groupInfoMap }.
async function snoozeTabs(type, tabs, extras, wakeAt, preset) {
  const source = Array.isArray(tabs) ? tabs : [];

  // Incognito tabs must never be written into chrome.storage.local (persistent,
  // non-incognito storage) — doing so would leak incognito browsing outside
  // its boundary. A single active incognito tab gets a specific error; the
  // multi-tab units silently exclude incognito tabs, same as any other
  // non-snoozeable tab.
  if (type === 'tab' && source.length > 0 && source.every((t) => t.incognito === true)) {
    return { success: false, error: 'Incognito tabs can\'t be snoozed' };
  }
  const nonIncognito = source.filter((t) => t.incognito !== true);

  // 2. Filter snoozeable URLs (non-snoozeable tabs are silently left open).
  const snoozeable = nonIncognito.filter((t) => isSnoozeableUrl(t.url));
  if (snoozeable.length === 0) {
    // A single-tab snooze of a rejected URL gets a page-specific message; the
    // multi-tab units report the generic "nothing here" error.
    const error = type === 'tab' ? 'This page can\'t be snoozed' : 'Nothing here can be snoozed';
    return { success: false, error };
  }

  // 1. Order ascending by tab.index.
  snoozeable.sort((a, b) => a.index - b.index);

  // Capture group structure for `window`; build the record-level groups array
  // and per-tab groupIndex.
  let recordGroups;
  let preparedTabs = snoozeable;
  if (type === 'window') {
    const groupInfoMap = (extras && extras.groupInfoMap) || new Map();
    const groupIdToIndex = new Map();
    recordGroups = [];
    for (const t of snoozeable) {
      const gid = t.groupId;
      if (gid !== undefined && gid !== chrome.tabGroups.TAB_GROUP_ID_NONE && !groupIdToIndex.has(gid)) {
        const gi = groupInfoMap.get(gid);
        groupIdToIndex.set(gid, recordGroups.length);
        recordGroups.push({
          title: gi ? gi.title || '' : '',
          color: gi ? gi.color || 'grey' : 'grey',
        });
      }
    }
    preparedTabs = snoozeable.map((t) => {
      const entry = { url: t.url, title: t.title, pinned: t.pinned, index: t.index };
      const gid = t.groupId;
      if (gid !== undefined && gid !== chrome.tabGroups.TAB_GROUP_ID_NONE && groupIdToIndex.has(gid)) {
        entry.groupIndex = groupIdToIndex.get(gid);
      }
      return entry;
    });
    if (recordGroups.length === 0) recordGroups = undefined;
  }

  const groupInfo = type === 'group' ? extras && extras.groupInfo : undefined;

  // 3. Build the record.
  const record = createSnoozeRecord({
    type,
    tabs: preparedTabs,
    group: groupInfo,
    groups: recordGroups,
    windowId: extras && extras.windowId,
    wakeAt,
    preset,
  });

  // 4. Persist first (under the lock) — a crash before close can at worst leave
  // a duplicate, never lose data.
  await withSnoozeLock(async () => {
    const items = await loadSnoozedItems();
    items.push(record);
    await saveSnoozedItems(items);
  });

  // 5. Schedule the alarm.
  await scheduleSnoozeAlarm(record);

  // 6. Last-window guard: keep Chrome alive if we're about to empty the only
  // normal window.
  await guardLastWindowBeforeClose(snoozeable);

  // 7. Close the tabs (closing all of a window's tabs closes the window). If
  // Chrome refuses, it stops at the first tab it can't close, so the tabs
  // before it may already be gone. Check which are still open: the record
  // keeps only the tabs that really closed, and when none did, the record and
  // its alarm are dropped so "could not snooze" leaves nothing to reopen.
  try {
    await chrome.tabs.remove(snoozeable.map((t) => t.id));
  } catch (error) {
    const stillOpen = await Promise.all(
      snoozeable.map((t) => chrome.tabs.get(t.id).then(() => true, () => false))
    );
    // record.tabs is in the same index order as snoozeable.
    const closedTabs = record.tabs.filter((_t, i) => !stillOpen[i]);
    if (closedTabs.length === record.tabs.length) {
      return { success: true, record };
    }
    if (closedTabs.length > 0) {
      record.tabs = closedTabs;
      record.summary = buildSnoozeSummary(record.type, closedTabs, record.group);
    }
    await withSnoozeLock(async () => {
      const items = await loadSnoozedItems();
      await saveSnoozedItems(
        closedTabs.length > 0
          ? items.map((item) => (item.id === record.id ? record : item))
          : items.filter((item) => item.id !== record.id)
      );
    });
    if (closedTabs.length === 0) {
      await chrome.alarms.clear(SNOOZE_ALARM_PREFIX + record.id);
      throw error;
    }
    throw new Error(`Snoozed ${closedTabs.length} of ${snoozeable.length} tabs; ${error.message}`, {
      cause: error,
    });
  }

  // 8. Done.
  return { success: true, record };
}

async function guardLastWindowBeforeClose(tabsToClose) {
  try {
    // Cheap check first: only pay for a tab query when there is exactly one
    // normal window (populate:true on every snooze fetched every tab of every
    // window just to service this guard).
    const windows = await chrome.windows.getAll({ populate: false, windowTypes: ['normal'] });
    if (!Array.isArray(windows) || windows.length !== 1) return;
    const tabs = await chrome.tabs.query({ windowId: windows[0].id });
    const closingIds = new Set(tabsToClose.map((t) => t.id));
    const remaining = (tabs || []).filter((t) => !closingIds.has(t.id));
    if (remaining.length === 0) {
      await chrome.tabs.create({ url: 'chrome://newtab/', active: true });
    }
  } catch (_e) {
    // Best effort — never block the snooze on the guard.
  }
}

async function handleSnoozeTab(message, sendResponse) {
  try {
    const w = clampOrRejectWakeAt(message);
    if (w.error) {
      sendResponse({ success: false, error: w.error });
      return;
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await snoozeTabs(
      'tab',
      tabs,
      { windowId: tabs[0] && tabs[0].windowId },
      w.value,
      message.preset
    );
    sendResponse(result);
  } catch (error) {
    console.error('[Huddle] Error in snoozeTab:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSnoozeSelected(message, sendResponse) {
  try {
    const w = clampOrRejectWakeAt(message);
    if (w.error) {
      sendResponse({ success: false, error: w.error });
      return;
    }
    const tabs = await chrome.tabs.query({ highlighted: true, currentWindow: true });
    const result = await snoozeTabs(
      'tabs',
      tabs,
      { windowId: tabs[0] && tabs[0].windowId },
      w.value,
      message.preset
    );
    sendResponse(result);
  } catch (error) {
    console.error('[Huddle] Error in snoozeSelected:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSnoozeWindow(message, sendResponse) {
  try {
    const w = clampOrRejectWakeAt(message);
    if (w.error) {
      sendResponse({ success: false, error: w.error });
      return;
    }
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groupInfoMap = await getSnoozeGroupInfoMap(tabs);
    const result = await snoozeTabs(
      'window',
      tabs,
      { windowId: tabs[0] && tabs[0].windowId, groupInfoMap },
      w.value,
      message.preset
    );
    sendResponse(result);
  } catch (error) {
    console.error('[Huddle] Error in snoozeWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSnoozeGroup(message, sendResponse) {
  try {
    const w = clampOrRejectWakeAt(message);
    if (w.error) {
      sendResponse({ success: false, error: w.error });
      return;
    }
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];
    const groupId = activeTab && activeTab.groupId;
    if (groupId === undefined || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      sendResponse({ success: false, error: 'Active tab is not in a group' });
      return;
    }
    const tabs = await chrome.tabs.query({ groupId, currentWindow: true });
    let groupInfo;
    try {
      const g = await chrome.tabGroups.get(groupId);
      groupInfo = { title: g.title || '', color: g.color || 'grey' };
    } catch (_e) {
      groupInfo = { title: '', color: 'grey' };
    }
    const result = await snoozeTabs(
      'group',
      tabs,
      { windowId: activeTab.windowId, groupInfo },
      w.value,
      message.preset
    );
    sendResponse(result);
  } catch (error) {
    console.error('[Huddle] Error in snoozeGroup:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ============================================================
// Tab Snoozing — Wake Path
// ============================================================
//
// A snoozed record stays in storage until its wake has finished: its tabs
// exist nowhere else, so removing it first (as Huddle did up to 0.6.0) lost
// every tab not yet reopened when the worker died, the extension reloaded or
// the browser quit mid-wake. While a record wakes it carries a claim:
//
//   record.waking = { by, boot, since, attempts, stalled,
//                     opened: [{ i, tabId, windowId }], failed: [i],
//                     windowId, placeholderTabId, groupId, baseline }
//
// - `by` is WAKER_ID, this worker instance; `boot` is BOOT_ID, this browser
//   session and extension load (see getBootId).
// - `opened[k].i` indexes record.tabs; a tab is written to `opened` right
//   after it is created, so an interruption leaves at most the one tab created
//   but not yet saved to open twice.
// - `baseline[url]` counts the tabs already showing that URL when the wake
//   began, so a restart never mistakes them for tabs the wake reopened.
// - `attempts` counts claims. Automatic retries stop after
//   WAKE_MAX_ATTEMPTS: the claim is then `stalled` and waits for Wake now.
//
// A record whose wake reopened nothing keeps no claim but `wakeFailedAt`, and
// also waits for Wake now. specs/tab-snoozing.md ("Waking") has the full
// protocol and the bounds it keeps.

// notificationId -> { windowId, tabId } for best-effort click focusing. This
// map is memory-resident and lossy across service-worker respawns (documented).
const snoozeNotificationTargets = new Map();

// This worker instance. A claim whose `by` is another id belongs to a worker
// that has since stopped.
const WAKER_ID = generateSnoozeId();
// Ids of the records this instance is waking right now (or has marked to
// resume). A claimed record in here is "active"; one that is not is
// "interrupted", whoever claimed it.
const wakingNow = new Set();
const WAKE_MAX_ATTEMPTS = 3;
// Timings, in one object so the unit harness can shorten them.
const WAKE_TIMING = {
  retryMs: 60000,
  settlePollMs: 1000,
  settleQuietPolls: 5,
  settleMaxMs: 20000,
};
const BOOT_ID_KEY = 'huddleBootId';
const BOOT_KIND_KEY = 'huddleBootKind';
const RESTORE_SETTLED_KEY = 'huddleRestoreSettled';

// A checkpoint in a wake. It does nothing unless a test or the audit's
// wake-stage build defines globalThis.__huddleWakeHook, which can then stop
// the wake at exactly this point. Stages: 'claimed', 'after-window-create',
// 'after-create:<i>', 'after-progress:<i>', 'before-group', 'before-remove'.
async function wakeStage(name, detail) {
  const hook = globalThis.__huddleWakeHook;
  if (typeof hook === 'function') {
    await hook(detail === undefined ? name : `${name}:${detail}`);
  }
}

// storage.session survives a worker restart and is cleared by a browser
// restart and by an extension reload, update or re-enable, so its id names
// "this boot": within one boot, tab and window ids keep their meaning.
let bootIdPromise = null;
function getBootId() {
  if (!bootIdPromise) {
    bootIdPromise = (async () => {
      const got = await chrome.storage.session.get(BOOT_ID_KEY);
      if (got && typeof got[BOOT_ID_KEY] === 'string') return got[BOOT_ID_KEY];
      const id = generateSnoozeId();
      await chrome.storage.session.set({ [BOOT_ID_KEY]: id });
      return id;
    })();
    bootIdPromise.catch(() => { bootIdPromise = null; });
  }
  return bootIdPromise;
}

// How this boot began, as the runtime's own events said: 'restart' after
// runtime.onStartup or onInstalled 'chrome_update' / 'install' (every id from
// before is meaningless), 'reload' after onInstalled 'update' (ids are still
// valid). null while none has arrived. Kept in storage.session so every
// worker instance of this boot knows it.
async function getBootKind() {
  const got = await chrome.storage.session.get(BOOT_KIND_KEY);
  const kind = got && got[BOOT_KIND_KEY];
  return kind === 'restart' || kind === 'reload' ? kind : null;
}

// A restart outranks a reload: Chrome can apply an update as it starts.
async function setBootKind(kind) {
  if (kind === 'reload' && (await getBootKind()) === 'restart') return 'restart';
  await chrome.storage.session.set({ [BOOT_KIND_KEY]: kind });
  return kind;
}

function snoozeAlarmName(id) {
  return SNOOZE_ALARM_PREFIX + id;
}

// The recovery alarm: if this worker stops, it starts a new one within a
// minute, which resumes the wake.
async function armRecoveryAlarm(id) {
  try {
    await chrome.alarms.create(snoozeAlarmName(id), { when: Date.now() + WAKE_TIMING.retryMs });
  } catch (error) {
    console.warn('[Huddle] Could not arm the wake recovery alarm:', error && error.message);
  }
}

async function clearSnoozeAlarm(id) {
  try {
    await chrome.alarms.clear(snoozeAlarmName(id));
  } catch (_e) {
    // harmless if already cleared
  }
}

// Stalled claims, and records none of whose tabs could be reopened, wait for
// the user: no alarm, reconciler or worker start retries them.
function isWakeHeld(record) {
  return !!(record.wakeFailedAt || (record.waking && record.waking.stalled));
}

// 'active' | 'interrupted' | null, as listSnoozed reports it.
function wakeStateOf(record) {
  if (wakingNow.has(record.id)) return 'active';
  return record.waking ? 'interrupted' : null;
}

async function windowExists(windowId) {
  if (windowId === undefined || windowId === null) return false;
  try {
    return !!(await chrome.windows.get(windowId));
  } catch (_e) {
    return false;
  }
}

async function getTabOrNull(tabId) {
  if (typeof tabId !== 'number') return null;
  try {
    return (await chrome.tabs.get(tabId)) || null;
  } catch (_e) {
    return null;
  }
}

// Tabs in regular (normal, non-incognito) windows, in window then tab order.
async function regularWindowTabs() {
  const windows = await chrome.windows.getAll({ populate: false, windowTypes: ['normal'] });
  const regular = new Map();
  (windows || []).forEach((w, n) => { if (!w.incognito) regular.set(w.id, n); });
  const tabs = (await chrome.tabs.query({})) || [];
  return tabs
    .filter((t) => regular.has(t.windowId))
    .sort((a, b) => (regular.get(a.windowId) - regular.get(b.windowId)) || (a.index - b.index));
}

function tabShowsUrl(tab, url) {
  return !!tab && (tab.url === url || tab.pendingUrl === url);
}

// How many regular-window tabs already show each of the record's URLs.
async function snoozeBaseline(record) {
  const baseline = {};
  try {
    const tabs = await regularWindowTabs();
    for (const url of new Set(record.tabs.map((t) => t.url))) {
      baseline[url] = tabs.filter((t) => tabShowsUrl(t, url)).length;
    }
  } catch (_e) {
    // no baseline: a restart then reserves nothing for this record
  }
  return baseline;
}

// Find the window to restore tab/tabs/group records into: the last-focused
// normal window, creating one if none exists.
// Memoize the in-flight lookup so concurrent wakes (e.g. several alarms
// firing at once with no normal window open) share one target window instead
// of each creating its own and splitting the restore across windows.
let restoreTargetInFlight = null;

async function getRestoreTargetWindowId() {
  if (restoreTargetInFlight) return restoreTargetInFlight;
  restoreTargetInFlight = (async () => {
    try {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      if (win && win.id !== undefined && win.id !== null) {
        return win.id;
      }
    } catch (_e) {
      // fall through to creating a window
    }
    const created = await chrome.windows.create({ focused: false });
    return created.id;
  })();
  try {
    return await restoreTargetInFlight;
  } finally {
    restoreTargetInFlight = null;
  }
}

// ---- Claiming ----

// Writes a claim, under the lock. `prepare(record)` returns the new claim
// for the stored record, or a { status } to stop with. The recovery alarm is
// armed before the claim is written: if the worker stops in between, the
// record is unclaimed and that alarm wakes it, a minute late.
async function writeClaim(id, prepare) {
  return withSnoozeLock(async () => {
    const items = await loadSnoozedItems();
    const record = items.find((r) => r.id === id);
    if (!record) return { status: 'missing' };
    const next = await prepare(record);
    if (next.status) return next;
    await armRecoveryAlarm(id);
    await wakeStage('claimed');
    delete record.wakeFailedAt;
    record.waking = next.waking;
    await saveSnoozedItems(items);
    return { status: 'claimed', record };
  });
}

// Stops automatic retries of a claim: it waits, visibly, for Wake now.
async function stallClaim(id) {
  let stalled = null;
  await withSnoozeLock(async () => {
    const items = await loadSnoozedItems();
    const record = items.find((r) => r.id === id);
    if (!record || !record.waking || record.waking.stalled) return;
    record.waking.stalled = true;
    await saveSnoozedItems(items);
    stalled = record;
  });
  if (stalled) {
    await clearSnoozeAlarm(id);
    notifyStalled(stalled);
  }
  return stalled;
}

// Claim a record of this boot: a fresh wake, or a resume of an interrupted
// one. `trigger` is 'alarm', 'reconcile', 'resume' (worker start) or
// 'wakeNow'; only Wake now resets the attempts and wakes a held record.
async function claimInThisBoot(id, bootId, trigger) {
  const automatic = trigger !== 'wakeNow';
  const baselineFor = async (record) => (record.waking && record.waking.baseline) || snoozeBaseline(record);
  const result = await writeClaim(id, async (record) => {
    if (automatic && isWakeHeld(record)) return { status: 'held' };
    const w = record.waking;
    if (w && w.boot !== bootId) return { status: 'earlier-boot' };
    if (automatic && w && (w.attempts || 0) >= WAKE_MAX_ATTEMPTS) return { status: 'stall' };
    const waking = {
      by: WAKER_ID,
      boot: bootId,
      since: w ? w.since : Date.now(),
      attempts: w && automatic ? (w.attempts || 0) + 1 : 1,
      stalled: false,
      opened: w && Array.isArray(w.opened) ? w.opened : [],
      failed: [],
      windowId: w ? w.windowId : null,
      placeholderTabId: w ? w.placeholderTabId : null,
      groupId: w ? w.groupId : null,
      baseline: await baselineFor(record),
      // New Tabs a restart resume found in a reused group or window: still
      // to close when this wake ends.
      ...(w && Array.isArray(w.strayTabIds) && w.strayTabIds.length ? { strayTabIds: w.strayTabIds } : {}),
    };
    return { waking };
  });
  if (result.status === 'stall') {
    await stallClaim(id);
    return { status: 'held' };
  }
  return result;
}

// ---- Resuming a claim from an earlier boot ----

// How many tabs per URL session restore should bring back for `records`: the
// most any record found already open (its baseline), plus every tab the
// records had reopened with that URL. A URL showing only in a tab that was
// already open must not end the wait early.
function expectedRestoreCounts(records) {
  const need = {};
  for (const r of records) {
    const baseline = (r.waking && r.waking.baseline) || {};
    for (const e of (r.waking && r.waking.opened) || []) {
      const url = r.tabs[e.i] && r.tabs[e.i].url;
      if (!url) continue;
      need[url] = Math.max(need[url] || 0, baseline[url] || 0);
    }
  }
  for (const r of records) {
    for (const e of (r.waking && r.waking.opened) || []) {
      const url = r.tabs[e.i] && r.tabs[e.i].url;
      if (url) need[url] += 1;
    }
  }
  return need;
}

// Wait for the browser to finish restoring the last session: poll the tab
// count until every URL shows in as many tabs as `need` expects, the count
// stops changing, or settleMaxMs passes. Once per boot.
async function waitForSessionRestore(need) {
  const settled = await chrome.storage.session.get(RESTORE_SETTLED_KEY);
  if (settled && settled[RESTORE_SETTLED_KEY]) return;
  const start = Date.now();
  let lastCount = -1;
  let quiet = 0;
  while (Date.now() - start < WAKE_TIMING.settleMaxMs) {
    let tabs = [];
    try {
      tabs = await regularWindowTabs();
    } catch (_e) {
      tabs = [];
    }
    if (Object.entries(need).every(([u, n]) => tabs.filter((t) => tabShowsUrl(t, u)).length >= n)) break;
    if (tabs.length === lastCount) {
      quiet++;
      if (quiet >= WAKE_TIMING.settleQuietPolls) break;
    } else {
      quiet = 0;
      lastCount = tabs.length;
    }
    await new Promise((resolve) => setTimeout(resolve, WAKE_TIMING.settlePollMs));
  }
  await chrome.storage.session.set({ [RESTORE_SETTLED_KEY]: true });
}

// After an extension reload ids are still valid: an opened entry is done when
// its tab still exists and still shows the record's URL (ids can collide
// with an unrelated tab when this was in fact a browser restart).
async function verifyAfterReload(record) {
  const w = record.waking;
  const opened = [];
  for (const entry of w.opened || []) {
    const tab = await getTabOrNull(entry.tabId);
    const want = record.tabs[entry.i] && record.tabs[entry.i].url;
    if (tab && tabShowsUrl(tab, want)) opened.push({ i: entry.i, tabId: tab.id, windowId: tab.windowId });
  }
  const windowId = (await windowExists(w.windowId)) ? w.windowId : null;
  let groupId = null;
  if (w.groupId !== undefined && w.groupId !== null) {
    try {
      await chrome.tabGroups.get(w.groupId);
      groupId = w.groupId;
    } catch (_e) {
      groupId = null;
    }
  }
  const placeholder = windowId !== null ? await getTabOrNull(w.placeholderTabId) : null;
  return { opened, windowId, groupId, placeholderTabId: placeholder ? placeholder.id : null };
}

// After a browser restart ids mean nothing. Only tabs a record had already
// reopened can be matched, by exact URL, in regular windows; each open tab is
// used once across all records (oldest claim first), and for each URL the
// first baseline[url] tabs are left alone as tabs that were open before.
// `verified` holds, per record, the entries the reload check already
// confirmed by id: those are kept as they are, their tabs are used by no
// other entry, and only the rest are matched by URL.
async function matchAfterRestart(records, verified = new Map()) {
  const tabs = await regularWindowTabs();
  const groups = await chrome.tabGroups.query({}).then((g) => g || [], () => []);
  const used = new Set();
  for (const v of verified.values()) for (const e of v.opened) used.add(e.tabId);
  const adoptedGroups = new Set();
  const results = new Map();
  for (const record of [...records].sort((a, b) => (a.waking.since || 0) - (b.waking.since || 0))) {
    const w = record.waking;
    const baseline = w.baseline || {};
    const kept = verified.has(record.id) ? verified.get(record.id).opened : [];
    const opened = [...kept];
    for (const entry of w.opened || []) {
      if (kept.some((e) => e.i === entry.i)) continue;
      const url = record.tabs[entry.i] && record.tabs[entry.i].url;
      const showing = tabs.filter((t) => tabShowsUrl(t, url));
      const free = showing.slice(baseline[url] || 0).find((t) => !used.has(t.id));
      if (free) {
        used.add(free.id);
        opened.push({ i: entry.i, tabId: free.id, windowId: free.windowId });
      }
    }
    const mine = new Set(opened.map((e) => e.tabId));
    const matched = tabs.filter((t) => mine.has(t.id));
    // Session restore brings back a tab whose first page had not committed
    // yet as a New Tab. Those are this wake's own leftovers, so they don't
    // stop a group or window from being reused, and they are closed at the end.
    const isNewTab = (t) => tabShowsUrl(t, 'chrome://newtab/');
    let groupId = null;
    let strayTabIds = [];
    if (record.type === 'group' && matched.length > 0) {
      const gid = matched[0].groupId;
      const others = tabs.filter((t) => t.groupId === gid && !mine.has(t.id));
      const sameGroup = gid !== undefined && gid !== chrome.tabGroups.TAB_GROUP_ID_NONE
        && matched.every((t) => t.groupId === gid) && others.every(isNewTab);
      if (sameGroup) {
        groupId = gid;
        strayTabIds = others.map((t) => t.id);
      }
    }
    if (record.type === 'group' && groupId === null && record.group) {
      // Nothing matched inside a group: a restored group with the record's
      // title and colour that holds only New Tabs is this wake's own group,
      // restored before any of its pages committed. Reuse it.
      const own = groups.find((g) => !adoptedGroups.has(g.id)
        && g.title === (record.group.title || '') && g.color === (record.group.color || 'grey')
        && tabs.some((t) => t.groupId === g.id)
        && tabs.filter((t) => t.groupId === g.id).every((t) => mine.has(t.id) || isNewTab(t)));
      if (own) {
        groupId = own.id;
        strayTabIds = tabs.filter((t) => t.groupId === own.id && !mine.has(t.id)).map((t) => t.id);
      }
    }
    if (groupId !== null) adoptedGroups.add(groupId);
    let windowId = null;
    let placeholderTabId = null;
    if (record.type === 'window' && matched.length > 0) {
      const wid = matched[0].windowId;
      const others = tabs.filter((t) => t.windowId === wid && !mine.has(t.id));
      if (matched.every((t) => t.windowId === wid) && others.every(isNewTab)) {
        windowId = wid;
        placeholderTabId = others.length > 0 ? others[0].id : null;
        strayTabIds = others.slice(1).map((t) => t.id);
      }
    }
    results.set(record.id, { opened, windowId, groupId, placeholderTabId, strayTabIds });
  }
  return results;
}

// Reload mode, for the opened entries the reload check could not confirm by
// id: they fall to the restart rule (URL matching). This boot may in fact be
// a browser restart whose onInstalled('update') came before onStartup (Chrome
// applying a pending update as it starts), and then every id is stale while
// session restore brings the reopened tabs back. The records whose entries
// all passed are left exactly as the reload check found them.
async function matchUnverifiedAfterReload(candidates, verified) {
  const unverified = candidates.filter((r) => (r.waking.opened || []).length > verified.get(r.id).opened.length);
  if (unverified.length === 0) return verified;
  // Verified records' tabs are open too and take their share of each URL.
  await waitForSessionRestore(expectedRestoreCounts(candidates));
  const matched = await matchAfterRestart(unverified, verified);
  const merged = new Map(verified);
  for (const r of unverified) {
    const v = verified.get(r.id);
    const m = matched.get(r.id);
    // A group or window the reload check found by id wins; otherwise the
    // matcher's (with the New Tabs it found in it, closed at the end).
    const groupId = v.groupId !== null ? v.groupId : m.groupId;
    const windowId = v.windowId !== null ? v.windowId : m.windowId;
    const fromMatcher = (v.groupId === null && m.groupId !== null) || (v.windowId === null && m.windowId !== null);
    merged.set(r.id, {
      opened: m.opened,
      windowId,
      groupId,
      placeholderTabId: v.windowId !== null ? v.placeholderTabId : m.placeholderTabId,
      strayTabIds: fromMatcher ? m.strayTabIds : [],
    });
  }
  return merged;
}

// Resume every claim made in an earlier boot, in one batch. `mode` is
// 'restart' or 'reload'. Before any tab is created, all of them are
// re-stamped in one write with this boot, this instance and only the opened
// entries that were verified or matched (with their current ids), so any
// later interruption is a same-boot resume where `opened` is authoritative.
// `reserved` are ids the caller already put in wakingNow for this resume.
// `wakeNowId` is the record you pressed Wake now on: it is resumed even when
// it waits for you (stalled, or none of its tabs reopened), and only its
// attempts start again from 1. Every other held record keeps waiting.
let earlierBootResume = null;
// Resolves once the running resume has re-stamped its records (or given up).
let earlierBootRestamped = Promise.resolve();
function resumeEarlierBoot(mode, { reserved = [], wakeNowId = null } = {}) {
  if (earlierBootResume) {
    // One resume at a time. Records the caller reserved, or a Wake now the
    // running resume leaves out, run in the next one.
    if (reserved.length === 0 && wakeNowId === null) return earlierBootResume;
    return earlierBootResume.then((previous) => (reserved.length === 0 && previous.has(wakeNowId)
      ? previous
      : resumeEarlierBoot(mode, { reserved, wakeNowId })));
  }
  let restampDone;
  earlierBootRestamped = new Promise((resolve) => { restampDone = resolve; });
  earlierBootResume = (async () => {
    const results = new Map();
    const restamped = [];
    let ids = [...reserved];
    try {
      const bootId = await getBootId();
      const items = await loadSnoozedItems();
      const candidates = items.filter((r) => r.waking && r.waking.boot !== bootId
        && (reserved.includes(r.id) || !wakingNow.has(r.id))
        && (r.id === wakeNowId || !isWakeHeld(r)));
      for (const id of reserved) if (!candidates.some((r) => r.id === id)) wakingNow.delete(id);
      ids = candidates.map((r) => r.id);
      for (const id of ids) wakingNow.add(id);
      if (candidates.length === 0) return results;
      let found;
      if (mode === 'restart') {
        await waitForSessionRestore(expectedRestoreCounts(candidates));
        found = await matchAfterRestart(candidates);
      } else {
        found = new Map();
        for (const r of candidates) found.set(r.id, await verifyAfterReload(r));
        found = await matchUnverifiedAfterReload(candidates, found);
      }
      const stall = [];
      await withSnoozeLock(async () => {
        const current = await loadSnoozedItems();
        for (const id of ids) await armRecoveryAlarm(id);
        await wakeStage('claimed');
        for (const record of current) {
          const w = record.waking;
          const seen = candidates.find((c) => c.id === record.id);
          if (!seen || !w || w.boot !== seen.waking.boot || w.by !== seen.waking.by) continue;
          const pressed = record.id === wakeNowId;
          const attempts = pressed ? 1 : (w.attempts || 0) + 1;
          const f = found.get(record.id);
          record.waking = {
            by: WAKER_ID,
            boot: bootId,
            since: w.since,
            attempts,
            stalled: false,
            opened: f.opened,
            failed: [],
            windowId: f.windowId,
            placeholderTabId: f.placeholderTabId,
            groupId: f.groupId,
            baseline: w.baseline || {},
            ...(f.strayTabIds && f.strayTabIds.length ? { strayTabIds: f.strayTabIds } : {}),
          };
          if (!pressed && attempts > WAKE_MAX_ATTEMPTS) stall.push(record.id);
          else restamped.push(record.id);
        }
        await saveSnoozedItems(current);
      });
      restampDone();
      for (const id of stall) {
        wakingNow.delete(id);
        await stallClaim(id);
        results.set(id, { held: true });
      }
    } catch (error) {
      console.error('[Huddle] Could not resume the wakes of an earlier session:', error);
      for (const id of ids) {
        if (restamped.includes(id)) continue;
        wakingNow.delete(id);
        results.set(id, { interrupted: true, error: error.message });
      }
    } finally {
      restampDone();
    }
    for (const id of restamped) {
      results.set(id, await runClaimedWake(id, { notify: true }));
    }
    return results;
  })();
  earlierBootResume.finally(() => { earlierBootResume = null; }).catch(() => {});
  return earlierBootResume;
}

// ---- Waking ----

// Wakes one record: claims it, reopens what is not open yet, then removes it.
// Returns null when there is no such record, { waking: 'active' } when this
// instance is already waking it, { held } for a record that waits for Wake
// now, { deferred } for a claim from an earlier boot whose kind is not known
// yet, { interrupted, error } when the wake stopped early (a recovery alarm
// then resumes it), and otherwise { record, createdCount, failedCount, kept }.
async function wakeSnoozedRecord(id, { notify = false, trigger = 'wakeNow' } = {}) {
  if (wakingNow.has(id)) {
    if (trigger === 'alarm') await armRecoveryAlarm(id);
    return { waking: 'active' };
  }
  wakingNow.add(id);
  let claim;
  try {
    const bootId = await getBootId();
    claim = await claimInThisBoot(id, bootId, trigger);
  } catch (error) {
    wakingNow.delete(id);
    // Try again in a minute (a no-op if there is no such record by then).
    if (trigger !== 'wakeNow') await armRecoveryAlarm(id);
    throw error;
  }
  if (claim.status === 'claimed') return runClaimedWake(id, { notify });
  wakingNow.delete(id);
  if (claim.status === 'missing') return null;
  if (claim.status === 'held') return { held: true };
  // A claim from an earlier boot.
  const kind = await getBootKind();
  if (kind || trigger === 'wakeNow') {
    // With no startup event yet, Wake now uses the reload check (tab id and
    // URL), which never counts a tab that is not there as reopened.
    const results = await resumeEarlierBoot(kind || 'reload', { wakeNowId: trigger === 'wakeNow' ? id : null });
    return results.get(id) || (wakingNow.has(id) ? { waking: 'active' } : { held: true });
  }
  return deferEarlierBootClaim(id);
}

// Neither onStartup nor onInstalled has told this boot how it began (they may
// still be on their way, or the extension was re-enabled, which fires
// neither). Wait one alarm period; if the claim is still from an earlier boot
// then, resume it with the reload check.
async function deferEarlierBootClaim(id) {
  const bootId = await getBootId();
  let seenBefore = false;
  await withSnoozeLock(async () => {
    const items = await loadSnoozedItems();
    const record = items.find((r) => r.id === id);
    if (!record || !record.waking) return;
    if (record.waking.deferredIn === bootId) {
      seenBefore = true;
      return;
    }
    record.waking.deferredIn = bootId;
    await saveSnoozedItems(items);
  });
  if (seenBefore) {
    const results = await resumeEarlierBoot('reload');
    return results.get(id) || { deferred: true };
  }
  await armRecoveryAlarm(id);
  return { deferred: true };
}

// Saves wake progress into the claim, under the lock. Throws when the claim
// is no longer this instance's (the record is gone), which ends the wake.
async function saveWakeProgress(id, patch) {
  await withSnoozeLock(async () => {
    const items = await loadSnoozedItems();
    const record = items.find((r) => r.id === id);
    if (!record || !record.waking || record.waking.by !== WAKER_ID) {
      throw new Error('This wake is no longer claimed');
    }
    Object.assign(record.waking, patch);
    await saveSnoozedItems(items);
  });
}

// Runs a wake this instance has claimed (the id is in wakingNow).
async function runClaimedWake(id, { notify }) {
  let result = null;
  try {
    const items = await loadSnoozedItems();
    const record = items.find((r) => r.id === id);
    if (!record || !record.waking) return null;
    const progress = {
      opened: [...(record.waking.opened || [])],
      failed: [],
      windowId: record.waking.windowId ?? null,
      placeholderTabId: record.waking.placeholderTabId ?? null,
      groupId: record.waking.groupId ?? null,
      strayTabIds: record.waking.strayTabIds || [],
    };
    if (record.type === 'window') {
      await reopenWindowRecord(record, progress);
    } else {
      await reopenTabsRecord(record, progress);
    }
    await closeStrayTabs(progress.strayTabIds);
    await wakeStage('before-remove');
    result = await completeWake(id, progress, { notify });
    return result;
  } catch (error) {
    console.error('[Huddle] A wake stopped before it finished; it will be resumed:', error);
    return { interrupted: true, error: error.message };
  } finally {
    wakingNow.delete(id);
    if (!result) await afterUnfinishedWake(id);
  }
}

// The claim is still there but this wake did not finish: retry in a minute,
// or, after the last attempt, stop and wait for Wake now.
async function afterUnfinishedWake(id) {
  try {
    const items = await loadSnoozedItems();
    const record = items.find((r) => r.id === id);
    if (!record || !record.waking || record.waking.by !== WAKER_ID || record.waking.stalled) return;
    if ((record.waking.attempts || 0) >= WAKE_MAX_ATTEMPTS) {
      await stallClaim(id);
    } else {
      await armRecoveryAlarm(id);
    }
  } catch (error) {
    // The alarm armed with the claim is still set, and resumes the wake.
    console.error('[Huddle] Could not check an unfinished wake:', error);
  }
}

// tab / tabs / group: reopen each tab not yet done into one window, saving
// after each. A group record creates its group with its first new tab, in the
// same save, and later tabs join it.
async function reopenTabsRecord(record, progress) {
  const done = new Set(progress.opened.map((e) => e.i));
  let windowId = (await windowExists(progress.windowId)) ? progress.windowId : null;
  if (windowId === null) windowId = await getRestoreTargetWindowId();

  let groupId = null;
  let adopt = [];
  if (record.type === 'group') {
    if (progress.groupId !== null && progress.groupId !== undefined) {
      try {
        await chrome.tabGroups.get(progress.groupId);
        groupId = progress.groupId;
      } catch (_e) {
        groupId = null;
      }
    }
    if (groupId === null) {
      // The group went away: the new one also takes the reopened tabs that
      // are still open and in no group.
      for (const entry of progress.opened) {
        const tab = await getTabOrNull(entry.tabId);
        if (tab && (tab.groupId === undefined || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE)) adopt.push(tab.id);
      }
    }
  }

  for (let i = 0; i < record.tabs.length; i++) {
    if (done.has(i)) continue;
    const t = record.tabs[i];
    let created;
    try {
      // No `index` here: chrome.tabs.create (unlike tabs.move) does not accept
      // -1 as "append at the end" — it throws "index: Value must be at least
      // 0". Omitting `index` already appends the tab as the last one in the
      // window, which is the behavior we want.
      created = await chrome.tabs.create({ windowId, url: t.url, pinned: !!t.pinned, active: false });
    } catch (e) {
      progress.failed.push(i);
      console.warn('[Huddle] Failed to restore snoozed tab:', t.url, e && e.message);
      continue;
    }
    await wakeStage('after-create', i);
    if (record.type === 'group') {
      groupId = await joinOrCreateWakeGroup(record, groupId, [created.id, ...adopt], windowId);
      adopt = [];
      progress.groupId = groupId;
    }
    progress.opened.push({ i, tabId: created.id, windowId: created.windowId ?? windowId });
    progress.windowId = windowId;
    await saveWakeProgress(record.id, {
      opened: progress.opened, failed: progress.failed, windowId, groupId: progress.groupId,
    });
    await wakeStage('after-progress', i);
  }
}

async function joinOrCreateWakeGroup(record, groupId, tabIds, windowId) {
  if (groupId !== null && groupId !== undefined) {
    try {
      await chrome.tabs.group({ groupId, tabIds });
      return groupId;
    } catch (_e) {
      // the group went away: make a new one
    }
  }
  try {
    const newGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    await chrome.tabGroups.update(newGroupId, {
      title: (record.group && record.group.title) || '',
      color: (record.group && record.group.color) || 'grey',
    });
    return newGroupId;
  } catch (_e) {
    return null; // best effort: the tab stays where it is, and the next one tries again
  }
}

// window (D18): open an empty window and save its id first, then reopen the
// tabs into it one by one with a save after each, then remove the New Tab,
// pin, and recreate the groups. At worst an interruption leaves one tab
// twice and one empty window, never a second copy of the whole window.
async function reopenWindowRecord(record, progress) {
  const done = new Set(progress.opened.map((e) => e.i));
  let windowId = (await windowExists(progress.windowId)) ? progress.windowId : null;
  if (windowId === null) {
    const win = await chrome.windows.create({ focused: false });
    await wakeStage('after-window-create');
    windowId = win.id;
    progress.windowId = windowId;
    progress.placeholderTabId = (win.tabs && win.tabs[0] && win.tabs[0].id) ?? null;
    await saveWakeProgress(record.id, { windowId, placeholderTabId: progress.placeholderTabId });
  }

  for (let i = 0; i < record.tabs.length; i++) {
    if (done.has(i)) continue;
    const t = record.tabs[i];
    let created;
    try {
      created = await chrome.tabs.create({ windowId, url: t.url, active: false });
    } catch (e) {
      // Chrome refuses some URLs (a file:// page without file access, say);
      // every other tab still comes back.
      progress.failed.push(i);
      console.warn('[Huddle] Failed to restore snoozed tab:', t.url, e && e.message);
      continue;
    }
    await wakeStage('after-create', i);
    progress.opened.push({ i, tabId: created.id, windowId: created.windowId ?? windowId });
    await saveWakeProgress(record.id, { opened: progress.opened, failed: progress.failed });
    await wakeStage('after-progress', i);
  }

  await wakeStage('before-group');
  await finishWindowRecord(record, progress, windowId);
}

async function finishWindowRecord(record, progress, windowId) {
  const live = new Map();
  for (const entry of progress.opened) {
    const tab = await getTabOrNull(entry.tabId);
    if (tab) live.set(entry.i, tab);
  }
  try {
    const inWindow = ((await chrome.tabs.query({ windowId })) || [])
      .filter((t) => t.id !== progress.placeholderTabId);
    if (inWindow.length === 0) {
      // Nothing came back into this window: do not leave it empty.
      await chrome.windows.remove(windowId);
    } else if (progress.placeholderTabId !== null && progress.placeholderTabId !== undefined) {
      // The window's New Tab is not one of the snoozed tabs.
      await chrome.tabs.remove(progress.placeholderTabId);
    }
  } catch (_e) {
    // best effort
  }

  for (const [i, tab] of live) {
    if (record.tabs[i].pinned) {
      try {
        await chrome.tabs.update(tab.id, { pinned: true });
      } catch (_e) {
        // best effort
      }
    }
  }

  if (Array.isArray(record.groups)) {
    for (let gi = 0; gi < record.groups.length; gi++) {
      const members = [...live].filter(([i]) => record.tabs[i].groupIndex === gi).map(([, tab]) => tab);
      if (members.length === 0) continue;
      try {
        const newGroupId = await chrome.tabs.group({
          tabIds: members.map((t) => t.id),
          createProperties: { windowId: members[0].windowId ?? windowId },
        });
        await chrome.tabGroups.update(newGroupId, {
          title: record.groups[gi].title || '',
          color: record.groups[gi].color || 'grey',
        });
      } catch (_e) {
        // best effort
      }
    }
  }
}

// Closes the New Tabs a restart left in a reused group or window.
async function closeStrayTabs(tabIds) {
  for (const id of tabIds || []) {
    const tab = await getTabOrNull(id);
    if (!tab || !tabShowsUrl(tab, 'chrome://newtab/')) continue;
    try {
      await chrome.tabs.remove(id);
    } catch (_e) {
      // best effort
    }
  }
}

// Removes the woken record, clears its alarm and notifies once with the
// totals over every attempt. A record none of whose tabs came back is kept,
// with no alarm, until you wake or discard it.
async function completeWake(id, progress, { notify }) {
  const outcome = await withSnoozeLock(async () => {
    const items = await loadSnoozedItems();
    const idx = items.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const record = items[idx];
    const createdCount = progress.opened.length;
    const failedCount = record.tabs.length - createdCount;
    if (createdCount === 0 && failedCount > 0) {
      delete record.waking;
      record.wakeFailedAt = Date.now();
      await saveSnoozedItems(items);
      return { record, createdCount, failedCount, kept: true };
    }
    items.splice(idx, 1);
    await saveSnoozedItems(items);
    return { record, createdCount, failedCount, kept: false };
  });
  if (!outcome) return null;
  await clearSnoozeAlarm(id);
  const { record, createdCount, failedCount } = outcome;
  const first = progress.opened[0];
  if (notify) {
    notifyWake(record, createdCount, failedCount, {
      windowId: record.type === 'window' ? progress.windowId : first && first.windowId,
      firstTabId: first && first.tabId,
    });
  }
  const { waking: _w, ...stored } = record;
  return { ...outcome, record: stored, windowId: progress.windowId, firstTabId: first && first.tabId };
}

// Fire the wake notification and register it in the best-effort click map.
// `location` (optional) carries { windowId, firstTabId } for click focusing.
function notifyWake(record, createdCount, failedCount, location = {}) {
  // Use the ACTUAL restored count (createdCount), not the originally intended
  // record.tabs.length — otherwise a partial-failure wake reports a number of
  // "back" tabs that's inconsistent with the "N could not be reopened" suffix.
  const n = typeof createdCount === 'number' ? createdCount : (record.tabs ? record.tabs.length : 0);
  const t = (record.tabs && record.tabs[0] && record.tabs[0].title) || '';
  const gt = record.group && record.group.title ? record.group.title : '(unnamed)';
  let title;
  let message;
  if (n === 0 && failedCount > 0) {
    // Nothing reopened: say so, and that the record was kept (completeWake).
    title = 'Huddle — tabs could not wake';
    switch (record.type) {
      case 'tab':
        message = `"${t}" could not be reopened`;
        break;
      case 'group':
        message = `Group "${gt}" could not be reopened`;
        break;
      case 'window':
        message = 'The window could not be reopened';
        break;
      default:
        message = `${plural(failedCount, 'tab')} could not be reopened`;
    }
    // "they are" when the sentence's subject is several tabs.
    const pronoun = record.type === 'tab' || record.type === 'group' || record.type === 'window' || failedCount === 1
      ? 'it is' : 'they are';
    message += ` — ${pronoun} still in the nap room`;
  } else {
    title = n === 1 ? 'Huddle — tab woke up' : 'Huddle — tabs woke up';
    switch (record.type) {
      case 'tab':
        message = `"${t}" is back`;
        break;
      case 'tabs':
        message = `${plural(n, 'tab')} ${n === 1 ? 'is' : 'are'} back`;
        break;
      case 'group':
        message = `Group "${gt}" (${plural(n, 'tab')}) is back`;
        break;
      case 'window':
        message = `Window restored (${plural(n, 'tab')})`;
        break;
      default:
        message = `${plural(n, 'tab')} ${n === 1 ? 'is' : 'are'} back`;
    }
    if (failedCount > 0) {
      message += ` — ${failedCount} could not be reopened`;
    }
  }

  const notificationId = 'snooze-wake:' + record.id;
  try {
    // A stalled notice for this record is out of date once it has woken.
    chrome.notifications.clear('snooze-stalled:' + record.id);
  } catch (_e) {
    // best effort
  }
  try {
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
    });
    snoozeNotificationTargets.set(notificationId, {
      windowId: location.windowId,
      tabId: location.firstTabId,
    });
  } catch (_e) {
    // notifications are best-effort
  }
}

// Said once, when automatic retries give up on a wake.
function notifyStalled(record) {
  try {
    chrome.notifications.create('snooze-stalled:' + record.id, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Huddle — tabs didn\'t finish waking',
      message: `${record.summary || 'Some tabs'} didn't finish waking — open the nap room to try again`,
    });
  } catch (_e) {
    // notifications are best-effort
  }
}

function handleSnoozeAlarm(alarm) {
  if (!alarm || typeof alarm.name !== 'string' || !alarm.name.startsWith(SNOOZE_ALARM_PREFIX)) {
    return undefined;
  }
  const id = alarm.name.slice(SNOOZE_ALARM_PREFIX.length);
  return wakeSnoozedRecord(id, { notify: true, trigger: 'alarm' }).catch((error) => {
    // The alarm armed with the claim, if any, tries again.
    console.error('[Huddle] Error waking a snoozed record:', error);
    return null;
  });
}

async function handleWakeNow(message, sendResponse) {
  try {
    const result = await wakeSnoozedRecord(message.id, { notify: false, trigger: 'wakeNow' });
    if (!result) {
      // It woke on its own, or was discarded, meanwhile.
      sendResponse({ success: false, notFound: true, error: 'Snooze not found' });
      return;
    }
    if (result.waking === 'active') {
      sendResponse({ success: false, waking: 'active' });
      return;
    }
    if (result.interrupted || result.held || result.deferred) {
      // A held record has no alarm: nothing retries it until you do.
      sendResponse({
        success: false,
        waking: 'interrupted',
        error: result.held
          ? 'These tabs didn\'t finish waking — try Wake now again, or Discard them'
          : 'These tabs didn\'t finish waking — Huddle will try again in a minute',
      });
      return;
    }
    const { createdCount, failedCount } = result;
    if (result.kept) {
      sendResponse({
        success: false,
        error: `Could not reopen ${plural(failedCount, 'tab')} — kept in the nap room`,
        createdCount,
        failedCount,
      });
      return;
    }
    // A partial wake is still a wake; the counts let the page say what failed.
    sendResponse({ success: true, createdCount, failedCount });
  } catch (error) {
    console.error('[Huddle] Error in wakeSnoozed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Discard a snooze: drop the record and its alarm without reopening the tabs.
// The tabs were closed when they were snoozed, so this is the destructive
// action; the removed record is returned so the UI can offer an Undo. A wake
// in progress is not discarded. A wake that was interrupted discards only
// the tabs that had not reopened: the reply's record holds just those, with
// no claim, so Undo puts back an ordinary snooze.
async function handleCancelSnooze(message, sendResponse) {
  try {
    const outcome = await withSnoozeLock(async () => {
      const items = await loadSnoozedItems();
      const idx = items.findIndex((r) => r.id === message.id);
      if (idx === -1) return null;
      if (wakingNow.has(message.id)) return { active: true };
      const [record] = items.splice(idx, 1);
      await saveSnoozedItems(items);
      if (!record.waking) return { record };
      const reopened = new Set((record.waking.opened || []).map((e) => e.i));
      const { waking: _w, ...rest } = record;
      const tabs = record.tabs.filter((_t, i) => !reopened.has(i));
      return {
        record: { ...rest, tabs, summary: buildSnoozeSummary(record.type, tabs, record.group) },
        interrupted: true,
      };
    });
    if (outcome && outcome.active) {
      sendResponse({ success: false, waking: 'active' });
      return;
    }
    await clearSnoozeAlarm(message.id);
    if (!outcome) {
      sendResponse({ success: false, record: undefined });
      return;
    }
    if (outcome.interrupted) {
      const n = outcome.record.tabs.length;
      sendResponse({
        success: true,
        record: n > 0 ? outcome.record : undefined,
        interrupted: true,
        discardedCount: n,
      });
      return;
    }
    sendResponse({ success: true, record: outcome.record });
  } catch (error) {
    console.error('[Huddle] Error in cancelSnoozed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Undo a discard: put the record back and re-arm its alarm. A wake time that
// passed during the undo window fires straight away, as a missed alarm would.
async function handleRestoreSnoozed(message, sendResponse) {
  try {
    const record = message.record;
    if (!record || typeof record.id !== 'string' || typeof record.wakeAt !== 'number' || !Array.isArray(record.tabs)) {
      sendResponse({ success: false, error: 'Invalid snooze record' });
      return;
    }
    // An Undo puts back a snooze, never a wake in progress.
    const { waking: _w, ...restoredRecord } = record;
    const restored = await withSnoozeLock(async () => {
      const items = await loadSnoozedItems();
      if (items.some((r) => r.id === restoredRecord.id)) return false;
      items.push(restoredRecord);
      await saveSnoozedItems(items);
      return true;
    });
    if (restored) await scheduleSnoozeAlarm(restoredRecord);
    sendResponse({ success: restored });
  } catch (error) {
    console.error('[Huddle] Error in restoreSnoozed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// The list the popup and the nap room show. A claimed record says whether it
// is waking now ('active') or didn't finish ('interrupted'); the claim's
// internals stay in the worker.
function listedSnoozeRecord(record) {
  const { waking, ...rest } = record;
  const state = wakeStateOf(record);
  if (!state) return rest;
  return { ...rest, waking: state, stalled: !!(waking && waking.stalled) };
}

async function handleListSnoozed(sendResponse) {
  try {
    // Wakes this worker resumes on start are marked active first, so none of
    // them shows as interrupted for the moment in between.
    await wakeResumeKickoff;
    const items = (await loadSnoozedItems()).map(listedSnoozeRecord);
    items.sort((a, b) => a.wakeAt - b.wakeAt);
    sendResponse({ success: true, items });
  } catch (error) {
    console.error('[Huddle] Error in listSnoozed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleWakeNotificationClicked(notificationId) {
  const target = snoozeNotificationTargets.get(notificationId);
  try {
    chrome.notifications.clear(notificationId);
  } catch (_e) {
    // best effort
  }
  if (!target) {
    // "Tabs didn't finish waking": its text sends you to the nap room.
    if (notificationId.startsWith('snooze-stalled:')) {
      try {
        await chrome.tabs.create({ url: chrome.runtime.getURL('nap-room.html') });
      } catch (_e) {
        // best effort
      }
    }
    return; // otherwise the worker was respawned; the click is a silent no-op
  }
  snoozeNotificationTargets.delete(notificationId);
  try {
    if (target.windowId !== undefined && target.windowId !== null) {
      await chrome.windows.update(target.windowId, { focused: true });
    }
    if (target.tabId !== undefined && target.tabId !== null) {
      await chrome.tabs.update(target.tabId, { active: true });
    }
  } catch (_e) {
    // the window/tab may already be gone
  }
}

// ============================================================
// Tab Snoozing — Reconciler (startup / install)
// ============================================================

// On browser startup and extension install/update: wake every past-due
// record, one at a time (each stays in storage until its own wake finishes),
// then re-arm alarms that went missing. Claimed and held records are left to
// the resume logic; an alarm scheduled earlier than a record's wakeAt is a
// recovery alarm and is kept.
async function reconcileSnoozeAlarms() {
  try {
    await wakeResumeKickoff;
    const now = Date.now();
    const items = await loadSnoozedItems();
    const due = items.filter((r) => !r.waking && !isWakeHeld(r) && r.wakeAt <= now);
    // Every due record gets an alarm before the first wake starts: if the
    // worker stops part-way through, those alarms wake the rest.
    if (due.length > 0) {
      const armed = new Set(((await chrome.alarms.getAll().catch(() => [])) || []).map((a) => a.name));
      for (const r of due) if (!armed.has(snoozeAlarmName(r.id))) await armRecoveryAlarm(r.id);
    }
    for (const r of due) {
      await wakeSnoozedRecord(r.id, { notify: true, trigger: 'reconcile' });
    }

    const remaining = await loadSnoozedItems();
    let existingAlarms = [];
    try {
      existingAlarms = (await chrome.alarms.getAll()) || [];
    } catch (_e) {
      existingAlarms = [];
    }
    const scheduled = new Map(existingAlarms.map((a) => [a.name, a.scheduledTime]));

    for (const r of remaining) {
      if (isWakeHeld(r) || wakingNow.has(r.id)) continue;
      const name = snoozeAlarmName(r.id);
      if (r.waking) {
        if (!scheduled.has(name)) await armRecoveryAlarm(r.id);
      } else if (r.wakeAt > now) {
        // A later alarm is stale; an earlier one is a recovery alarm, kept.
        if (!scheduled.has(name) || scheduled.get(name) > r.wakeAt) await scheduleSnoozeAlarm(r);
      }
    }
  } catch (error) {
    console.error('[Huddle] Error reconciling snooze alarms:', error);
  }
}

// ============================================================
// Worker start
// ============================================================

// Runs on every start of this worker (the top level runs once per instance).
// Resumes wakes a stopped instance of this boot left unfinished, and wakes
// from an earlier boot once this boot's kind is known; the rest wait for
// runtime.onStartup / onInstalled, or for their recovery alarm. Also re-arms
// the AI key's expiry alarm (L12), which an update or reload clears.
let wakeResumeKickoff = Promise.resolve();

function onWorkerStart() {
  let marked;
  wakeResumeKickoff = new Promise((resolve) => { marked = resolve; });
  const run = (async () => {
    let sameBoot = [];
    const earlier = [];
    try {
      const bootId = await getBootId();
      const kind = await getBootKind();
      const items = await loadSnoozedItems();
      for (const r of items) {
        if (!r.waking || isWakeHeld(r) || wakingNow.has(r.id)) continue;
        if (r.waking.boot === bootId) {
          sameBoot.push(r.id);
          wakingNow.add(r.id);
        } else if (kind) {
          earlier.push(r.id);
          wakingNow.add(r.id);
        } else {
          // Its recovery alarm resumes it if no startup event does.
          const alarm = await chrome.alarms.get(snoozeAlarmName(r.id));
          if (!alarm) await armRecoveryAlarm(r.id);
        }
      }
      if (earlier.length > 0) {
        resumeEarlierBoot(kind, { reserved: earlier })
          .catch((error) => console.error('[Huddle] Could not resume a wake:', error));
      }
    } catch (error) {
      for (const id of sameBoot) wakingNow.delete(id);
      sameBoot = [];
      console.error('[Huddle] Could not check for unfinished wakes:', error);
    } finally {
      marked();
    }
    for (const id of sameBoot) {
      wakingNow.delete(id);
      await wakeSnoozedRecord(id, { notify: true, trigger: 'resume' }).catch((error) => {
        console.error('[Huddle] Could not resume a wake:', error);
      });
    }
  })();
  const ai = (async () => {
    try {
      const config = await loadAiConfig();
      if (config && config.key && typeof config.expiresAt === 'number') {
        const alarm = await chrome.alarms.get(AI_KEY_ALARM);
        if (!alarm) scheduleKeyExpiryAlarm(config);
      }
    } catch (error) {
      console.error('[Huddle] Could not check the AI key expiry:', error);
    }
  })();
  return Promise.all([run, ai]);
}

async function handleBrowserStartup() {
  try {
    await setBootKind('restart');
    await wakeResumeKickoff;
    // Match the tabs session restore brings back before the reconciler opens
    // any: its tabs must not be taken for ones a record had reopened.
    const resumed = resumeEarlierBoot('restart');
    await earlierBootRestamped;
    await reconcileSnoozeAlarms();
    await resumed;
  } catch (error) {
    console.error('[Huddle] Error on browser startup:', error);
  }
}

async function handleInstalled(details) {
  try {
    const reason = details && details.reason;
    // 'update' is an extension reload or update in a running browser.
    // 'chrome_update' means Chrome restarted. 'install' with claims in storage
    // is an extension loaded from the command line starting with the browser:
    // such a relaunch fires onInstalled('install') and no onStartup, and
    // clears the alarms (probe-events, Chrome for Testing 151). A real first
    // install has nothing claimed, so treating it as a restart changes nothing.
    const kind = reason === 'update' ? 'reload' : (reason === 'chrome_update' || reason === 'install') ? 'restart' : null;
    await wakeResumeKickoff;
    let resumed = Promise.resolve();
    if (kind) {
      const effective = await setBootKind(kind);
      resumed = resumeEarlierBoot(effective);
      await earlierBootRestamped;
    }
    await reconcileSnoozeAlarms();
    await resumed;
  } catch (error) {
    console.error('[Huddle] Error on install or update:', error);
  }
}

// ============================================================
// Tab Snoozing — Top-level listener registrations (MV3: sync at top level)
// ============================================================

chrome.alarms.onAlarm.addListener(handleSnoozeAlarm);
chrome.runtime.onStartup.addListener(handleBrowserStartup);
chrome.runtime.onInstalled.addListener(handleInstalled);
chrome.notifications.onClicked.addListener(handleWakeNotificationClicked);
onWorkerStart();
