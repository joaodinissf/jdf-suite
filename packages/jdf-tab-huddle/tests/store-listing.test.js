import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// What the Chrome Web Store and chrome://extensions show about Huddle: the
// manifest's description, in the one framing that makes Huddle a single
// purpose ("Huddle organizes your browser tabs"), and its icons; and what is
// pasted into the store's dashboard from store/.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (file) => resolve(__dirname, '../src', file);
const store = (file) => resolve(__dirname, '../store', file);
const manifest = JSON.parse(readFileSync(src('manifest.json'), 'utf8'));

// Chrome's limit for a manifest description.
const DESCRIPTION_LIMIT = 132;

// A PNG's width and height, from its IHDR chunk.
function pngSize(path) {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

// A PNG's colour type: 2 is RGB (24-bit, no alpha), 6 is RGBA.
const pngColorType = (path) => readFileSync(path)[25];

// The text of the first ```text block under a Markdown heading.
function pasteBlock(markdown, heading) {
  const section = markdown.split(/^#+ /m).find((s) => s.startsWith(heading));
  expect(section, `no "${heading}" section`).toBeTruthy();
  return section.match(/```text\n([\s\S]*?)\n```/)[1];
}

const POLICY_URL = 'https://joaof.eu/privacy/huddle/';

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
      expect(pngSize(src(file))).toEqual([Number(size), Number(size)]);
    }
  });
});

// What is pasted into the Chrome Web Store dashboard (store/), kept in step
// with the manifest that is uploaded with it.
describe('the store/ folder', () => {
  const read = (file) => readFileSync(store(file), 'utf8');

  it('gives the manifest\'s description as the summary, and a description that starts with the purpose', () => {
    const listing = read('listing.md');
    const privacy = read('privacy-practices.md');
    expect(pasteBlock(listing, 'Summary')).toBe(manifest.description);
    const description = pasteBlock(listing, 'Detailed description');
    expect(description).toMatch(/^Huddle organizes your browser tabs\./);
    expect(description).toContain(`Privacy policy: ${POLICY_URL}`);
    expect(description).not.toMatch(/clump/i);
    expect(pasteBlock(privacy, 'Single purpose')).toMatch(/^Huddle organizes your browser tabs: /);
  });

  it('justifies exactly the permissions the manifest asks for, and no host access', () => {
    const privacy = read('privacy-practices.md');
    const justified = [...privacy.matchAll(/^### `([a-zA-Z]+)`$/gm)].map((m) => m[1]);
    expect(justified.sort()).toEqual([...manifest.permissions].sort());
    for (const permission of justified) expect(pasteBlock(privacy, `\`${permission}\``).length).toBeGreaterThan(40);
    // "Host permissions: none" is only true while the manifest asks for none.
    expect(privacy).toMatch(/^### Host permissions\n\nNone\./m);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
  });

  it('names the same privacy policy in the listing and the Privacy tab', () => {
    const listing = read('listing.md');
    const privacy = read('privacy-practices.md');
    expect(listing).toContain(`## Privacy policy URL\n\n${POLICY_URL}`);
    expect(privacy).toContain(`## Privacy policy URL\n\n${POLICY_URL}`);
    expect(pasteBlock(privacy, 'Data use statement')).toContain(POLICY_URL);
  });

  it('has the screenshots and the small promo tile at the store\'s sizes, as PNGs without alpha', () => {
    const listing = read('listing.md');
    const images = readdirSync(store('screenshots')).filter((f) => f.endsWith('.png')).sort();
    const screenshots = images.filter((f) => /^\d-/.test(f));
    // At least one and at most five screenshots; listing.md names each one.
    expect(screenshots.length).toBeGreaterThanOrEqual(1);
    expect(screenshots.length).toBeLessThanOrEqual(5);
    expect(images).toEqual([...screenshots, 'promo-small-440x280.png']);
    for (const file of images) {
      expect(listing).toContain(`store/screenshots/${file}`);
      const expected = file.startsWith('promo') ? [440, 280] : [1280, 800];
      expect(pngSize(store(`screenshots/${file}`)), file).toEqual(expected);
      expect(pngColorType(store(`screenshots/${file}`)), file).toBe(2);
    }
  });
});
