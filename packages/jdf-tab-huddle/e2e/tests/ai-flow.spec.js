import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { resetBrowserState, createTabs, createWindow } from '../helpers/tabs.js';
import { openPopup } from '../helpers/popup.js';
import {
  installFakeOpenRouter, siteUrls, GOOD_KEY, BAD_KEY, USABLE_LUNA_IDS,
} from '../helpers/fake-openrouter.js';

// "Organize with AI" end to end: the popup's O, the organize page and the
// service worker, against a fake OpenRouter (nothing reaches the real one:
// context.route answers it, and the host is mapped to nowhere as well).

test.use({ extraArgs: ['--host-resolver-rules=MAP openrouter.ai ~NOTFOUND'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seed(sw, context, { key = GOOD_KEY, model = 'anthropic/claude-haiku-4.5' } = {}) {
  await resetBrowserState(sw, context);
  await createTabs(sw, siteUrls());
  await sw.evaluate(async ({ key, model }) => {
    // Only the site tabs are left to organize.
    const blank = await chrome.tabs.query({ url: 'about:blank' });
    if (blank.length) await chrome.tabs.remove(blank.map((t) => t.id));
    await chrome.storage.local.remove('openRouterModelsCache');
    await chrome.storage.local.set({
      aiConfig: { key: key ? btoa(key) : null, model, expiresAt: Date.now() + 86400000, expiryDuration: 86400000, setupComplete: true },
    });
  }, { key, model });
}

// The popup's O opens the organize page; returns it once its catalog loaded.
async function openOrganize(context, extensionId) {
  const popup = await openPopup(context, extensionId);
  const before = new Set(context.pages());
  await popup.keyboard.press('o');
  let page;
  await expect.poll(() => {
    page = context.pages().find((p) => !before.has(p) && p.url().includes('/ai-proposal.html'));
    return !!page;
  }, { timeout: 10000 }).toBe(true);
  await popup.close();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.models-status')).not.toHaveText(/Loading/, { timeout: 10000 });
  return page;
}

// Stops the worker the way Chrome does when it idles out.
async function stopWorker(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
  await sleep(500);
}

const groupNames = (page) => page.locator('#content .group-card .group-name');

// A second window with one tab the organize page's window must never see,
// then the first window focused again so the popup opens there.
async function openSecondWindow(sw) {
  const { windowId, tabIds } = await createWindow(sw, ['https://elsewhere.huddle.test/page-1']);
  await sw.evaluate(async (other) => {
    const [first] = (await chrome.windows.getAll()).filter((w) => w.id !== other);
    await chrome.windows.update(first.id, { focused: true });
  }, windowId);
  await expect.poll(() => sw.evaluate(async (id) => (await chrome.tabs.get(id)).url, tabIds[0]))
    .toBe('https://elsewhere.huddle.test/page-1');
  return { windowId, tabId: tabIds[0] };
}

test.describe('Organize with AI', () => {
  test('O, Organize, Apply: the proposed groups land in the window', async ({ context, sw, extensionId }) => {
    const fake = await installFakeOpenRouter(context);
    await seed(sw, context);
    const page = await openOrganize(context, extensionId);

    await expect(page.locator('#modelName')).toHaveText('Claude Haiku 4.5');
    await page.fill('#userInstructions', 'one group per site');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await expect(groupNames(page)).toHaveCount(3);
    await expect(page.locator('#applyButton')).toBeFocused();
    expect(fake.chats).toHaveLength(1);
    expect(fake.chats[0].prompt).toContain('one group per site');
    // Huddle's own pages are not tabs to organize.
    expect(fake.chats[0].prompt).not.toContain('ai-proposal.html');

    const closed = page.waitForEvent('close');
    await page.click('#applyButton');
    await closed;
    const titles = await sw.evaluate(async () => (await chrome.tabGroups.query({})).map((g) => g.title).sort());
    expect(titles).toEqual(['Docs', 'Mail', 'Shop']);
  });

  test('with two windows open, only the organize page\'s window is sent to OpenRouter', async ({ context, sw, extensionId }) => {
    const fake = await installFakeOpenRouter(context);
    await seed(sw, context);
    const other = await openSecondWindow(sw);
    const page = await openOrganize(context, extensionId);

    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    expect(fake.chats).toHaveLength(1);
    expect(fake.chats[0].prompt).toContain('docs.huddle.test');
    expect(fake.chats[0].prompt).not.toContain('elsewhere.huddle.test');
    expect(fake.chats[0].prompt).not.toContain(`[id:${other.tabId}]`);
    await expect(page.locator('#content')).not.toContainText('elsewhere');
  });

  test('Apply leaves a tab in another window where it is, even when the page sends its id', async ({ context, sw, extensionId }) => {
    await installFakeOpenRouter(context);
    await seed(sw, context);
    const other = await openSecondWindow(sw);
    const page = await openOrganize(context, extensionId);

    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    // Swap one proposed tab for the other window's tab. That tab never left
    // this window, so the page's own onDetached guard never sees it: only the
    // worker's check stands between Apply and moving it.
    const swapped = await page.evaluate((otherTabId) => {
      const group = proposal.groups.find((g) => g.tabIds.length > 1);
      const was = group.tabIds[0];
      group.tabIds[0] = otherTabId;
      return was;
    }, other.tabId);
    await page.click('#applyButton');
    await expect(page.locator('#applyError')).toContainText('1 proposed tab was closed, moved or pinned');

    const tab = await sw.evaluate(async (id) => {
      const t = await chrome.tabs.get(id);
      return { windowId: t.windowId, groupId: t.groupId };
    }, other.tabId);
    expect(tab).toEqual({ windowId: other.windowId, groupId: -1 });
    // The rest was grouped; only the tab taken out of the proposal was not.
    const ungrouped = await sw.evaluate(async (id) => (await chrome.tabs.get(id)).groupId, swapped);
    expect(ungrouped).toBe(-1);
    const titles = await sw.evaluate(async () => (await chrome.tabGroups.query({})).map((g) => g.title).sort());
    expect(titles).toEqual(['Docs', 'Mail', 'Shop']);
  });

  test('picking another model on a proposal makes Cmd+Enter run again with it, never apply the old one', async ({ context, sw, extensionId }) => {
    const fake = await installFakeOpenRouter(context);
    await seed(sw, context);
    const page = await openOrganize(context, extensionId);
    const cmdEnter = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';

    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    await page.click('#changeModel');
    await page.keyboard.type('gpt-6');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('#modelNote')).toHaveText('This proposal came from Claude Haiku 4.5. Run again to use GPT-6 Luna.');
    await expect(page.locator('#runAgainButton')).toBeFocused();
    await expect(page.locator('#runAgainButton')).toBeInViewport();
    await expect(page.locator('#proposalKeys')).toContainText('run again');

    await page.keyboard.press(cmdEnter);
    await expect(page.locator('#content .proposal-head')).toContainText('GPT-6 Luna');
    expect(fake.chats.map((c) => c.model)).toEqual(['anthropic/claude-haiku-4.5', 'openai/gpt-6-luna']);
    expect(await sw.evaluate(async () => (await chrome.tabGroups.query({})).length)).toBe(0);
    // The proposal now matches the model, so Cmd+Enter applies again.
    await expect(page.locator('#proposalKeys')).toContainText('apply');
  });

  test('a proposed tab closed before Apply is reported, and Apply says it was left out', async ({ context, sw, extensionId }) => {
    await installFakeOpenRouter(context);
    await seed(sw, context);
    const page = await openOrganize(context, extensionId);

    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    await sw.evaluate(async () => {
      const [shop] = await chrome.tabs.query({ url: '*://shop.huddle.test/*' });
      await chrome.tabs.remove(shop.id);
    });
    await expect(page.locator('#applyError')).toContainText('closed, moved or pinned');
    await page.click('#applyButton');
    await expect(page.locator('#applyError')).toContainText(/Grouped \d+ tabs? into \d+ groups?\. 1 proposed tab was closed/);
    await expect(page.locator('#closeAfterApply')).toBeFocused();
  });

  test('a tab pinned while the proposal is on screen stays pinned: Apply leaves it out and says so', async ({ context, sw, extensionId }) => {
    await installFakeOpenRouter(context);
    await seed(sw, context);
    const page = await openOrganize(context, extensionId);

    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    const mailId = await sw.evaluate(async () => {
      const [mail] = await chrome.tabs.query({ url: '*://mail.huddle.test/*' });
      await chrome.tabs.update(mail.id, { pinned: true });
      return mail.id;
    });
    await page.click('#applyButton');
    await expect(page.locator('#applyError')).toContainText('1 proposed tab was closed, moved or pinned, so it was left out.');
    const mail = await sw.evaluate(async (id) => {
      const t = await chrome.tabs.get(id);
      return { pinned: t.pinned, groupId: t.groupId };
    }, mailId);
    expect(mail).toEqual({ pinned: true, groupId: -1 });
  });

  test('in the proposal, Escape in a group name undoes the edit instead of closing, and a name stops at 40 characters', async ({ context, sw, extensionId }) => {
    await installFakeOpenRouter(context);
    await seed(sw, context);
    const page = await openOrganize(context, extensionId);

    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    const name = groupNames(page).first();
    const was = await name.inputValue();
    await name.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typo');
    await page.keyboard.press('Escape');
    await expect(name).toHaveValue(was);
    await expect(name).not.toBeFocused();
    expect(page.isClosed()).toBe(false);

    await name.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' and many more words than a group name can hold');
    // The field stops at 40 characters as they are typed.
    expect((await name.inputValue()).length).toBe(40);
  });

  test('in the proposal, Cmd/Ctrl+Enter in the Run again instructions runs again and applies nothing', async ({ context, sw, extensionId }) => {
    const fake = await installFakeOpenRouter(context);
    await seed(sw, context);
    const page = await openOrganize(context, extensionId);

    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    await page.click('#nextRun summary');
    await page.click('#userInstructions');
    await page.keyboard.type('by topic');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await expect.poll(() => fake.chats.length).toBe(2);
    expect(fake.chats[1].prompt).toContain('by topic');
    await expect(groupNames(page)).toHaveCount(3);
    expect(page.isClosed()).toBe(false);
    expect(await sw.evaluate(async () => (await chrome.tabGroups.query({})).length)).toBe(0);
  });

  test('a reload with a proposal on screen says the proposal is gone and offers Run again', async ({ context, sw, extensionId }) => {
    await installFakeOpenRouter(context);
    await seed(sw, context);
    const page = await openOrganize(context, extensionId);

    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    await page.reload();
    await expect(page.locator('#content .ended-msg')).toContainText('cleared the proposal that was on screen');
    await expect(page.locator('#content .ended-msg')).not.toContainText('no longer working on it');
    await expect(page.locator('#startOrganize')).toHaveText('Run again');
    await expect(page.locator('#startOrganize')).toBeFocused();
  });

  test('Organize after the worker idled out still runs', async ({ context, sw, extensionId }) => {
    await installFakeOpenRouter(context);
    await seed(sw, context);
    const page = await openOrganize(context, extensionId);
    await stopWorker(context, page);

    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    await expect(page.locator('#content')).not.toContainText('This run has ended');
  });

  test('Enter twice on Organize is one run the second Enter never stops; Tab, Enter on Stop does', async ({ context, sw, extensionId }) => {
    const fake = await installFakeOpenRouter(context, { slowMs: 1500 });
    await seed(sw, context, { model: 'huddle-test/slow' });
    const page = await openOrganize(context, extensionId);

    await page.focus('#startOrganize');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('#stopRun')).not.toBeFocused();
    // The focused progress line is not a control: no focus ring around it.
    await expect(page.locator('#runProgress')).toBeFocused();
    expect(await page.locator('#runProgress').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
    await expect(groupNames(page)).toHaveCount(3);
    expect(fake.chats).toHaveLength(1);

    await page.click('#runAgainButton');
    await expect(page.locator('#stopRun')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.locator('#stopRun')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#content .ended-msg')).toContainText('Stopped');
  });

  test('the worker stopping mid-run ends the run with Run again, not a stuck spinner', async ({ context, sw, extensionId }) => {
    await installFakeOpenRouter(context, { slowMs: 6000 });
    await seed(sw, context, { model: 'huddle-test/slow' });
    const page = await openOrganize(context, extensionId);

    await page.click('#startOrganize');
    await expect(page.locator('#stopRun')).toBeVisible();
    await stopWorker(context, page);
    await expect(page.locator('#content .ended-msg')).toContainText('This run has ended', { timeout: 5000 });
    await expect(page.locator('#startOrganize')).toHaveText('Run again');
  });

  test('a reload mid-run keeps the instructions, and the old run never writes into the new one', async ({ context, sw, extensionId }) => {
    const fake = await installFakeOpenRouter(context, { slowMs: 3000 });
    await seed(sw, context, { model: 'huddle-test/slow' });
    const page = await openOrganize(context, extensionId);

    await page.fill('#userInstructions', 'one group per site');
    await page.click('#startOrganize');
    await expect.poll(() => fake.chats.length).toBe(1);
    await page.reload();
    await expect(page.locator('#content .ended-msg')).toContainText('This run has ended');
    await expect(page.locator('#userInstructions')).toHaveValue('one group per site');
    // Focus lands on Run again once the page has its settings.
    await expect(page.locator('#startOrganize')).toBeFocused();

    // Run again with a fast model: its proposal, and only its output.
    await page.click('#changeModel');
    await page.selectOption('#runSelect', 'anthropic/claude-haiku-4.5');
    await page.keyboard.press('Enter');
    await expect(page.locator('#modelPanel')).toBeHidden();
    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    expect(fake.chats.at(-1)).toMatchObject({ model: 'anthropic/claude-haiku-4.5' });
    expect(fake.chats.at(-1).prompt).toContain('one group per site');
    await sleep(3500); // past the old run's answer
    await expect(page.locator('.proposal-head')).toContainText('Claude Haiku 4.5');
    const raw = await page.locator('#rawResponsePre').textContent();
    expect(raw.match(/"groups"/g)).toHaveLength(1);
  });

  test('the model filter applies to every model, and batch variants never show', async ({ context, sw, extensionId }) => {
    await installFakeOpenRouter(context);
    await seed(sw, context);
    const page = await openOrganize(context, extensionId);

    await page.click('#changeModel');
    await expect(page.locator('#runFilter')).toBeFocused();
    await page.keyboard.type('luna');
    const ids = await page.locator('#runSelect option').evaluateAll((opts) => opts.map((o) => o.value));
    expect(ids.sort()).toEqual([...USABLE_LUNA_IDS].sort());
    await expect(page.locator('#runSelect')).not.toContainText('(batch)');
    // The current model (Haiku) is not in the list, and the bar still names it.
    await expect(page.locator('#modelName')).toHaveText('Claude Haiku 4.5');

    await page.fill('#runFilter', 'zzzz');
    await expect(page.locator('.models-empty')).toHaveText('No models match "zzzz".');

    // Escape closes the list and keeps the model it opened with.
    await page.keyboard.press('Escape');
    await expect(page.locator('#modelPanel')).toBeHidden();
    await expect(page.locator('#changeModel')).toBeFocused();
  });

  test('a provider 401 points at the model, and another model works', async ({ context, sw, extensionId }) => {
    const fake = await installFakeOpenRouter(context);
    await seed(sw, context, { model: 'deepseek/deepseek-v4-flash' });
    const page = await openOrganize(context, extensionId);

    await page.click('#startOrganize');
    const error = page.locator('#content .error-msg');
    await expect(error).toContainText('DeepInfra, the provider serving DeepSeek V4 Flash, refused the request (401: User not found)');
    // A retry of the same model is refused again, so Change model is the
    // focused primary button and there is no Retry.
    await expect(page.locator('#startOrganize')).toHaveText('Change model');
    await expect(page.locator('#startOrganize')).toBeFocused();
    await expect(page.locator('#content button', { hasText: 'Retry' })).toHaveCount(0);
    await expect(page.locator('#content button', { hasText: 'Open Settings' })).toHaveCount(0);
    await expect(page.locator('#makeDefault')).toBeHidden();

    await page.click('#content button:has-text("Change model")');
    await page.selectOption('#runSelect', 'openai/gpt-6-luna');
    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    expect(fake.chats.map((c) => c.model)).toEqual(['deepseek/deepseek-v4-flash', 'openai/gpt-6-luna']);
  });

  test('Enter twice on Organize when the run fails fast: the second Enter presses nothing', async ({ context, sw, extensionId }) => {
    const fake = await installFakeOpenRouter(context);
    await seed(sw, context, { model: 'deepseek/deepseek-v4-flash' });
    const page = await openOrganize(context, extensionId);

    await page.focus('#startOrganize');
    const t0 = Date.now();
    await page.keyboard.press('Enter');
    // The provider 401 is back before the second Enter of the double press.
    await expect(page.locator('#startOrganize')).toHaveText('Change model');
    test.skip(Date.now() - t0 > 500, 'the error came back too late to test a double press');
    await page.keyboard.press('Enter');
    await sleep(500);
    await expect(page.locator('#modelPanel')).toBeHidden();
    await expect(page.locator('#startOrganize')).toBeFocused();
    expect(fake.chats).toHaveLength(1);
    // A deliberate Enter a moment later does what the button says.
    await sleep(800);
    await page.keyboard.press('Enter');
    await expect(page.locator('#modelPanel')).toBeVisible();
  });

  test('a rejected key brings the key form; Enter saves a new key and organizes', async ({ context, sw, extensionId }) => {
    await installFakeOpenRouter(context);
    await seed(sw, context, { key: BAD_KEY });
    const page = await openOrganize(context, extensionId);

    await page.click('#startOrganize');
    // Said once, as the key form's intro.
    await expect(page.locator('#keyIntro')).toContainText('OpenRouter rejected your saved key');
    await expect(page.locator('#content .error-msg')).toHaveCount(0);
    await expect(page.locator('#keySetup')).toBeVisible();
    await expect(page.locator('#inlineKeyInput')).toBeFocused();
    await page.keyboard.type(GOOD_KEY);
    await page.keyboard.press('Enter');
    await expect(groupNames(page)).toHaveCount(3);
    const stored = await page.evaluate(async () => atob((await chrome.storage.local.get('aiConfig')).aiConfig.key));
    expect(stored).toBe(GOOD_KEY);
  });

  test('GPT-6 Luna (no temperature) organizes: the request carries only what it takes', async ({ context, sw, extensionId }) => {
    const fake = await installFakeOpenRouter(context);
    await seed(sw, context, { model: 'openai/gpt-6-luna' });
    const page = await openOrganize(context, extensionId);

    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    await expect(page.locator('.proposal-head')).toContainText('GPT-6 Luna');
    expect(fake.chats).toHaveLength(1);
    expect(fake.chats[0]).toMatchObject({ model: 'openai/gpt-6-luna', responseFormat: 'json_schema', requireParameters: true });
    expect(fake.chats[0].params).not.toContain('temperature');
  });

  test('a strict request OpenRouter routes nowhere is retried once without it, and organizes', async ({ context, sw, extensionId }) => {
    const fake = await installFakeOpenRouter(context);
    await seed(sw, context, { model: 'huddle-test/no-strict' });
    const page = await openOrganize(context, extensionId);

    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    expect(fake.chats.map((c) => [c.responseFormat, c.requireParameters])).toEqual([
      ['json_schema', true],
      ['json_object', false],
    ]);
  });

  test('a default OpenRouter no longer lists: the page says so and organizes with the first recommended model', async ({ context, sw, extensionId }) => {
    const fake = await installFakeOpenRouter(context);
    await seed(sw, context, { model: 'qwen/qwen3.5-flash-20260224' });
    const page = await openOrganize(context, extensionId);

    await expect(page.locator('#modelName')).toHaveText('Claude Haiku 4.5');
    await expect(page.locator('#modelNote')).toHaveText('Your default Qwen 3.5 Flash is no longer on OpenRouter; using Claude Haiku 4.5.');
    await page.click('#startOrganize');
    await expect(groupNames(page)).toHaveCount(3);
    expect(fake.chats.map((c) => c.model)).toEqual(['anthropic/claude-haiku-4.5']);
  });

  test('O again brings back the organize page already open', async ({ context, sw, extensionId }) => {
    await installFakeOpenRouter(context);
    await seed(sw, context);
    const page = await openOrganize(context, extensionId);
    const popup = await openPopup(context, extensionId);
    await popup.keyboard.press('o');
    await sleep(800);
    const organizePages = context.pages().filter((p) => p.url().includes('/ai-proposal.html'));
    expect(organizePages).toEqual([page]);
  });
});
