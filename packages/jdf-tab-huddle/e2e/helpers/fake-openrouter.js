/**
 * A fake OpenRouter for the AI flow specs. context.route answers every
 * request to https://openrouter.ai (the worker's catalog and chat requests,
 * the pages' key check), so nothing reaches the real service; the spec also
 * maps openrouter.ai to nowhere as a safety net. Keys are test strings.
 *
 * Huddle has no host permission for openrouter.ai, so Chrome applies CORS to
 * these answers like any cross-origin fetch. The fake allows any origin, as
 * the real API does. (Playwright answers the preflights itself, and adds an
 * allow-origin header to a fulfilled answer that has none.) opts.cors false
 * sends one naming another origin instead, which Chrome refuses as it refuses
 * an answer with none (a proxy's or an outage page): every fetch then fails.
 *
 * Also serves the http tabs the specs organize (https://<site>.huddle.test/).
 */

export const GOOD_KEY = 'sk-or-e2e-good';
export const BAD_KEY = 'sk-or-e2e-bad';

const TEXT = { output_modalities: ['text'] };
const JSON_PARAMS = ['max_tokens', 'temperature', 'response_format'];
const LUNA_PARAMS = ['include_reasoning', 'max_completion_tokens', 'max_tokens', 'reasoning',
  'reasoning_effort', 'response_format', 'seed', 'structured_outputs', 'tool_choice', 'tools'];
// Claude Haiku 5.5's, as OpenRouter's live catalog lists them (Oct 2026): no temperature.
const HAIKU_PARAMS = ['include_reasoning', 'max_completion_tokens', 'max_tokens', 'reasoning',
  'reasoning_effort', 'response_format', 'stop', 'structured_outputs', 'tool_choice', 'tools', 'verbosity'];
const model = (id, name, prompt, completion, extra = {}) => ({
  id,
  name,
  pricing: { prompt, completion },
  architecture: TEXT,
  supported_parameters: JSON_PARAMS,
  ...extra,
});

export const CATALOG = [
  model('anthropic/claude-haiku-5.5', 'Anthropic: Claude Haiku 5.5', '0.0000001', '0.0000005',
    { supported_parameters: HAIKU_PARAMS, context_length: 1000000 }),
  // The default before Haiku 5.5: no longer recommended, still listed.
  model('anthropic/claude-haiku-4.5', 'Anthropic: Claude Haiku 4.5', '0.000001', '0.000005',
    { supported_parameters: [...JSON_PARAMS, 'structured_outputs'] }),
  // Like the live catalog: GPT-6 Luna takes structured outputs but no
  // temperature, so a strict request with one finds no provider.
  model('openai/gpt-6-luna', 'OpenAI: GPT-6 Luna', '0.0000001', '0.0000005',
    { supported_parameters: LUNA_PARAMS }),
  // Batch variants, marked in the id or only in the name: never offered.
  model('openai/gpt-6-luna:batch', 'OpenAI: GPT-6 Luna (batch)', '0.00000075', '0.000003'),
  model('openai/gpt-6-luna-batch', 'GPT-6 Luna (batch)', '0.00000075', '0.000003'),
  model('openai/gpt-5.6-luna-pro-batch', 'GPT-5.6 Luna Pro (batch)', '0.0000075', '0.00003'),
  model('sao10k/l3-lunaris-8b', 'Sao10K: Llama 3 8B Lunaris', '0.00000002', '0.00000005'),
  // No JSON output: never offered.
  model('nousresearch/hermes-luna-70b', 'Nous: Hermes Luna 70B', '0.0000004', '0.0000004',
    { supported_parameters: ['temperature'] }),
  // A provider refuses it with a 401 while the same key works elsewhere.
  model('deepseek/deepseek-v4-flash', 'DeepSeek: DeepSeek V4 Flash', '0.0000001', '0.0000004'),
  // Lists structured outputs, but no provider honors a strict request for it
  // (OpenRouter's 404 whatever the request carries): only the fallback works.
  model('huddle-test/no-strict', 'Huddle Test: No Strict', '0.000001', '0.000001',
    { supported_parameters: [...JSON_PARAMS, 'structured_outputs'] }),
  // Answers slowly (for reloads and worker stops mid-run).
  model('huddle-test/slow', 'Huddle Test: Slow', '0.000001', '0.000001'),
];

export const USABLE_LUNA_IDS = ['openai/gpt-6-luna', 'sao10k/l3-lunaris-8b'];

const SITES = {
  docs: ['Extension service worker lifecycle', 'chrome.tabGroups reference'],
  mail: ['Inbox (3)'],
  shop: ['Your cart'],
};

