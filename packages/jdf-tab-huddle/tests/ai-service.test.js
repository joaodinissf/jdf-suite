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

  test('each model has id, name, and cost', () => {
    for (const model of AI_MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.cost).toBeTruthy();
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
