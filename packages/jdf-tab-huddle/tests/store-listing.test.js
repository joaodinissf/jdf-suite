import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// What the Chrome Web Store and chrome://extensions show about Huddle: the
// manifest's description, in the one framing that makes Huddle a single
// purpose ("Huddle organizes your browser tabs"), and its icons.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (file) => resolve(__dirname, '../src', file);
const manifest = JSON.parse(readFileSync(src('manifest.json'), 'utf8'));

// Chrome's limit for a manifest description.
const DESCRIPTION_LIMIT = 132;

// A PNG's width and height, from its IHDR chunk.
function pngSize(file) {
  const bytes = readFileSync(src(file));
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('the store listing', () => {
  it('describes Huddle as organizing your browser tabs, within Chrome\'s 132 characters', () => {
    const { description } = manifest;
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    expect(description).toMatch(/^Organize your browser tabs: /);
    // Every feature named is a part of tab organization, under its user-facing name.
    for (const part of ['sort', 'group', 'de-duplicate', 'snooze', 'open links as tabs', 'AI']) {
      expect(description).toContain(part);
    }
    expect(description).not.toMatch(/clump/i);
  });

  it('has the toolbar and store icons at 16, 48 and 128 px', () => {
    const sizes = { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' };
    expect(manifest.icons).toEqual(sizes);
    expect(manifest.action.default_icon).toEqual(sizes);
    for (const [size, file] of Object.entries(sizes)) {
      expect(pngSize(file)).toEqual([Number(size), Number(size)]);
    }
  });
});
