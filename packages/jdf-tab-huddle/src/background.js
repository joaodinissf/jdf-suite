// Background service worker for persistent logging
console.log('Tab Organizer service worker starting...');

// ============================================================
// AI Tab Grouping — Constants and Helpers
// ============================================================

// Curated defaults — always available offline; enriched from the live catalog
// when present. Full OpenRouter list is fetched/cached separately.
const AI_MODELS = [
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', cost: '$0.80/M in', curated: true },
  { id: 'google/gemini-3.1-flash-lite-preview-20260303', name: 'Gemini 3.1 Flash Lite', cost: '$0.25/M in', curated: true },
  { id: 'qwen/qwen3.5-flash-20260224', name: 'Qwen 3.5 Flash', cost: '$0.065/M in', curated: true },
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

const VALID_TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

// OpenRouter model catalog cache (chrome.storage.local)
const MODELS_CACHE_KEY = 'openRouterModelsCache';
const MODELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function formatModelCost(pricing) {
  if (!pricing || pricing.prompt == null || pricing.prompt === '') return 'price unknown';
  const perToken = Number(pricing.prompt);
  if (!Number.isFinite(perToken)) return 'price unknown';
  if (perToken === 0) return 'free';
  const perMillion = perToken * 1e6;
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}/M in`;
  if (perMillion < 1) return `$${perMillion.toFixed(3)}/M in`;
  return `$${perMillion.toFixed(2)}/M in`;
}

// Batch-only variants cannot answer a chat request, so the picker hides them.
function isBatchOnlyModelId(id) {
  return typeof id === 'string' && id.endsWith(':batch');
}

// Huddle needs a text reply in JSON, so a model must emit text and accept
// response_format. Models the catalog says cannot do both are left out.
function canHuddleUseModel(raw) {
  if (isBatchOnlyModelId(raw.id)) return false;
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
  return {
    id: raw.id,
    name: raw.name || raw.id,
    cost: formatModelCost(raw.pricing),
    supportsStructuredOutputs: params.includes('structured_outputs'),
    curated: false,
  };
}

// The curated entries carry no structured-output facts of their own — only the
// live catalog knows. Pass the flag through undefined rather than coercing to
// false so the UI can say "unknown" instead of asserting an unsupported "no".
function curatedModelsAsPickerEntries() {
  return AI_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    cost: m.cost,
    supportsStructuredOutputs: m.supportsStructuredOutputs,
    curated: true,
  }));
}

function mergeModelsForPicker(remoteModels) {
  const remote = Array.isArray(remoteModels) ? remoteModels : [];
  const byId = new Map(remote.map((m) => [m.id, m]));
  const curated = AI_MODELS.map((c) => {
    const hit = byId.get(c.id);
    if (!hit) {
      // Not in the catalog — leave the flag undefined ("unknown"), not false.
      return {
        id: c.id,
        name: c.name,
        cost: c.cost,
        supportsStructuredOutputs: c.supportsStructuredOutputs,
        curated: true,
      };
    }
    return {
      id: c.id,
      name: c.name || hit.name,
      cost: hit.cost || c.cost,
      supportsStructuredOutputs: !!hit.supportsStructuredOutputs,
      curated: true,
    };
  });
  const curatedIds = new Set(curated.map((m) => m.id));
  const rest = remote
    .filter((m) => m && m.id && !curatedIds.has(m.id) && !isBatchOnlyModelId(m.id))
    .slice()
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  return curated.concat(rest);
}

async function fetchOpenRouterModels() {
  let response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        // OpenRouter documents optional app identification; helps some edge filters.
        'HTTP-Referer': chrome.runtime.getURL(''),
        'X-Title': 'Huddle',
      },
    });
  } catch (err) {
    console.error('[Tab Organizer] Models catalog network error:', err);
    throw new Error(`Network error loading catalog: ${err.message || err}`, { cause: err });
  }

  if (!response.ok) {
    let detail = '';
    try {
      const text = await response.text();
      detail = text ? `: ${text.slice(0, 120)}` : '';
    } catch (_e) {
      // ignore body read failures
    }
    console.error('[Tab Organizer] Models catalog HTTP', response.status, detail);
    throw new Error(`Failed to fetch models (${response.status})${detail}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error('[Tab Organizer] Models catalog JSON parse error:', err);
    throw new Error('Models catalog returned invalid JSON', { cause: err });
  }

  const list = Array.isArray(data.data) ? data.data : [];
  if (list.length === 0) {
    throw new Error('Models catalog was empty');
  }
  return list.map(normalizeOpenRouterModel).filter(Boolean);
}

