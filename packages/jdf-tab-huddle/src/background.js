// Background service worker for persistent logging
console.log('Huddle service worker starting...');

// storage.local holds the OpenRouter key: only Huddle's own pages and this
// worker may read it, not the link clumper's content script in every web
// page (L10). Called on every worker start, so it never depends on an install
// event having run. storage.sync stays readable there: the clumper reads its
// settings from it.
if (chrome.storage.local.setAccessLevel) {
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch((e) => console.warn('[Huddle] storage.local.setAccessLevel failed:', e));
} else {
  console.warn('[Huddle] storage.local.setAccessLevel is missing: content scripts can read storage.local');
}

// Whether a message or port comes from one of Huddle's own pages (the popup,
// the nap room, Settings, the organize page, the split dialog). Content
// scripts arrive with the web page's url. No web page can load Huddle's
// pages: the manifest lists no web_accessible_resources.
function fromExtensionPage(sender) {
  return !!sender && sender.id === chrome.runtime.id
    && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

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
// only used offline; the catalog's own prices win. Each is served by
// providers that don't train on prompts (DeepSeek V4.1 Flash left the list:
// its only provider does).
const AI_MODELS = [
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', provider: 'Anthropic',
    pricing: { prompt: '0.000001', completion: '0.000005' } },
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
    // The fetch's timeout also cuts a body that is still arriving.
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new Error(timedOut ? 'OpenRouter didn\'t answer' : 'OpenRouter sent a catalog Huddle can\'t read', { cause: err });
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
    denyDataCollection: !(previous && previous.denyDataCollection === false),
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
// Settings saves its data-collection checkbox with the model
// (denyDataCollection, a boolean); a save without one keeps the stored value,
// which is on until turned off.
async function saveAiDefaultModel(model, { allowUnlisted = false, denyDataCollection } = {}) {
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
  if (typeof denyDataCollection === 'boolean') aiConfig.denyDataCollection = denyDataCollection;
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

// What a tab's address tells the model: no query or fragment, no data: body
// (a whole document), no blob: id, and of a local file only its name.
function stripQueryParams(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:') return `data:${u.pathname.split(/[;,]/)[0]}`;
    if (u.protocol === 'blob:') return `blob:${u.origin}`;
    if (u.protocol === 'file:') return `file:…/${u.pathname.split('/').pop()}`;
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
    // Capped: a title or address can be any length, and every character is
    // sent and paid for.
    const cleanUrl = stripQueryParams(tab.pendingUrl || tab.url).slice(0, 300);
    // A local tab's title is its cleaned address: Chrome titles an untitled
    // data: or file: page with its whole address (the document, or the local
    // path) and a file: folder "Index of <path>".
    const local = /^(data|blob|file):/i.test(tab.pendingUrl || tab.url || '');
    const title = local ? cleanUrl : (tab.title || '(no title)').slice(0, 200);
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
// denyDataCollection (Settings, on by default) asks OpenRouter to skip
// providers that train on prompts, on the strict and the plain request alike.
function buildOpenRouterRequestBody(model, messages, { params = null, jsonSchema = null, strict = true, maxTokens = null, denyDataCollection = false } = {}) {
  const known = Array.isArray(params);
  const takes = (name) => !known || params.includes(name);
  const body = {
    model,
    messages,
    stream: true,
  };
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    if (takes('max_tokens')) body.max_tokens = maxTokens;
    else if (known && params.includes('max_completion_tokens')) body.max_completion_tokens = maxTokens;
  }

  if (strict && jsonSchema && known && params.includes('structured_outputs')) {
    body.response_format = {
      type: 'json_schema',
      json_schema: jsonSchema,
    };
    body.provider = { require_parameters: true };
  } else if (takes('response_format')) {
    body.response_format = { type: 'json_object' };
  }
  if (denyDataCollection) body.provider = { ...(body.provider || {}), data_collection: 'deny' };

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

// Settings' data-collection checkbox, as its label reads, for the error that
// says it, or the account's privacy settings, left no provider ("… data policy").
const DATA_COLLECTION_SETTING = 'Don\'t use providers that train on my prompts';

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
// ctx: { model, modelName, tried: ['strict'?, 'plain'?] (what was sent),
//        denyDataCollection (the request asked for data_collection: deny) }
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
  } else if ((status === 404 || status === 400) && /data policy/i.test(said)) {
    // Checked before the routing refusal, whose pattern matches this text too.
    // The account's own OpenRouter privacy settings refuse with the same words,
    // so they are named whether or not Huddle's setting is on.
    error = ctx.denyDataCollection
      ? aiError(`No provider for ${who} meets your "${DATA_COLLECTION_SETTING}" setting or your OpenRouter privacy settings (${code}). Pick another model, or change either one.`, 'model', { retryable: false })
      : aiError(`No provider for ${who} meets your OpenRouter privacy settings (${code}). Pick another model, or change them at openrouter.ai/settings/privacy.`, 'model', { retryable: false });
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
        throw aiError(`The provider stopped mid-answer. ${cause.message}`, cause.kind, { status: cause.status, retryable: cause.retryable });
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

// options: { params, jsonSchema, maxTokens, denyDataCollection, signal, ctx,
//            onFinish, firstByteMs, idleMs }
// Resolves with the model's text. See buildOpenRouterRequestBody for what is
// sent, and STRICT_REFUSAL_STATUSES for the one retry.
// Rejects with an error carrying .kind; an abort through `signal` rejects
// with an AbortError.
async function callOpenRouter(apiKey, model, messages, onChunk, options = {}) {
  const ctx = { model, ...(options.ctx || {}), denyDataCollection: !!options.denyDataCollection };
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
      denyDataCollection: !!options.denyDataCollection,
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

  if (!parsed || !Array.isArray(parsed.groups)) {
    return { success: false, error: 'AI response missing "groups" array.' };
  }

  const validTabIds = new Set(originalTabs.map(t => t.id));
  const assignedTabIds = new Set();
  const groups = [];
  let unknownIds = 0;

  for (const group of parsed.groups) {
    if (!group || !group.name || !Array.isArray(group.tabIds)) continue;

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
        denyDataCollection: config.denyDataCollection !== false,
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
  // A run spends the stored key: only the organize page may start one.
  if (!fromExtensionPage(port.sender)) {
    port.disconnect();
    return;
  }
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

// Groups the tabs still in the window. Tabs closed, moved away or pinned
// since the proposal was made are left out and counted (grouping a pinned tab
// would unpin it); the page is closed only when everything proposed was
// grouped, and never when it is the window's last tab.
async function handleApplyAiProposal(message, sender, sendResponse) {
  try {
    const { groups, windowId } = message;

    // Grouping can pull a split's halves apart; record the pairs first. The
    // sort below records and restores again for the moves it makes.
    const splitPairs = await captureSplitPairs([windowId]);

    const windowTabs = await chrome.tabs.query({ windowId });
    const stillHere = new Map(windowTabs.filter(t => !t.pinned).map(t => [t.id, t]));

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
    // Only the clumper in a page's top frame sends this, and it never sends
    // more than 25 web links.
    if (!sender || !sender.tab || sender.frameId !== 0) {
      sendResponse({ success: false, error: 'forbidden' });
      return;
    }
    const urls = (Array.isArray(message.urls) ? message.urls : [])
      .filter((url) => /^https?:/i.test(url))
      .slice(0, 25);
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Huddle's own pages may send every action; the link clumper's content
  // script, which runs in web pages, only clumpOpenUrls (L11).
  if (!fromExtensionPage(sender) && message.action !== 'clumpOpenUrls') {
    sendResponse({ success: false, error: 'forbidden' });
  } else if (message.type === 'log') {
    console.log('[Huddle]', message.data.message, ...message.data.args);
    sendResponse({ success: true });
  } else if (message.action === 'clumpOpenUrls') {
    handleClumpOpenUrls(message, sender, sendResponse);
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
    handleExtractAllDomainsConfirmation(message, sender, sendResponse);
    return true; // async response
  } else if (message.action === 'moveAllToSingleWindow') {
    handleMoveAllToSingleWindow(message, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'copyTabs') {
    // scope: 'window' (current window only; default for callers that omit
    // the field) | 'all' (every window).
    handleCopyTabs(message.respectGroups, sendResponse, message.scope || 'window');
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
    handleApplyAiProposal(message, sender, sendResponse);
    return true;
  } else if (message.action === 'cancelAiProposal') {
    if (sender.tab) {
      chrome.tabs.remove(sender.tab.id);
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
      // models: Huddle's own recommendations, for a picker that has no catalog
      // yet (Settings with no key fetches nothing until it is browsed).
      sendResponse({ protocol: AI_PROTOCOL, config, expiryPresets: EXPIRY_PRESETS, defaultModel: DEFAULT_MODEL, models: curatedModelsAsPickerEntries() });
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
    saveAiDefaultModel(message.model, { allowUnlisted: !!message.allowUnlisted, denyDataCollection: message.denyDataCollection }).then((saved) => {
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

    // One pass over all regular windows and one over all incognito windows:
    // a page open in both kinds of window is not a duplicate.
    const tabsByKind = [false, true].map((inc) => windows.filter((w) => !!w.incognito === inc).flatMap((w) => w.tabs));
    const { tabsToRemove } = findDuplicateTabs(tabsByKind, respectGroups);

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

// Find duplicate tabs, considering tab groups if respectGroups.
// Each array is deduplicated on its own: one window, or (for global dedupe)
// all regular windows and, separately, all incognito windows.
function findDuplicateTabs(tabArrays, respectGroups = true) {
  const tabsToRemove = [];

  for (const tabs of tabArrays) {
    const arrayUrlSeen = new Map();

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

        // Groups mode dedups within each group of the array: a URL repeated
        // in two different groups is NOT a duplicate. Flat mode dedups across
        // the whole array.
        const seenMap = respectGroups ? groupUrlSeen : arrayUrlSeen;

        if (seenMap.has(url)) {
          // Duplicate. Prefer keeping the copy in a Split View — closing it
          // would pull a page off the user's screen mid-use while a background
          // duplicate survives. (Pinned tabs never reach this point at all.)
          const kept = seenMap.get(url);
          if (tabSplitViewId(tab) !== null && tabSplitViewId(kept) === null) {
            tabsToRemove.push(kept.id);
            seenMap.set(url, tab);
          } else {
            tabsToRemove.push(tab.id);
          }
        } else {
          // First occurrence - keep it
          seenMap.set(url, tab);
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

// A Split domains request waiting for its dialog's answer is saved in
// storage.session under the dialog tab's id, so the answer works the same
// whether or not the worker was stopped while the dialog was open.
function splitConfirmKey(tabId) {
  return `splitConfirm:${tabId}`;
}

// A dialog closed with its tab's X forgets its request.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(splitConfirmKey(tabId)).catch(() => {});
});

// Create confirmation dialog URL with parameters
function createConfirmationDialogUrl(domainAnalysis, respectGroups) {
  const extractableCount = domainAnalysis.extractableDomains.length;
  const singleTabCount = domainAnalysis.singleTabDomains.length;

  const params = new URLSearchParams({
    extractable: extractableCount.toString(),
    single: singleTabCount.toString(),
    groups: respectGroups ? 'keep' : 'flat'
  });

  return chrome.runtime.getURL(`confirmation-dialog.html?${params.toString()}`);
}

// The popup has closed by the time a split ends (it closes when the windows
// appear), so a split that went wrong also says so in a notification.
// Clicking it only clears it (handleWakeNotificationClicked).
function notifySplitProblem(result) {
  let message;
  if (!result.success) {
    message = `Couldn't split domains: ${result.error || 'unknown error'}`;
  } else {
    message = `Split into ${plural(result.windows || 0, 'window')}`
      + (result.notMoved ? `; ${plural(result.notMoved, 'tab')} couldn't be moved` : '')
      + (result.sortFailed ? '; couldn\'t sort, try Sort' : '');
  }
  try {
    chrome.notifications.create('split:' + Date.now(), {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Split domains',
      message,
    });
  } catch (_e) {
    // notifications are best-effort
  }
}

// Handle Extract All Domains functionality. Up to 5 windows, it splits
// straight away. Above that it opens the confirmation dialog, saves the
// request and replies { pending: true }: the dialog's answer is carried out,
// and its result shown there, by handleExtractAllDomainsConfirmation.
async function handleExtractAllDomains(respectGroups = true, sendResponse) {
  let result;
  try {
    console.log('[Huddle] Starting Extract All Domains', respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Analyze all domains and their tab counts
    const domainAnalysis = await analyzeDomainDistribution();

    // Check if confirmation is needed (more than 5 total windows would be created)
    const totalWindowsToCreate = domainAnalysis.extractableDomains.length + (domainAnalysis.singleTabDomains.length > 0 ? 1 : 0);
    if (totalWindowsToCreate > 5) {
      console.log('[Huddle] Many windows would be created, requesting confirmation');
      const confirmTab = await chrome.tabs.create({
        url: createConfirmationDialogUrl(domainAnalysis, respectGroups),
        active: true
      });
      await chrome.storage.session.set({ [splitConfirmKey(confirmTab.id)]: { respectGroups } })
        .catch((error) => console.error('[Huddle] Could not save the Split domains request:', error));
      sendResponse({ success: true, pending: true });
      return;
    }

    result = await extractAndSortAllDomains(domainAnalysis, respectGroups);
    if (result.notMoved || result.sortFailed) notifySplitProblem(result);
  } catch (error) {
    console.error('[Huddle] Error in Extract All Domains:', error);
    result = { success: false, error: error.message };
    notifySplitProblem(result);
  }
  sendResponse(result);
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

// The dialog's Confirm or Cancel, carried out from the request saved in
// storage.session. Cancel closes the dialog. Confirm analyses the tabs again
// as they are now (leaving out the dialog's own tab), splits them and replies
// with the result, which the dialog shows. With no saved request, the dialog
// is told the request has ended.
async function handleExtractAllDomainsConfirmation(message, sender, sendResponse) {
  const tabId = sender && sender.tab ? sender.tab.id : undefined;
  try {
    const key = splitConfirmKey(tabId);
    const stored = (await chrome.storage.session.get(key))[key];
    await chrome.storage.session.remove(key);

    if (!message.confirmed) {
      sendResponse({ success: true, cancelled: true });
      if (tabId !== undefined) chrome.tabs.remove(tabId).catch(() => {});
      return;
    }
    if (!stored) {
      sendResponse({ success: false, expired: true, error: 'This split request has ended. Close this tab and run Split domains again.' });
      return;
    }
    const domainAnalysis = await analyzeDomainDistribution(tabId);
    sendResponse(await extractAndSortAllDomains(domainAnalysis, stored.respectGroups !== false));
  } catch (error) {
    console.error('[Huddle] Error in Extract All Domains confirmation:', error);
    sendResponse({ success: false, error: `Couldn't split domains: ${error.message}` });
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

async function handleCopyTabs(respectGroups = true, sendResponse, scope = 'window') {
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

// Reads the sleeping list; call it under the snooze lock. A failed read
// throws: the callers that change the list write it back, and writing back an
// empty list read from a failure would erase every snooze. A stored value
// that is not a list is moved aside to `snoozedItemsCorrupt:<time>` (so
// nothing is lost), reported once, and snoozing carries on from an empty list.
async function loadSnoozedItems() {
  const result = await chrome.storage.local.get([SNOOZE_STORAGE_KEY]);
  const items = result && result[SNOOZE_STORAGE_KEY];
  if (Array.isArray(items)) return items;
  if (items !== undefined && items !== null) {
    const backupKey = `${SNOOZE_STORAGE_KEY}Corrupt:${Date.now()}`;
    await chrome.storage.local.set({ [backupKey]: items, [SNOOZE_STORAGE_KEY]: [] });
    console.error(`[Huddle] The stored sleeping list was not a list; it was moved to "${backupKey}".`);
  }
  return [];
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

// notificationId -> { windowId, tabId } for best-effort click focusing. This
// map is memory-resident and lossy across service-worker respawns (documented).
const snoozeNotificationTargets = new Map();

// Find the window to restore tab/tabs/group records into: the last-focused
// regular window, else any regular window, else a new one. Never an incognito
// window (with "Allow in Incognito" on they are 'normal' windows too): the
// tabs were snoozed from regular windows, and in incognito they would come
// back without the user's logins and be lost with that window. Returns
// { windowId, placeholderTabId }; placeholderTabId is the New Tab of a window
// created here, which the caller removes once a tab has opened in it.
// Memoize the in-flight lookup so concurrent wakes (e.g. several alarms
// firing at once with no normal window open) share one target window instead
// of each creating its own and splitting the restore across windows.
let restoreTargetInFlight = null;

async function getRestoreTargetWindowId() {
  if (restoreTargetInFlight) return restoreTargetInFlight;
  restoreTargetInFlight = (async () => {
    try {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
      if (win && !win.incognito && win.id != null) return { windowId: win.id };
      const regular = (await chrome.windows.getAll({ windowTypes: ['normal'] })).find((w) => !w.incognito);
      if (regular) return { windowId: regular.id };
    } catch (_e) {
      // fall through to creating a window
    }
    const created = await chrome.windows.create({ focused: false });
    return { windowId: created.id, placeholderTabId: created.tabs && created.tabs[0] && created.tabs[0].id };
  })();
  try {
    return await restoreTargetInFlight;
  } finally {
    restoreTargetInFlight = null;
  }
}

// Recreate the tabs/window/group in the background. Never throws — per-tab
// failures are counted. Returns { createdCount, failedCount, windowId, firstTabId }.
async function restoreSnoozedRecord(record) {
  let createdCount = 0;
  let failedCount = 0;
  let windowId;
  let firstTabId;

  if (record.type === 'window') {
    const urls = record.tabs.map((t) => t.url);
    // createdTabs[i] is the tab reopened from record.tabs[i], or null when
    // that one could not be reopened; pinning and groups follow this mapping.
    let createdTabs;
    let win;
    try {
      win = await chrome.windows.create({ url: urls, focused: false });
      windowId = win && win.id;
      createdTabs = record.tabs.map((_t, i) => (win && win.tabs && win.tabs[i]) || null);
    } catch (_e) {
      // Chrome refuses the whole list when it refuses one URL (a file:// page
      // without file access, say). Open an empty window and reopen the tabs
      // one by one instead, so every other tab still comes back.
      win = await chrome.windows.create({ focused: false });
      windowId = win && win.id;
      const placeholder = win && win.tabs && win.tabs[0];
      createdTabs = [];
      for (const t of record.tabs) {
        try {
          createdTabs.push(await chrome.tabs.create({ windowId, url: t.url, active: false }));
        } catch (e) {
          createdTabs.push(null);
          console.warn('[Huddle] Failed to restore snoozed tab:', t.url, e && e.message);
        }
      }
      const opened = createdTabs.some(Boolean);
      try {
        if (opened && placeholder) {
          // The window's New Tab is not one of the snoozed tabs.
          await chrome.tabs.remove(placeholder.id);
        } else if (!opened && windowId !== undefined) {
          // Nothing came back: do not leave an empty window behind.
          await chrome.windows.remove(windowId);
          windowId = undefined;
        }
      } catch (_e) {
        // best effort
      }
    }
    createdCount = createdTabs.filter(Boolean).length;
    failedCount = record.tabs.length - createdCount;
    const firstCreated = createdTabs.find(Boolean);
    if (firstCreated) firstTabId = firstCreated.id;

    // Re-pin tabs whose stored entry was pinned.
    for (let i = 0; i < record.tabs.length; i++) {
      if (record.tabs[i].pinned && createdTabs[i]) {
        try {
          await chrome.tabs.update(createdTabs[i].id, { pinned: true });
        } catch (_e) {
          // best effort
        }
      }
    }

    // Recreate each stored group over the new tabs.
    if (record.groups && record.groups.length > 0) {
      for (let gi = 0; gi < record.groups.length; gi++) {
        const memberTabIds = [];
        for (let i = 0; i < record.tabs.length; i++) {
          if (record.tabs[i].groupIndex === gi && createdTabs[i]) {
            memberTabIds.push(createdTabs[i].id);
          }
        }
        if (memberTabIds.length > 0) {
          try {
            const newGroupId = await chrome.tabs.group({
              tabIds: memberTabIds,
              createProperties: { windowId },
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

    return { createdCount, failedCount, windowId, firstTabId };
  }

  // tab / tabs / group — recreate into the last-focused regular window.
  const target = await getRestoreTargetWindowId();
  windowId = target.windowId;
  const createdTabIds = [];
  for (const t of record.tabs) {
    try {
      // No `index` here: chrome.tabs.create (unlike tabs.move) does not accept
      // -1 as "append at the end" — it throws "index: Value must be at least
      // 0". Omitting `index` already appends the tab as the last one in the
      // window, which is the behavior we want.
      const created = await chrome.tabs.create({
        windowId,
        url: t.url,
        pinned: !!t.pinned,
        active: false,
      });
      createdCount++;
      createdTabIds.push(created.id);
      if (firstTabId === undefined) firstTabId = created.id;
    } catch (e) {
      failedCount++;
      console.warn('[Huddle] Failed to restore snoozed tab:', t.url, e && e.message);
    }
  }
  // A window created for this wake opened with a New Tab that isn't one of
  // the snoozed tabs. Once a tab is in, the window can't close by removing it.
  // (A concurrent wake sharing the window may remove it first; then this fails.)
  if (target.placeholderTabId !== undefined && createdCount > 0) {
    chrome.tabs.remove(target.placeholderTabId).catch(() => {});
  }

  if (record.type === 'group' && createdTabIds.length > 0) {
    try {
      const newGroupId = await chrome.tabs.group({
        tabIds: createdTabIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(newGroupId, {
        title: (record.group && record.group.title) || '',
        color: (record.group && record.group.color) || 'grey',
      });
    } catch (_e) {
      // best effort
    }
  }

  return { createdCount, failedCount, windowId, firstTabId };
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
    // Nothing reopened: say so, and that the record was kept (wakeSnoozedRecord).
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

// Ids of the records this worker is waking right now. A second wake of one
// of them (an alarm and Wake now at once, say) does nothing.
const wakingNow = new Set();
const WAKE_RETRY_MS = 60000;

// Wake the record again in a minute, in case this wake fails or does not
// finish (the worker stops, the browser quits).
async function armWakeRetry(id) {
  try {
    await chrome.alarms.create(SNOOZE_ALARM_PREFIX + id, { when: Date.now() + WAKE_RETRY_MS });
  } catch (_e) {
    // best effort: reconcileSnoozeAlarms wakes it on the next startup
  }
}

async function clearSnoozeAlarm(id) {
  try {
    await chrome.alarms.clear(SNOOZE_ALARM_PREFIX + id);
  } catch (_e) {
    // harmless: a leftover alarm finds no record
  }
}

// Wake one record: reopen its tabs, and only once they are open remove it
// from storage and clear its alarm (tabs Chrome refuses are dropped, as
// before). Until then the record stays stored with an
// alarm a minute out, so a wake cut short (the worker stopped, the extension
// reloaded, the browser quit) is simply done again from scratch by that alarm
// or the next startup. A re-run can open some tabs twice; it never loses one.
// Returns null when there is no such record, { waking: true } when this
// worker is already waking it, and otherwise { record, createdCount,
// failedCount, kept, windowId, firstTabId }. Throws when the wake failed; the
// record is then kept, and its alarm wakes it again in a minute.
async function wakeSnoozedRecord(id, options = {}) {
  if (wakingNow.has(id)) {
    // The running wake's alarm may just have fired (a wake longer than a
    // minute): keep one armed in case this worker stops before it finishes.
    await armWakeRetry(id);
    return { waking: true };
  }
  wakingNow.add(id);
  try {
    await armWakeRetry(id);
    const record = await withSnoozeLock(async () => (await loadSnoozedItems()).find((r) => r.id === id));
    if (!record) {
      await clearSnoozeAlarm(id);
      return null;
    }
    const result = await restoreSnoozedRecord(record);
    // Not one tab reopened although there were tabs to reopen: keep the
    // record, with no alarm. A URL Chrome refuses now (a file:// page without
    // file access, a removed extension's page) is refused again a minute
    // later, so it waits in the nap room, overdue, to be woken or discarded.
    const kept = result.createdCount === 0 && result.failedCount > 0;
    if (!kept) {
      await withSnoozeLock(async () => {
        const items = await loadSnoozedItems();
        await saveSnoozedItems(items.filter((r) => r.id !== id));
      });
    }
    await clearSnoozeAlarm(id);
    // A kept record that isn't due yet (Wake now pressed early) keeps its
    // own wake time.
    if (kept && record.wakeAt > Date.now()) await scheduleSnoozeAlarm(record).catch(() => {});
    if (options.notify === true) notifyWake(record, result.createdCount, result.failedCount, result);
    return { record, ...result, kept };
  } finally {
    wakingNow.delete(id);
  }
}

function handleSnoozeAlarm(alarm) {
  if (!alarm || typeof alarm.name !== 'string' || !alarm.name.startsWith(SNOOZE_ALARM_PREFIX)) {
    return undefined;
  }
  const id = alarm.name.slice(SNOOZE_ALARM_PREFIX.length);
  return wakeSnoozedRecord(id, { notify: true }).catch((error) => {
    console.error('[Huddle] Could not wake a snoozed record; trying again in a minute:', error);
    return null;
  });
}

async function handleWakeNow(message, sendResponse) {
  try {
    const result = await wakeSnoozedRecord(message.id, { notify: false });
    if (!result) {
      // It woke on its own, or was discarded, meanwhile.
      sendResponse({ success: false, notFound: true, error: 'Snooze not found' });
      return;
    }
    if (result.waking) {
      sendResponse({ success: false, waking: true });
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
    sendResponse({ success: false, error: 'Couldn\'t wake these tabs right now — Huddle will try again in a minute' });
  }
}

// Discard a snooze: drop the record and its alarm without reopening the tabs.
// The tabs were closed when they were snoozed, so this is the destructive
// action; the removed record is returned so the UI can offer an Undo. A
// record that is waking right now is not discarded.
async function handleCancelSnooze(message, sendResponse) {
  try {
    const removed = await withSnoozeLock(async () => {
      if (wakingNow.has(message.id)) return { waking: true };
      const items = await loadSnoozedItems();
      const idx = items.findIndex((r) => r.id === message.id);
      if (idx === -1) return null;
      const [record] = items.splice(idx, 1);
      await saveSnoozedItems(items);
      return { record };
    });
    if (removed && removed.waking) {
      sendResponse({ success: false, waking: true });
      return;
    }
    await clearSnoozeAlarm(message.id);
    sendResponse({ success: removed !== null, record: removed ? removed.record : undefined });
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
    // Only what Huddle would have snoozed: a wake opens these URLs.
    if (!record || typeof record.id !== 'string' || typeof record.wakeAt !== 'number' || !Array.isArray(record.tabs)
      || !record.tabs.every((t) => t && isSnoozeableUrl(t.url))) {
      sendResponse({ success: false, error: 'Invalid snooze record' });
      return;
    }
    const restored = await withSnoozeLock(async () => {
      const items = await loadSnoozedItems();
      if (items.some((r) => r.id === record.id)) return false;
      items.push(record);
      await saveSnoozedItems(items);
      return true;
    });
    if (restored) await scheduleSnoozeAlarm(record);
    sendResponse({ success: restored });
  } catch (error) {
    console.error('[Huddle] Error in restoreSnoozed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleListSnoozed(sendResponse) {
  try {
    // `waking`: whether this worker is waking the record right now.
    const items = (await withSnoozeLock(loadSnoozedItems)).map((r) => ({ ...r, waking: wakingNow.has(r.id) }));
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
  if (!target) return; // worker was respawned; click is a silent no-op
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
// record, one at a time (each stays in storage until its own wake is done),
// then re-arm alarms for future records that lost their timer.
async function reconcileSnoozeAlarms() {
  try {
    const now = Date.now();
    const due = (await withSnoozeLock(loadSnoozedItems)).filter((r) => r.wakeAt <= now);
    // Every due record gets its alarm first, so one the loop has not reached
    // when the worker stops is still woken a minute later.
    for (const r of due) await armWakeRetry(r.id);
    for (const r of due) {
      await wakeSnoozedRecord(r.id, { notify: true }).catch((error) => {
        console.error('[Huddle] Could not wake a snoozed record; trying again in a minute:', error);
      });
    }

    const remaining = await withSnoozeLock(loadSnoozedItems);
    let existingAlarms = [];
    try {
      existingAlarms = (await chrome.alarms.getAll()) || [];
    } catch (_e) {
      existingAlarms = [];
    }
    const existingNames = new Set(existingAlarms.map((a) => a.name));

    for (const r of remaining) {
      if (r.wakeAt > now && !existingNames.has(SNOOZE_ALARM_PREFIX + r.id)) {
        await scheduleSnoozeAlarm(r);
      }
    }
  } catch (error) {
    console.error('[Huddle] Error reconciling snooze alarms:', error);
  }
}

// Every worker start: an extension update or reload clears the AI key's
// expiry alarm, so re-arm it (loadAiConfig also purges a key already expired).
async function rearmKeyExpiryAlarm() {
  try {
    const config = await loadAiConfig();
    if (config && config.key && typeof config.expiresAt === 'number') {
      const alarm = await chrome.alarms.get(AI_KEY_ALARM);
      if (!alarm) scheduleKeyExpiryAlarm(config);
    }
  } catch (error) {
    console.error('[Huddle] Could not check the AI key expiry:', error);
  }
}

// Chrome runs the link clumper only in pages loaded after Huddle was
// installed, updated or reloaded, and the copy left in an older page can no
// longer open tabs (it never arms). So each open http(s) page gets a fresh
// copy; a tab Chrome won't script (the Web Store, for one) is skipped.
async function injectClumperIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-clumper.js'] }).catch(() => {});
  }
}

// ============================================================
// Tab Snoozing — Top-level listener registrations (MV3: sync at top level)
// ============================================================

chrome.alarms.onAlarm.addListener(handleSnoozeAlarm);
chrome.runtime.onStartup.addListener(reconcileSnoozeAlarms);
chrome.runtime.onInstalled.addListener(reconcileSnoozeAlarms);
chrome.runtime.onInstalled.addListener(injectClumperIntoOpenTabs);
chrome.notifications.onClicked.addListener(handleWakeNotificationClicked);
rearmKeyExpiryAlarm();
