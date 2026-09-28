// Tests for callOpenRouter (src/background.js) — the OpenRouter fetch/SSE client.
// Exposed globally by tests/setup.js.

function makeErrorResponse(status) {
  return { ok: false, status };
}

function makeNonStreamingResponse(content) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

// Builds a fake `Response` whose `.body.getReader()` yields the given raw
// text chunks (already SSE-formatted) one at a time, then signals done.
function makeStreamingResponse(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) {
            const value = encoder.encode(chunks[i]);
            i += 1;
            return { done: false, value };
          }
          return { done: true, value: undefined };
        },
      }),
    },
  };
}

describe('callOpenRouter - error status mapping', () => {
  const withBody = (status, message, provider) => ({
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { code: status, message, ...(provider ? { metadata: { provider_name: provider } } : {}) } }),
  });

  test('401 with no body is left for the key check (kind auth)', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeErrorResponse(401));
    await expect(callOpenRouter('key', 'model', [])).rejects.toMatchObject({
      kind: 'auth',
      message: 'OpenRouter refused the request (401).',
    });
  });

  test('429 says what OpenRouter said, once, with no ".:" glitch', async () => {
    global.fetch = vi.fn().mockResolvedValue(withBody(429, 'Rate limit exceeded: free-models-per-day'));
    await expect(callOpenRouter('key', 'model', [])).rejects.toMatchObject({
      kind: 'transient',
      message: 'OpenRouter is rate limiting this request (429: Rate limit exceeded: free-models-per-day). Try again in a moment.',
    });
  });

  test('402 -> credits, which a plain retry cannot fix', async () => {
    global.fetch = vi.fn().mockResolvedValue(withBody(402, 'This request requires more credits'));
    await expect(callOpenRouter('key', 'model', [], null, { ctx: { modelName: 'GPT-6 Luna' } })).rejects.toMatchObject({
      kind: 'credits',
      retryable: false,
      message: 'OpenRouter needs more credits to run GPT-6 Luna (402: This request requires more credits). Add credits on OpenRouter, or pick a cheaper model.',
    });
  });

  // From #71: OpenRouter's own explanation reaches the message, whatever the status.
  test('401 with a provider named is the model\'s problem, with OpenRouter\'s explanation', async () => {
    global.fetch = vi.fn().mockResolvedValue(withBody(401, 'User not found.', 'DeepSeek'));
    const err = await callOpenRouter('key', 'deepseek/deepseek-v4-flash', [], null, { ctx: { modelName: 'DeepSeek V4 Flash' } }).catch((e) => e);
    expect(err.message).toBe('DeepSeek, the provider serving DeepSeek V4 Flash, refused the request (401: User not found). Your key works; pick another model.');
    expect(err.kind).toBe('model');
    expect(err.status).toBe(401);
    expect(err.openRouterError).toEqual({ message: 'User not found.', provider: 'DeepSeek' });
  });

  test('other statuses carry OpenRouter\'s explanation', async () => {
    global.fetch = vi.fn().mockResolvedValue(withBody(503, 'No endpoints available'));
    await expect(callOpenRouter('key', 'model', [])).rejects.toThrow(/\(503: No endpoints available\)/);
  });

  test('a non-JSON error body is shown as text', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ...makeErrorResponse(500), text: async () => 'upstream timeout' });
    await expect(callOpenRouter('key', 'model', [])).rejects.toThrow(/\(500: upstream timeout\)/);
  });

  test('a failed request is logged with its status, model, format and body', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue(withBody(503, 'No endpoints available'));
    await callOpenRouter('key', 'some/model', []).catch(() => {});
    expect(spy).toHaveBeenCalledWith('[Huddle] OpenRouter request failed:', {
      status: 503,
      model: 'some/model',
      responseFormat: 'json_object',
      detail: { message: 'No endpoints available', provider: '' },
    });
    spy.mockRestore();
  });

  test('404 names the model', async () => {
    global.fetch = vi.fn().mockResolvedValue(withBody(404, 'No endpoints found for z-ai/glm-5-air.'));
    await expect(callOpenRouter('key', 'z-ai/glm-5-air', [], null, { ctx: { modelName: 'GLM 5 Air' } })).rejects.toMatchObject({
      kind: 'model',
      retryable: false,
      message: 'GLM 5 Air isn\'t available on OpenRouter right now (404: No endpoints found for z-ai/glm-5-air). Pick another model.',
    });
  });

  // Each of these fails the same way on a retry, so the page leads with Change
  // model instead of Retry (retryable: false).
  test.each([
    [400, 'This endpoint\'s maximum context length is 8192 tokens.', ''],
    [400, 'foo/bar is not a valid model ID', ''],
    [403, 'Your input was flagged for moderation.', ''],
    [401, 'User not found.', 'DeepInfra'],
  ])('%i "%s" is not retryable', async (status, message, provider) => {
    global.fetch = vi.fn().mockResolvedValue(withBody(status, message, provider));
    await expect(callOpenRouter('key', 'model', [])).rejects.toMatchObject({ kind: 'model', retryable: false, status });
  });

  test('500 -> try again', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeErrorResponse(500));
    await expect(callOpenRouter('key', 'model', [])).rejects.toMatchObject({ kind: 'transient', status: 500 });
  });

  test('503 names the model that failed, and the provider when OpenRouter says', async () => {
    global.fetch = vi.fn().mockResolvedValue(withBody(503, 'Service unavailable'));
    await expect(callOpenRouter('key', 'openai/gpt-6-luna', [], null, { ctx: { modelName: 'GPT-6 Luna' } })).rejects.toMatchObject({
      kind: 'transient',
      message: 'OpenRouter or the provider serving GPT-6 Luna had a problem (503: Service unavailable). Try again in a moment.',
    });
    global.fetch = vi.fn().mockResolvedValue(withBody(502, 'Bad gateway', 'Azure'));
    await expect(callOpenRouter('key', 'openai/gpt-6-luna', [], null, { ctx: { modelName: 'GPT-6 Luna' } })).rejects.toMatchObject({
      message: 'OpenRouter or Azure, the provider serving GPT-6 Luna, had a problem (502: Bad gateway). Try again in a moment.',
    });
  });
});

