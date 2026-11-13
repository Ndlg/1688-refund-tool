'use strict';

const core = RefundCore;
const byId = id => document.getElementById(id);
const shop = byId('shop');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const shopName = () => shop.value.replace(/\s+/g, ' ').trim();
const results = new Map();
const observations = new Map();
const selectedIds = new Set();
let locations = [];
let orders = [];
let running = false;
let stopped = false;
let latestRun = '';
let windowId;
let dashboardId;
let expectedName = '';
let found = 0;
let reused = 0;
let opened = 0;

function status(message) {
  latestRun = message;
  byId('progress').textContent = message;
}

function visibleOrders() {
  const filter = byId('resultFilter').value;
  return filter ? orders.filter(order => (results.get(order.id)?.state || '未检查') === filter) : orders;
}

function refreshSelection() {
  const visible = visibleOrders();
  const visibleSelected = visible.filter(order => selectedIds.has(order.id)).length;
  const selectVisible = byId('selectVisible');
  selectVisible.checked = visible.length > 0 && visibleSelected === visible.length;
  selectVisible.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
  selectVisible.disabled = running || !visible.length;
  byId('openSelected').disabled = running || !selectedIds.size;
  byId('clearSelection').disabled = running || !selectedIds.size;
  byId('selectedCount').textContent = '已选 ' + selectedIds.size + ' 单' +
    (visibleSelected < selectedIds.size ? '（含筛选外 ' + (selectedIds.size - visibleSelected) + ' 单）' : '');
  for (const box of byId('rows').querySelectorAll('input[type="checkbox"]')) box.disabled = running;
}

function refreshControls() {
  shop.disabled = running;
  byId('run').disabled = running || !shopName();
  byId('scan').disabled = running || !shopName();
  byId('stop').disabled = !running || stopped;
  byId('retry').disabled = running || !orders.some(order => !results.has(order.id) || results.get(order.id).css === 'failed');
  byId('copy').disabled = running || !results.size;
  byId('locationKeywords').disabled = running || !shopName();
  byId('saveLocations').disabled = running || !shopName();
  refreshSelection();
}

function render() {
  const body = byId('rows');
  const waybillCounts = core.duplicateWaybills(results.values());
  body.replaceChildren();
  for (const order of visibleOrders()) {
    const result = results.get(order.id);
    const row = body.insertRow();
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selectedIds.has(order.id);
    box.setAttribute('aria-label', '选择退款单 ' + order.id);
    box.addEventListener('change', () => {
      if (box.checked) selectedIds.add(order.id);
      else selectedIds.delete(order.id);
      refreshSelection();
    });
    row.insertCell().append(box);
    const link = document.createElement('a');
    link.href = order.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = order.id;
    row.insertCell().append(link);
    const state = row.insertCell();
    state.className = result?.css || 'muted';
    state.textContent = result?.state || '未检查';
    row.insertCell().textContent = result?.location || '—';
    row.insertCell().textContent = result?.at || '—';
    row.insertCell().textContent = result?.carrier || '—';
    const waybillCell = row.insertCell();
    if (!result?.waybills?.length) {
      waybillCell.textContent = !result ? '未读取' : result.state === '读取失败' ? '读取失败' : '未取得运单号';
    }
    for (const number of result?.waybills || []) {
      const count = waybillCounts.get(core.waybillKey(number));
      const entry = document.createElement('span');
      entry.className = count > 1 ? 'waybill-number waybill-duplicate' : 'waybill-number';
      entry.textContent = number + (count > 1 ? '（重复 ' + count + ' 单）' : '');
      if (count > 1) row.classList.add('duplicate-waybill');
      waybillCell.append(entry);
    }
    row.insertCell().textContent = [result?.reason, result?.text].filter(Boolean).join(' · ') || '—';
  }
  refreshControls();
}

