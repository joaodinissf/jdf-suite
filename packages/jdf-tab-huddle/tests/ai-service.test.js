describe('AI Service - Key Encoding', () => {
  test('encodeKey and decodeKey are inverse operations', () => {
    const key = 'sk-or-v1-abc123xyz';
    const encoded = encodeKey(key);
    expect(encoded).not.toBe(key);
    expect(decodeKey(encoded)).toBe(key);
  });

  test('encodeKey produces base64 output', () => {
    const encoded = encodeKey('test-key');
    // Base64 only contains A-Z, a-z, 0-9, +, /, =
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe('AI Service - Key Expiry', () => {
  test('isKeyExpired returns true when no config', () => {
    expect(isKeyExpired(null)).toBe(true);
    expect(isKeyExpired({})).toBe(true);
    expect(isKeyExpired({ key: null })).toBe(true);
  });

  test('isKeyExpired returns false when expiresAt is null (never expires)', () => {
    expect(isKeyExpired({ key: 'abc', expiresAt: null })).toBe(false);
  });

  test('isKeyExpired returns false when key has not expired', () => {
    const futureTime = Date.now() + 3600000;
    expect(isKeyExpired({ key: 'abc', expiresAt: futureTime })).toBe(false);
  });

  test('isKeyExpired returns true when key has expired', () => {
    const pastTime = Date.now() - 1000;
    expect(isKeyExpired({ key: 'abc', expiresAt: pastTime })).toBe(true);
  });
});

describe('AI Service - stripQueryParams', () => {
  test('strips query parameters from URLs', () => {
    expect(stripQueryParams('https://example.com/path?foo=bar&baz=1'))
      .toBe('https://example.com/path');
  });

  test('preserves URLs without query parameters', () => {
    expect(stripQueryParams('https://example.com/path'))
      .toBe('https://example.com/path');
  });

  test('handles invalid URLs gracefully', () => {
    expect(stripQueryParams('not-a-url')).toBe('not-a-url');
  });

  // L22: a data: address is the whole document, a blob: one an id, and a
  // file: one a local path with the user's name in it.
  test('data: keeps only its MIME type', () => {
    expect(stripQueryParams('data:text/html,<title>Draft</title><p>PRIVATE-NOTE-BODY</p>')).toBe('data:text/html');
    expect(stripQueryParams(`data:text/html;base64,${'A'.repeat(200000)}`)).toBe('data:text/html');
    expect(stripQueryParams('data:image/png;charset=utf-8,xyz')).toBe('data:image/png');
  });

  test('blob: keeps only the origin that made it', () => {
    expect(stripQueryParams('blob:https://example.com/550e8400-e29b-41d4-a716-446655440000')).toBe('blob:https://example.com');
  });

  test('file: keeps only the file name', () => {
    expect(stripQueryParams('file:///Users/someone/Private/tax-return-2026.pdf?x=1')).toBe('file:…/tax-return-2026.pdf');
  });
});

describe('AI Service - buildAiPrompt', () => {
  const sampleTabs = [
    { id: 1, url: 'https://github.com/user/repo', title: 'My Repo', pendingUrl: null },
    { id: 2, url: 'https://news.ycombinator.com/', title: 'Hacker News', pendingUrl: null },
    { id: 3, url: 'https://github.com/user/other', title: 'Other Repo', pendingUrl: null },
  ];

  test('returns system and user messages', () => {
    const messages = buildAiPrompt(sampleTabs);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  test('system message requests JSON-only output', () => {
    const messages = buildAiPrompt(sampleTabs);
    expect(messages[0].content).toContain('JSON');
  });

  test('user message contains tab IDs, domains, and titles', () => {
    const messages = buildAiPrompt(sampleTabs);
    const content = messages[1].content;
    expect(content).toContain('[id:1]');
    expect(content).toContain('[id:2]');
    expect(content).toContain('[id:3]');
    expect(content).toContain('github.com');
    expect(content).toContain('My Repo');
    expect(content).toContain('Hacker News');
  });

  test('tabs are sorted by domain in the prompt', () => {
    const messages = buildAiPrompt(sampleTabs);
    const content = messages[1].content;
    // github.com should appear before news.ycombinator.com
    const githubPos = content.indexOf('github.com');
    const hnPos = content.indexOf('news.ycombinator.com');
    expect(githubPos).toBeLessThan(hnPos);
  });

  test('a 250-character title is cut to 200, a 400-character address to 300', () => {
    const title = 'T'.repeat(250);
    const url = `https://example.com/${'p'.repeat(400 - 'https://example.com/'.length)}`;
    const line = buildAiPrompt([{ id: 7, url, title }])[1].content.split('\n').find((l) => l.startsWith('[id:7]'));
    expect(line).toBe(`[id:7] example.com — "${'T'.repeat(200)}" — ${url.slice(0, 300)}`);
  });

  test('a data: tab sends its MIME type, not its document', () => {
    const content = buildAiPrompt([{ id: 8, url: 'data:text/html,<p>PRIVATE-NOTE-BODY</p>', title: 'Draft' }])[1].content;
    expect(content).not.toContain('PRIVATE-NOTE-BODY');
    expect(content).toContain('— data:text/html');
  });

  // Chrome titles a page without a <title> with its address.
  test('an untitled data: tab sends its MIME type as the title, not its document', () => {
    const url = 'data:text/html,<p>UNTITLED-NOTE-BODY</p>';
    const line = buildAiPrompt([{ id: 9, url, title: url }])[1].content.split('\n').find((l) => l.startsWith('[id:9]'));
    expect(line).toBe('[id:9] data — "data:text/html" — data:text/html');
  });

  // Chrome unescapes the address it uses as the title, so title !== url.
  test('an untitled percent-encoded data: tab sends its MIME type as the title', () => {
    const url = 'data:text/html,%3Cp%3EESCAPED-NOTE-BODY%20caf%C3%A9%3C/p%3E';
    const line = buildAiPrompt([{ id: 12, url, title: 'data:text/html,<p>ESCAPED-NOTE-BODY café</p>' }])[1].content
      .split('\n').find((l) => l.startsWith('[id:12]'));
    expect(line).toBe('[id:12] data — "data:text/html" — data:text/html');
  });

  // Chrome cuts the title at 4096 characters, so title !== url.
  test('an untitled data: tab over 4096 characters sends its MIME type as the title', () => {
    const url = `data:text/plain,LONG-NOTE-BODY ${'x'.repeat(20000)}`;
    const line = buildAiPrompt([{ id: 13, url, title: url.slice(0, 4096) }])[1].content
      .split('\n').find((l) => l.startsWith('[id:13]'));
    expect(line).toBe('[id:13] data — "data:text/plain" — data:text/plain');
  });

  // Chrome titles a file: folder "Index of <its full path>".
  test('a file: folder sends its cleaned address as the title, not its path', () => {
    const url = 'file:///Users/someone/Private/files/';
    const line = buildAiPrompt([{ id: 14, url, title: 'Index of /Users/someone/Private/files/' }])[1].content
      .split('\n').find((l) => l.startsWith('[id:14]'));
    expect(line).toBe('[id:14] file — "file:…/" — file:…/');
  });

  test('a local tab (file:, data:, blob:) always sends its cleaned address as the title', () => {
    const lines = buildAiPrompt([
      { id: 15, url: 'file:///Users/someone/Private/my%20notes.txt', title: 'my notes.txt' },
      { id: 16, url: 'data:text/html,<title>Private plan</title>', title: 'Private plan' },
      { id: 17, url: 'blob:https://app.example/1234-abcd', title: 'Export of my account' },
    ])[1].content;
    expect(lines).toContain('[id:15] file — "file:…/my%20notes.txt" — file:…/my%20notes.txt');
    expect(lines).toContain('"data:text/html" — data:text/html');
    expect(lines).toContain('"blob:https://app.example" — blob:https://app.example');
    expect(lines).not.toMatch(/Private plan|Export of my account/);
  });

  test('a tab with no title still says (no title)', () => {
    expect(buildAiPrompt([{ id: 11, url: 'https://example.com/a' }])[1].content).toContain('[id:11] example.com — "(no title)" — https://example.com/a');
  });

  test('a file: tab titled with its address sends only the file name', () => {
    const url = 'file:///Users/someone/Private/tax-return-2026.pdf';
    for (const tab of [{ id: 10, url, title: url }, { id: 10, url: 'chrome://newtab/', pendingUrl: url, title: url }]) {
      const content = buildAiPrompt([tab])[1].content;
      expect(content).not.toContain('/Users/someone');
      expect(content).toContain('"file:…/tax-return-2026.pdf" — file:…/tax-return-2026.pdf');
    }
  });

  test('lists available colors', () => {
    const messages = buildAiPrompt(sampleTabs);
    const content = messages[1].content;
    expect(content).toContain('blue');
    expect(content).toContain('green');
    expect(content).toContain('purple');
  });
});

describe('AI Service - parseAiResponse', () => {
  const originalTabs = [
    { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
  ];

  test('parses valid JSON response', () => {
    const response = JSON.stringify({
      groups: [
        { name: 'Dev', color: 'blue', tabIds: [1, 2] },
        { name: 'Social', color: 'green', tabIds: [3, 4] },
      ]
    });

    const result = parseAiResponse(response, originalTabs);
    expect(result.success).toBe(true);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].name).toBe('Dev');
    expect(result.groups[0].color).toBe('blue');
    expect(result.groups[0].tabIds).toEqual([1, 2]);
    expect(result.ungroupedTabIds).toEqual([5]);
  });

  test('handles JSON wrapped in code fences', () => {
    const response = '```json\n{"groups": [{"name": "Test", "color": "red", "tabIds": [1, 2, 3, 4, 5]}]}\n```';
    const result = parseAiResponse(response, originalTabs);
    expect(result.success).toBe(true);
    expect(result.groups).toHaveLength(1);
  });

  test('filters out invalid tab IDs (hallucination guard)', () => {
    const response = JSON.stringify({
      groups: [
        { name: 'Dev', color: 'blue', tabIds: [1, 999, 2] },
      ]
    });

    const result = parseAiResponse(response, originalTabs);
    expect(result.success).toBe(true);
    expect(result.groups[0].tabIds).toEqual([1, 2]);
  });

  test('prevents duplicate tab assignments across groups', () => {
    const response = JSON.stringify({
      groups: [
        { name: 'A', color: 'blue', tabIds: [1, 2] },
        { name: 'B', color: 'red', tabIds: [2, 3] }, // tab 2 is a duplicate
      ]
    });

    const result = parseAiResponse(response, originalTabs);
    expect(result.success).toBe(true);
    // Tab 2 should only be in the first group
    expect(result.groups[0].tabIds).toEqual([1, 2]);
    expect(result.groups[1].tabIds).toEqual([3]);
  });

  test('normalizes invalid colors to grey', () => {
    const response = JSON.stringify({
      groups: [
        { name: 'Test', color: 'neon_pink', tabIds: [1, 2, 3, 4, 5] },
      ]
    });

    const result = parseAiResponse(response, originalTabs);
    expect(result.success).toBe(true);
    expect(result.groups[0].color).toBe('grey');
  });

  test('collects unassigned tabs into ungroupedTabIds', () => {
    const response = JSON.stringify({
      groups: [
        { name: 'Partial', color: 'blue', tabIds: [1, 3] },
      ]
    });

    const result = parseAiResponse(response, originalTabs);
    expect(result.success).toBe(true);
    expect(result.ungroupedTabIds).toEqual([2, 4, 5]);
  });

  test('returns error for invalid JSON', () => {
    const result = parseAiResponse('not json at all', originalTabs);
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid JSON');
  });

  test('returns error for missing groups array', () => {
    const result = parseAiResponse('{"data": []}', originalTabs);
    expect(result.success).toBe(false);
    expect(result.error).toContain('groups');
  });

  // Models without structured outputs can answer this; it used to throw a raw TypeError.
  test('a null answer is a missing groups array, not a crash', () => {
    for (const answer of ['null', '```json\nnull\n```']) {
      expect(parseAiResponse(answer, originalTabs)).toMatchObject({ success: false, error: expect.stringContaining('groups') });
    }
  });

  test('null group entries are skipped and the valid groups kept', () => {
    const result = parseAiResponse('{"groups":[null,{"name":"A","color":"blue","tabIds":[1,2]}]}', originalTabs);
    expect(result.success).toBe(true);
    expect(result.groups).toEqual([{ name: 'A', color: 'blue', tabIds: [1, 2] }]);
    // Nothing usable at all: the existing "no group" error.
    expect(parseAiResponse('{"groups":[null]}', originalTabs))
      .toMatchObject({ success: false, error: expect.stringMatching(/didn't put any of your tabs in a group/) });
  });

  test('skips groups with no valid tabs', () => {
    const response = JSON.stringify({
      groups: [
        { name: 'Valid', color: 'blue', tabIds: [1] },
        { name: 'Empty', color: 'red', tabIds: [999, 888] },
      ]
    });

    const result = parseAiResponse(response, originalTabs);
    expect(result.success).toBe(true);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe('Valid');
  });

  test('truncates long group names to 40 characters', () => {
    const longName = 'A'.repeat(60);
    const response = JSON.stringify({
      groups: [
        { name: longName, color: 'blue', tabIds: [1, 2, 3, 4, 5] },
      ]
    });

    const result = parseAiResponse(response, originalTabs);
    expect(result.success).toBe(true);
    expect(result.groups[0].name.length).toBe(40);
  });
});

describe('AI Service - Constants', () => {
  test('AI_MODELS has at least 2 models', () => {
    expect(AI_MODELS.length).toBeGreaterThanOrEqual(2);
  });

  test('each model has id, name, provider and pricing', () => {
    for (const model of AI_MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.provider).toBeTruthy();
      expect(formatModelCost(model.pricing)).toMatch(/ in · .* out per M$/);
    }
  });

  test('VALID_TAB_GROUP_COLORS matches Chrome tab group colors', () => {
    expect(VALID_TAB_GROUP_COLORS).toContain('blue');
    expect(VALID_TAB_GROUP_COLORS).toContain('red');
    expect(VALID_TAB_GROUP_COLORS).toContain('green');
    expect(VALID_TAB_GROUP_COLORS).toContain('grey');
    expect(VALID_TAB_GROUP_COLORS).toHaveLength(9);
  });
});