async function getOpenRouterModels({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const stored = await chrome.storage.local.get([MODELS_CACHE_KEY]);
    const cache = stored[MODELS_CACHE_KEY];
    if (cache && Array.isArray(cache.models) && cache.models.length > 0
        && typeof cache.fetchedAt === 'number'
        && (Date.now() - cache.fetchedAt) < MODELS_CACHE_TTL_MS) {
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
        [MODELS_CACHE_KEY]: { models: remote, fetchedAt },
      });
    } catch (cacheErr) {
      // Still return the live catalog even if caching fails (quota, etc.).
      console.warn('[Tab Organizer] Models catalog cache write failed:', cacheErr);
    }
    return {
      models: mergeModelsForPicker(remote),
      fetchedAt,
      fromCache: false,
    };
  } catch (error) {
    console.error('[Tab Organizer] getOpenRouterModels failed:', error);
    const stored = await chrome.storage.local.get([MODELS_CACHE_KEY]);
    const cache = stored[MODELS_CACHE_KEY];
    if (cache && Array.isArray(cache.models) && cache.models.length > 0) {
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

async function modelSupportsStructuredOutputs(modelId) {
  if (!modelId) return false;
  const stored = await chrome.storage.local.get([MODELS_CACHE_KEY]);
  const cache = stored[MODELS_CACHE_KEY];
  if (cache && Array.isArray(cache.models)) {
    const hit = cache.models.find((m) => m.id === modelId);
    if (hit) return !!hit.supportsStructuredOutputs;
  }
  const curated = AI_MODELS.find((m) => m.id === modelId);
  if (curated && curated.supportsStructuredOutputs != null) {
    return !!curated.supportsStructuredOutputs;
  }
  return false;
}

async function resolveModelDisplayName(modelId) {
  if (!modelId) return modelId;
  const curated = AI_MODELS.find((m) => m.id === modelId);
  if (curated) return curated.name;
  const stored = await chrome.storage.local.get([MODELS_CACHE_KEY]);
  const cache = stored[MODELS_CACHE_KEY];
  const hit = cache && Array.isArray(cache.models)
    ? cache.models.find((m) => m.id === modelId)
    : null;
  return (hit && hit.name) || modelId;
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

function encodeKey(plaintext) {
  return btoa(plaintext);
}

function decodeKey(encoded) {
  return atob(encoded);
}

function isKeyExpired(aiConfig) {
  if (!aiConfig || !aiConfig.key) return true;
  if (aiConfig.expiresAt === null) return false;
  return Date.now() > aiConfig.expiresAt;
}

async function saveAiConfig(config) {
  const key = encodeKey(config.key);
  const previous = await loadAiConfig();
  // A missing or unparsable duration must not become a key that never expires.
  const expiryDuration = config.expiryDuration === null
    ? null
    : (Number.isFinite(config.expiryDuration) && config.expiryDuration > 0
      ? config.expiryDuration
      : DEFAULT_EXPIRY);

  // Editing the model must not restart the key's countdown. Only a new key, a
  // changed expiry policy, or re-entering a key that has already expired resets
  // it; re-saving the same live key keeps its deadline.
  const keptKey = !!previous
    && previous.key === key
    && previous.expiryDuration === expiryDuration
    && previous.expiresAt !== undefined
    && !isKeyExpired(previous);

  const expiresAt = keptKey
    ? previous.expiresAt
    : (expiryDuration !== null ? Date.now() + expiryDuration : null);

  const aiConfig = {
    key,
    model: config.model || DEFAULT_MODEL,
    expiresAt,
    expiryDuration,
    setupComplete: true,
  };

  await chrome.storage.local.set({ aiConfig });
  return aiConfig;
}

async function loadAiConfig() {
  const result = await chrome.storage.local.get(['aiConfig']);
  return result.aiConfig || null;
}

// Runs waiting for their proposal tab to send 'aiProposalReady', keyed by
// that tab's id. In memory only: if the service worker is stopped, the map
// comes back empty and the page is told its run has ended.
const aiPendingRuns = new Map();

// A proposal tab closed before it sent 'aiProposalReady' ends its run, so
// the waiting promise settles and its config is not held until shutdown.
chrome.tabs.onRemoved.addListener((tabId) => {
  const resolve = aiPendingRuns.get(tabId);
  if (resolve) {
    aiPendingRuns.delete(tabId);
    resolve(null);
  }
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

function buildOpenRouterRequestBody(model, messages, { useJsonSchema = false, jsonSchema = null } = {}) {
  const body = {
    model,
    messages,
    temperature: 0.3,
    stream: true,
  };

  if (useJsonSchema && jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: jsonSchema,
    };
    // Only route to providers that honor structured outputs for this model.
    body.provider = { require_parameters: true };
  } else {
    body.response_format = { type: 'json_object' };
  }

  return body;
}

async function readOpenRouterResponse(response, onChunk) {
  const contentType = response.headers.get('content-type') || '';

  // If the response is not SSE, fall back to reading it as plain JSON
  if (!contentType.includes('text/event-stream')) {
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (content && onChunk) onChunk(content);
    return content;
  }

  // SSE streaming
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5);
      if (payload === '[DONE]') continue;

      try {
        const parsed = JSON.parse(payload);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          fullText += content;
          if (onChunk) onChunk(content);
        }
      } catch (_e) {
        // skip malformed SSE lines
      }
    }
  }

  return fullText;
}

// Read an error response's body: OpenRouter sends
// { error: { code, message, metadata: { provider_name, raw, ... } } }.
// Never throws; resolves null when there is no readable body.
async function readOpenRouterErrorBody(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_e) {
      return { error: { message: text.slice(0, 500) } };
    }
  } catch (_e) {
    return null;
  }
}