function report(prefix) {
  const tally = [...results.values()].reduce((counts, item) => {
    counts[item.state] = (counts[item.state] || 0) + 1;
    return counts;
  }, {});
  const checked = results.size - (tally['读取失败'] || 0);
  status(expectedName + ' · ' + prefix + '\n' +
    '找到 ' + found + ' 单 · 新开 ' + opened + ' · 复用 ' + reused + ' · 已读取 ' + checked + '\n' +
    '已签收 ' + (tally['已签收'] || 0) + ' · 尚未签收 ' + (tally['尚未签收'] || 0) +
    ' · 无物流 ' + (tally['无物流'] || 0) + ' · 待核实 ' + (tally['待核实'] || 0) + ' · 读取失败 ' + (tally['读取失败'] || 0) +
    ' · 未检查 ' + (found - results.size));
}

function checkStopped() {
  if (stopped) throw new Error('已停止');
}

async function bounded(operation, milliseconds) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('页面响应超时')), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function inspect(tabId, mode, command, frameId) {
  const target = frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] };
  const response = await bounded(chrome.scripting.executeScript({
    target, func: inspectRefund, args: [mode, command || ''],
  }), 3500);
  return response.filter(frame => frame.result).map(frame => ({ ...frame.result, frameId: frame.frameId }));
}

async function withAwakeTab(tabId, operation) {
  const before = (await chrome.tabs.query({ windowId, active: true }))[0];
  if (before?.id !== dashboardId) throw new Error('请切回工作台以唤醒休眠页面');
  await chrome.tabs.update(tabId, { active: true });
  try { return await operation(); }
  finally {
    const current = (await chrome.tabs.query({ windowId, active: true }))[0];
    if (current?.id === tabId) await chrome.tabs.update(dashboardId, { active: true });
  }
}

function workbenchList(tab) {
  try {
    const url = new URL(tab.url);
    return url.origin === 'https://work.1688.com' && /\/sellerRefundList$/.test(url.searchParams.get('_path_') || '');
  } catch { return false; }
}

async function waitList(tabId, predicate, timeout = 25000) {
  const end = Date.now() + timeout;
  let lastError;
  let lastFrames = [];
  while (Date.now() < end) {
    checkStopped();
    try {
      const frames = await inspect(tabId, 'list');
      lastFrames = frames;
      const candidates = frames.flatMap(frame => frame.shopNames || []);
      if (candidates.length && !candidates.includes(expectedName)) throw new Error('店铺不符，停止检查');
      const result = predicate(frames);
      if (result) return result;
    } catch (error) {
      if (error.message === '店铺不符，停止检查') throw error;
      lastError = error;
    }
    await pause(500);
  }
  const hints = lastFrames.map(f => [f.host, f.shopNames?.join(' / '), f.oldUrl ? '新版' : '', f.listFrame ? '旧版' : '',
    f.statusUrl ? '有目标筛选' : '', f.selected ? '已选中' : ''].filter(Boolean).join(' / '));
  throw new Error(lastError ? '读取列表超时。请检查店铺登录和插件网站访问权限。' :
    '等待旧版退款列表超时。' + [...new Set(hints)].join('，'));
}

