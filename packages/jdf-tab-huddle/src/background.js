// Background service worker for persistent logging
console.log('Tab Organizer service worker starting...');

// ============================================================
// AI Tab Grouping — Constants and Helpers
// ============================================================

const AI_MODELS = [
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', cost: '$0.80/M in' },
  { id: 'google/gemini-3.1-flash-lite-preview-20260303', name: 'Gemini 3.1 Flash Lite', cost: '$0.25/M in' },
  { id: 'qwen/qwen3.5-flash-20260224', name: 'Qwen 3.5 Flash', cost: '$0.065/M in' },
];
const DEFAULT_MODEL = AI_MODELS[0].id;

const EXPIRY_PRESETS = [
  { label: '1 hour', value: 3600000 },
  { label: '24 hours', value: 86400000 },
  { label: '7 days', value: 604800000 },
  { label: '30 days', value: 2592000000 },
  { label: 'Never expires', value: null },
];
const DEFAULT_EXPIRY = 86400000; // 24 hours

const VALID_TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

function encodeKey(plaintext) {
  return btoa(plaintext);
}

function decodeKey(encoded) {
  return atob(encoded);
}

function isKeyExpired(aiConfig) {
  if (!aiConfig || !aiConfig.key) return true;
  if (aiConfig.expiresAt === null) return false;
  return Date.now() > aiConfig.expiresAt;
}

async function saveAiConfig(config) {
  const expiresAt = config.expiryDuration !== null
    ? Date.now() + config.expiryDuration
    : null;

  const aiConfig = {
    key: encodeKey(config.key),
    model: config.model || DEFAULT_MODEL,
    expiresAt,
    expiryDuration: config.expiryDuration,
    setupComplete: true,
  };

  await chrome.storage.local.set({ aiConfig });
  return aiConfig;
}

async function loadAiConfig() {
  const result = await chrome.storage.local.get(['aiConfig']);
  return result.aiConfig || null;
}

// Resolves when the proposal tab signals it is ready to receive messages
let aiProposalReadyResolve = null;

// ============================================================
// AI Tab Grouping — Prompt Building and Response Parsing
// ============================================================

function stripQueryParams(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch (_e) {
    return url;
  }
}

function buildAiPrompt(tabs, instructions) {
  // Pre-sort tabs by domain for easier clustering
  const sortedTabs = [...tabs].sort((a, b) => {
    const domainA = lexHost(a.url);
    const domainB = lexHost(b.url);
    return domainA.localeCompare(domainB);
  });

  const tabLines = sortedTabs.map(tab => {
    const domain = lexHost(tab.url);
    const title = tab.title || '(no title)';
    const cleanUrl = stripQueryParams(tab.pendingUrl || tab.url);
    return `[id:${tab.id}] ${domain} — "${title}" — ${cleanUrl}`;
  }).join('\n');

  const systemMessage = {
    role: 'system',
    content: 'You organize browser tabs into logical groups. Return ONLY valid JSON, no other text.'
  };

  const userMessage = {
    role: 'user',
    content: `Group these browser tabs into logical categories based on their content and purpose.
Each group should have a short descriptive name (2-4 words max).

Return JSON in this exact format:
{"groups": [{"name": "Group Name", "color": "blue", "tabIds": [1, 2, 3]}]}

Available colors: ${VALID_TAB_GROUP_COLORS.join(', ')}

Every tab must be assigned to exactly one group. Do not omit any tabs.
${instructions ? '\nAdditional instructions from user: ' + instructions + '\n' : ''}
Tabs (sorted by domain):
${tabLines}`
  };

  return [systemMessage, userMessage];
}

async function callOpenRouter(apiKey, model, messages, onChunk) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': chrome.runtime.getURL(''),
      'X-Title': 'Tab Organizer',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      stream: true,
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 401) throw new Error('Invalid API key. Please check your OpenRouter key.');
    if (status === 429) throw new Error('Rate limited. Please try again in a moment.');
    if (status === 402) throw new Error('Insufficient credits. Please add credits on OpenRouter.');
    throw new Error(`OpenRouter API error (${status})`);
  }

  const contentType = response.headers.get('content-type') || '';

  // If the response is not SSE, fall back to reading it as plain JSON
  if (!contentType.includes('text/event-stream')) {
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (content && onChunk) onChunk(content);
    return content;
  }

  // SSE streaming
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5);
      if (payload === '[DONE]') continue;

      try {
        const parsed = JSON.parse(payload);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          fullText += content;
          if (onChunk) onChunk(content);
        }
      } catch (_e) {
        // skip malformed SSE lines
      }
    }
  }

  return fullText;
}

function parseAiResponse(responseText, originalTabs) {
  // Extract JSON — handle markdown code fences
  let jsonStr = responseText.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (_e) {
    return { success: false, error: 'AI returned invalid JSON. Please try again.' };
  }

  if (!parsed.groups || !Array.isArray(parsed.groups)) {
    return { success: false, error: 'AI response missing "groups" array.' };
  }

  const validTabIds = new Set(originalTabs.map(t => t.id));
  const assignedTabIds = new Set();
  const groups = [];

  for (const group of parsed.groups) {
    if (!group.name || !Array.isArray(group.tabIds)) continue;

    // Validate and filter tab IDs
    const validIds = group.tabIds
      .filter(id => validTabIds.has(id) && !assignedTabIds.has(id));
    validIds.forEach(id => assignedTabIds.add(id));

    if (validIds.length === 0) continue;

    // Normalize color
    const color = VALID_TAB_GROUP_COLORS.includes(group.color) ? group.color : 'grey';

    groups.push({
      name: String(group.name).slice(0, 40),
      color,
      tabIds: validIds,
    });
  }

  // Collect unassigned tabs into "Ungrouped"
  const unassignedIds = originalTabs
    .map(t => t.id)
    .filter(id => !assignedTabIds.has(id));

  return {
    success: true,
    groups,
    ungroupedTabIds: unassignedIds,
  };
}

// ============================================================
// AI Tab Grouping — Message Handlers
// ============================================================

async function handleAiGroupTabs(message, sendResponse) {
  try {
    const config = await loadAiConfig();

    // No key or expired → open setup page
    if (!config || !config.key || isKeyExpired(config)) {
      const mode = config && config.key ? 'expired' : 'setup';
      const url = chrome.runtime.getURL(`ai-setup.html?mode=${mode}`);
      await chrome.tabs.create({ url, active: true });
      sendResponse({ success: true, action: 'setup' });
      return;
    }

    // Open proposal tab immediately
    const respectParam = (message.respectGroups !== undefined ? message.respectGroups : true) ? 'true' : 'false';
    const proposalUrl = chrome.runtime.getURL(`ai-proposal.html?respectGroups=${respectParam}`);
    const proposalTab = await chrome.tabs.create({ url: proposalUrl, active: true });
    sendResponse({ success: true, action: 'proposal' });

    // Wait for the proposal page to signal it's ready (with optional instructions)
    const userInstructions = await new Promise(resolve => { aiProposalReadyResolve = resolve; });

    const send = (msg) => {
      chrome.tabs.sendMessage(proposalTab.id, msg).catch(() => {});
    };

    // Gather tabs
    send({ type: 'ai-status', text: 'Gathering tabs...' });
    const respectGroups = message.respectGroups !== undefined ? message.respectGroups : true;
    const currentWindow = await chrome.windows.getCurrent();
    const tabs = await getTabsWithGroupInfo(currentWindow.id);

    // In Tab Groups Mode: only organize ungrouped tabs. In Individual Mode: all tabs.
    const unpinnedTabs = tabs.filter(t => {
      if (t.pinned || t.id === proposalTab.id) return false;
      if (respectGroups && t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return false;
      return true;
    });

    if (unpinnedTabs.length === 0) {
      const errorMsg = respectGroups
        ? 'No ungrouped tabs to organize. Switch to Individual Mode to reorganize all tabs.'
        : 'No unpinned tabs to organize.';
      send({ type: 'ai-error', error: errorMsg });
      return;
    }

    // Build prompt and send debug info
    const messages = buildAiPrompt(unpinnedTabs, userInstructions);
    const modelName = AI_MODELS.find(m => m.id === config.model)?.name || config.model;
    send({ type: 'ai-debug', model: config.model, modelName, messages, respectGroups });
    send({ type: 'ai-status', text: 'Calling ' + modelName + '...' });

    // Stream API call
    const apiKey = decodeKey(config.key);
    const responseText = await callOpenRouter(apiKey, config.model, messages, (chunk) => {
      send({ type: 'ai-chunk', text: chunk });
    });

    // Parse response
    send({ type: 'ai-status', text: 'Parsing response...' });
    const result = parseAiResponse(responseText, unpinnedTabs);

    if (!result.success) {
      send({ type: 'ai-error', error: result.error });
      return;
    }

    // Build tab metadata and send proposal
    const tabMeta = unpinnedTabs.map(t => ({
      id: t.id,
      title: t.title || '(no title)',
      url: t.pendingUrl || t.url,
      favIconUrl: t.favIconUrl || '',
    }));

    send({
      type: 'ai-proposal',
      groups: result.groups,
      ungroupedTabIds: result.ungroupedTabIds,
      tabs: tabMeta,
      windowId: currentWindow.id,
    });
  } catch (error) {
    console.error('[Tab Organizer] Error in AI group tabs:', error);
    // Try to send error to proposal tab if it's open
    try {
      const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('ai-proposal.html') });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'ai-error', error: error.message });
      }
    } catch (_e) {
      // proposal tab may not exist
    }
  }
}

