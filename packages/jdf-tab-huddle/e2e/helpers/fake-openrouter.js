/**
 * A fake OpenRouter for the AI flow specs. context.route answers every
 * request to https://openrouter.ai (the worker's catalog and chat requests,
 * the pages' key check), so nothing reaches the real service; the spec also
 * maps openrouter.ai to nowhere as a safety net. Keys are test strings.
 *
 * Also serves the http tabs the specs organize (https://<site>.huddle.test/).
 */

export const GOOD_KEY = 'sk-or-e2e-good';
export const BAD_KEY = 'sk-or-e2e-bad';

const TEXT = { output_modalities: ['text'] };
const JSON_PARAMS = ['max_tokens', 'temperature', 'response_format'];
const model = (id, name, prompt, completion, extra = {}) => ({
  id,
  name,
  pricing: { prompt, completion },
  architecture: TEXT,
  supported_parameters: JSON_PARAMS,
  ...extra,
});

export const CATALOG = [
  model('anthropic/claude-haiku-4.5', 'Anthropic: Claude Haiku 4.5', '0.000001', '0.000005',
    { supported_parameters: [...JSON_PARAMS, 'structured_outputs'] }),
  model('openai/gpt-6-luna', 'OpenAI: GPT-6 Luna', '0.0000015', '0.000006'),
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

function jsonReply(status, obj) {
  return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}

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
 */
export async function installFakeOpenRouter(context, { slowMs = 4000 } = {}) {
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
      log.chats.push({ model: body.model, prompt: (body.messages || []).map((m) => m.content).join('\n') });
      if (key !== GOOD_KEY) {
        reply = jsonReply(401, { error: { code: 401, message: 'User not found.' } });
      } else if (body.model === 'deepseek/deepseek-v4-flash') {
        reply = jsonReply(401, { error: { code: 401, message: 'User not found.', metadata: { provider_name: 'DeepInfra' } } });
      } else {
        if (body.model === 'huddle-test/slow') await sleep(slowMs);
        reply = sse(JSON.stringify({ groups: groupsFromPrompt(body) }), body.model);
      }
    } else {
      reply = jsonReply(404, { error: { code: 404, message: `no fake for ${path}` } });
    }
    try {
      await route.fulfill(reply);
    } catch (_e) {
      // The request was aborted (Stop, a reload, a closed tab).
    }
  });
  return log;
}