// OpenRouter's own explanation, e.g. `No auth credentials found`, plus the
// upstream provider when it names one. Empty when the body says nothing.
function describeOpenRouterErrorBody(body) {
  const detail = body && body.error;
  if (!detail || typeof detail.message !== 'string' || !detail.message.trim()) return '';
  const provider = detail.metadata && detail.metadata.provider_name;
  return provider ? `${detail.message.trim()} (provider: ${provider})` : detail.message.trim();
}

// Map a failed response to a user-facing error. The status alone only guesses:
// OpenRouter returns 401 for more than a bad key, so when the body explains the
// failure, that explanation is what the user sees.
function mapOpenRouterHttpError(status, body = null) {
  const said = describeOpenRouterErrorBody(body);
  let message;
  if (status === 401) {
    message = said
      ? `OpenRouter refused the request (401): ${said}`
      : 'Invalid API key. Please check your OpenRouter key.';
  } else if (status === 429) {
    message = 'Rate limited. Please try again in a moment.';
  } else if (status === 402) {
    message = 'Insufficient credits. Please add credits on OpenRouter.';
  } else {
    message = `OpenRouter API error (${status})`;
  }
  if (said && status !== 401) message += `: ${said}`;
  const error = new Error(message);
  error.status = status;
  error.openRouterError = body && body.error ? body.error : null;
  return error;
}

// Statuses an endpoint uses to refuse the request itself — the only ones that
// can mean "this provider won't take the json_schema". 401/402/429 describe the
// account, not the payload: they would fail identically without the schema, so
// retrying just burns a second call (and hammers an already rate-limited API).
const SCHEMA_REJECTION_STATUSES = new Set([400, 404, 422, 501]);

