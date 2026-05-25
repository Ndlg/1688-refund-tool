const saleTemplate = document.querySelector('#saleTemplate');
const aftersaleTemplate = document.querySelector('#aftersaleTemplate');
const refundIds = document.querySelector('#refundIds');
const openDelay = document.querySelector('#openDelay');
const results = document.querySelector('#results');
const idCount = document.querySelector('#idCount');
const linkCount = document.querySelector('#linkCount');
const statusText = document.querySelector('#status');

let links = [];
let openTimer = null;
let opening = false;

const STORAGE_KEYS = ['saleTemplate', 'aftersaleTemplate', 'refundIds', 'openDelay'];

function saveState() {
  chrome.storage.local.set({
    saleTemplate: saleTemplate.value,
    aftersaleTemplate: aftersaleTemplate.value,
    refundIds: refundIds.value,
    openDelay: openDelay.value,
  });
}

function restoreState() {
  chrome.storage.local.get(STORAGE_KEYS, (items) => {
    saleTemplate.value = items.saleTemplate || '';
    aftersaleTemplate.value = items.aftersaleTemplate || '';
    refundIds.value = items.refundIds || '';
    openDelay.value = items.openDelay || '3000';
    idCount.textContent = String(parseRefundRecords(refundIds.value).length);
  });
}

function extractRefundIds(text) {
  return [...new Set(text.match(/\bTQ\d{12,24}\b/g) || [])];
}

function parseRefundRecords(text) {
  const records = [];
  const seen = new Set();

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/\bTQ\d{12,24}\b/);
    if (!match) continue;

    const id = match[0];
    const type = line.includes('售后') ? '售后' : (line.includes('售中') ? '售中' : '');
    const key = `${id}|${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({ id, type });
  }

  return records;
}

function makeUrl(template, refundId) {
  const oldIds = extractRefundIds(template);
  if (oldIds.length) {
    let result = template;
    for (const oldId of oldIds) result = result.split(oldId).join(refundId);
    return result;
  }

  const replaced = template.replace(/(refundId=)[^&#]+/i, `$1${encodeURIComponent(refundId)}`);
  if (replaced !== template) return replaced;

  const url = new URL(template);
  url.searchParams.set('refundId', refundId);
  return url.toString();
}

function setStatus(text) {
  statusText.textContent = text;
}

function generate() {
  results.innerHTML = '';
  links = [];

  const sale = saleTemplate.value.trim();
  const aftersale = aftersaleTemplate.value.trim();
  const templates = [sale, aftersale].filter(Boolean);
  const records = parseRefundRecords(refundIds.value);

  idCount.textContent = String(records.length);
  if (!templates.length || !records.length) {
    linkCount.textContent = '0';
    setStatus('缺少模板或单号');
    return;
  }

  try {
    links = records.flatMap((record) => {
      if (record.type === '售中' && sale) {
        return [{ id: record.id, type: record.type, url: makeUrl(sale, record.id) }];
      }
      if (record.type === '售后' && aftersale) {
        return [{ id: record.id, type: record.type, url: makeUrl(aftersale, record.id) }];
      }
      return templates.map((template) => ({
        id: record.id,
        type: record.type || '未知',
        url: makeUrl(template, record.id),
      }));
    });
  } catch (error) {
    linkCount.textContent = '0';
    setStatus(`模板错误：${error.message}`);
    return;
  }

  linkCount.textContent = String(links.length);
  setStatus('已生成');

  for (const item of links) {
    const row = document.createElement('div');
    row.className = 'result';
    row.innerHTML = '<code></code><a target="_blank" rel="noopener noreferrer"></a><button type="button">打开</button>';
    row.querySelector('code').textContent = `${item.id} ${item.type}`.trim();
    const anchor = row.querySelector('a');
    anchor.href = item.url;
    anchor.textContent = item.url;
    row.querySelector('button').addEventListener('click', () => chrome.tabs.create({ url: item.url }));
    results.appendChild(row);
  }
}

function scanCurrentPage() {
  chrome.runtime.sendMessage({ type: 'codex1688:collect-ids' }, (response) => {
    const ids = response && Array.isArray(response.ids) ? response.ids : [];
    refundIds.value = ids.join('\n');
    idCount.textContent = String(ids.length);
    saveState();
    setStatus(ids.length ? '扫描完成' : '未扫描到单号');
  });
}

async function copyLinks() {
  if (!links.length) generate();
  await navigator.clipboard.writeText(links.map((item) => item.url).join('\n'));
  setStatus(`已复制 ${links.length} 条`);
}

function openAll() {
  if (!links.length) generate();
  if (!links.length || opening) return;

  const delay = Math.max(1000, Number(openDelay.value || 3000));
  let index = 0;
  opening = true;
  saveState();

  const openNext = () => {
    if (!opening || index >= links.length) {
      opening = false;
      openTimer = null;
      setStatus(`打开完成 ${index}/${links.length}`);
      return;
    }

    const item = links[index];
    chrome.tabs.create({ url: item.url, active: false });
    index += 1;
    setStatus(`正在打开 ${index}/${links.length}，间隔 ${delay} ms`);
    openTimer = setTimeout(openNext, delay);
  };

  openNext();
}

function stopOpen() {
  opening = false;
  if (openTimer) clearTimeout(openTimer);
  openTimer = null;
  setStatus('已停止打开');
}

document.querySelector('#scanPage').addEventListener('click', scanCurrentPage);
document.querySelector('#generate').addEventListener('click', generate);
document.querySelector('#copyLinks').addEventListener('click', copyLinks);
document.querySelector('#openAll').addEventListener('click', openAll);
document.querySelector('#stopOpen').addEventListener('click', stopOpen);
document.querySelector('#clear').addEventListener('click', () => {
  refundIds.value = '';
  results.innerHTML = '';
  links = [];
  idCount.textContent = '0';
  linkCount.textContent = '0';
  saveState();
  setStatus('已清空');
});

saleTemplate.addEventListener('input', saveState);
aftersaleTemplate.addEventListener('input', saveState);
openDelay.addEventListener('input', saveState);
refundIds.addEventListener('input', () => {
  idCount.textContent = String(parseRefundRecords(refundIds.value).length);
  saveState();
});

restoreState();
