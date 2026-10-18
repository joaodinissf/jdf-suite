import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

describe('showStatus', () => {
  let statusEl;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    statusEl = document.createElement('div');
    statusEl.id = 'ai-status';
    document.body.appendChild(statusEl);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a success message fades after 1.8s', () => {
    global.showStatus('Saved', { target: 'ai-status' });
    expect(statusEl.classList.contains('visible')).toBe(true);
    vi.advanceTimersByTime(1800);
    expect(statusEl.classList.contains('visible')).toBe(false);
  });

  it('a quick second save is not hidden by the first save\'s timer', () => {
    global.showStatus('first', { target: 'ai-status' });
    vi.advanceTimersByTime(1000);
    global.showStatus('second', { target: 'ai-status' });
    vi.advanceTimersByTime(1000);
    expect(statusEl.classList.contains('visible')).toBe(true);
    expect(statusEl.textContent).toBe('second');
    vi.advanceTimersByTime(800);
    expect(statusEl.classList.contains('visible')).toBe(false);
  });

  it('an error cancels a pending fade from an earlier success, and stays', () => {
    global.showStatus('Saved', { target: 'ai-status' });
    vi.advanceTimersByTime(1000);
    global.showStatus('Error: boom', { error: true, target: 'ai-status' });
    expect(statusEl.classList.contains('error')).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(statusEl.classList.contains('visible')).toBe(true);
  });
});

describe('Settings: Open links as tabs', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/options.html'), 'utf8');

  beforeEach(() => {
    document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  });

  it('has no settings of its own, only how to use it, after the tab-organization sections', () => {
    expect(document.getElementById('clumping-enabled')).toBeNull();
    expect(document.getElementById('clumping-key')).toBeNull();
    expect(document.getElementById('clumping-modifier')).toBeNull();
    expect(document.getElementById('clumping-status')).toBeNull();
    const section = document.getElementById('openLinksSection');
    expect(section.querySelectorAll('select, input, button')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/link clumping|activation key/i);
    expect(document.querySelector('.subtitle').textContent).not.toMatch(/Open links as tabs/);
    const chips = [...document.querySelectorAll('section .group-chip')].map((c) => c.textContent);
    expect(chips.at(-1)).toBe('Open links as tabs');
  });

  it('the help line names the shortcut Chrome has bound, and says one drag opens the links', () => {
    global.showOpenLinksShortcut();
    expect(document.getElementById('openLinksHelp').textContent.replace(/\s+/g, ' ')).toBe(
      "Start it on a page with ⌥⇧L or the popup's Open links as tabs, then drag a box over the links. They open as tabs and the page goes back to normal; Esc cancels.");
    expect(document.querySelector('#openLinksShortcut kbd').textContent).toBe('⌥⇧L');
  });

  it('with no shortcut bound, the help line says where to set one', () => {
    chrome.commands.getAll.mockImplementationOnce((callback) => callback([{ name: '_execute_action', shortcut: '⌥⇧U' }, { name: 'open-links', shortcut: '' }]));
    global.showOpenLinksShortcut();
    expect(document.getElementById('openLinksShortcut').textContent).toBe('a shortcut you set at chrome://extensions/shortcuts');
  });
});