describe('callOpenRouter - errors inside a 200', () => {
  test('an error event mid-stream is a provider failure, not invalid JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeStreamingResponse([
      'data: {"choices":[{"delta":{"content":"{\\"groups\\": ["}}]}\n\n',
      'data: {"error":{"code":502,"message":"Upstream provider disconnected"},"choices":[{"delta":{},"finish_reason":"error"}]}\n\n',
    ]));
    await expect(callOpenRouter('key', 'model', [])).rejects.toThrow(/stopped mid-answer.*502: Upstream provider disconnected/);
  });

  test('a JSON error body with status 200 is reported as that error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ error: { code: 502, message: 'Provider returned error' } }),
    });
    await expect(callOpenRouter('key', 'model', [])).rejects.toThrow(/502: Provider returned error/);
  });

  test('an HTML page (captive portal) is not an API response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    });
    await expect(callOpenRouter('key', 'model', [])).rejects.toMatchObject({ kind: 'network' });
  });

  test('a request that never answers times out with a readable error', async () => {
    global.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await expect(callOpenRouter('key', 'model', [], null, { firstByteMs: 20 }))
      .rejects.toMatchObject({ kind: 'transient', message: expect.stringMatching(/didn't answer within/) });
  });
});

describe('callOpenRouter - SSE streaming', () => {
  test('handles a line split mid-chunk, skips malformed JSON, stops at [DONE]', async () => {
    // The first "data:" line is deliberately split across two reads.
    const chunk1 = 'data: {"choices":[{"delta":{"content":"Hel';
    const chunk2 =
      'lo "}}]}\n\n' +
      'data: {this is not valid json}\n\n' +
      'data: {"choices":[{"delta":{"content":"World"}}]}\n\n' +
      'data: [DONE]\n\n';

    global.fetch = vi.fn().mockResolvedValue(makeStreamingResponse([chunk1, chunk2]));

    const onChunk = vi.fn();
    const result = await callOpenRouter('key', 'model', [], onChunk);

    expect(onChunk.mock.calls).toEqual([['Hello '], ['World']]);
    expect(result).toBe('Hello World');
  });

  test('emits nothing extra when the stream contains only [DONE]', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeStreamingResponse(['data: [DONE]\n\n']));

    const onChunk = vi.fn();
    const result = await callOpenRouter('key', 'model', [], onChunk);

    expect(onChunk).not.toHaveBeenCalled();
    expect(result).toBe('');
  });
});

describe('callOpenRouter - non-streaming JSON fallback', () => {
  test('returns content directly and invokes onChunk once when not SSE', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeNonStreamingResponse('Plain response text'));

    const onChunk = vi.fn();
    const result = await callOpenRouter('key', 'model', [], onChunk);

    expect(result).toBe('Plain response text');
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('Plain response text');
  });

  test('works without an onChunk callback', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeNonStreamingResponse('No callback here'));

    const result = await callOpenRouter('key', 'model', []);

    expect(result).toBe('No callback here');
  });
});

describe('callOpenRouter - structured output options', () => {
  test('sends json_schema body when useJsonSchema is true', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeNonStreamingResponse('{"groups":[]}'));
    const jsonSchema = buildTabGroupsJsonSchema([1, 2]);

    await callOpenRouter('key', 'model', [{ role: 'user', content: 'hi' }], null, {
      useJsonSchema: true,
      jsonSchema,
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema).toEqual(jsonSchema);
    expect(body.provider).toEqual({ require_parameters: true });
  });

  test('falls back to json_object after a failed structured-output request', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeErrorResponse(400))
      .mockResolvedValueOnce(makeNonStreamingResponse('{"groups":[]}'));

    const result = await callOpenRouter('key', 'model', [], null, {
      useJsonSchema: true,
      jsonSchema: buildTabGroupsJsonSchema([1]),
    });

    expect(result).toBe('{"groups":[]}');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const secondBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(firstBody.response_format.type).toBe('json_schema');
    expect(secondBody.response_format.type).toBe('json_object');
    expect(secondBody.provider).toBeUndefined();
  });

  test('does not retry when json_object request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeErrorResponse(500));
    await expect(
      callOpenRouter('key', 'model', [], null, { useJsonSchema: false })
    ).rejects.toMatchObject({ status: 500 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('does not retry structured-output failures that are account/rate-limit errors', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeErrorResponse(401));
    await expect(
      callOpenRouter('key', 'model', [], null, {
        useJsonSchema: true,
        jsonSchema: buildTabGroupsJsonSchema([1]),
      })
    ).rejects.toMatchObject({ status: 401 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