async function scanList(awake = false) {
  const tabs = await chrome.tabs.query({ windowId });
  let tab = tabs.find(workbenchList);
  if (!tab) tab = await chrome.tabs.create({ windowId, url: core.listUrl, active: false });

  let frames;
  try {
    frames = await waitList(tab.id, value => value.some(frame => frame.shopNames?.includes(expectedName)) &&
      value.some(frame => frame.oldUrl || frame.statusUrl || frame.selected) && value, awake ? 25000 : 4500);
  } catch (error) {
    if (awake || stopped || error.message === '店铺不符，停止检查') throw error;
    return withAwakeTab(tab.id, () => scanList(true));
  }
  const old = frames.find(frame => frame.oldUrl);
  if (old && !frames.some(frame => frame.listFrame && frame.statusUrl)) {
    status(expectedName + ' · 切换到旧版退款列表');
    const action = await inspect(tab.id, 'list', 'old', old.frameId);
    if (!action.some(frame => frame.clicked)) throw new Error('无法切回旧版退款列表');
    frames = await waitList(tab.id, value => value.some(frame => frame.listFrame && frame.statusUrl) && value);
  }
  let page = frames.find(frame => frame.listFrame && frame.selected);
  const entry = frames.find(frame => frame.listFrame && frame.statusUrl);
  if (!page && entry) {
    const action = await inspect(tab.id, 'list', 'status', entry.frameId);
    if (!action.some(frame => frame.clicked)) throw new Error('无法选择待卖家确认收货');
    page = await waitList(tab.id, value => value.find(frame => frame.listFrame && frame.selected &&
      (frame.details.length || frame.empty)));
  }
  if (!page) throw new Error('未找到旧版「待卖家确认收货」筛选');
  if (page.previous) {
    const action = await inspect(tab.id, 'list', 'first', page.frameId);
    if (!action.some(frame => frame.clicked)) throw new Error('无法返回筛选列表第一页');
    page = await waitList(tab.id, value => value.find(frame => frame.listFrame && frame.selected && !frame.previous &&
      (frame.details.length || frame.empty)));
  }

  const expected = page.count ?? entry?.count;
  const collected = new Map();
  for (let number = 1; ; number++) {
    checkStopped();
    if (number > 200) throw new Error('分页超过 200 页，请检查是否选对筛选');
    status(expectedName + ' · 读取待卖家确认收货第 ' + number + ' 页');
    for (const url of page.details) {
      const item = core.detail(url);
      if (!item) throw new Error('发现无法确认安全的详情地址，请在列表中核查');
      if (collected.has(item.id) && collected.get(item.id).kind !== item.kind) throw new Error('同一退款单号出现不同详情类型');
      collected.set(item.id, item);
    }
    if (!page.next || (expected !== null && expected !== undefined && collected.size === expected && page.end)) break;
    const previousIds = page.details.join('\n');
    const action = await inspect(tab.id, 'list', 'next', page.frameId);
    if (!action.some(frame => frame.clicked)) throw new Error('无法翻到下一页');
    page = await waitList(tab.id, value => value.find(frame => frame.listFrame && frame.selected &&
      frame.details.length && frame.details.join('\n') !== previousIds));
  }
  if (expected !== null && expected !== undefined && collected.size !== expected) {
    throw new Error('列表显示 ' + expected + ' 单，实际识别 ' + collected.size + ' 单，请核查分页后重试');
  }
  if (!collected.size && !page.empty && expected !== 0) throw new Error('没有读取到订单，请核查当前筛选');
  if (!page.end && page.pages > 1 && expected == null) throw new Error('无法确认分页已读完');
  return [...collected.values()];
}

async function inspectOrder(tabId, order, awake = false) {
  const end = Date.now() + (awake ? 15000 : 4500);
  let partial;
  while (Date.now() < end) {
    checkStopped();
    const tab = await chrome.tabs.get(tabId);
    const target = core.detail(tab.url || '');
    if (!awake && (tab.discarded || tab.frozen || tab.status === 'unloaded')) break;
    if (tab.status === 'complete' && target?.id === order.id && target.kind === order.kind) {
      try {
        const data = (await inspect(tabId, 'detail')).find(frame => frame.id === order.id && frame.filled);
        if (data) {
          partial = data;
          if (data.lines.length || data.problem || data.missingConfirmed) return data;
        }
      } catch (error) {
        if (!awake && error.message === '页面响应超时') break;
      }
    }
    await pause(550);
  }
  if (!awake) return withAwakeTab(tabId, () => inspectOrder(tabId, order, true));
  if (partial) return partial;
  throw new Error('未读到该退款单的退货物流区，请检查登录、限流或页面加载');
}

async function openDetail(order, batch) {
  const key = order.id + '/' + order.kind;
  const existingId = batch.existing.get(key);
  if (existingId !== undefined) return { tabId: existingId, created: false };
  const wait = 3000 - (Date.now() - batch.lastOpened);
  if (wait > 0) await pause(wait);
  checkStopped();
  const tab = await chrome.tabs.create({ windowId, url: order.url, active: false });
  batch.existing.set(key, tab.id);
  batch.lastOpened = Date.now();
  return { tabId: tab.id, created: true };
}

