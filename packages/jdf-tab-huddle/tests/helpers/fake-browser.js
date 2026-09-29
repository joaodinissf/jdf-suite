// A small stateful stand-in for the Chrome APIs the worker's snooze and wake
// code uses, for tests that need more than one worker instance over the same
// profile: windows, tabs and groups that behave (ids, order, a window closing
// with its last tab), storage.local, storage.session and alarms that outlive
// a worker, and browser-level events (a worker stop, an extension reload, a
// browser restart with or without session restore).
//
// Each startWorker() evaluates src/background.js afresh, as Chrome does when
// it starts a worker, with its own `chrome` object. kill() makes every call
// that instance makes from then on hang, and stops delivering events to it,
// which is what a stopped worker looks like to the rest of the browser.
//
// A test stops a wake at an exact point with dieAt(stage): the worker's
// wakeStage() hook then kills the instance at that stage, once.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
export const BACKGROUND_PATH = resolve(here, '../../src/background.js');

const NONE = -1;
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const never = () => new Promise(() => {});

function urlMatches(pattern, url) {
  if (typeof pattern !== 'string') return true;
  if (!pattern.includes('*')) return pattern === url;
  const re = new RegExp('^' + pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(url || '');
}

export function createBrowser({ source = null } = {}) {
  const src = source || readFileSync(BACKGROUND_PATH, 'utf8');
  const b = {
    local: {},
    session: {},
    alarms: new Map(),
    windows: new Map(),
    tabs: new Map(),
    groups: new Map(),
    nextTabId: 1,
    nextWindowId: 1,
    nextGroupId: 1,
    focusedWindowId: null,
    notifications: [],
    created: [], // every tabs.create call that made a tab: { url, windowId, worker }
    createCalls: [], // every tabs.create call, made or refused
    windowCreates: [], // the argument of every windows.create call
    workers: [],
    stageHits: [],
    apiCalls: 0,
    faults: {}, // name -> [fn(args) returning an Error to throw, or null]
  };

  // ---- tab and window model ----
  function windowTabs(windowId) {
    return [...b.tabs.values()].filter((t) => t.windowId === windowId).sort((x, y) => x.index - y.index);
  }
  function reindex(windowId) {
    const list = windowTabs(windowId);
    const pinned = list.filter((t) => t.pinned);
    const rest = list.filter((t) => !t.pinned);
    [...pinned, ...rest].forEach((t, i) => { t.index = i; });
  }
  function dropEmptyGroups() {
    for (const gid of [...b.groups.keys()]) {
      if (![...b.tabs.values()].some((t) => t.groupId === gid)) b.groups.delete(gid);
    }
  }
  function addWindow({ incognito = false, focused = true, type = 'normal' } = {}) {
    const id = b.nextWindowId++;
    b.windows.set(id, { id, type, incognito, focused });
    if (focused || b.focusedWindowId === null) b.focusedWindowId = id;
    return id;
  }
  function addTab({ windowId, url, pinned = false, active = false, id = null, groupId = NONE }) {
    const tabId = id ?? b.nextTabId++;
    if (tabId >= b.nextTabId) b.nextTabId = tabId + 1;
    const w = b.windows.get(windowId);
    const tab = {
      id: tabId, windowId, url, pinned: !!pinned, active: !!active, groupId,
      index: windowTabs(windowId).length, incognito: !!(w && w.incognito), highlighted: !!active,
    };
    b.tabs.set(tabId, tab);
    reindex(windowId);
    return tab;
  }
  function removeTab(tabId) {
    const tab = b.tabs.get(tabId);
    if (!tab) return;
    b.tabs.delete(tabId);
    if (windowTabs(tab.windowId).length === 0) {
      b.windows.delete(tab.windowId);
      if (b.focusedWindowId === tab.windowId) b.focusedWindowId = [...b.windows.keys()][0] ?? null;
    } else {
      reindex(tab.windowId);
    }
    dropEmptyGroups();
  }
  function removeWindow(windowId) {
    for (const t of windowTabs(windowId)) b.tabs.delete(t.id);
    b.windows.delete(windowId);
    if (b.focusedWindowId === windowId) b.focusedWindowId = [...b.windows.keys()][0] ?? null;
    dropEmptyGroups();
  }
  const pub = (t) => clone(t);

  // ---- the chrome object one worker instance sees ----
  function makeChrome(worker) {
    const events = worker.events;
    const call = (name, fn) => async (...args) => {
      if (worker.dead) return never();
      b.apiCalls++;
      await Promise.resolve();
      if (worker.dead) return never();
      const faults = b.faults[name];
      if (faults && faults.length) {
        const err = faults[0](...args);
        if (err) {
          faults.shift();
          throw err;
        }
      }
      return fn(...args);
    };
    const event = (key) => ({
      addListener: (fn) => { events[key].push(fn); },
      removeListener: (fn) => {
        const i = events[key].indexOf(fn);
        if (i >= 0) events[key].splice(i, 1);
      },
      hasListener: (fn) => events[key].includes(fn),
    });
    const area = (store, name) => ({
      get: call(`storage.${name}.get`, (keys) => {
        const data = store();
        if (keys == null) return clone(data);
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        const out = {};
        for (const k of list) if (k in data) out[k] = clone(data[k]);
        return out;
      }),
      set: call(`storage.${name}.set`, (items) => { Object.assign(store(), clone(items)); }),
      remove: call(`storage.${name}.remove`, (keys) => {
        for (const k of typeof keys === 'string' ? [keys] : keys) delete store()[k];
      }),
    });
    return {
      runtime: {
        id: 'test-id',
        lastError: null,
        getURL: (p) => `chrome-extension://test-id/${p}`,
        sendMessage: call('runtime.sendMessage', () => undefined),
        onMessage: event('message'),
        onConnect: event('connect'),
        onStartup: event('startup'),
        onInstalled: event('installed'),
      },
      storage: {
        local: area(() => b.local, 'local'),
        session: area(() => b.session, 'session'),
        sync: area(() => ({}), 'sync'),
        onChanged: event('storageChanged'),
      },
      alarms: {
        create: call('alarms.create', (name, info) => {
          b.alarms.set(name, { name, scheduledTime: info.when ?? Date.now() + (info.delayInMinutes || 0) * 60000 });
        }),
        get: call('alarms.get', (name) => clone(b.alarms.get(name))),
        getAll: call('alarms.getAll', () => clone([...b.alarms.values()])),
        clear: call('alarms.clear', (name) => b.alarms.delete(name)),
        clearAll: call('alarms.clearAll', () => { b.alarms.clear(); return true; }),
        onAlarm: event('alarm'),
      },
      notifications: {
        create: (id, options) => {
          if (worker.dead) return;
          b.notifications.push({ id, ...options, worker: worker.n });
        },
        clear: () => {},
        onClicked: event('notificationClicked'),
      },
      windows: {
        WINDOW_ID_NONE: -1,
        create: call('windows.create', (info = {}) => {
          b.windowCreates.push(clone(info));
          const id = addWindow({ focused: info.focused !== false, incognito: !!info.incognito });
          const urls = Array.isArray(info.url) ? info.url : info.url ? [info.url] : ['chrome://newtab/'];
          for (const url of urls) addTab({ windowId: id, url });
          return { ...clone(b.windows.get(id)), tabs: windowTabs(id).map(pub) };
        }),
        get: call('windows.get', (id) => {
          const w = b.windows.get(id);
          if (!w) throw new Error(`No window with id: ${id}.`);
          return clone(w);
        }),
        getAll: call('windows.getAll', (info = {}) => [...b.windows.values()]
          .filter((w) => !info.windowTypes || info.windowTypes.includes(w.type))
          .map((w) => ({ ...clone(w), ...(info.populate ? { tabs: windowTabs(w.id).map(pub) } : {}) }))),
        getLastFocused: call('windows.getLastFocused', () => {
          const w = b.windows.get(b.focusedWindowId);
          if (!w) throw new Error('No last-focused window');
          return clone(w);
        }),
        getCurrent: call('windows.getCurrent', () => clone(b.windows.get(b.focusedWindowId))),
        update: call('windows.update', (id, info) => {
          if (info.focused) b.focusedWindowId = id;
          return clone(b.windows.get(id));
        }),
        remove: call('windows.remove', (id) => {
          if (!b.windows.has(id)) throw new Error(`No window with id: ${id}.`);
          removeWindow(id);
        }),
      },
      tabs: {
        TAB_ID_NONE: -1,
        create: call('tabs.create', (info) => {
          b.createCalls.push({ url: info.url, worker: worker.n });
          const windowId = info.windowId ?? b.focusedWindowId;
          if (!b.windows.has(windowId)) throw new Error(`No window with id: ${windowId}.`);
          if (typeof info.url === 'string' && info.url.startsWith('file:')) throw new Error('Cannot access file URLs');
          const tab = addTab({ windowId, url: info.url, pinned: info.pinned, active: info.active });
          b.created.push({ url: info.url, windowId, worker: worker.n });
          return pub(tab);
        }),
        get: call('tabs.get', (id) => {
          const t = b.tabs.get(id);
          if (!t) throw new Error(`No tab with id: ${id}.`);
          return pub(t);
        }),
        query: call('tabs.query', (q = {}) => [...b.tabs.values()]
          .filter((t) => (q.windowId === undefined || t.windowId === q.windowId)
            && (q.groupId === undefined || t.groupId === q.groupId)
            && (q.active === undefined || t.active === q.active)
            && (q.pinned === undefined || t.pinned === q.pinned)
            && (!(q.currentWindow || q.lastFocusedWindow) || t.windowId === b.focusedWindowId)
            && (q.url === undefined || urlMatches(q.url, t.url)))
          .sort((x, y) => (x.windowId - y.windowId) || (x.index - y.index))
          .map(pub)),
        remove: call('tabs.remove', (ids) => {
          for (const id of Array.isArray(ids) ? ids : [ids]) {
            if (!b.tabs.has(id)) throw new Error(`No tab with id: ${id}.`);
            removeTab(id);
          }
        }),
        update: call('tabs.update', (id, info) => {
          const t = b.tabs.get(id);
          if (!t) throw new Error(`No tab with id: ${id}.`);
          if ('pinned' in info) {
            t.pinned = !!info.pinned;
            if (t.pinned) t.groupId = NONE;
            reindex(t.windowId);
            dropEmptyGroups();
          }
          if ('active' in info) t.active = !!info.active;
          if ('url' in info) t.url = info.url;
          return pub(t);
        }),
        group: call('tabs.group', (info) => {
          const ids = Array.isArray(info.tabIds) ? info.tabIds : [info.tabIds];
          for (const id of ids) if (!b.tabs.has(id)) throw new Error(`No tab with id: ${id}.`);
          let gid = info.groupId;
          let windowId;
          if (gid !== undefined) {
            const g = b.groups.get(gid);
            if (!g) throw new Error(`No group with id: ${gid}.`);
            windowId = g.windowId;
          } else {
            windowId = (info.createProperties && info.createProperties.windowId) ?? b.tabs.get(ids[0]).windowId;
            gid = b.nextGroupId++;
            b.groups.set(gid, { id: gid, windowId, title: '', color: 'grey', collapsed: false });
          }
          for (const id of ids) {
            const t = b.tabs.get(id);
            t.windowId = windowId;
            t.pinned = false;
            t.groupId = gid;
          }
          reindex(windowId);
          dropEmptyGroups();
          return gid;
        }),
        ungroup: call('tabs.ungroup', (ids) => {
          for (const id of Array.isArray(ids) ? ids : [ids]) {
            const t = b.tabs.get(id);
            if (t) t.groupId = NONE;
          }
          dropEmptyGroups();
        }),
        move: call('tabs.move', () => []),
        sendMessage: call('tabs.sendMessage', () => undefined),
        onRemoved: event('tabRemoved'),
        onDetached: event('tabDetached'),
        onUpdated: event('tabUpdated'),
      },
      tabGroups: {
        TAB_GROUP_ID_NONE: NONE,
        get: call('tabGroups.get', (gid) => {
          const g = b.groups.get(gid);
          if (!g) throw new Error(`No group with id: ${gid}.`);
          return clone(g);
        }),
        update: call('tabGroups.update', (gid, info) => {
          const g = b.groups.get(gid);
          if (!g) throw new Error(`No group with id: ${gid}.`);
          Object.assign(g, info);
          return clone(g);
        }),
        query: call('tabGroups.query', (q = {}) => [...b.groups.values()]
          .filter((g) => q.windowId === undefined || g.windowId === q.windowId).map(clone)),
      },
    };
  }

  // ---- workers ----
  // Each name is read with typeof, so a build without them (origin/main's,
  // for the before-run of a proof) still loads and its tests fail on
  // behaviour, not on a ReferenceError from this block.
  const exportsSource = `
return {
  WAKE_TIMING: typeof WAKE_TIMING === 'undefined' ? undefined : WAKE_TIMING,
  wakingNow: typeof wakingNow === 'undefined' ? undefined : wakingNow,
  WAKER_ID: typeof WAKER_ID === 'undefined' ? undefined : WAKER_ID,
  kickoff: () => (typeof wakeResumeKickoff === 'undefined' ? undefined : wakeResumeKickoff),
};`;

  // `source` runs another build of background.js in this browser (a
  // downgrade check); its internals are then not read.
  function startWorker({ source: otherSource = null } = {}) {
    const worker = {
      n: b.workers.length + 1,
      dead: false,
      pending: new Set(),
      events: {
        message: [], connect: [], startup: [], installed: [], alarm: [], storageChanged: [],
        notificationClicked: [], tabRemoved: [], tabDetached: [], tabUpdated: [],
      },
    };
    worker.chrome = makeChrome(worker);
    const factory = new Function('chrome', otherSource ? otherSource : `${src}\n${exportsSource}`);
    worker.internals = factory(worker.chrome) || {};
    if (worker.internals.WAKE_TIMING) {
      Object.assign(worker.internals.WAKE_TIMING, { retryMs: 60000, settlePollMs: 5, settleQuietPolls: 10, settleMaxMs: 400 });
    }
    const track = (value) => {
      if (value && typeof value.then === 'function') {
        const p = Promise.resolve(value).catch(() => {});
        worker.pending.add(p);
        p.finally(() => worker.pending.delete(p));
      }
      return value;
    };
    const fire = (key, ...args) => {
      if (worker.dead) return Promise.resolve([]);
      return Promise.all(worker.events[key].map((fn) => track(fn(...args))));
    };
    worker.alarm = (name) => {
      const at = b.alarms.get(name);
      b.alarms.delete(name);
      return fire('alarm', at ? { ...at } : { name, scheduledTime: Date.now() });
    };
    worker.startup = () => fire('startup');
    worker.clickNotification = (id) => fire('notificationClicked', id);
    worker.installed = (details = { reason: 'update' }) => fire('installed', details);
    worker.send = (message, sender = {}) => new Promise((resolveReply) => {
      if (worker.dead) return;
      let replied = false;
      const sendResponse = (value) => {
        if (!replied) {
          replied = true;
          resolveReply(value);
        }
      };
      for (const fn of worker.events.message) track(fn(message, sender, sendResponse));
    });
    worker.kill = () => {
      worker.dead = true;
      for (const k of Object.keys(worker.events)) worker.events[k] = [];
    };
    b.workers.push(worker);
    return worker;
  }

  // ---- browser-level events ----
  b.startWorker = startWorker;
  b.liveWorkers = () => b.workers.filter((w) => !w.dead);
  b.killWorkers = () => { for (const w of b.liveWorkers()) w.kill(); };

  // A worker stop (idle timeout, crash): memory goes, storage stays.
  b.stopWorker = () => b.killWorkers();

  // An extension reload or update: the worker goes, storage.session and the
  // alarms are cleared, tabs stay.
  b.reloadExtension = () => {
    b.killWorkers();
    b.session = {};
    b.alarms.clear();
  };

  // Quit and relaunch. With `restore`, session restore brings back every
  // window and tab with new ids (from `idsFrom`, so they can collide with the
  // old ones), optionally only after `restoreDelayMs`.
  b.restart = ({ restore = true, idsFrom = 1, restoreDelayMs = 0, keep = null } = {}) => {
    b.killWorkers();
    b.session = {};
    const snapshot = [...b.windows.values()].map((w) => ({
      w: clone(w),
      tabs: windowTabs(w.id).map((t) => ({ ...clone(t), group: t.groupId !== NONE ? clone(b.groups.get(t.groupId)) : null })),
    }));
    b.windows.clear();
    b.tabs.clear();
    b.groups.clear();
    b.nextTabId = idsFrom;
    b.nextWindowId = idsFrom;
    b.nextGroupId = idsFrom;
    b.focusedWindowId = null;
    // The browser opens with one New Tab window when nothing is restored.
    const doRestore = () => {
      for (const { w, tabs } of snapshot) {
        const kept = tabs.filter((t) => !keep || keep(t));
        if (kept.length === 0) continue;
        const wid = addWindow({ incognito: w.incognito, focused: true });
        const groupMap = new Map();
        for (const t of kept) {
          let gid = NONE;
          if (t.group) {
            if (!groupMap.has(t.groupId)) {
              const ng = b.nextGroupId++;
              b.groups.set(ng, { ...t.group, id: ng, windowId: wid });
              groupMap.set(t.groupId, ng);
            }
            gid = groupMap.get(t.groupId);
          }
          addTab({ windowId: wid, url: t.url, pinned: t.pinned, groupId: gid });
        }
      }
    };
    if (!restore) {
      const wid = addWindow();
      addTab({ windowId: wid, url: 'chrome://newtab/', active: true });
    } else if (restoreDelayMs > 0) {
      const wid = addWindow();
      const placeholder = addTab({ windowId: wid, url: 'chrome://newtab/', active: true });
      setTimeout(() => {
        doRestore();
        removeTab(placeholder.id);
      }, restoreDelayMs);
    } else {
      doRestore();
    }
  };

  // The next time the worker reaches `stage`, it dies there (once).
  b.dieAt = (stage) => {
    let fired = false;
    globalThis.__huddleWakeHook = async (s) => {
      if (fired || s !== stage) return;
      fired = true;
      b.stageHits.push(s);
      b.killWorkers();
      await never();
    };
  };
  // The next time the worker reaches `stage`, it waits for the returned
  // release() (or until `run` is called, once).
  b.pauseAt = (stage, run = null) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    let fired = false;
    globalThis.__huddleWakeHook = async (s) => {
      if (fired || s !== stage) return;
      fired = true;
      b.stageHits.push(s);
      if (run) await run();
      else await gate;
    };
    return release;
  };
  b.clearHook = () => { delete globalThis.__huddleWakeHook; };

  // The next call to `name` for which `when(...args)` is true throws.
  b.failOnce = (name, when = () => true, message = `${name} failed`) => {
    (b.faults[name] = b.faults[name] || []).push((...args) => (when(...args) ? new Error(message) : null));
  };

  // Waits until no worker has touched the browser for a few ticks.
  b.settle = async ({ quietTicks = 4, maxMs = 5000 } = {}) => {
    const start = Date.now();
    let last = -1;
    let quiet = 0;
    while (Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 2));
      if (b.apiCalls === last) {
        quiet++;
        if (quiet >= quietTicks) return;
      } else {
        quiet = 0;
        last = b.apiCalls;
      }
    }
    throw new Error('the browser never settled');
  };

  // Test-side helpers that do not go through a worker.
  b.openWindow = (urls, { focused = true, incognito = false } = {}) => {
    const wid = addWindow({ focused, incognito });
    const tabs = urls.map((url) => addTab({ windowId: wid, url }));
    return { windowId: wid, tabIds: tabs.map((t) => t.id) };
  };
  b.openTab = (windowId, url, { id = null } = {}) => addTab({ windowId, url, id }).id;
  b.closeTab = (id) => removeTab(id);
  b.makeGroup = (tabIds, { title = '', color = 'grey' } = {}) => {
    const gid = b.nextGroupId++;
    b.groups.set(gid, { id: gid, windowId: b.tabs.get(tabIds[0]).windowId, title, color, collapsed: false });
    for (const id of tabIds) b.tabs.get(id).groupId = gid;
    return gid;
  };
  b.closeWindow = (id) => removeWindow(id);
  b.navigate = (id, url) => { b.tabs.get(id).url = url; };
  b.allTabs = () => [...b.tabs.values()].sort((x, y) => (x.windowId - y.windowId) || (x.index - y.index)).map(pub);
  b.urlCount = (url) => [...b.tabs.values()].filter((t) => t.url === url).length;
  b.tabsIn = (windowId) => windowTabs(windowId).map(pub);
  b.records = () => clone(b.local.snoozedItems || []);
  b.record = (id) => b.records().find((r) => r.id === id);
  b.snoozeAlarms = () => [...b.alarms.values()].filter((a) => a.name.startsWith('snooze:'));

  return b;
}
