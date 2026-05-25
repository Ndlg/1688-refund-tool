(function () {
  'use strict';

  const LABEL_REFUND_ID = '\u9000\u6b3e\u5355\u53f7';
  const TYPE_SALE = '\u552e\u4e2d';
  const TYPE_AFTERSALE = '\u552e\u540e';

  function extractRefundIds(text) {
    const ids = [];
    const normalized = text.replace(/\s+/g, ' ');
    const labeledPattern = new RegExp(`${LABEL_REFUND_ID}[:\uff1a]\\s*(TQ\\d{12,24})`, 'g');

    for (const match of normalized.matchAll(labeledPattern)) {
      ids.push(match[1]);
    }

    if (!ids.length) {
      ids.push(...(normalized.match(/\bTQ\d{12,24}\b/g) || []));
    }

    return [...new Set(ids)];
  }

  function extractRefundRecords(text) {
    const records = [];
    const seen = new Set();
    const lines = text.split(/\r?\n/);
    const labeledPattern = new RegExp(`${LABEL_REFUND_ID}[:\uff1a]\\s*(TQ\\d{12,24})`);

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(labeledPattern);
      if (!match) continue;

      const id = match[1];
      const context = lines.slice(index, index + 10).join(' ');
      const type = context.includes(TYPE_AFTERSALE) ? TYPE_AFTERSALE : (context.includes(TYPE_SALE) ? TYPE_SALE : '');
      const key = `${id}|${type}`;

      if (seen.has(key)) continue;
      seen.add(key);
      records.push(type ? `${id},${type}` : id);
    }

    if (records.length) return records;
    return extractRefundIds(text);
  }

  function scanIdsInThisFrame() {
    const text = document.body ? (document.body.innerText || document.body.textContent || '') : '';
    return extractRefundRecords(text);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'codex1688:scan-ids') return false;
    sendResponse({ ids: scanIdsInThisFrame() });
    return true;
  });
})();