async function work(mode) {
  if (running || !shopName()) return;
  const retry = mode === 'retry';
  const selectionOnly = mode === 'selected';
  const chosen = selectionOnly ? orders.filter(order => selectedIds.has(order.id)) : [];
  if (selectionOnly && !chosen.length) return;
  running = true;
  stopped = false;
  expectedName = shopName();
  const batchStatus = byId('batchStatus');
  batchStatus.textContent = selectionOnly ? '准备打开 ' + chosen.length + ' 单' : '';
  if (!selectionOnly) status(expectedName + ' · 正在核对旧版退款列表');
  refreshControls();
  // A lock is scoped to this Edge profile, so the other profile can run independently.
  const runInProfile = async lock => {
    if (!lock) {
      if (selectionOnly) batchStatus.textContent = '这个配置已有任务在运行';
      else status('这个配置已有任务在运行');
      return;
    }
    let selectedOpened = 0;
    let selectedReused = 0;
    const selectedFailures = [];
    const batchReport = prefix => {
      batchStatus.textContent = prefix + ' · 共 ' + chosen.length + ' 单 · 新开 ' + selectedOpened +
        ' · 已打开 ' + selectedReused + ' · 打开失败 ' + selectedFailures.length +
        (selectedFailures.length ? '（' + selectedFailures.join('；') + '）' : '');
    };
    try {
      const dashboard = await chrome.tabs.getCurrent();
      windowId = dashboard.windowId;
      dashboardId = dashboard.id;
      await chrome.storage.local.set({ workbenchShopName: expectedName });
      await loadLocations();
      if (!retry && !selectionOnly) {
        orders = [];
        results.clear();
        observations.clear();
        selectedIds.clear();
        byId('resultFilter').value = '';
        found = reused = opened = 0;
        render();
        orders = await scanList();
        found = orders.length;
        render();
      }
      if (!found) { report('当前没有待确认收货订单'); return; }
      if (mode === 'scan') { report('扫描完成，勾选订单后可批量打开'); return; }
      const tabs = await chrome.tabs.query({ windowId });
      const existing = new Map();
      for (const tab of tabs) {
        const item = core.detail(tab.pendingUrl || tab.url || '');
        if (item) existing.set(item.id + '/' + item.kind, tab.id);
      }
      const batch = { existing, lastOpened: 0 };
      for (const order of selectionOnly ? chosen : orders) {
        checkStopped();
        if (retry && results.has(order.id) && results.get(order.id).css !== 'failed') continue;
        if (!selectionOnly) report('读取 ' + order.id);
        try {
          const { tabId, created } = await openDetail(order, batch);
          if (selectionOnly) {
            if (created) selectedOpened++;
            else selectedReused++;
            batchReport('正在打开');
            continue;
          }
          if (created) opened++;
          else if (!retry) reused++;
          const observation = await inspectOrder(tabId, order);
          observations.set(order.id, observation);
          results.set(order.id, core.classify(observation, locations));
        } catch (error) {
          if (stopped) throw error;
          if (selectionOnly) {
            selectedFailures.push(order.id + '：' + error.message);
            batchReport('正在打开');
            continue;
          }
          results.set(order.id, { state: '读取失败', css: 'failed', reason: error.message });
        }
        render();
      }
      if (selectionOnly) batchReport('批量打开完成');
      else report('检查完成');
    } catch (error) {
      if (selectionOnly) {
        if (stopped) batchReport('已停止批量打开');
        else batchStatus.textContent = '批量打开失败：' + error.message;
      } else if (stopped) report('已停止');
      else status(expectedName + ' · ' + error.message);
    }
  };
  try { await navigator.locks.request('1688-refund-workbench', { ifAvailable: true }, runInProfile); }
  catch (error) {
    if (selectionOnly) batchStatus.textContent = error.message;
    else status(error.message);
  }
  finally { running = false; refreshControls(); }
}