export function siteUrls() {
  return Object.entries(SITES).flatMap(([site, titles]) =>
    titles.map((_t, i) => `https://${site}.huddle.test/page-${i + 1}`));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What OpenRouter says when require_parameters leaves no provider.
export const NO_ENDPOINTS = 'No endpoints found that can handle the requested parameters. To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection';

// The body's parameters a provider has to honor, as OpenRouter counts them
// (a json_schema answer format needs structured_outputs as well).
function requestedParameters(body) {
  const asked = Object.keys(body).filter((k) => !['model', 'messages', 'stream', 'provider'].includes(k));
  if (body.response_format && body.response_format.type === 'json_schema') asked.push('structured_outputs');
  return asked;
}

// With provider.require_parameters, a request carrying any parameter the
// model does not list routes nowhere: the 404 the real service sends.
function refusedByRouting(body) {
  if (!(body.provider && body.provider.require_parameters)) return false;
  if (body.model === 'huddle-test/no-strict') return true;
  const entry = CATALOG.find((m) => m.id === body.model);
  if (!entry) return false;
  return requestedParameters(body).some((p) => !entry.supported_parameters.includes(p));
}

function jsonReply(status, obj) {
  return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}

// OpenRouter's CORS answer, and one Chrome refuses an extension.
const CORS = { 'access-control-allow-origin': '*' };
const NO_CORS = { 'access-control-allow-origin': 'https://openrouter.ai' };

// Groups the prompt's tabs by host, like a well-behaved model.
function groupsFromPrompt(body) {
  const text = (body.messages || []).map((m) => m.content || '').join('\n');
  const byHost = new Map();
  for (const m of text.matchAll(/\[id:(\d+)\]\s+(\S+)\s+—/g)) {
    const host = m[2].split('.')[0];
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(Number(m[1]));
  }
  const colors = ['blue', 'green', 'purple', 'orange', 'cyan'];
  return Array.from(byHost, ([host, tabIds], i) => ({
    name: host.charAt(0).toUpperCase() + host.slice(1),
    color: colors[i % colors.length],
    tabIds,
  }));
}

function sse(content, modelId) {
  const pieces = content.match(/.{1,24}/gs) || [];
  const lines = pieces.map((p) => `data: ${JSON.stringify({ model: modelId, choices: [{ index: 0, delta: { content: p } }] })}\n\n`);
  lines.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n');
  return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: lines.join('') };
}

/**
 * Installs the fake on a context. Returns { requests, chats } where chats
 * are the chat bodies OpenRouter received (model, instructions), in order.
 * opts.slowMs: how long huddle-test/slow takes to answer.
 * opts.cors: false sends every answer with CORS headers Chrome refuses.
 */
export async function installFakeOpenRouter(context, { slowMs = 4000, cors = true } = {}) {
  const log = { requests: [], chats: [] };

  await context.route('https://*.huddle.test/**', (route) => {
    const url = new URL(route.request().url());
    const site = url.hostname.split('.')[0];
    const index = Number((url.pathname.match(/page-(\d+)/) || [])[1] || 1) - 1;
    const title = (SITES[site] || [])[index] || site;
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>${title}</title><h1>${title}</h1>` });
  });

  await context.route('https://openrouter.ai/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const auth = (await req.allHeaders()).authorization || '';
    const key = auth.replace(/^Bearer\s+/i, '');
    log.requests.push({ method: req.method(), path, key: key === GOOD_KEY ? 'good' : key ? 'other' : 'none' });
    let reply;
    if (path === '/api/v1/models') {
      reply = jsonReply(200, { data: CATALOG });
    } else if (path === '/api/v1/key') {
      reply = key === GOOD_KEY
        ? jsonReply(200, { data: { label: 'e2e', limit: 5, usage: 0 } })
        : jsonReply(401, { error: { code: 401, message: 'User not found.' } });
    } else if (path === '/api/v1/chat/completions') {
      const body = JSON.parse(req.postData() || '{}');
      log.chats.push({
        model: body.model,
        prompt: (body.messages || []).map((m) => m.content).join('\n'),
        params: requestedParameters(body),
        responseFormat: body.response_format ? body.response_format.type : null,
        requireParameters: !!(body.provider && body.provider.require_parameters),
        dataCollection: (body.provider && body.provider.data_collection) || null,
      });
      if (key !== GOOD_KEY) {
        reply = jsonReply(401, { error: { code: 401, message: 'User not found.' } });
      } else if (refusedByRouting(body)) {
        reply = jsonReply(404, { error: { code: 404, message: NO_ENDPOINTS } });
      } else if (body.model === 'deepseek/deepseek-v4-flash') {
        reply = jsonReply(401, { error: { code: 401, message: 'User not found.', metadata: { provider_name: 'DeepInfra' } } });
      } else {
        if (body.model === 'huddle-test/slow') await sleep(slowMs);
        reply = sse(JSON.stringify({ groups: groupsFromPrompt(body) }), body.model);
      }
    } else {
      reply = jsonReply(404, { error: { code: 404, message: `no fake for ${path}` } });
    }
    reply.headers = { ...reply.headers, ...(cors ? CORS : NO_CORS) };
    try {
      await route.fulfill(reply);
    } catch (_e) {
      // The request was aborted (Stop, a reload, a closed tab).
    }
  });
  return log;
}
