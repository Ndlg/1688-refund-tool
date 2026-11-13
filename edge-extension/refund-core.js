/* Shared parsing and classification for the workbench. */
'use strict';

const RefundCore = (() => {
  const listUrl = 'https://work.1688.com/home/page/index.htm?_path_=/2017sellerbase_trade/sellerRefundList';

  function detail(input) {
    let url;
    try { url = new URL(input); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const path = {
      'trade.1688.com': '/order/refund/',
      'dispute.1688.com': '/refund/',
    }[url.hostname];
    if (!path || !['assureRefundDetail.htm', 'aftersaleDetail.htm'].some(name => url.pathname === path + name)) return null;
    const id = url.searchParams.get('refundId');
    if (!/^TQ\d{12,24}$/.test(id || '') || url.searchParams.getAll('refundId').length !== 1 ||
        url.searchParams.get('userType') !== 'seller' || url.searchParams.getAll('userType').length !== 1) return null;
    // Only accept the list's read-only detail links, including its tracking parameter.
    if ([...url.searchParams.keys()].some(key => !['refundId', 'userType', 'spm'].includes(key))) return null;
    return { id, url: url.href, kind: url.pathname.endsWith('/aftersaleDetail.htm') ? '售后' : '售中' };
  }

  function eventFromLine(line) {
    const m = String(line).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(\S[\s\S]*)$/);
    if (!m) return null;
    const pad = part => part.padStart(2, '0');
    return { at: [m[1], pad(m[2]), pad(m[3])].join('-') + ' ' +
      [pad(m[4]), m[5], m[6] || '00'].join(':'), text: m[7].trim() };
  }

  function keywords(value) {
    return [...new Set(String(value || '').split(/[\n,，;；、]+/).map(s => s.trim()).filter(Boolean))];
  }

  function classify({ carrier = '', waybill = '', waybills = waybill ? [waybill] : [], lines = [], problem = '', noLogistics = '', trackingText = '' } = {}, locations = []) {
    const events = [...new Map(lines.map(eventFromLine).filter(Boolean).map(e => [e.at + ' ' + e.text, e])).values()]
      .sort((a, b) => b.at.localeCompare(a.at));
    const latest = events[0] || { at: '', text: '' };
    const result = (state, css, reason = '', location = '—') => ({
      state, css, reason, carrier, waybill, waybills, location, ...latest,
    });
    const review = reason => result('待核实', 'review', reason);
    if (problem) return review(problem);
    if (!events.length) {
      if (noLogistics) return result('无物流', 'none', noLogistics);
      return result('读取失败', 'failed', trackingText
        ? '退货轨迹格式未识别：' + trackingText.slice(0, 180)
        : '未确认物流区是否加载完成，请重试');
    }
    const text = latest.text.replace(/\s+/g, '');
    if (events.some(e => e.at === latest.at && e.text !== latest.text)) return review('最新时间有多条不同轨迹');
    const eventText = text.split(/如有疑问|如遇问题|有问题请联系|感谢使用|期待再次为您服务/)[0];
    if (/拒收|退回寄件|已退回|正在退回|退件|已丢失|滞留|取消签收|撤销签收|签收失败|派送失败|异常签收/.test(eventText)) {
      return review('最新事件显示异常、拒收或退回');
    }
    const waiting = /未签收|待签收|未妥投|尚未签收|请签收|预计[^。]*签收|请(?:您)?(?:及时|尽快)?取件|待取件|签收码/.test(eventText);
    const pickedUp = /完成取件|已取走|已领取|取件成功|已取出|已被(?:收件人|本人|客户|用户)取件|(?:收件人|本人|客户|用户|您)已(?:在[^。]*?)?取件/.test(eventText);
    const signed = /已签收|本人签收|签收成功|签收人[：:]|妥投成功|已妥投|签收【|已由[^。]*签收|签收方式[：:]/.test(eventText);
    const pickupPoint = /代收|驿站|快递柜|自提柜|丰巢|前台|门卫/.test(eventText);
    const matched = locations.filter(word => eventText.toLowerCase().includes(word.replace(/\s+/g, '').toLowerCase()));
    if (!waiting && (pickedUp || signed)) {
      const location = matched.length ? '命中：' + matched.join('、')
        : locations.length ? '未匹配关键词' : '未设置关键词';
      return result('已签收', 'signed', pickedUp ? '退货轨迹显示已完成取件' : '', location);
    }
    if (/存放|入柜|入站|待取件/.test(eventText) && (pickupPoint || waiting)) {
      return result('尚未签收', 'transit', '已到代收点，轨迹显示待取');
    }
    if (pickupPoint && !waiting) return review('仅有代收信息，未见完成取件或签收');
    if (waiting || /揽收|已取件|已取包裹|已收取|运输|发往|到达|派送|分拣|途经|预计/.test(eventText)) {
      return result('尚未签收', 'transit');
    }
    return review('最新轨迹没有明确签收结果');
  }
  function waybillKey(number) {
    return number.replace(/\s+/g, '').toUpperCase();
  }

  function duplicateWaybills(results) {
    const counts = new Map();
    for (const result of results) {
      const keys = new Set((result.waybills || []).map(waybillKey).filter(Boolean));
      for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  return { listUrl, detail, classify, keywords, eventFromLine, waybillKey, duplicateWaybills };
})();

if (typeof module !== 'undefined') module.exports = RefundCore;
