/* Runs in an isolated extension world, in the selected tab's frames. */
'use strict';

function inspectRefund(mode, command) {
  const norm = value => (value || '').replace(/\s+/g, ' ').trim();
  const text = node => norm(node?.innerText || node?.textContent);
  const links = [...document.links];
  const active = node => node && !node.disabled && node.getAttribute('aria-disabled') !== 'true' &&
    !node.classList.contains('disabled') && !node.classList.contains('next-disabled');
  const host = location.hostname;
  const listFrame = host === 'dispute.1688.com' && location.pathname === '/refund/sellerRefundList.htm';
  if (mode === 'list') {
    const shopNames = host === 'work.1688.com' && window === window.top
      ? [...new Set(links.filter(a => {
        if (a.protocol !== 'https:') return false;
        const rect = a.getBoundingClientRect();
        if (rect.top < 0 || rect.top >= 160 || rect.width <= 0 || rect.height <= 0) return false;
        return /^shop[a-z0-9-]+\.1688\.com$/i.test(a.hostname) ||
          (a.hostname === 'corp.1688.com' && a.pathname === '/page/index.htm' && new URL(a.href).searchParams.has('memberId'));
      }).map(text).filter(Boolean))]
      : [];
    const refundLinks = links.filter(a => a.protocol === 'https:' && a.hostname === 'dispute.1688.com' &&
      a.pathname === '/refund/sellerRefundList.htm');
    const old = refundLinks.find(a => new URL(a.href).searchParams.get('forceOldSellerRefundList') === '1');
    const statusLink = refundLinks.find(a => new URL(a.href).searchParams.get('disputeStatus') === 'waitsellerreceive');
    const count = text(statusLink).match(/[（(](\d+)[）)]/);
    const controls = [...document.querySelectorAll('button,[role=button],a,[aria-label]')];
    const name = node => norm(node.getAttribute('aria-label') || node.title || text(node));
    const next = controls.find(node => /^下一页(?:[，,]\s*当前第\d+页)?$/.test(name(node)));
    const previous = controls.find(node => /^上一页(?:[，,]\s*当前第\d+页)?$/.test(name(node)));
    const first = controls.find(node => /^第1页[，,]共\d+页$/.test(name(node)));
    const pageNodes = [...document.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label'));
    const total = pageNodes.map(label => label.match(/^第\d+页[，,]共(\d+)页$/)).find(Boolean);
    const end = pageNodes.some(label => /^已经是最后一页/.test(label));
    const statusSelected = statusLink && (statusLink.getAttribute('aria-current') === 'page' ||
      /(?:^|[\s-])(?:active|current|selected)(?=\s|$)/i.test(String(statusLink.parentElement?.className)));
    const selected = listFrame && (new URL(location.href).searchParams.get('disputeStatus') === 'waitsellerreceive' || !!statusSelected);
    const details = listFrame ? links.filter(a => text(a) === '查看详情' && /[?&]refundId=TQ\d+/.test(a.href))
      .map(a => a.href) : [];
    if (command === 'old' && old) {
      location.assign(old.href);
      return { clicked: true };
    }
    if (command === 'status' && listFrame && statusLink) { statusLink.click(); return { clicked: true }; }
    if (command && listFrame && selected && command === 'next' && active(next)) { next.click(); return { clicked: true }; }
    if (command === 'first' && listFrame && selected && active(first)) { first.click(); return { clicked: true }; }
    return {
      shopNames, host, listFrame, selected, oldUrl: old?.href || '', statusUrl: statusLink?.href || '',
      count: count ? Number(count[1]) : null, details, pages: total ? Number(total[1]) : null, end,
      next: active(next) ? name(next) : '',
      previous: active(previous) ? name(previous) : '',
      empty: /暂无(?:相关)?(?:退款|售后|订单|数据|记录)|没有找到|没有符合/.test(document.body?.innerText || ''),
    };
  }

  if (!/^(?:trade|dispute)\.1688\.com$/.test(host) ||
      !/\/(?:assureRefundDetail|aftersaleDetail)\.htm$/.test(location.pathname)) return null;
  const id = new URL(location.href).searchParams.get('refundId');
  const selector = 'td,th,dt,dd,div,p,span,label,b,strong,li';
  const elements = [...document.querySelectorAll(selector)];
  const labels = names => elements.filter(el => names.includes(text(el).replace(/[:：]\s*$/, '')) &&
    ![...el.children].some(child => names.includes(text(child).replace(/[:：]\s*$/, ''))));
  const label = names => labels(names)[0];
  const valueAfter = el => {
    if (!el) return '';
    const cell = el.closest('td,th,dt');
    const next = text(cell?.nextElementSibling || el.nextElementSibling || el.parentElement?.nextElementSibling);
    if (next && next.length <= 100) return next;
    let parent = el.parentElement;
    for (let i = 0; i < 4 && parent && parent !== document.body; i++, parent = parent.parentElement) {
      const value = text(parent).slice(text(el).length).trim();
      if (text(parent).startsWith(text(el)) && value && value.length <= 100) return value;
    }
    return '';
  };
  const tracking = label(['物流跟踪', '退货物流跟踪', '退货物流轨迹', '物流轨迹', '退货物流信息']);
  const carrier = valueAfter(label(['物流公司', '退货物流公司', '快递公司']));
  const returnLabels = labels(['退货运单号', '退货物流单号']);
  const waybillFields = returnLabels.length ? returnLabels : labels(['运单号', '物流单号']);
  const rawWaybill = [...new Set(waybillFields.map(valueAfter).filter(Boolean))].join('、');
  const numbers = (rawWaybill.match(/[A-Za-z0-9][A-Za-z0-9-]{5,39}/g) || []).filter(number => /\d/.test(number));
  const waybills = [...new Map(numbers.map(number => [number.toUpperCase(), number])).values()];
  const trackingLabel = /^(?:退货)?物流(?:跟踪|轨迹|信息)\s*[:：]?\s*/;
  const time = /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[ T]+\d{1,2}:\d{2}(?::\d{2})?/g;
  const missing = /(?:此|该)?运单[^。；\n]{0,30}超过\s*\d+\s*天[^。；\n]{0,32}不再提供[^。；\n]*|不再提供物流(?:跟踪|轨迹|信息)[^。；\n]*|暂无(?:可查询的|相关|退货)?物流(?:信息|轨迹|跟踪|记录)?|无(?:退货)?物流(?:信息|轨迹|跟踪|记录)|(?:暂)?未查(?:询)?到(?:该(?:笔)?运单的?)?物流(?:跟踪信息|信息|轨迹|记录)|(?:暂未|查询不到|查无)物流(?:信息|轨迹|记录)|暂不支持[^。；\n]{0,24}物流(?:查询|跟踪|轨迹)/;
  const loading = /加载中|正在(?:加载|查询)|请稍候|稍后再试|查询失败|系统繁忙|访问过于频繁|网络异常/;
  let trackingText = '';
  if (tracking) {
    const cell = tracking.closest('td,th,dt');
    const candidates = [
      cell?.nextElementSibling, tracking.nextElementSibling,
      tracking.parentElement?.nextElementSibling, tracking.parentElement,
      tracking.parentElement?.parentElement,
    ];
    for (const candidate of candidates) {
      if (!candidate || candidate === document.body) continue;
      const value = (candidate.innerText ?? candidate.textContent ?? '').trim().replace(trackingLabel, '');
      // The detail page also contains a separate refund-action timeline.
      if (/退款操作记录|售后操作记录|操作历史|申请售后时间|退货地址\s*[:：]|收货地址\s*[:：]|退货时间\s*[:：]|运单号\s*[:：]/.test(value)) continue;
      if (!value || value.length > 30000) continue;
      if (value.search(time) >= 0 || missing.test(value)) {
        trackingText = value;
        break;
      }
      if (!trackingText) trackingText = value;
    }
  }
  const matches = [...trackingText.matchAll(time)];
  const lines = matches.map((match, index) => {
    const message = norm(trackingText.slice(match.index + match[0].length, matches[index + 1]?.index));
    return message ? match[0] + ' ' + message : '';
  }).filter(Boolean);
  const body = document.body?.innerText || '';
  const detailLoaded = /当前(?:退款|售后)状态|买家已退货[，,]?\s*等待卖家确认收货/.test(body);
  const filled = !!(tracking || rawWaybill || label(['退货时间', '退货地址']) || detailLoaded);
  const isLoading = loading.test(trackingText);
  const explicitMissing = !isLoading && (trackingText.match(missing) ||
    norm(trackingText).match(/^(?:无物流|无轨迹|暂无轨迹|暂无记录|暂无相关记录)[。！]?$/));
  const noWaybill = detailLoaded && !waybills.length && !rawWaybill && !carrier && !tracking;
  const explicitEmptyWaybill = detailLoaded && /^(?:无|未填写|未提供|暂无|—+|-+|\/)$/.test(rawWaybill) && !lines.length;
  const noLogistics = explicitMissing?.[0] || (noWaybill || explicitEmptyWaybill ? '详情页未提供退货运单或物流' : '');
  return {
    id, filled, carrier, waybills, waybill: waybills.length === 1 ? waybills[0] : '',
    lines, noLogistics, missingConfirmed: !!explicitMissing,
    trackingText: isLoading ? '' : norm(trackingText).slice(0, 200),
    problem: waybills.length > 1 ? '页面包含多个退货运单，需要人工核对' : '',
  };
}