async function handleApplyAiProposal(message, sender, sendResponse) {
  try {
    // Close the proposal tab first to reduce the number of tabs Chrome is managing
    if (sender.tab) {
      await chrome.tabs.remove(sender.tab.id);
    }

    const { groups, windowId } = message;

    // Apply groups with a small delay between each to avoid overwhelming Chrome
    for (const group of groups) {
      if (!group.tabIds || group.tabIds.length === 0) continue;

      const groupId = await chrome.tabs.group({
        tabIds: group.tabIds,
        createProperties: { windowId },
      });

      await chrome.tabGroups.update(groupId, {
        title: group.name || '',
        color: VALID_TAB_GROUP_COLORS.includes(group.color) ? group.color : 'grey',
      });

      // Let Chrome settle between group operations
      await new Promise(r => setTimeout(r, 50));
    }

    // Sort after all groups are created
    await sortWindowTabs(windowId, true);

    sendResponse({ success: true });
  } catch (error) {
    console.error('[Tab Organizer] Error applying AI proposal:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Tab Groups Helper Functions
async function getTabGroupsInfo(windowId = null) {
  try {
    const query = windowId ? { windowId } : {};
    const groups = await chrome.tabGroups.query(query);
    const groupsMap = new Map();
    
    for (const group of groups) {
      groupsMap.set(group.id, group);
    }
    
    return groupsMap;
  } catch (error) {
    console.error('[Tab Organizer] Error getting tab groups info:', error);
    return new Map();
  }
}

async function getTabsWithGroupInfo(windowId = null) {
  try {
    const query = windowId ? { windowId } : {};
    const tabs = await chrome.tabs.query(query);
    const groupsMap = await getTabGroupsInfo(windowId);
    
    return tabs.map(tab => ({
      ...tab,
      groupInfo: tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? groupsMap.get(tab.groupId) : null
    }));
  } catch (error) {
    console.error('[Tab Organizer] Error getting tabs with group info:', error);
    return [];
  }
}

// Helper function to recreate tab groups when moving tabs between windows
async function recreateTabGroup(groupInfo, tabIds, targetWindowId) {
  try {
    if (!groupInfo || tabIds.length === 0) {
      return null;
    }
    
    // Create new group with the tabs
    const newGroupId = await chrome.tabs.group({
      tabIds: tabIds,
      createProperties: {
        windowId: targetWindowId
      }
    });
    
    // Update the group with the original properties
    await chrome.tabGroups.update(newGroupId, {
      title: groupInfo.title || '',
      color: groupInfo.color || 'grey',
      collapsed: groupInfo.collapsed || false
    });
    
    return newGroupId;
  } catch (error) {
    console.error('[Tab Organizer] Error recreating tab group:', error);
    return null;
  }
}

// Helper function to move tabs while preserving group structure
async function moveTabsWithGroups(tabsToMove, targetWindowId) {
  try {
    // Group tabs by their original group
    const tabsByGroup = new Map();
    
    for (const tab of tabsToMove) {
      const groupKey = tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? tab.groupId : 'ungrouped';
      if (!tabsByGroup.has(groupKey)) {
        tabsByGroup.set(groupKey, []);
      }
      tabsByGroup.get(groupKey).push(tab);
    }
    
    // Move ungrouped tabs first
    if (tabsByGroup.has('ungrouped')) {
      const ungroupedTabs = tabsByGroup.get('ungrouped');
      await chrome.tabs.move(
        ungroupedTabs.map(tab => tab.id),
        { windowId: targetWindowId, index: -1 }
      );
      tabsByGroup.delete('ungrouped');
    }
    
    // Move and recreate grouped tabs
    for (const [_originalGroupId, groupTabs] of tabsByGroup.entries()) {
      const tabIds = groupTabs.map(tab => tab.id);
      
      // Move tabs to target window first (they lose their group membership)
      await chrome.tabs.move(tabIds, { windowId: targetWindowId, index: -1 });
      
      // Recreate the group if we have group info
      if (groupTabs[0].groupInfo) {
        await recreateTabGroup(groupTabs[0].groupInfo, tabIds, targetWindowId);
      }
    }
    
  } catch (error) {
    console.error('[Tab Organizer] Error moving tabs with groups:', error);
  }
}

async function handleClumpOpenUrls(message, sender, sendResponse) {
  try {
    const urls = Array.isArray(message.urls) ? message.urls : [];
    if (urls.length === 0) {
      sendResponse({ success: true, opened: 0 });
      return;
    }
    const senderTab = sender && sender.tab;
    const baseIndex = senderTab && typeof senderTab.index === 'number' ? senderTab.index + 1 : 0;
    const windowId = senderTab ? senderTab.windowId : undefined;
    const openerTabId = senderTab ? senderTab.id : undefined;
    for (let i = 0; i < urls.length; i++) {
      const createProps = {
        url: urls[i],
        active: false,
        index: baseIndex + i,
      };
      if (windowId !== undefined) createProps.windowId = windowId;
      if (openerTabId !== undefined) createProps.openerTabId = openerTabId;
      await chrome.tabs.create(createProps);
    }
    sendResponse({ success: true, opened: urls.length });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'log') {
    console.log('[Tab Organizer]', message.data.message, ...message.data.args);
    sendResponse({ success: true });
  } else if (message.action === 'clumpOpenUrls') {
    handleClumpOpenUrls(message, _sender, sendResponse);
    return true; // async response
  } else if (message.action === 'sortAllWindows') {
    handleSortAllWindows(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'sortCurrentWindow') {
    handleSortCurrentWindow(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'removeDuplicatesWindow') {
    handleRemoveDuplicatesWindow(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'removeDuplicatesAllWindows') {
    handleRemoveDuplicatesAllWindows(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'removeDuplicatesGlobally') {
    handleRemoveDuplicatesGlobally(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'extractDomain') {
    handleExtractDomain(message, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'extractAllDomains') {
    handleExtractAllDomains(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'extractAllDomainsConfirmation') {
    // This will be handled by the confirmation dialog listener
    sendResponse({ success: true });
  } else if (message.action === 'moveAllToSingleWindow') {
    handleMoveAllToSingleWindow(message, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'copyAllTabs') {
    handleCopyAllTabs(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'flattenWindow') {
    handleFlattenWindow(sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'aiGroupTabs') {
    handleAiGroupTabs(message, sendResponse);
    return true;
  } else if (message.action === 'aiProposalReady') {
    if (aiProposalReadyResolve) {
      aiProposalReadyResolve(message.instructions || '');
      aiProposalReadyResolve = null;
    }
    sendResponse({ success: true });
  } else if (message.action === 'applyAiProposal') {
    handleApplyAiProposal(message, _sender, sendResponse);
    return true;
  } else if (message.action === 'cancelAiProposal') {
    if (_sender.tab) {
      chrome.tabs.remove(_sender.tab.id);
    }
    sendResponse({ success: true });
  } else if (message.action === 'saveAiConfig') {
    saveAiConfig(message.config).then(saved => {
      sendResponse({ success: true, config: saved });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  } else if (message.action === 'loadAiConfig') {
    loadAiConfig().then(config => {
      sendResponse({ config, models: AI_MODELS, expiryPresets: EXPIRY_PRESETS });
    });
    return true;
  } else if (message.action === 'openAiSettings') {
    const url = chrome.runtime.getURL('ai-setup.html?mode=edit');
    chrome.tabs.create({ url, active: true });
    sendResponse({ success: true });
  } else if (message.action === 'deleteAiConfig') {
    chrome.storage.local.remove('aiConfig').then(() => {
      sendResponse({ success: true });
    });
    return true;
  } else if (message.action === 'getSnoozePresets') {
    handleGetSnoozePresets(sendResponse);
    return true;
  } else if (message.action === 'snoozeTab') {
    handleSnoozeTab(message, sendResponse);
    return true;
  } else if (message.action === 'snoozeSelected') {
    handleSnoozeSelected(message, sendResponse);
    return true;
  } else if (message.action === 'snoozeWindow') {
    handleSnoozeWindow(message, sendResponse);
    return true;
  } else if (message.action === 'snoozeGroup') {
    handleSnoozeGroup(message, sendResponse);
    return true;
  } else if (message.action === 'listSnoozed') {
    handleListSnoozed(sendResponse);
    return true;
  } else if (message.action === 'wakeSnoozed') {
    handleWakeNow(message, sendResponse);
    return true;
  } else if (message.action === 'cancelSnoozed') {
    handleCancelSnooze(message, sendResponse);
    return true;
  }
});

async function handleSortAllWindows(respectGroups = true, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Sorting tabs in', windows.length, 'windows', respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Sort tabs within each window
    for (const window of windows) {
      await sortWindowTabs(window.id, respectGroups);
    }

    console.log('[Tab Organizer] Completed sortAllWindows');
    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in sortAllWindows:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSortCurrentWindow(respectGroups = true, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    console.log('[Tab Organizer] Sorting tabs in current window', respectGroups ? '(preserving groups)' : '(individual tabs)');

    await sortWindowTabs(tabs[0].windowId, respectGroups);

    console.log('[Tab Organizer] Completed sortCurrentWindow');
    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in sortCurrentWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Extract domain from URL with better handling for sleeping tabs
function lexHost(url) {
  try {
    var u = new URL(url);

    if (u.protocol === 'chrome-extension:' || u.protocol === 'moz-extension:') {
      return u.host;
    }

    if (u.protocol === 'file:') {
      return 'file';
    }

    if (u.protocol === 'data:') {
      return 'data';
    }

    if (u.protocol === 'about:' || u.protocol === 'chrome:') {
      return u.host || u.pathname.split('/')[0];
    }

    return u.hostname;
  } catch (_e) {
    return url || '';
  }
}

async function handleExtractDomain(message, sendResponse) {
  try {
    const targetDomain = lexHost(message.url);
    const respectGroups = message.respectGroups !== undefined ? message.respectGroups : true;
    console.log('[Tab Organizer] Extracting domain:', targetDomain, respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Create a window with the active tab in it
    const newWindow = await chrome.windows.create({
      tabId: message.tabId,
      focused: true
    });

    // Query tabs based on mode
    const allTabs = respectGroups ? await getTabsWithGroupInfo() : await chrome.tabs.query({});

    const tabsToMove = [];
    for (const tab of allTabs) {
      const tabDomain = lexHost(tab.url);
      // Skip pinned tabs and the active tab that's already in the new window
      if (tabDomain === targetDomain && tab.id !== message.tabId && !tab.pinned) {
        tabsToMove.push(tab);
      }
    }

    // Move matching tabs to the new window
    if (tabsToMove.length > 0) {
      if (respectGroups) {
        await moveTabsWithGroups(tabsToMove, newWindow.id);
      } else {
        // Simple move for individual mode
        const tabIds = tabsToMove.map(tab => tab.id);
        await chrome.tabs.move(tabIds, { windowId: newWindow.id, index: -1 });
      }
      console.log('[Tab Organizer] Moved', tabsToMove.length, 'tabs to new window');
    }

    // Wait a moment for tabs to settle, then sort
    setTimeout(async () => {
      await sortWindowTabs(newWindow.id, respectGroups);

      // Activate the original active tab
      await chrome.tabs.update(message.tabId, { active: true });

      console.log('[Tab Organizer] Completed extractDomain');
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in extractDomain:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates within current window only
async function handleRemoveDuplicatesWindow(respectGroups = true, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    console.log('[Tab Organizer] Removing duplicates in current window', respectGroups ? '(respecting groups)' : '(individual tabs)');

    const { tabsToRemove } = findDuplicateTabs([tabs], respectGroups);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Tab Organizer] Removed', tabsToRemove.length, 'duplicate tabs from current window');
    }

    // Sort remaining tabs in the current window
    setTimeout(async () => {
      await sortWindowTabs(tabs[0].windowId, respectGroups);
      console.log('[Tab Organizer] Completed removeDuplicatesWindow');
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in removeDuplicatesWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates within each window separately
async function handleRemoveDuplicatesAllWindows(respectGroups = true, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Removing duplicates in', windows.length, 'windows separately', respectGroups ? '(respecting groups)' : '(individual tabs)');

    const windowTabArrays = windows.map(window => window.tabs);
    const { tabsToRemove } = findDuplicateTabs(windowTabArrays, respectGroups);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Tab Organizer] Removed', tabsToRemove.length, 'duplicate tabs across all windows');
    }

    // Sort all windows
    setTimeout(async () => {
      for (const window of windows) {
        await sortWindowTabs(window.id, respectGroups);
      }
      console.log('[Tab Organizer] Completed removeDuplicatesAllWindows');
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in removeDuplicatesAllWindows:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates across all windows globally
async function handleRemoveDuplicatesGlobally(respectGroups = true, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Removing duplicates globally across all windows', respectGroups ? '(respecting groups)' : '(individual tabs)');

    // Flatten all tabs from all windows for global deduplication
    const allTabs = windows.flatMap(window => window.tabs);
    const { tabsToRemove } = findDuplicateTabs([allTabs], respectGroups);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Tab Organizer] Removed', tabsToRemove.length, 'duplicate tabs globally');
    }

    // Sort all windows
    setTimeout(async () => {
      for (const window of windows) {
        await sortWindowTabs(window.id, respectGroups);
      }
      console.log('[Tab Organizer] Completed removeDuplicatesGlobally');
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in removeDuplicatesGlobally:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Helper function to find duplicate tabs while considering tab groups
function findDuplicateTabs(tabArrays, respectGroups = true) {
  const urlSeen = new Map();
  const tabsToRemove = [];

  // Process each array of tabs (either per window or globally)
  for (const tabs of tabArrays) {
    const localUrlSeen = new Map();

    // Group tabs by their group membership if respecting groups
    const tabsByGroup = new Map();
    if (respectGroups) {
      for (const tab of tabs) {
        const groupKey = tab.groupId || 'ungrouped';
        if (!tabsByGroup.has(groupKey)) {
          tabsByGroup.set(groupKey, []);
        }
        tabsByGroup.get(groupKey).push(tab);
      }
    } else {
      // Treat all tabs as one group if not respecting groups
      tabsByGroup.set('all', tabs);
    }

    // Process each group separately
    for (const [_groupKey, groupTabs] of tabsByGroup.entries()) {
      const groupUrlSeen = new Map();
      
      for (const tab of groupTabs) {
        // Never remove pinned tabs
        if (tab.pinned) {
          continue;
        }

        const url = tab.pendingUrl || tab.url;

        // For per-window deduplication, track within each window/group
        // For global deduplication, track across all windows but respect groups if enabled
        const seenMap = respectGroups 
          ? (tabArrays.length === 1 ? urlSeen : groupUrlSeen)
          : (tabArrays.length === 1 ? urlSeen : localUrlSeen);

        if (seenMap.has(url)) {
          // This is a duplicate - mark for removal
          tabsToRemove.push(tab.id);
        } else {
          // First occurrence - keep it
          seenMap.set(url, tab.id);
          if (tabArrays.length === 1) {
            // For global deduplication, also track in the global map
            urlSeen.set(url, tab.id);
          }
        }
      }
    }
  }

  return { tabsToRemove };
}

// Analyze all domains and their tab counts
async function analyzeDomainDistribution() {
  try {
    const allTabsWithGroups = await getTabsWithGroupInfo();
    const domainTabCounts = new Map();
    const domainTabs = new Map();

    // Count tabs per domain (exclude pinned tabs from extraction consideration)
    for (const tab of allTabsWithGroups) {
      if (tab.pinned) {continue;}

      const domain = lexHost(tab.url);
      if (!domainTabCounts.has(domain)) {
        domainTabCounts.set(domain, 0);
        domainTabs.set(domain, []);
      }
      domainTabCounts.set(domain, domainTabCounts.get(domain) + 1);
      domainTabs.get(domain).push(tab);
    }

    // Separate domains by tab count
    const extractableDomains = [];
    const singleTabDomains = [];

    for (const [domain, count] of domainTabCounts.entries()) {
      if (count >= 2) {
        extractableDomains.push(domain);
      } else {
        singleTabDomains.push(domain);
      }
    }

    return {
      extractableDomains,
      singleTabDomains,
      domainTabCounts,
      domainTabs
    };
  } catch (error) {
    console.error('[Tab Organizer] Error analyzing domain distribution:', error);
    return {
      extractableDomains: [],
      singleTabDomains: [],
      domainTabCounts: new Map(),
      domainTabs: new Map()
    };
  }
}

// Create confirmation dialog URL with parameters
function createConfirmationDialogUrl(domainAnalysis) {
  const extractableCount = domainAnalysis.extractableDomains.length;
  const singleTabCount = domainAnalysis.singleTabDomains.length;

  const params = new URLSearchParams({
    extractable: extractableCount.toString(),
    single: singleTabCount.toString()
  });

  return chrome.runtime.getURL(`confirmation-dialog.html?${params.toString()}`);
}

// Handle Extract All Domains functionality
async function handleExtractAllDomains(respectGroups = true, sendResponse) {
  try {
    console.log('[Tab Organizer] Starting Extract All Domains', respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Analyze all domains and their tab counts
    const domainAnalysis = await analyzeDomainDistribution();

    // Check if confirmation is needed (more than 5 total windows would be created)
    const totalWindowsToCreate = domainAnalysis.extractableDomains.length + (domainAnalysis.singleTabDomains.length > 0 ? 1 : 0);
    const needsConfirmation = totalWindowsToCreate > 5;

    if (needsConfirmation) {
      console.log('[Tab Organizer] Many windows would be created, requesting confirmation');

      // Create a confirmation dialog using the separate HTML file
      const confirmationUrl = createConfirmationDialogUrl(domainAnalysis);
      const confirmTab = await chrome.tabs.create({
        url: confirmationUrl,
        active: true
      });

      // Set up a one-time listener for the confirmation response
      const confirmationPromise = new Promise((resolve) => {
        const messageListener = (confirmMessage, sender, confirmSendResponse) => {
          if (confirmMessage.action === 'extractAllDomainsConfirmation' && sender.tab.id === confirmTab.id) {
            chrome.runtime.onMessage.removeListener(messageListener);
            chrome.tabs.remove(confirmTab.id);
            confirmSendResponse({ success: true });
            resolve(confirmMessage.confirmed);
          }
        };
        chrome.runtime.onMessage.addListener(messageListener);
      });

      const confirmed = await confirmationPromise;
      if (!confirmed) {
        console.log('[Tab Organizer] User cancelled Extract All Domains');
        sendResponse({ success: true, cancelled: true });
        return;
      }
    }

    // Proceed with extraction
    await performExtractAllDomains(domainAnalysis, respectGroups);

    // Sort all windows after operations
    setTimeout(async () => {
      const windows = await chrome.windows.getAll({ populate: true });
      for (const window of windows) {
        await sortWindowTabs(window.id, respectGroups);
      }
      console.log('[Tab Organizer] Completed Extract All Domains');
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in Extract All Domains:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Perform the actual extraction logic
async function performExtractAllDomains(domainAnalysis, respectGroups = true) {
  try {
    console.log('[Tab Organizer] Performing extraction for', domainAnalysis.extractableDomains.length, 'domains', respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Phase 1: Create one window per domain with ≥2 tabs
    for (const domain of domainAnalysis.extractableDomains) {
      const domainTabs = domainAnalysis.domainTabs.get(domain);

      if (domainTabs.length < 2) {continue;}

      // Use the first tab as the anchor for the new window
      const anchorTab = domainTabs[0];

      // Create new window with the anchor tab
      const newWindow = await chrome.windows.create({
        tabId: anchorTab.id,
        focused: false // Don't focus individual domain windows
      });

      // Move other tabs from this domain to the new window
      const tabsToMove = domainTabs.slice(1);
      if (tabsToMove.length > 0) {
        if (respectGroups) {
          await moveTabsWithGroups(tabsToMove, newWindow.id);
        } else {
          const tabIds = tabsToMove.map(tab => tab.id);
          await chrome.tabs.move(tabIds, { windowId: newWindow.id, index: -1 });
        }
      }

      console.log('[Tab Organizer] Created window for domain:', domain, 'with', domainTabs.length, 'tabs');
    }

    // Phase 2: Create one "Miscellaneous" window for all single-tab domains
    if (domainAnalysis.singleTabDomains.length > 0) {
      console.log('[Tab Organizer] Creating miscellaneous window for', domainAnalysis.singleTabDomains.length, 'single-tab domains');

      // Use the first single-tab domain as the anchor
      const firstSingleDomain = domainAnalysis.singleTabDomains[0];
      const firstTab = domainAnalysis.domainTabs.get(firstSingleDomain)[0];

      const miscWindow = await chrome.windows.create({
        tabId: firstTab.id,
        focused: false
      });

      // Move all other single tabs to the miscellaneous window
      const singleTabsToMove = [];
      for (let i = 1; i < domainAnalysis.singleTabDomains.length; i++) {
        const domain = domainAnalysis.singleTabDomains[i];
        const tab = domainAnalysis.domainTabs.get(domain)[0];
        singleTabsToMove.push(tab);
      }

      if (singleTabsToMove.length > 0) {
        if (respectGroups) {
          await moveTabsWithGroups(singleTabsToMove, miscWindow.id);
        } else {
          const tabIds = singleTabsToMove.map(tab => tab.id);
          await chrome.tabs.move(tabIds, { windowId: miscWindow.id, index: -1 });
        }
      }

      console.log('[Tab Organizer] Created miscellaneous window with', domainAnalysis.singleTabDomains.length, 'single-tab domains');
    }

    console.log('[Tab Organizer] Extract All Domains extraction phase completed');

  } catch (error) {
    console.error('[Tab Organizer] Error in performExtractAllDomains:', error);
    throw error;
  }
}

// Helper function to sort tabs within a specific window
async function sortWindowTabs(windowId, respectGroups = true) {
  try {
    const tabsWithGroups = respectGroups ? await getTabsWithGroupInfo(windowId) : await chrome.tabs.query({ windowId });
    
    // Separate pinned tabs (never move these)
    const pinnedTabs = tabsWithGroups.filter(tab => tab.pinned);
    const unpinnedTabs = tabsWithGroups.filter(tab => !tab.pinned);
    
    if (!respectGroups) {
      // Simple sort for individual mode
      unpinnedTabs.sort((a, b) => {
        const urlA = a.pendingUrl || a.url;
        const urlB = b.pendingUrl || b.url;
        return urlA.localeCompare(urlB);
      });

      // Move tabs to sorted positions as a batch (omit windowId — tabs are
      // already in this window)
      if (unpinnedTabs.length > 0) {
        await chrome.tabs.move(
          unpinnedTabs.map(t => t.id),
          { index: pinnedTabs.length }
        );
      }
      return;
    }

    // Group-aware sorting logic
    const ungroupedTabs = [];
    const groupedTabsMap = new Map();

    for (const tab of unpinnedTabs) {
      if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
        ungroupedTabs.push(tab);
      } else {
        if (!groupedTabsMap.has(tab.groupId)) {
          groupedTabsMap.set(tab.groupId, []);
        }
        groupedTabsMap.get(tab.groupId).push(tab);
      }
    }

    // Sort ungrouped tabs by URL
    ungroupedTabs.sort((a, b) => {
      const urlA = a.pendingUrl || a.url;
      const urlB = b.pendingUrl || b.url;
      return urlA.localeCompare(urlB);
    });

    // Sort tabs within each group by URL
    for (const [_groupId, groupTabs] of groupedTabsMap.entries()) {
      groupTabs.sort((a, b) => {
        const urlA = a.pendingUrl || a.url;
        const urlB = b.pendingUrl || b.url;
        return urlA.localeCompare(urlB);
      });
    }

    // Determine the final order: pinned tabs, then ungrouped tabs, then grouped tabs
    let currentIndex = pinnedTabs.length;

    // Move ungrouped tabs first as a batch (omit windowId — tabs are already
    // in this window, and passing windowId can trigger Chrome's cross-window
    // group migration)
    if (ungroupedTabs.length > 0) {
      await chrome.tabs.move(
        ungroupedTabs.map(t => t.id),
        { index: currentIndex }
      );
    }
    currentIndex += ungroupedTabs.length;

    // Move grouped tabs as a batch per group to avoid Chrome's group migration
    // behavior that can occur with sequential single-tab moves
    for (const [_groupId, groupTabs] of groupedTabsMap.entries()) {
      await chrome.tabs.move(
        groupTabs.map(t => t.id),
        { index: currentIndex }
      );
      currentIndex += groupTabs.length;
    }
    
  } catch (error) {
    console.error('[Tab Organizer] Error sorting window tabs:', error);
  }
}

// Format tabs as text for clipboard copy
function formatTabsAsText(tabs, respectGroups = true) {
  if (tabs.length === 0) return '';

  if (!respectGroups) {
    return tabs.map(tab => tab.pendingUrl || tab.url).join('\n');
  }

  // Check if any tabs actually belong to a group
  const hasAnyGroups = tabs.some(tab => tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE);

  if (!hasAnyGroups) {
    // No groups at all — just list URLs without headers
    return tabs.map(tab => tab.pendingUrl || tab.url).join('\n');
  }

  // Organize tabs by group
  const groups = new Map();
  const ungrouped = [];

  for (const tab of tabs) {
    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      ungrouped.push(tab);
    } else {
      if (!groups.has(tab.groupId)) {
        groups.set(tab.groupId, { info: tab.groupInfo, tabs: [] });
      }
      groups.get(tab.groupId).tabs.push(tab);
    }
  }

  const sections = [];

  // Add grouped sections (URLs only, no headers)
  for (const [_groupId, group] of groups.entries()) {
    const urls = group.tabs.map(tab => tab.pendingUrl || tab.url);
    urls.sort();
    sections.push(urls.join('\n'));
  }

  // Add ungrouped section
  if (ungrouped.length > 0) {
    const urls = ungrouped.map(tab => tab.pendingUrl || tab.url);
    urls.sort();
    sections.push(urls.join('\n'));
  }

  return sections.join('\n\n');
}

async function handleFlattenWindow(sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groupedTabIds = tabs
      .filter(tab => tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
      .map(tab => tab.id);

    console.log('[Tab Organizer] Flattening current window,', groupedTabIds.length, 'grouped tabs');

    if (groupedTabIds.length > 0) {
      await chrome.tabs.ungroup(groupedTabIds);
    }

    sendResponse({ success: true });
  } catch (error) {
    console.error('[Tab Organizer] Error in flattenWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleCopyAllTabs(respectGroups = true, sendResponse) {
  try {
    console.log('[Tab Organizer] Copying all tabs', respectGroups ? '(preserving groups)' : '(individual tabs)');

    const tabs = await getTabsWithGroupInfo();
    const text = formatTabsAsText(tabs, respectGroups);

    sendResponse({ success: true, text });
  } catch (error) {
    console.error('[Tab Organizer] Error in copyAllTabs:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleMoveAllToSingleWindow(message, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Moving tabs from', windows.length, 'windows to single window');

    if (windows.length <= 1) {
      console.log('[Tab Organizer] Only one window exists, nothing to move');
      sendResponse({ success: true });
      return;
    }

    // Find the target window containing the active tab
    let targetWindow = null;
    if (message.activeTabId) {
      targetWindow = windows.find(w => w.tabs.some(tab => tab.id === message.activeTabId));
    }

    if (!targetWindow) {
      // If no active tab provided or found, use the focused window
      targetWindow = windows.find(w => w.focused);
      if (!targetWindow) {
        // If no focused window, use the first window as target
        targetWindow = windows[0];
      }
    }

    const tabsToMove = [];

    // Collect all unpinned tabs from other windows with their group info
    for (const window of windows) {
      if (window.id !== targetWindow.id) {
        const windowTabsWithGroups = await getTabsWithGroupInfo(window.id);
        for (const tab of windowTabsWithGroups) {
          if (!tab.pinned) {
            tabsToMove.push(tab);
          }
        }
      }
    }

    if (tabsToMove.length === 0) {
      console.log('[Tab Organizer] No unpinned tabs to move');
      sendResponse({ success: true });
      return;
    }

    // Move tabs based on mode
    const respectGroups = message.respectGroups !== undefined ? message.respectGroups : true;
    if (respectGroups) {
      await moveTabsWithGroups(tabsToMove, targetWindow.id);
    } else {
      const tabIds = tabsToMove.map(tab => tab.id);
      await chrome.tabs.move(tabIds, { windowId: targetWindow.id, index: -1 });
    }

    console.log('[Tab Organizer] Moved', tabsToMove.length, 'unpinned tabs to single window');

    // Wait a moment for tabs to settle, then sort tabs in the target window
    setTimeout(async () => {
      await sortWindowTabs(targetWindow.id, respectGroups);

      console.log('[Tab Organizer] Completed moveAllToSingleWindow');

      // Bring the target window into focus
      await chrome.windows.update(targetWindow.id, { focused: true });

      // If we have an active tab ID, make sure it stays active
      if (message.activeTabId) {
        await chrome.tabs.update(message.activeTabId, { active: true });
      }
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in moveAllToSingleWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ============================================================
// Tab Snoozing — Constants and Pure Helpers
// ============================================================

const SNOOZE_STORAGE_KEY = 'snoozedItems';
const SNOOZE_ALARM_PREFIX = 'snooze:';

// Ordered list of the five presets. Times are computed on demand by
// computePresetWakeTime — this array holds only key + label metadata.
const SNOOZE_PRESETS = [
  { key: 'laterToday', label: 'Later Today' },
  { key: 'tonight', label: 'Tonight' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'weekend', label: 'This Weekend' },
  { key: 'nextWeek', label: 'Next Week' },
];

// Next occurrence of weekday `targetDow` (0=Sun..6=Sat) at `hour`:00 local time.
// - strictlyAfterToday === false: strictly after `now` (used by `weekend`).
// - strictlyAfterToday === true:  strictly after *today* (used by `nextWeek`).
function nextWeekdayAt(now, targetDow, hour, strictlyAfterToday) {
  const base = new Date(now);
  const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, 0, 0, 0);
  const dayDiff = (targetDow - base.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + dayDiff);
  if (strictlyAfterToday) {
    // "next week" semantics: the target weekday is never today.
    if (dayDiff === 0) {
      candidate.setDate(candidate.getDate() + 7);
    }
  } else if (candidate.getTime() <= now) {
    // "weekend" semantics: allow today if the hour is still ahead.
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate.getTime();
}

// Returns the wake time (epoch ms, local) for a preset key. Throws on unknown.
function computePresetWakeTime(preset, now = Date.now()) {
  const base = new Date(now);
  switch (preset) {
    case 'laterToday':
      return now + 3 * 60 * 60 * 1000;
    case 'tonight': {
      const tonight = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 18, 0, 0, 0);
      if (now >= tonight.getTime()) {
        return now + 60 * 60 * 1000;
      }
      return tonight.getTime();
    }
    case 'tomorrow': {
      const tomorrow = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 9, 0, 0, 0);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.getTime();
    }
    case 'weekend':
      return nextWeekdayAt(now, 6, 9, false);
    case 'nextWeek':
      return nextWeekdayAt(now, 1, 9, true);
    default:
      throw new Error('Unknown snooze preset: ' + preset);
  }
}

// Safety net against clock skew / popup-open drift: never schedule in the past.
function clampWakeAt(wakeAt, now = Date.now()) {
  return Math.max(wakeAt, now + 60000);
}

// Allowlist per the Edge Cases table. Rejects unparseable / null / '' and
// this extension's own pages.
function isSnoozeableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  let u;
  try {
    u = new URL(url);
  } catch (_e) {
    return false;
  }
  const protocol = u.protocol;
  if (protocol === 'http:' || protocol === 'https:' || protocol === 'file:') {
    return true;
  }
  if (protocol === 'about:') {
    return u.pathname === 'blank';
  }
  if (protocol === 'chrome-extension:') {
    // Allow foreign extension pages, but not our own (they cannot be reopened
    // meaningfully and would resurrect the extension's own UI).
    let ownId;
    try {
      ownId = chrome.runtime.getURL('').split('/')[2];
    } catch (_e) {
      ownId = '';
    }
    return u.host !== ownId;
  }
  return false;
}

// Truncate a tab title to the stored maximum (60 chars).
function truncateSnoozeTitle(title) {
  return (title || '').slice(0, 60);
}

// Primary key generator. Uses crypto.randomUUID() (available in MV3 service
// workers); falls back to a UUIDv4 shim in environments that lack it.
function generateSnoozeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// The `summary` string shown in the sleeping list (captured at snooze time).
function buildSnoozeSummary(type, tabs, groupInfo) {
  const n = tabs.length;
  switch (type) {
    case 'tab': {
      const first = tabs[0] || {};
      const title = first.title ? first.title : (first.url || '');
      return truncateSnoozeTitle(title);
    }
    case 'tabs':
      return `${n} selected tabs`;
    case 'group': {
      const title = groupInfo && groupInfo.title ? groupInfo.title : '(unnamed)';
      return `Group "${title}" (${n} tabs)`;
    }
    case 'window':
      return `Window (${n} tabs)`;
    default:
      return `${n} tabs`;
  }
}

// Assemble a full snooze record (pure — generates id/createdAt/summary and
// truncates titles). `tabs` may already carry a `groupIndex` (window type).
function createSnoozeRecord({ type, tabs, group, groups, windowId, wakeAt, preset }) {
  const normalizedTabs = tabs
    .map((t) => {
      const entry = {
        url: t.url,
        title: truncateSnoozeTitle(t.title),
        pinned: !!t.pinned,
        index: t.index,
      };
      if (typeof t.groupIndex === 'number') {
        entry.groupIndex = t.groupIndex;
      }
      return entry;
    })
    .sort((a, b) => a.index - b.index);

  const record = {
    id: generateSnoozeId(),
    type,
    summary: buildSnoozeSummary(type, normalizedTabs, group),
    createdAt: Date.now(),
    wakeAt,
    preset,
    windowId,
    tabs: normalizedTabs,
  };

  if (type === 'group' && group) {
    record.group = { title: group.title || '', color: group.color || 'grey' };
  }
  if (type === 'window' && groups && groups.length > 0) {
    record.groups = groups.map((g) => ({ title: g.title || '', color: g.color || 'grey' }));
  }

  return record;
}

// ============================================================
// Tab Snoozing — Storage and Scheduling
// ============================================================

// Serializes all read-modify-write cycles on `snoozedItems` within this worker.
let snoozeLock = Promise.resolve();
function withSnoozeLock(fn) {
  const run = snoozeLock.then(() => fn());
  // Keep the chain alive regardless of whether `fn` resolved or rejected.
  snoozeLock = run.then(() => {}, () => {});
  return run;
}

async function loadSnoozedItems() {
  try {
    const result = await chrome.storage.local.get([SNOOZE_STORAGE_KEY]);
    const items = result && result[SNOOZE_STORAGE_KEY];
    return Array.isArray(items) ? items : [];
  } catch (_e) {
    return [];
  }
}

async function saveSnoozedItems(items) {
  await chrome.storage.local.set({ [SNOOZE_STORAGE_KEY]: items });
}

function scheduleSnoozeAlarm(record) {
  return chrome.alarms.create(SNOOZE_ALARM_PREFIX + record.id, { when: record.wakeAt });
}

// ============================================================
// Tab Snoozing — Snooze Path
// ============================================================

// Resolve the effective wakeAt for an incoming snooze message. Presets are
// clamped to now + 60s; a custom time in the past is rejected outright.
function clampOrRejectWakeAt(message, now = Date.now()) {
  const incoming = message.wakeAt;
  if (message.preset === 'custom') {
    if (typeof incoming !== 'number' || Number.isNaN(incoming) || incoming < now + 60000) {
      return { error: 'Wake time is in the past' };
    }
    return { value: incoming };
  }
  const base = typeof incoming === 'number' && !Number.isNaN(incoming) ? incoming : now;
  return { value: clampWakeAt(base, now) };
}

function handleGetSnoozePresets(sendResponse) {
  const now = Date.now();
  const presets = SNOOZE_PRESETS.map((p) => ({
    key: p.key,
    label: p.label,
    wakeAt: computePresetWakeTime(p.key, now),
  }));
  sendResponse({ success: true, presets });
}

// Build a Map of groupId -> { title, color } for every group represented in
// `tabs` (used to capture window-level group structure).
async function getSnoozeGroupInfoMap(tabs) {
  const map = new Map();
  const groupIds = [
    ...new Set(
      tabs
        .map((t) => t.groupId)
        .filter((id) => id !== undefined && id !== chrome.tabGroups.TAB_GROUP_ID_NONE)
    ),
  ];
  for (const gid of groupIds) {
    try {
      const g = await chrome.tabGroups.get(gid);
      map.set(gid, { title: g.title || '', color: g.color || 'grey' });
    } catch (_e) {
      map.set(gid, { title: '', color: 'grey' });
    }
  }
  return map;
}

// Shared core for all four snooze units. Implements steps 1-8 of the snooze
// flow. `extras` may carry { windowId, groupInfo, groupInfoMap }.
async function snoozeTabs(type, tabs, extras, wakeAt, preset) {
  const source = Array.isArray(tabs) ? tabs : [];

  // Incognito tabs must never be written into chrome.storage.local (persistent,
  // non-incognito storage) — doing so would leak incognito browsing outside
  // its boundary. A single active incognito tab gets a specific error; the
  // multi-tab units silently exclude incognito tabs, same as any other
  // non-snoozeable tab.
  if (type === 'tab' && source.length > 0 && source.every((t) => t.incognito === true)) {
    return { success: false, error: 'Incognito tabs can\'t be snoozed' };
  }
  const nonIncognito = source.filter((t) => t.incognito !== true);

  // 2. Filter snoozeable URLs (non-snoozeable tabs are silently left open).
  const snoozeable = nonIncognito.filter((t) => isSnoozeableUrl(t.url));
  if (snoozeable.length === 0) {
    // A single-tab snooze of a rejected URL gets a page-specific message; the
    // multi-tab units report the generic "nothing here" error.
    const error = type === 'tab' ? 'This page can\'t be snoozed' : 'Nothing here can be snoozed';
    return { success: false, error };
  }

  // 1. Order ascending by tab.index.
  snoozeable.sort((a, b) => a.index - b.index);

  // Capture group structure for `window`; build the record-level groups array
  // and per-tab groupIndex.
  let recordGroups;
  let preparedTabs = snoozeable;
  if (type === 'window') {
    const groupInfoMap = (extras && extras.groupInfoMap) || new Map();
    const groupIdToIndex = new Map();
    recordGroups = [];
    for (const t of snoozeable) {
      const gid = t.groupId;
      if (gid !== undefined && gid !== chrome.tabGroups.TAB_GROUP_ID_NONE && !groupIdToIndex.has(gid)) {
        const gi = groupInfoMap.get(gid);
        groupIdToIndex.set(gid, recordGroups.length);
        recordGroups.push({
          title: gi ? gi.title || '' : '',
          color: gi ? gi.color || 'grey' : 'grey',
        });
      }
    }
    preparedTabs = snoozeable.map((t) => {
      const entry = { url: t.url, title: t.title, pinned: t.pinned, index: t.index };
      const gid = t.groupId;
      if (gid !== undefined && gid !== chrome.tabGroups.TAB_GROUP_ID_NONE && groupIdToIndex.has(gid)) {
        entry.groupIndex = groupIdToIndex.get(gid);
      }
      return entry;
    });
    if (recordGroups.length === 0) recordGroups = undefined;
  }

  const groupInfo = type === 'group' ? extras && extras.groupInfo : undefined;

  // 3. Build the record.
  const record = createSnoozeRecord({
    type,
    tabs: preparedTabs,
    group: groupInfo,
    groups: recordGroups,
    windowId: extras && extras.windowId,
    wakeAt,
    preset,
  });

  // 4. Persist first (under the lock) — a crash before close can at worst leave
  // a duplicate, never lose data.
  await withSnoozeLock(async () => {
    const items = await loadSnoozedItems();
    items.push(record);
    await saveSnoozedItems(items);
  });

  // 5. Schedule the alarm.
  await scheduleSnoozeAlarm(record);

  // 6. Last-window guard: keep Chrome alive if we're about to empty the only
  // normal window.
  await guardLastWindowBeforeClose(snoozeable);

  // 7. Close the tabs (closing all of a window's tabs closes the window).
  await chrome.tabs.remove(snoozeable.map((t) => t.id));

  // 8. Done.
  return { success: true, record };
}

async function guardLastWindowBeforeClose(tabsToClose) {
  try {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    if (!Array.isArray(windows) || windows.length !== 1) return;
    const win = windows[0];
    const closingIds = new Set(tabsToClose.map((t) => t.id));
    const remaining = (win.tabs || []).filter((t) => !closingIds.has(t.id));
    if (remaining.length === 0) {
      await chrome.tabs.create({ url: 'chrome://newtab/', active: true });
    }
  } catch (_e) {
    // Best effort — never block the snooze on the guard.
  }
}

async function handleSnoozeTab(message, sendResponse) {
  try {
    const w = clampOrRejectWakeAt(message);
    if (w.error) {
      sendResponse({ success: false, error: w.error });
      return;
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await snoozeTabs(
      'tab',
      tabs,
      { windowId: tabs[0] && tabs[0].windowId },
      w.value,
      message.preset
    );
    sendResponse(result);
  } catch (error) {
    console.error('[Tab Organizer] Error in snoozeTab:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSnoozeSelected(message, sendResponse) {
  try {
    const w = clampOrRejectWakeAt(message);
    if (w.error) {
      sendResponse({ success: false, error: w.error });
      return;
    }
    const tabs = await chrome.tabs.query({ highlighted: true, currentWindow: true });
    const result = await snoozeTabs(
      'tabs',
      tabs,
      { windowId: tabs[0] && tabs[0].windowId },
      w.value,
      message.preset
    );
    sendResponse(result);
  } catch (error) {
    console.error('[Tab Organizer] Error in snoozeSelected:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSnoozeWindow(message, sendResponse) {
  try {
    const w = clampOrRejectWakeAt(message);
    if (w.error) {
      sendResponse({ success: false, error: w.error });
      return;
    }
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groupInfoMap = await getSnoozeGroupInfoMap(tabs);
    const result = await snoozeTabs(
      'window',
      tabs,
      { windowId: tabs[0] && tabs[0].windowId, groupInfoMap },
      w.value,
      message.preset
    );
    sendResponse(result);
  } catch (error) {
    console.error('[Tab Organizer] Error in snoozeWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSnoozeGroup(message, sendResponse) {
  try {
    const w = clampOrRejectWakeAt(message);
    if (w.error) {
      sendResponse({ success: false, error: w.error });
      return;
    }
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];
    const groupId = activeTab && activeTab.groupId;
    if (groupId === undefined || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      sendResponse({ success: false, error: 'Active tab is not in a group' });
      return;
    }
    const tabs = await chrome.tabs.query({ groupId, currentWindow: true });
    let groupInfo;
    try {
      const g = await chrome.tabGroups.get(groupId);
      groupInfo = { title: g.title || '', color: g.color || 'grey' };
    } catch (_e) {
      groupInfo = { title: '', color: 'grey' };
    }
    const result = await snoozeTabs(
      'group',
      tabs,
      { windowId: activeTab.windowId, groupInfo },
      w.value,
      message.preset
    );
    sendResponse(result);
  } catch (error) {
    console.error('[Tab Organizer] Error in snoozeGroup:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ============================================================
// Tab Snoozing — Wake Path
// ============================================================

// notificationId -> { windowId, tabId } for best-effort click focusing. This
// map is memory-resident and lossy across service-worker respawns (documented).
const snoozeNotificationTargets = new Map();

// Find the window to restore tab/tabs/group records into: the last-focused
// normal window, creating one if none exists.
async function getRestoreTargetWindowId() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (win && win.id !== undefined && win.id !== null) {
      return win.id;
    }
  } catch (_e) {
    // fall through to creating a window
  }
  const created = await chrome.windows.create({ focused: false });
  return created.id;
}

// Recreate the tabs/window/group in the background. Never throws — per-tab
// failures are counted. Returns { createdCount, failedCount, windowId, firstTabId }.
async function restoreSnoozedRecord(record) {
  let createdCount = 0;
  let failedCount = 0;
  let windowId;
  let firstTabId;

  if (record.type === 'window') {
    const urls = record.tabs.map((t) => t.url);
    let win;
    try {
      win = await chrome.windows.create({ url: urls, focused: false });
    } catch (_e) {
      win = await chrome.windows.create({ focused: false });
    }
    windowId = win && win.id;
    const createdTabs = (win && win.tabs) || [];
    createdCount = createdTabs.length;
    failedCount = Math.max(0, record.tabs.length - createdCount);
    if (createdTabs[0]) firstTabId = createdTabs[0].id;

    // Re-pin tabs whose stored entry was pinned.
    for (let i = 0; i < record.tabs.length; i++) {
      if (record.tabs[i].pinned && createdTabs[i]) {
        try {
          await chrome.tabs.update(createdTabs[i].id, { pinned: true });
        } catch (_e) {
          // best effort
        }
      }
    }

    // Recreate each stored group over the new tabs.
    if (record.groups && record.groups.length > 0) {
      for (let gi = 0; gi < record.groups.length; gi++) {
        const memberTabIds = [];
        for (let i = 0; i < record.tabs.length; i++) {
          if (record.tabs[i].groupIndex === gi && createdTabs[i]) {
            memberTabIds.push(createdTabs[i].id);
          }
        }
        if (memberTabIds.length > 0) {
          try {
            const newGroupId = await chrome.tabs.group({
              tabIds: memberTabIds,
              createProperties: { windowId },
            });
            await chrome.tabGroups.update(newGroupId, {
              title: record.groups[gi].title || '',
              color: record.groups[gi].color || 'grey',
            });
          } catch (_e) {
            // best effort
          }
        }
      }
    }

    return { createdCount, failedCount, windowId, firstTabId };
  }

  // tab / tabs / group — recreate into the last-focused normal window.
  windowId = await getRestoreTargetWindowId();
  const createdTabIds = [];
  for (const t of record.tabs) {
    try {
      // No `index` here: chrome.tabs.create (unlike tabs.move) does not accept
      // -1 as "append at the end" — it throws "index: Value must be at least
      // 0". Omitting `index` already appends the tab as the last one in the
      // window, which is the behavior we want.
      const created = await chrome.tabs.create({
        windowId,
        url: t.url,
        pinned: !!t.pinned,
        active: false,
      });
      createdCount++;
      createdTabIds.push(created.id);
      if (firstTabId === undefined) firstTabId = created.id;
    } catch (_e) {
      failedCount++;
    }
  }

  if (record.type === 'group' && createdTabIds.length > 0) {
    try {
      const newGroupId = await chrome.tabs.group({
        tabIds: createdTabIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(newGroupId, {
        title: (record.group && record.group.title) || '',
        color: (record.group && record.group.color) || 'grey',
      });
    } catch (_e) {
      // best effort
    }
  }

  return { createdCount, failedCount, windowId, firstTabId };
}

// Fire the wake notification and register it in the best-effort click map.
// `location` (optional) carries { windowId, firstTabId } for click focusing.
function notifyWake(record, createdCount, failedCount, location = {}) {
  // Use the ACTUAL restored count (createdCount), not the originally intended
  // record.tabs.length — otherwise a partial-failure wake reports a number of
  // "back" tabs that's inconsistent with the "N could not be reopened" suffix.
  const n = typeof createdCount === 'number' ? createdCount : (record.tabs ? record.tabs.length : 0);
  const title = n === 1 ? 'Huddle — tab woke up' : 'Huddle — tabs woke up';
  let message;
  switch (record.type) {
    case 'tab': {
      const t = (record.tabs && record.tabs[0] && record.tabs[0].title) || '';
      message = `"${t}" is back`;
      break;
    }
    case 'tabs':
      message = `${n} tabs are back`;
      break;
    case 'group': {
      const gt = record.group && record.group.title ? record.group.title : '(unnamed)';
      message = `Group "${gt}" (${n} tabs) is back`;
      break;
    }
    case 'window':
      message = `Window restored (${n} tabs)`;
      break;
    default:
      message = `${n} tabs are back`;
  }
  if (failedCount > 0) {
    message += ` — ${failedCount} could not be reopened`;
  }

  const notificationId = 'snooze-wake:' + record.id;
  try {
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
    });
    snoozeNotificationTargets.set(notificationId, {
      windowId: location.windowId,
      tabId: location.firstTabId,
    });
  } catch (_e) {
    // notifications are best-effort
  }
}

// Atomically pop the record, clear its alarm, restore it, optionally notify.
// Idempotent: a missing id is a silent no-op (handles duplicate alarm fires).
async function wakeSnoozedRecord(id, options = {}) {
  const notify = options.notify === true;

  const record = await withSnoozeLock(async () => {
    const items = await loadSnoozedItems();
    const idx = items.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const [popped] = items.splice(idx, 1);
    await saveSnoozedItems(items);
    return popped;
  });

  if (!record) return null;

  try {
    await chrome.alarms.clear(SNOOZE_ALARM_PREFIX + id);
  } catch (_e) {
    // harmless if already fired/cleared
  }

  let restoreResult;
  try {
    restoreResult = await restoreSnoozedRecord(record);
  } catch (error) {
    // restoreSnoozedRecord already try/catches every per-tab create; a throw
    // here means something failed outside that loop (e.g. chrome.windows.create
    // / getLastFocused for a window-type record). The record was already
    // popped from storage above — without this recovery it would be gone for
    // good. Re-persist it (under the same lock used everywhere else) and arm
    // a near-future retry so the tabs are never permanently lost.
    console.error('[Tab Organizer] restoreSnoozedRecord failed; re-persisting snoozed record to avoid data loss:', error);
    await withSnoozeLock(async () => {
      const items = await loadSnoozedItems();
      items.push(record);
      await saveSnoozedItems(items);
    });
    try {
      await chrome.alarms.create(SNOOZE_ALARM_PREFIX + id, { when: Date.now() + 60000 });
    } catch (_alarmErr) {
      // best effort — reconcileSnoozeAlarms re-arms it on next startup/install
    }
    return { record, requeued: true };
  }

  if (notify) {
    notifyWake(record, restoreResult.createdCount, restoreResult.failedCount, {
      windowId: restoreResult.windowId,
      firstTabId: restoreResult.firstTabId,
    });
  }

  return { record, ...restoreResult };
}

function handleSnoozeAlarm(alarm) {
  if (!alarm || typeof alarm.name !== 'string' || !alarm.name.startsWith(SNOOZE_ALARM_PREFIX)) {
    return;
  }
  const id = alarm.name.slice(SNOOZE_ALARM_PREFIX.length);
  wakeSnoozedRecord(id, { notify: true });
}

async function handleWakeNow(message, sendResponse) {
  try {
    const result = await wakeSnoozedRecord(message.id, { notify: false });
    if (!result) {
      sendResponse({ success: false, error: 'Snooze not found' });
      return;
    }
    if (result.requeued) {
      sendResponse({ success: false, error: 'Could not restore right now — will retry automatically' });
      return;
    }
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Tab Organizer] Error in wakeSnoozed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleCancelSnooze(message, sendResponse) {
  try {
    const removed = await withSnoozeLock(async () => {
      const items = await loadSnoozedItems();
      const idx = items.findIndex((r) => r.id === message.id);
      if (idx === -1) return false;
      items.splice(idx, 1);
      await saveSnoozedItems(items);
      return true;
    });
    try {
      await chrome.alarms.clear(SNOOZE_ALARM_PREFIX + message.id);
    } catch (_e) {
      // harmless if already cleared
    }
    sendResponse({ success: removed });
  } catch (error) {
    console.error('[Tab Organizer] Error in cancelSnoozed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleListSnoozed(sendResponse) {
  try {
    const items = await loadSnoozedItems();
    items.sort((a, b) => a.wakeAt - b.wakeAt);
    sendResponse({ success: true, items });
  } catch (error) {
    console.error('[Tab Organizer] Error in listSnoozed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleWakeNotificationClicked(notificationId) {
  const target = snoozeNotificationTargets.get(notificationId);
  try {
    chrome.notifications.clear(notificationId);
  } catch (_e) {
    // best effort
  }
  if (!target) return; // worker was respawned; click is a silent no-op
  snoozeNotificationTargets.delete(notificationId);
  try {
    if (target.windowId !== undefined && target.windowId !== null) {
      await chrome.windows.update(target.windowId, { focused: true });
    }
    if (target.tabId !== undefined && target.tabId !== null) {
      await chrome.tabs.update(target.tabId, { active: true });
    }
  } catch (_e) {
    // the window/tab may already be gone
  }
}

// ============================================================
// Tab Snoozing — Reconciler (startup / install)
// ============================================================

// Belt-and-braces on browser startup / extension install/update: wake every
// past-due record and re-arm alarms for future records that lost their timer.
async function reconcileSnoozeAlarms() {
  try {
    const now = Date.now();
    const items = await loadSnoozedItems();

    const pastDue = items.filter((r) => r.wakeAt <= now);
    for (const r of pastDue) {
      await wakeSnoozedRecord(r.id, { notify: true });
    }

    const remaining = await loadSnoozedItems();
    let existingAlarms = [];
    try {
      existingAlarms = (await chrome.alarms.getAll()) || [];
    } catch (_e) {
      existingAlarms = [];
    }
    const existingNames = new Set(existingAlarms.map((a) => a.name));

    for (const r of remaining) {
      if (r.wakeAt > now && !existingNames.has(SNOOZE_ALARM_PREFIX + r.id)) {
        await scheduleSnoozeAlarm(r);
      }
    }
  } catch (error) {
    console.error('[Tab Organizer] Error reconciling snooze alarms:', error);
  }
}

// ============================================================
// Tab Snoozing — Top-level listener registrations (MV3: sync at top level)
// ============================================================

chrome.alarms.onAlarm.addListener(handleSnoozeAlarm);
chrome.runtime.onStartup.addListener(reconcileSnoozeAlarms);
chrome.runtime.onInstalled.addListener(reconcileSnoozeAlarms);
chrome.notifications.onClicked.addListener(handleWakeNotificationClicked);