// options: { useJsonSchema, jsonSchema }
// When useJsonSchema is true and the endpoint refuses the schema outright,
// retries once with plain json_object so organize still works there.
async function callOpenRouter(apiKey, model, messages, onChunk, options = {}) {
  const postRequest = async (opts) => {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': chrome.runtime.getURL(''),
        'X-Title': 'Tab Organizer',
      },
      body: JSON.stringify(buildOpenRouterRequestBody(model, messages, opts)),
    });

    if (!response.ok) {
      const body = await readOpenRouterErrorBody(response);
      console.error('[Tab Organizer] OpenRouter request failed:', {
        status: response.status,
        model,
        responseFormat: opts.useJsonSchema ? 'json_schema' : 'json_object',
        body,
      });
      throw mapOpenRouterHttpError(response.status, body);
    }
    return response;
  };

  const wantSchema = !!(options.useJsonSchema && options.jsonSchema);
  let response;
  try {
    response = await postRequest({
      useJsonSchema: wantSchema,
      jsonSchema: options.jsonSchema || null,
    });
  } catch (error) {
    if (!wantSchema || !SCHEMA_REJECTION_STATUSES.has(error.status)) throw error;
    console.warn(
      '[Tab Organizer] Endpoint refused the JSON schema; retrying with json_object:',
      error.message
    );
    response = await postRequest({ useJsonSchema: false, jsonSchema: null });
  }

  // Past this point the response is streaming into onChunk, and the proposal UI
  // has already rendered those chunks. A retry here would append a second
  // generation onto the partial text on screen, so failures must propagate.
  return readOpenRouterResponse(response, onChunk);
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

  for (const group of parsed.groups) {
    if (!group.name || !Array.isArray(group.tabIds)) continue;

    // Validate and filter tab IDs
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
// AI Tab Grouping — Message Handlers
// ============================================================

async function handleAiGroupTabs(message, sendResponse) {
  // The popup waits on exactly one reply, including when something fails
  // before the proposal tab exists.
  let responded = false;
  const reply = (response) => {
    if (responded) return;
    responded = true;
    sendResponse(response);
  };
  // Set once the proposal tab is open, so the catch below can reach it.
  let proposalTabId = null;
  const send = (msg) => {
    chrome.tabs.sendMessage(proposalTabId, msg).catch(() => {});
  };

  try {
    const respectGroups = message.respectGroups !== undefined ? message.respectGroups : true;
    const respectParam = respectGroups ? 'true' : 'false';
    const config = await loadAiConfig();

    // No key or expired → open setup page (carrying the Groups/Flat choice)
    if (!config || !config.key || isKeyExpired(config)) {
      const mode = config && config.key ? 'expired' : 'setup';
      const url = chrome.runtime.getURL(`ai-setup.html?mode=${mode}&respectGroups=${respectParam}`);
      await chrome.tabs.create({ url, active: true });
      reply({ success: true, action: 'setup' });
      return;
    }

    // Open proposal tab immediately
    const proposalUrl = chrome.runtime.getURL(`ai-proposal.html?respectGroups=${respectParam}`);
    const proposalTab = await chrome.tabs.create({ url: proposalUrl, active: true });
    proposalTabId = proposalTab.id;
    reply({ success: true, action: 'proposal' });

    // Wait for this proposal tab to signal it's ready (with optional instructions)
    const userInstructions = await new Promise(resolve => {
      aiPendingRuns.set(proposalTabId, resolve);
    });
    // The proposal tab was closed before the user started the run.
    if (userInstructions === null) return;

    // Gather tabs
    send({ type: 'ai-status', text: 'Gathering tabs...' });
    const currentWindow = await chrome.windows.getCurrent();
    const tabs = await getTabsWithGroupInfo(currentWindow.id);

    // Groups mode: only organize ungrouped tabs. Flat mode: all tabs.
    const unpinnedTabs = tabs.filter(t => {
      if (t.pinned || t.id === proposalTabId) return false;
      if (respectGroups && t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return false;
      return true;
    });

    if (unpinnedTabs.length === 0) {
      const errorMsg = respectGroups
        ? 'No ungrouped tabs to organize. Switch to Flat to reorganize all tabs.'
        : 'No unpinned tabs to organize.';
      send({ type: 'ai-error', error: errorMsg });
      return;
    }

    // Build prompt and send debug info
    const messages = buildAiPrompt(unpinnedTabs, userInstructions);
    const modelName = await resolveModelDisplayName(config.model);
    const useJsonSchema = await modelSupportsStructuredOutputs(config.model);
    const tabIds = unpinnedTabs.map((t) => t.id);
    const jsonSchema = useJsonSchema ? buildTabGroupsJsonSchema(tabIds) : null;
    send({
      type: 'ai-debug',
      model: config.model,
      modelName,
      messages,
      respectGroups,
      useJsonSchema,
    });
    send({
      type: 'ai-status',
      text: useJsonSchema
        ? `Calling ${modelName} (structured output)...`
        : `Calling ${modelName}...`,
    });

    // Stream API call (strict json_schema when the catalog says the model supports it)
    const apiKey = decodeKey(config.key);
    const responseText = await callOpenRouter(
      apiKey,
      config.model,
      messages,
      (chunk) => {
        send({ type: 'ai-chunk', text: chunk });
      },
      { useJsonSchema, jsonSchema }
    );

    // Parse response
    send({ type: 'ai-status', text: 'Parsing response...' });
    const result = parseAiResponse(responseText, unpinnedTabs);

    if (!result.success) {
      send({ type: 'ai-error', error: result.error });
      return;
    }

    // Build tab metadata and send proposal
    const tabMeta = unpinnedTabs.map(t => ({
      id: t.id,
      title: t.title || '(no title)',
      url: t.pendingUrl || t.url,
      favIconUrl: t.favIconUrl || '',
    }));

    send({
      type: 'ai-proposal',
      groups: result.groups,
      ungroupedTabIds: result.ungroupedTabIds,
      tabs: tabMeta,
      windowId: currentWindow.id,
    });
  } catch (error) {
    console.error('[Tab Organizer] Error in AI group tabs:', error);
    reply({ success: false, error: error.message });
    // The proposal tab may already be closed; send() swallows that.
    if (proposalTabId !== null) {
      send({ type: 'ai-error', error: error.message });
    }
  }
}

// The proposal tab stays open until this finishes, so a failure can be shown
// there; it is closed only once the groups are in place.
async function handleApplyAiProposal(message, sender, sendResponse) {
  try {
    const { groups, windowId } = message;

    // Grouping can pull a split's halves apart; record the pairs first. The
    // sort below records and restores again for the moves it makes.
    const splitPairs = await captureSplitPairs([windowId]);

    // Tabs closed or moved away since the proposal was made would make
    // chrome.tabs.group reject, so only the ones still in the window are used.
    const windowTabs = await chrome.tabs.query({ windowId });
    const stillHere = new Map(windowTabs.map(t => [t.id, t]));

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
    for (const group of groups) {
      const tabIds = (group.tabIds || []).filter(id => stillHere.has(id));
      if (tabIds.length === 0) continue;

      const groupId = await chrome.tabs.group({
        tabIds,
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

    sendResponse({ success: true });
    if (sender.tab) {
      try {
        await chrome.tabs.remove(sender.tab.id);
      } catch (_e) {
        // the user may have closed it already
      }
    }
  } catch (error) {
    console.error('[Tab Organizer] Error applying AI proposal:', error);
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
    console.error('[Tab Organizer] Error getting tab groups info:', error);
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
    console.error('[Tab Organizer] Error recreating tab group:', error);
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
      console.error('[Tab Organizer] Error moving tabs with groups:', error);
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
    console.log('[Tab Organizer]', message.data.message, ...message.data.args);
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
    // This will be handled by the confirmation dialog listener
    sendResponse({ success: true });
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
  } else if (message.action === 'aiProposalReady') {
    // pending:false means no run is waiting for this tab (it was refreshed,
    // its run already started, or the service worker restarted).
    const tabId = _sender.tab ? _sender.tab.id : null;
    const resolve = aiPendingRuns.get(tabId);
    if (resolve) {
      aiPendingRuns.delete(tabId);
      resolve(message.instructions || '');
    }
    sendResponse({ success: true, pending: !!resolve });
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
    Promise.all([loadAiConfig(), getOpenRouterModels({ forceRefresh: false })]).then(
      ([config, catalog]) => {
        sendResponse({
          config,
          models: catalog.models,
          expiryPresets: EXPIRY_PRESETS,
          modelsMeta: {
            fetchedAt: catalog.fetchedAt,
            fromCache: catalog.fromCache,
            stale: !!catalog.stale,
            fallback: !!catalog.fallback,
            error: catalog.error || null,
          },
        });
      }
    ).catch((err) => {
      sendResponse({
        config: null,
        models: curatedModelsAsPickerEntries(),
        expiryPresets: EXPIRY_PRESETS,
        modelsMeta: { fetchedAt: null, fromCache: false, fallback: true, error: err.message },
      });
    });
    return true;
  } else if (message.action === 'loadAiStatus') {
    // The popup only needs the cog state and a model label. Deliberately does
    // not touch the catalog: loadAiConfig can fire a network fetch on a cold
    // cache, which would stall the popup's first paint once every TTL.
    loadAiConfig().then(async (config) => {
      const model = config && config.model;
      sendResponse({
        config,
        modelName: model ? await resolveModelDisplayName(model) : null,
      });
    }).catch((err) => {
      console.error('[Tab Organizer] loadAiStatus failed:', err);
      sendResponse({ config: null, modelName: null });
    });
    return true;
  } else if (message.action === 'refreshOpenRouterModels') {
    // Always respond with a models array so the setup page never gets an empty
    // message (which used to surface as the opaque "Refresh failed").
    getOpenRouterModels({ forceRefresh: true })
      .then((catalog) => {
        const models = Array.isArray(catalog.models)
          ? catalog.models
          : curatedModelsAsPickerEntries();
        sendResponse({
          success: !catalog.fallback,
          models,
          modelsMeta: {
            fetchedAt: catalog.fetchedAt,
            fromCache: !!catalog.fromCache,
            stale: !!catalog.stale,
            fallback: !!catalog.fallback,
            error: catalog.error || null,
          },
        });
      })
      .catch((err) => {
        console.error('[Tab Organizer] refreshOpenRouterModels handler error:', err);
        sendResponse({
          success: false,
          error: err.message || String(err),
          models: curatedModelsAsPickerEntries(),
          modelsMeta: {
            fetchedAt: null,
            fromCache: false,
            fallback: true,
            error: err.message || String(err),
          },
        });
      });
    return true;
  } else if (message.action === 'openAiSettings') {
    const url = chrome.runtime.getURL('ai-setup.html?mode=edit');
    chrome.tabs.create({ url, active: true });
    sendResponse({ success: true });
  } else if (message.action === 'deleteAiConfig') {
    chrome.storage.local.remove('aiConfig').then(() => {
      sendResponse({ success: true });
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
  }
});

// Give Chrome a moment to settle closed or moved tabs before re-sorting. The
// handlers await this (rather than sorting in a detached timer) so they reply
// only once the work is done, with counts the popup can report.
const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));

async function handleSortAllWindows(respectGroups = true, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Sorting tabs in', windows.length, 'windows', respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Sort tabs within each window
    let unsorted = 0;
    for (const window of windows) {
      if (!(await sortWindowTabs(window.id, respectGroups))) unsorted++;
    }
    if (unsorted > 0) {
      throw new Error(`${unsorted} of ${windows.length} windows couldn't be sorted. Try again.`);
    }

    console.log('[Tab Organizer] Completed sortAllWindows');
    sendResponse({
      success: true,
      tabs: windows.reduce((sum, w) => sum + w.tabs.length, 0),
      windows: windows.length,
    });

  } catch (error) {
    console.error('[Tab Organizer] Error in sortAllWindows:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSortCurrentWindow(respectGroups = true, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    console.log('[Tab Organizer] Sorting tabs in current window', respectGroups ? '(preserving groups)' : '(individual tabs)');

    if (!(await sortWindowTabs(tabs[0].windowId, respectGroups))) {
      throw new Error('The window couldn\'t be sorted. Try again.');
    }

    console.log('[Tab Organizer] Completed sortCurrentWindow');
    sendResponse({ success: true, tabs: tabs.length });

  } catch (error) {
    console.error('[Tab Organizer] Error in sortCurrentWindow:', error);
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
    console.log('[Tab Organizer] Extracting domain:', targetDomain, respectGroups ? '(preserving groups)' : '(individual tabs)');

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
      console.log('[Tab Organizer] Moved', moved, 'of', tabsToMove.length, 'tabs to new window');
    }
    await restoreSplitPairs(splitPairs);

    // Wait a moment for tabs to settle, then sort
    await settle();
    const sorted = await sortWindowTabs(newWindow.id, respectGroups);

    // Activate the original active tab
    await chrome.tabs.update(message.tabId, { active: true });

    console.log('[Tab Organizer] Completed extractDomain');

    // The active tab went into the new window too.
    sendResponse({
      success: true,
      moved: moved + 1,
      notMoved: tabsToMove.length - moved,
      domain: targetDomain,
      sortFailed: !sorted,
    });

  } catch (error) {
    console.error('[Tab Organizer] Error in extractDomain:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates within current window only
async function handleRemoveDuplicatesWindow(respectGroups = true, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    console.log('[Tab Organizer] Removing duplicates in current window', respectGroups ? '(respecting groups)' : '(individual tabs)');

    const { tabsToRemove } = findDuplicateTabs([tabs], respectGroups);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Tab Organizer] Removed', tabsToRemove.length, 'duplicate tabs from current window');
    }

    // Sort remaining tabs in the current window
    await settle();
    const sorted = await sortWindowTabs(tabs[0].windowId, respectGroups);
    console.log('[Tab Organizer] Completed removeDuplicatesWindow');

    sendResponse({ success: true, removed: tabsToRemove.length, sortFailed: !sorted });

  } catch (error) {
    console.error('[Tab Organizer] Error in removeDuplicatesWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates within each window separately
async function handleRemoveDuplicatesAllWindows(respectGroups = true, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Removing duplicates in', windows.length, 'windows separately', respectGroups ? '(respecting groups)' : '(individual tabs)');

    const windowTabArrays = windows.map(window => window.tabs);
    const { tabsToRemove } = findDuplicateTabs(windowTabArrays, respectGroups);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Tab Organizer] Removed', tabsToRemove.length, 'duplicate tabs across all windows');
    }

    // Sort all windows
    await settle();
    let unsorted = 0;
    for (const window of windows) {
      if (!(await sortWindowTabs(window.id, respectGroups))) unsorted++;
    }
    console.log('[Tab Organizer] Completed removeDuplicatesAllWindows');

    sendResponse({ success: true, removed: tabsToRemove.length, sortFailed: unsorted > 0 });

  } catch (error) {
    console.error('[Tab Organizer] Error in removeDuplicatesAllWindows:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates across all windows globally
async function handleRemoveDuplicatesGlobally(respectGroups = true, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Removing duplicates globally across all windows', respectGroups ? '(respecting groups)' : '(individual tabs)');

    // Flatten all tabs from all windows for global deduplication
    const allTabs = windows.flatMap(window => window.tabs);
    const { tabsToRemove } = findDuplicateTabs([allTabs], respectGroups);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Tab Organizer] Removed', tabsToRemove.length, 'duplicate tabs globally');
    }

    // Sort all windows
    await settle();
    let unsorted = 0;
    for (const window of windows) {
      if (!(await sortWindowTabs(window.id, respectGroups))) unsorted++;
    }
    console.log('[Tab Organizer] Completed removeDuplicatesGlobally');

    sendResponse({ success: true, removed: tabsToRemove.length, sortFailed: unsorted > 0 });

  } catch (error) {
    console.error('[Tab Organizer] Error in removeDuplicatesGlobally:', error);
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
async function analyzeDomainDistribution() {
  try {
    const allTabsWithGroups = await getTabsWithGroupInfo();
    const domainTabCounts = new Map();
    const domainTabs = new Map();

    // Count tabs per domain (exclude pinned tabs from extraction consideration)
    for (const tab of allTabsWithGroups) {
      if (tab.pinned) {continue;}

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
    console.error('[Tab Organizer] Error analyzing domain distribution:', error);
    throw error;
  }
}

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
    console.log('[Tab Organizer] Starting Extract All Domains', respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Analyze all domains and their tab counts
    const domainAnalysis = await analyzeDomainDistribution();

    // Check if confirmation is needed (more than 5 total windows would be created)
    const totalWindowsToCreate = domainAnalysis.extractableDomains.length + (domainAnalysis.singleTabDomains.length > 0 ? 1 : 0);
    const needsConfirmation = totalWindowsToCreate > 5;

    if (needsConfirmation) {
      console.log('[Tab Organizer] Many windows would be created, requesting confirmation');

      // Create a confirmation dialog using the separate HTML file
      const confirmationUrl = createConfirmationDialogUrl(domainAnalysis);
      const confirmTab = await chrome.tabs.create({
        url: confirmationUrl,
        active: true
      });

      // Set up a one-time listener for the confirmation response
      const confirmationPromise = new Promise((resolve) => {
        const messageListener = (confirmMessage, sender, confirmSendResponse) => {
          if (confirmMessage.action === 'extractAllDomainsConfirmation' && sender.tab.id === confirmTab.id) {
            chrome.runtime.onMessage.removeListener(messageListener);
            chrome.tabs.remove(confirmTab.id);
            confirmSendResponse({ success: true });
            resolve(confirmMessage.confirmed);
          }
        };
        chrome.runtime.onMessage.addListener(messageListener);
      });

      const confirmed = await confirmationPromise;
      if (!confirmed) {
        console.log('[Tab Organizer] User cancelled Extract All Domains');
        sendResponse({ success: true, cancelled: true });
        return;
      }
    }

    // Proceed with extraction
    const { windows: created, notMoved } = await performExtractAllDomains(domainAnalysis, respectGroups);

    // Sort all windows after operations
    await settle();
    const windows = await chrome.windows.getAll({ populate: true });
    let unsorted = 0;
    for (const window of windows) {
      if (!(await sortWindowTabs(window.id, respectGroups))) unsorted++;
    }
    console.log('[Tab Organizer] Completed Extract All Domains');

    sendResponse({ success: true, windows: created, notMoved, sortFailed: unsorted > 0 });

  } catch (error) {
    console.error('[Tab Organizer] Error in Extract All Domains:', error);
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
    console.log('[Tab Organizer] Performing extraction for', domainAnalysis.extractableDomains.length, 'domains', respectGroups ? '(preserving groups)' : '(individual tabs)');

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

      console.log('[Tab Organizer] Created window for domain:', domain, 'with', domainTabs.length, 'tabs');
    }

    // Phase 2: Create one "Miscellaneous" window for all single-tab domains
    if (domainAnalysis.singleTabDomains.length > 0) {
      console.log('[Tab Organizer] Creating miscellaneous window for', domainAnalysis.singleTabDomains.length, 'single-tab domains');

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

      console.log('[Tab Organizer] Created miscellaneous window with', domainAnalysis.singleTabDomains.length, 'single-tab domains');
    }

    await restoreSplitPairs(splitPairs);

    console.log('[Tab Organizer] Extract All Domains extraction phase completed');
    return { windows, notMoved };

  } catch (error) {
    console.error('[Tab Organizer] Error in performExtractAllDomains:', error);
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
      console.error(`[Tab Organizer] Error sorting window tabs (attempt ${attempt}):`, error);
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

    console.log('[Tab Organizer] Flattening current window,', groupedTabIds.length, 'grouped tabs');

    if (groupedTabIds.length > 0) {
      await chrome.tabs.ungroup(groupedTabIds);
    }

    sendResponse({ success: true, ungrouped: groupedTabIds.length });
  } catch (error) {
    console.error('[Tab Organizer] Error in flattenWindow:', error);
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

    console.log('[Tab Organizer] Compacting current window into', pairs.length, 'split views');

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
        console.error('[Tab Organizer] Could not split tabs', pair, error);
      }
    }

    sendResponse({ success: true, paired, failed });
  } catch (error) {
    console.error('[Tab Organizer] Error in compactWindow:', error);
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

    console.log('[Tab Organizer] Expanding', splitIds.length, 'split views in current window');

    let unsplit = 0;
    let failed = 0;
    for (const splitId of splitIds) {
      try {
        await chrome.tabs.unsplit(splitId);
        unsplit++;
      } catch (error) {
        failed++;
        console.error('[Tab Organizer] Could not unsplit', splitId, error);
      }
    }

    sendResponse({ success: true, unsplit, failed });
  } catch (error) {
    console.error('[Tab Organizer] Error in expandWindow:', error);
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
    console.error('[Tab Organizer] Could not record split pairs:', error);
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
      console.error('[Tab Organizer] Could not restore split', [left.id, right.id], error);
    }
  }
  return restored;
}

async function handleCopyTabs(respectGroups = true, sendResponse, scope = 'all') {
  try {
    const scopeLabel = scope === 'window' ? 'current window' : 'all windows';
    console.log(
      '[Tab Organizer] Copying tabs from',
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
    console.error('[Tab Organizer] Error in copyTabs:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleMoveAllToSingleWindow(message, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Moving tabs from', windows.length, 'windows to single window');

    if (windows.length <= 1) {
      console.log('[Tab Organizer] Only one window exists, nothing to move');
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
      console.log('[Tab Organizer] No unpinned tabs to move');
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

    console.log('[Tab Organizer] Moved', moved, 'of', tabsToMove.length, 'unpinned tabs to single window');

    // Wait a moment for tabs to settle, then sort tabs in the target window
    await settle();
    const sorted = await sortWindowTabs(targetWindow.id, respectGroups);

    console.log('[Tab Organizer] Completed moveAllToSingleWindow');

    // Bring the target window into focus
    await chrome.windows.update(targetWindow.id, { focused: true });

    // If we have an active tab ID, make sure it stays active
    if (message.activeTabId) {
      await chrome.tabs.update(message.activeTabId, { active: true });
    }

    sendResponse({ success: true, moved, notMoved: tabsToMove.length - moved, sortFailed: !sorted });

  } catch (error) {
    console.error('[Tab Organizer] Error in moveAllToSingleWindow:', error);
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

async function loadSnoozedItems() {
  try {
    const result = await chrome.storage.local.get([SNOOZE_STORAGE_KEY]);
    const items = result && result[SNOOZE_STORAGE_KEY];
    return Array.isArray(items) ? items : [];
  } catch (_e) {
    return [];
  }
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
    console.error('[Tab Organizer] Error in snoozeTab:', error);
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
    console.error('[Tab Organizer] Error in snoozeSelected:', error);
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
    console.error('[Tab Organizer] Error in snoozeWindow:', error);
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
    console.error('[Tab Organizer] Error in snoozeGroup:', error);
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
          console.warn('[Tab Organizer] Failed to restore snoozed tab:', t.url, e && e.message);
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

  // tab / tabs / group — recreate into the last-focused normal window.
  windowId = await getRestoreTargetWindowId();
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
      console.warn('[Tab Organizer] Failed to restore snoozed tab:', t.url, e && e.message);
    }
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
    // Nothing reopened: say so, and that the record was kept (restorePoppedRecord).
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

// Post-pop half of the wake flow: clear the alarm, restore, optionally
// notify. On a restore throw the already-popped record is re-persisted with a
// near-future retry alarm so snoozed tabs are never permanently lost. Shared
// by wakeSnoozedRecord (single pop) and reconcileSnoozeAlarms (batched pop).
async function restorePoppedRecord(record, options = {}) {
  const notify = options.notify === true;

  try {
    await chrome.alarms.clear(SNOOZE_ALARM_PREFIX + record.id);
  } catch (_e) {
    // harmless if already fired/cleared
  }

  let restoreResult;
  try {
    restoreResult = await restoreSnoozedRecord(record);
  } catch (error) {
    // restoreSnoozedRecord already try/catches every per-tab create; a throw
    // here means something failed outside that loop (e.g. chrome.windows.create
    // / getLastFocused for a window-type record). The record was already
    // popped from storage — without this recovery it would be gone for good.
    // Re-persist it (under the same lock used everywhere else) and arm a
    // near-future retry so the tabs are never permanently lost.
    console.error('[Tab Organizer] restoreSnoozedRecord failed; re-persisting snoozed record to avoid data loss:', error);
    await withSnoozeLock(async () => {
      const items = await loadSnoozedItems();
      items.push(record);
      await saveSnoozedItems(items);
    });
    try {
      await chrome.alarms.create(SNOOZE_ALARM_PREFIX + record.id, { when: Date.now() + 60000 });
    } catch (_alarmErr) {
      // best effort — reconcileSnoozeAlarms re-arms it on next startup/install
    }
    return { record, requeued: true };
  }

  // Not one tab reopened although there were tabs to reopen: they now exist
  // only in this record, so put it back instead of dropping it. No retry
  // alarm: a URL Chrome refuses now (a file:// page without file access, a
  // removed extension's page) is refused again a minute later. The record
  // waits in the nap room, overdue, to be woken again or discarded.
  let kept = false;
  if (restoreResult.createdCount === 0 && restoreResult.failedCount > 0) {
    await withSnoozeLock(async () => {
      const items = await loadSnoozedItems();
      if (!items.some((r) => r.id === record.id)) items.push(record);
      await saveSnoozedItems(items);
    });
    kept = true;
  }

  if (notify) {
    notifyWake(record, restoreResult.createdCount, restoreResult.failedCount, {
      windowId: restoreResult.windowId,
      firstTabId: restoreResult.firstTabId,
    });
  }

  return { record, ...restoreResult, kept };
}

// Atomically pop the record, clear its alarm, restore it, optionally notify.
// Idempotent: a missing id is a silent no-op (handles duplicate alarm fires).
async function wakeSnoozedRecord(id, options = {}) {
  const record = await withSnoozeLock(async () => {
    const items = await loadSnoozedItems();
    const idx = items.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const [popped] = items.splice(idx, 1);
    await saveSnoozedItems(items);
    return popped;
  });

  if (!record) return null;

  return restorePoppedRecord(record, options);
}

function handleSnoozeAlarm(alarm) {
  if (!alarm || typeof alarm.name !== 'string' || !alarm.name.startsWith(SNOOZE_ALARM_PREFIX)) {
    return;
  }
  const id = alarm.name.slice(SNOOZE_ALARM_PREFIX.length);
  wakeSnoozedRecord(id, { notify: true });
}

async function handleWakeNow(message, sendResponse) {
  try {
    const result = await wakeSnoozedRecord(message.id, { notify: false });
    if (!result) {
      sendResponse({ success: false, error: 'Snooze not found' });
      return;
    }
    if (result.requeued) {
      sendResponse({ success: false, error: 'Could not restore right now — will retry automatically' });
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
    console.error('[Tab Organizer] Error in wakeSnoozed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Discard a snooze: drop the record and its alarm without reopening the tabs.
// The tabs were closed when they were snoozed, so this is the destructive
// action; the removed record is returned so the UI can offer an Undo.
async function handleCancelSnooze(message, sendResponse) {
  try {
    const removed = await withSnoozeLock(async () => {
      const items = await loadSnoozedItems();
      const idx = items.findIndex((r) => r.id === message.id);
      if (idx === -1) return null;
      const [record] = items.splice(idx, 1);
      await saveSnoozedItems(items);
      return record;
    });
    try {
      await chrome.alarms.clear(SNOOZE_ALARM_PREFIX + message.id);
    } catch (_e) {
      // harmless if already cleared
    }
    sendResponse({ success: removed !== null, record: removed || undefined });
  } catch (error) {
    console.error('[Tab Organizer] Error in cancelSnoozed:', error);
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
    console.error('[Tab Organizer] Error in restoreSnoozed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleListSnoozed(sendResponse) {
  try {
    const items = await loadSnoozedItems();
    items.sort((a, b) => a.wakeAt - b.wakeAt);
    sendResponse({ success: true, items });
  } catch (error) {
    console.error('[Tab Organizer] Error in listSnoozed:', error);
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

// Belt-and-braces on browser startup / extension install/update: wake every
// past-due record and re-arm alarms for future records that lost their timer.
async function reconcileSnoozeAlarms() {
  try {
    const now = Date.now();

    // Pop ALL past-due records in one locked storage transaction (a single
    // read-modify-write instead of one per record), then restore each.
    const pastDue = await withSnoozeLock(async () => {
      const items = await loadSnoozedItems();
      const due = items.filter((r) => r.wakeAt <= now);
      if (due.length > 0) {
        await saveSnoozedItems(items.filter((r) => r.wakeAt > now));
      }
      return due;
    });
    for (const r of pastDue) {
      await restorePoppedRecord(r, { notify: true });
    }

    const remaining = await loadSnoozedItems();
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
    console.error('[Tab Organizer] Error reconciling snooze alarms:', error);
  }
}

// ============================================================
// Tab Snoozing — Top-level listener registrations (MV3: sync at top level)
// ============================================================

chrome.alarms.onAlarm.addListener(handleSnoozeAlarm);
chrome.runtime.onStartup.addListener(reconcileSnoozeAlarms);
chrome.runtime.onInstalled.addListener(reconcileSnoozeAlarms);
chrome.notifications.onClicked.addListener(handleWakeNotificationClicked);