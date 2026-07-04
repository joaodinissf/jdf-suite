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
  test('401 -> invalid API key message', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeErrorResponse(401));
    await expect(callOpenRouter('key', 'model', [])).rejects.toThrow(
      'Invalid API key. Please check your OpenRouter key.'
    );
  });

  test('429 -> rate limited message', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeErrorResponse(429));
    await expect(callOpenRouter('key', 'model', [])).rejects.toThrow(
      'Rate limited. Please try again in a moment.'
    );
  });

  test('402 -> insufficient credits message', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeErrorResponse(402));
    await expect(callOpenRouter('key', 'model', [])).rejects.toThrow(
      'Insufficient credits. Please add credits on OpenRouter.'
    );
  });

  test('500 -> generic status-coded message', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeErrorResponse(500));
    await expect(callOpenRouter('key', 'model', [])).rejects.toThrow(
      'OpenRouter API error (500)'
    );
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