async function loadLocations() {
  const key = shopName();
  const setting = 'refundLocations:' + key;
  const saved = key ? (await chrome.storage.local.get(setting))[setting] : '';
  if (shopName() !== key) return;
  byId('locationKeywords').value = typeof saved === 'string' ? saved : '';
  locations = core.keywords(byId('locationKeywords').value);
  byId('settingsStatus').textContent = '按店铺保存，匹配最新签收或取件轨迹。';
}

shop.addEventListener('change', async () => {
  orders = [];
  results.clear();
  observations.clear();
  selectedIds.clear();
  byId('resultFilter').value = '';
  byId('batchStatus').textContent = '';
  found = opened = reused = 0;
  render();
  status('就绪');
  await loadLocations().catch(error => { byId('settingsStatus').textContent = '读取关键词失败：' + error.message; });
});
shop.addEventListener('input', () => {
  if (expectedName && shopName() !== expectedName) {
    orders = [];
    results.clear();
    observations.clear();
    selectedIds.clear();
    found = opened = reused = 0;
    byId('resultFilter').value = '';
    byId('batchStatus').textContent = '';
    expectedName = '';
    render();
    status('就绪');
  } else refreshControls();
});
byId('saveLocations').addEventListener('click', async () => {
  const key = shopName();
  if (!key || running) return;
  const next = core.keywords(byId('locationKeywords').value);
  const value = next.join('，');
  try {
    await chrome.storage.local.set({ ['refundLocations:' + key]: value });
    if (shopName() !== key) return;
    locations = next;
    byId('locationKeywords').value = value;
    for (const [id, observation] of observations) results.set(id, core.classify(observation, locations));
    render();
    byId('settingsStatus').textContent = next.length ? '已保存 ' + next.length + ' 个关键词。' : '已清空地点关键词。';
  } catch (error) { byId('settingsStatus').textContent = '保存失败：' + error.message; }
});
byId('resultFilter').addEventListener('change', render);
byId('selectVisible').addEventListener('change', event => {
  for (const order of visibleOrders()) {
    if (event.target.checked) selectedIds.add(order.id);
    else selectedIds.delete(order.id);
  }
  render();
});
byId('clearSelection').addEventListener('click', () => { selectedIds.clear(); render(); });
byId('openSelected').addEventListener('click', () => work('selected'));
byId('scan').addEventListener('click', () => work('scan'));
byId('run').addEventListener('click', () => work('check'));
byId('retry').addEventListener('click', () => work('retry'));
byId('stop').addEventListener('click', () => { stopped = true; refreshControls(); });
byId('copy').addEventListener('click', async () => {
  const safe = v => String(v || '').replace(/[\t\r\n]+/g, ' ').replace(/^[=+\-@]/, "'$&");
  const counts = core.duplicateWaybills(results.values());
  const lines = [['店铺', '退款单号', '结果', '地点匹配', '物流公司', '退货运单号', '重复运单号', '最新轨迹时间', '最新轨迹', '原因', '详情链接']];
  for (const order of orders) {
    const r = results.get(order.id) || {};
    const numbers = r.waybills || [];
    const repeated = numbers.filter(number => counts.get(core.waybillKey(number)) > 1);
    lines.push([expectedName, order.id, r.state || '未检查', r.location, r.carrier, numbers.join('、'),
      repeated.join('、'), r.at, r.text, r.reason, order.url]);
  }
  try {
    await navigator.clipboard.writeText(lines.map(row => row.map(safe).join('\t')).join('\n'));
    byId('progress').textContent = latestRun + '\n结果已复制';
  } catch (error) { byId('progress').textContent = latestRun + '\n复制失败：' + error.message; }
});

refreshControls();
chrome.storage.local.get('workbenchShopName').then(items => {
  if (!shop.value && typeof items.workbenchShopName === 'string') shop.value = items.workbenchShopName;
  refreshControls();
  return loadLocations();
}).catch(error => { byId('settingsStatus').textContent = '读取店铺设置失败：' + error.message; });
