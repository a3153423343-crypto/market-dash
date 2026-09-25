import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';
dns.setDefaultResultOrder('ipv4first');

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8899);
/* 0.0.0.0 = 局域网/隧道都能访问；设 BIND=127.0.0.1 可只允许本机 */
const HOST = process.env.BIND || '0.0.0.0';
const TOKEN = process.env.TOKEN || '';
const REFRESH_MS = 60 * 1000;

const EM_HOSTS = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com', 'https://1.push2.eastmoney.com', 'https://82.push2.eastmoney.com'];
let emHost = EM_HOSTS[0];

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0 Safari/537.36',
  'Referer': 'https://quote.eastmoney.com/',
  'Accept': '*/*'
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getText(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
      const t = await r.text();
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return t;
    } catch (e) { lastErr = e; await sleep(400 * (i + 1)); }
  }
  throw lastErr;
}

/* try every mirror until one answers; remember the winner */
async function emGet(qs) {
  const order = [emHost].concat(EM_HOSTS.filter(h => h !== emHost));
  let lastErr;
  for (const h of order) {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetch(h + '/api/qt/' + qs, { headers: UA, signal: AbortSignal.timeout(15000) });
        const t = await r.text();
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = JSON.parse(t);
        if (emHost !== h) { console.log('  mirror switch -> ' + h); emHost = h; }
        return j;
      } catch (e) { lastErr = e; await sleep(300); }
    }
  }
  throw lastErr;
}
async function getJson(url) { return JSON.parse(await getText(url)); }

/* 用户指定的 38 个板块（display, 东财板块代码, 类型）。第 25 项"模块"待确认 */
const WATCH = [
  ['通信技术','BK1650','概念'],['CPO','BK1128','概念'],['光模块','BK1136','概念'],['国产芯片','BK0891','概念'],
  ['半导体','BK1036','行业'],['数据中心','BK0922','概念'],['存储芯片','BK1137','概念'],['先进封装','BK1101','概念'],
  ['创新药','BK1106','概念'],['商业航天','BK0963','概念'],['电力','BK0428','行业'],['算力概念','BK1134','概念'],
  ['光学光电子','BK1038','行业'],['MLCC','BK0890','概念'],['白酒','BK0896','概念'],['玻璃基板','BK1175','概念'],
  ['消费电子','BK1037','行业'],['物流','BK0422','行业'],['煤炭','BK0437','行业'],['黄金','BK1617','行业'],
  ['旅游','BK1272','行业'],['电网设备','BK0457','行业'],['稀土','BK1626','行业'],['游戏','BK1046','行业'],['生猪','BK1512','行业'],
  ['化工','BK1206','行业'],['银行','BK1283','行业'],['证券II','BK0473','行业'],['军工','BK0490','概念'],
  ['低空经济','BK1166','概念'],['有色金属','BK0478','行业'],['人形机器人','BK1184','概念'],['AI应用','BK1629','概念'],
  ['元件','BK0459','行业'],['储能概念','BK0989','概念'],['PCB','BK0877','概念'],['锂电池概念','BK0574','概念'],
  ['电力设备','BK1200','行业']
];

async function fetchWatch() {
  const secids = WATCH.map(w => '90.' + w[1]).join(',');
  const j = await emGet('ulist.np/get?fltt=2&invt=2&secids=' + secids + '&fields=f12,f14,f2,f3,f62,f184,f164,f174');
  const diff = (j.data && j.data.diff) || [];
  const byCode = {};
  for (const x of diff) byCode[x.f12] = x;
  const rows = WATCH.map(function (w) {
    const x = byCode[w[1]];
    if (!x) return { name: w[0], code: w[1], kind: w[2], main: null, err: 'no data' };
    return { name: w[0], code: w[1], kind: w[2], realName: x.f14, idx: x.f2, pct: x.f3, main: x.f62, mainPct: x.f184, d5: x.f164, d10: x.f174 };
  });
  rows.sort((a, b) => (b.main === null ? -1e18 : b.main) - (a.main === null ? -1e18 : a.main));
  return rows;
}

/* 抓 38 个板块当日的分时资金流（每分钟的当日累计主力净额），供前端时间轴回放 */
async function fetchSeries(codes) {
  const out = {};
  let i = 0;
  const worker = async () => {
    while (i < codes.length) {
      const c = codes[i++];
      try {
        const j = await emGet('stock/fflow/kline/get?lmt=0&klt=1&secid=90.' + c + '&fields1=f1,f2,f3,f7&fields2=f51,f52');
        const k = (j.data && j.data.klines) || [];
        out[c] = k.map(function (line) { const p = line.split(','); return { t: p[0].slice(11), v: Number(p[1]) }; });
      } catch (e) { out[c] = []; }
      await sleep(25);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  return out;
}
function buildSeries(map) {
  let times = [];
  for (const w of WATCH) { const s = map[w[1]]; if (s && s.length > times.length) times = s.map(function (x) { return x.t; }); }
  const series = WATCH.map(function (w) {
    const s = map[w[1]] || [];
    const vals = times.map(function (t, idx) { return idx < s.length ? s[idx].v : (s.length ? s[s.length - 1].v : null); });
    return { name: w[0], code: w[1], kind: w[2], vals: vals };
  });
  return { times: times, series: series };
}

const SECTOR_FIELDS = 'f12,f14,f2,f3,f62,f184,f66,f72,f78,f84,f164,f165,f174,f175';
function mapSector(d) {
  return { code: d.f12, name: d.f14, idx: d.f2, pct: d.f3, main: d.f62, mainPct: d.f184,
    xlarge: d.f66, large: d.f72, mid: d.f78, small: d.f84, d5: d.f164, d5p: d.f165, d10: d.f174, d10p: d.f175 };
}
/* the API caps page size at 100, so walk pages until exhausted */
async function fetchSectors(fsParam) {
  const out = [];
  const seen = new Set();
  let total = Infinity;
  for (let pn = 1; pn <= 12; pn++) {
    const j = await emGet('clist/get?pn=' + pn + '&pz=100&po=1&np=1&fltt=2&invt=2&fid=f62&fs=' + fsParam + '&fields=' + SECTOR_FIELDS);
    const d = j.data || {};
    if (typeof d.total === 'number') total = d.total;
    const diff = d.diff || [];
    if (!diff.length) break;
    for (const raw of diff) {
      const r = mapSector(raw);
      if (!r.name || typeof r.main !== 'number' || seen.has(r.code)) continue;
      seen.add(r.code); out.push(r);
    }
    if (diff.length < 100 || out.length >= total) break;
    await sleep(120);
  }
  return out;
}
function summarize(rows) {
  let sum = 0, up = 0, down = 0;
  for (const r of rows) { sum += r.main; if (r.main > 0) up++; else if (r.main < 0) down++; }
  return { count: rows.length, totalMain: sum, inflowCount: up, outflowCount: down };
}

const A_INDEX = [['1.000001', '上证指数'], ['0.399001', '深证成指'], ['0.399006', '创业板指'], ['1.000688', '科创50']];
async function fetchAIndex() {
  const out = [];
  for (const [secid, label] of A_INDEX) {
    try {
      const j = await emGet('stock/get?secid=' + secid + '&fltt=2&invt=2&fields=f43,f58,f169,f170,f48');
      const d = j.data; if (!d) { out.push({ label, err: 'no data' }); continue; }
      out.push({ label, name: d.f58, last: d.f43, pct: d.f170, chg: d.f169, amount: d.f48 });
    } catch (e) { out.push({ label, err: String(e.message).slice(0, 40) }); }
    await sleep(60);
  }
  return out;
}

/* ---------- 美股：三层结构（指数 / 大型公司 / 板块） ---------- */
const US_SYMBOLS = [
  /* 指数 */
  ['100','SPX','标普500','index'],
  ['100','NDX100','纳斯达克100','index'],
  ['100','NDX','纳斯达克综指','index'],
  ['100','DJIA','道琼斯','index'],
  ['107','IWM','罗素2000(ETF)','index'],
  ['105','SMH','费城半导体(ETF)','index'],
  /* 大型公司 */
  ['105','NVDA','英伟达','mega'], ['105','MSFT','微软','mega'], ['105','AAPL','苹果','mega'],
  ['105','GOOGL','谷歌-A','mega'], ['105','AMZN','亚马逊','mega'], ['105','META','Meta','mega'],
  ['105','AVGO','博通','mega'], ['105','TSLA','特斯拉','mega'], ['105','AMD','AMD','mega'],
  ['105','MU','美光','mega'], ['105','NFLX','奈飞','mega'], ['105','PLTR','Palantir','mega'],
  ['106','TSM','台积电','mega'], ['106','V','Visa','mega'], ['106','JPM','摩根大通','mega'],
  ['106','XOM','埃克森美孚','mega'], ['106','UNH','联合健康','mega'], ['106','LLY','礼来','mega'],
  /* 宽基 */
  ['107','SPY','标普500','broad'], ['105','QQQ','纳指100','broad'], ['107','DIA','道琼斯','broad'], ['107','IWM','罗素2000','broad'],
  /* 11 个 SPDR 行业 */
  ['107','XLK','科技','sector'], ['107','XLC','通信服务','sector'], ['107','XLY','可选消费','sector'],
  ['107','XLP','日常消费','sector'], ['107','XLF','金融','sector'], ['107','XLV','医疗保健','sector'],
  ['107','XLI','工业','sector'], ['107','XLE','能源','sector'], ['107','XLU','公用事业','sector'],
  ['107','XLB','基础材料','sector'], ['107','XLRE','房地产','sector'],
  /* 细分行业 */
  ['105','SMH','半导体','theme'], ['107','IGV','软件','theme'], ['107','HACK','网络安全','theme'],
  ['107','XBI','生物科技','theme'], ['107','KRE','区域银行','theme'], ['107','XOP','油气开采','theme'],
  ['107','GDX','黄金矿业','theme'], ['107','ITB','房屋建筑','theme'], ['107','JETS','航空','theme'],
  ['107','TAN','太阳能','theme'], ['107','LIT','锂电池','theme'], ['105','BOTZ','机器人与AI','theme'],
  ['107','URA','铀与核能','theme'], ['107','ARKK','颠覆创新','theme'],
  /* 恐慌指数相关 ETF（VIX 指数本身来自 CBOE 接口） */
  ['107','VIXY','恐慌指数期货ETF','vixetf'], ['107','SVXY','做空波动率ETF','vixetf']
];

/* 批量取美股报价：东财 stock/get 逐个取容易被重置连接，ulist.np 一次拿全部 */
const US_FIELDS = 'f2,f3,f4,f5,f6,f7,f8,f10,f12,f13,f14,f15,f16,f17,f18,f20';
async function fetchUsQuotesBatch() {
  const secids = [];
  for (const s of US_SYMBOLS) { const k = s[0] + '.' + s[1]; if (secids.indexOf(k) < 0) secids.push(k); }
  const j = await emGet('ulist.np/get?fltt=2&invt=2&secids=' + secids.join(',') + '&fields=' + US_FIELDS);
  const diff = (j && j.data && j.data.diff) || [];
  const by = {};
  for (const d of diff) by[d.f13 + '.' + d.f12] = d;
  return by;
}

/* VIX 分时（CBOE 官方，390 个分钟点）与日线历史（1990 至今） */
let vixIntraCache = { at: 0, data: null };
async function fetchVixIntraday() {
  if (vixIntraCache.data && (Date.now() - vixIntraCache.at) < 5 * 60 * 1000) return vixIntraCache.data;
  try {
    const r = await fetch('https://cdn.cboe.com/api/global/delayed_quotes/charts/intraday/_VIX.json', { headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(20000) });
    if (r.ok) {
      const j = await r.json();
      const d = (j.data || []).map(function (x) { return { t: x.datetime, c: x.price ? x.price.close : 0 }; }).filter(function (x) { return x.c > 0; });
      vixIntraCache = { at: Date.now(), data: d };
      return d;
    }
  } catch (e) {}
  return vixIntraCache.data || [];
}
let vixHistCache = { at: 0, data: null };
async function fetchVixHist() {
  if (vixHistCache.data && (Date.now() - vixHistCache.at) < 12 * 3600 * 1000) return vixHistCache.data;
  try {
    const r = await fetch('https://cdn.cboe.com/api/global/delayed_quotes/charts/historical/_VIX.json', { headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(25000) });
    if (r.ok) {
      const j = await r.json();
      const m = {};
      for (const row of (j.data || [])) { const v = parseFloat(row.close); if (isFinite(v) && v > 0) m[row.date] = v; }
      vixHistCache = { at: Date.now(), data: m };
      return m;
    }
  } catch (e) {}
  return vixHistCache.data || {};
}

/* VIX 恐慌指数：CBOE 官方延迟报价接口；失败则回退到 FRED 收盘值 */
async function fetchVix() {
  try {
    const r = await fetch('https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json', {
      headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const d = j.data || {};
    if (typeof d.current_price !== 'number') throw new Error('no price');
    return { source: 'CBOE', time: j.timestamp, last: d.current_price, chg: d.price_change, pct: d.price_change_percent, prev: d.prev_day_close, high: d.high, low: d.low, open: d.open };
  } catch (e) {
    return { source: 'none', err: String(e && e.message ? e.message : e).slice(0, 60) };
  }
}

async function fetchUS() {
  let by = {};
  for (let a = 0; a < 4; a++) {
    try { by = await fetchUsQuotesBatch(); if (Object.keys(by).length) break; } catch (e) { await sleep(700 * (a + 1)); }
  }
  const rows = US_SYMBOLS.map(function (sym, my) {
    const d = by[sym[0] + '.' + sym[1]];
    const base = { prefix: sym[0], ticker: sym[1], cn: sym[2], group: sym[3], ord: my };
    if (!d || typeof d.f2 !== 'number') return Object.assign(base, { err: 'no data' });
    return Object.assign(base, {
      name: d.f14, last: d.f2, prev: d.f18, chg: d.f4, pct: d.f3,
      amount: d.f6, volume: d.f5, volRatio: d.f10, turnover: d.f8, mcap: d.f20,
      high: d.f15, low: d.f16, open: d.f17, amp: d.f7
    });
  });
  const spy = rows.find(function (x) { return x.ticker === 'SPY'; });
  if (spy && typeof spy.pct === 'number') {
    for (const x of rows) if (typeof x.pct === 'number') x.rel = +(x.pct - spy.pct).toFixed(2);
  }
  const g = function (name) { return rows.filter(function (x) { return x.group === name; }); };
  const byPct = function (a, b) { return (b.pct === undefined ? -999 : b.pct) - (a.pct === undefined ? -999 : a.pct); };
  const byAmt = function (a, b) { return (b.amount || 0) - (a.amount || 0); };
  /* 一律按涨跌幅从高到低：涨的在前，跌的在后 */
  return {
    indices: g('index').sort(byPct),
    mega: g('mega').sort(byPct),
    broad: g('broad').sort(byPct),
    sectors: g('sector').sort(byPct),
    thematic: g('theme').sort(byPct),
    vixetf: g('vixetf').sort(byPct),
    ok: rows.filter(function (x) { return !x.err; }).length,
    total: rows.length
  };
}

async function fetchMarketFlow() {
  try {
    const j = await emGet('stock/fflow/kline/get?lmt=0&klt=1&secid=1.000001&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56');
    const k = (j.data && j.data.klines) || [];
    if (!k.length) return null;
    const p = k[k.length - 1].split(',');
    return { time: p[0], main: +p[1], small: +p[2], mid: +p[3], large: +p[4], xlarge: +p[5], points: k.length };
  } catch (e) { return null; }
}

async function fredLast(series) {
  try {
    const d = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const txt = await getText('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + series + '&cosd=' + d);
    const lines = txt.trim().split(/\r?\n/).slice(1);
    for (let i = lines.length - 1; i >= 0; i--) {
      const parts = lines[i].split(',');
      const v = parts[1];
      if (v && v !== '.' && v !== '') return { date: parts[0], value: parseFloat(v) };
    }
    return null;
  } catch (e) { return null; }
}
async function fetchMacro() {
  const [dgs10, dgs2, t10y2y, vix, hy] = await Promise.all([fredLast('DGS10'), fredLast('DGS2'), fredLast('T10Y2Y'), fredLast('VIXCLS'), fredLast('BAMLH0A0HYM2')]);
  return { dgs10, dgs2, t10y2y, vix, hyOas: hy };
}
async function fetchUsdCny() {
  try { const j = await getJson('https://api.frankfurter.app/latest?from=USD&to=CNY'); return { date: j.date, rate: j.rates && j.rates.CNY }; } catch (e) { return null; }
}

function marketStatus(now) {
  const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  const day = bj.getDay(), hm = bj.getHours() * 100 + bj.getMinutes();
  const weekday = day >= 1 && day <= 5;
  const aOpen = weekday && ((hm >= 930 && hm <= 1130) || (hm >= 1300 && hm <= 1500));
  const usOpen = (day >= 1 && day <= 5 && hm >= 2130) || (day >= 2 && day <= 6 && hm <= 400);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return { beijing: bj.getFullYear() + '-' + pad(bj.getMonth() + 1) + '-' + pad(bj.getDate()) + ' ' + pad(bj.getHours()) + ':' + pad(bj.getMinutes()), aOpen, usOpen, weekday };
}

/* ---------- 24 小时统一时间轴（北京时间 00:00-24:00，5 分钟一格 = 288 格） ---------- */
const SLOT_MIN = 5;
const SLOT_COUNT = (24 * 60) / SLOT_MIN;

function bjNow() { return new Date(Date.now() + (new Date().getTimezoneOffset() + 480) * 60000); }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function bjToday() { const d = bjNow(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function nextDateStr(s) { const p = s.split('-'); const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1)); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
/* 美东 DST：3 月第二个周日 ~ 11 月第一个周日，北京 = 美东 + 12h；冬令时 +13h */
function usBeijingOffset(dateStr) {
  const p = dateStr.split('-'); const y = +p[0];
  const d = Date.UTC(y, +p[1] - 1, +p[2], 12);
  const mar1 = new Date(Date.UTC(y, 2, 1)).getUTCDay();
  const dstStart = Date.UTC(y, 2, 1 + ((7 - mar1) % 7) + 7);
  const nov1 = new Date(Date.UTC(y, 10, 1)).getUTCDay();
  const dstEnd = Date.UTC(y, 10, 1 + ((7 - nov1) % 7));
  return (d >= dstStart && d < dstEnd) ? 12 : 13;
}
function etBarToBjSlot(barDate, offHours) {
  const date = barDate.slice(0, 10); const hm = barDate.slice(11, 16).split(':');
  let bh = (+hm[0]) + offHours; let bd = date;
  if (bh >= 24) { bh -= 24; bd = nextDateStr(date); }
  return { date: bd, slot: Math.floor((bh * 60 + (+hm[1])) / SLOT_MIN) };
}
const SINA_INDEX = { '100.SPX': '.INX', '100.NDX': '.IXIC', '100.NDX100': '.NDX', '100.DJIA': '.DJI' };
function sinaSymbol(sym) { return SINA_INDEX[sym[0] + '.' + sym[1]] || sym[1]; }

/* 美股盘前/盘后：新浪 hq 批量接口，f[21]=扩展价 f[22]=扩展涨跌幅 f[23]=涨跌额 f[24]=时间 */
let extCache = { at: 0, data: null };
async function fetchUsExt() {
  if (extCache.data && (Date.now() - extCache.at) < 60 * 1000) return extCache.data;
  const list = US_SYMBOLS.filter(function (s) { return s[0] !== '100'; }).map(function (s) { return 'gb_' + s[1].toLowerCase(); }).join(',');
  const out = {};
  try {
    const r = await fetch('https://hq.sinajs.cn/list=' + list, { headers: SINA_UA, signal: AbortSignal.timeout(15000) });
    const buf = Buffer.from(await r.arrayBuffer());
    let txt = buf.toString('utf8');
    if (/\uFFFD/.test(txt.slice(0, 300))) { try { txt = new TextDecoder('gbk').decode(buf); } catch (e) {} }
    for (const line of txt.split('\n')) {
      const m = line.match(/hq_str_gb_([a-z0-9._-]+)="([^"]*)"/i);
      if (!m) continue;
      const f = m[2].split(',');
      if (f.length < 26) continue;
      const extPx = parseFloat(f[21]);
      const extPct = parseFloat(f[22]);
      if (!isFinite(extPx) || extPx <= 0) continue;
      const extT = String(f[24]).trim();
      const hm = extT.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      let sess = 'closed';
      if (hm) { let h = (+hm[1]) % 12; if (/PM/i.test(hm[3])) h += 12; sess = h < 9 ? 'pre' : (h >= 16 ? 'post' : 'regular'); }
      out[m[1].toUpperCase()] = { px: extPx, pct: isFinite(extPct) ? extPct : null, amount: parseFloat(f[23]), t: extT, session: sess, close0: String(f[25]).trim() };
    }
  } catch (e) {}
  extCache = { at: Date.now(), data: out };
  return out;
}

const SINA_UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0 Safari/537.36', 'Referer': 'https://stock.finance.sina.com.cn/' };
let intradayCache = { at: 0, data: null };
/* 美股 5 分钟 K 线：只取最后一个交易日；10 分钟内复用缓存 */
async function fetchUsIntraday() {
  if (intradayCache.data && (Date.now() - intradayCache.at) < 10 * 60 * 1000) return intradayCache.data;
  const out = {};
  let i = 0;
  const worker = async () => {
    while (i < US_SYMBOLS.length) {
      const sym = US_SYMBOLS[i++];
      const ss = sinaSymbol(sym);
      try {
        const r = await fetch('https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20t=/US_MinKService.getMinK?symbol=' + encodeURIComponent(ss) + '&type=5', { headers: SINA_UA, signal: AbortSignal.timeout(20000) });
        if (r.ok) {
          const txt = await r.text();
          const a = txt.indexOf('('), b = txt.lastIndexOf(')');
          if (a >= 0 && b > a) {
            const arr = JSON.parse(txt.slice(a + 1, b));
            if (Array.isArray(arr) && arr.length) {
              out[sym[0] + '.' + sym[1]] = arr.map(function (x) { return { d: x.d, c: Number(x.c) }; });
            }
          }
        }
      } catch (e) {}
      await sleep(25);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  intradayCache = { at: Date.now(), data: out };
  return out;
}

/* 自建历史归档：每天收盘后保存当日 A 股分时，历史越用越全 */
const ARCHIVE_FILE = path.join(DIR, 'archive.json');
let archive = {};
try { archive = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8')); } catch (e) { archive = {}; }
function saveArchive() { try { fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archive)); } catch (e) {} }
function archiveToday(flow, watch) {
  const today = bjToday();
  const times = (flow && flow.times) || [];
  if (!times.length || times[times.length - 1] < '14:55') return;      /* 未收盘不存 */
  if (archive[today] && archive[today].aShare && archive[today].aShare.length) return;
  archive[today] = {
    date: today, times: times,
    aShare: flow.series.map(function (s) { return { name: s.name, vals: s.vals }; }),
    daily: watch.map(function (w) { return { name: w.name, code: w.code, kind: w.kind, main: w.main, pct: w.pct }; }),
    savedAt: new Date().toISOString()
  };
  saveArchive();
}

function mergeAHistIntoArchive(aHist) {
  let changed = false;
  for (const code of Object.keys(aHist)) {
    const w = WATCH.find(function (x) { return x[1] === code; });
    if (!w) continue;
    for (const date of Object.keys(aHist[code])) {
      const rec = aHist[code][date];
      if (!archive[date]) { archive[date] = { date: date, times: [], aShare: [], daily: [], fromDaily: true, savedAt: null }; }
      const a = archive[date];
      if (!a.daily) a.daily = [];
      const row = { name: w[0], code: code, kind: w[2], main: rec.main, pct: rec.pct };
      const i = a.daily.findIndex(function (z) { return z.code === code; });
      if (i >= 0) a.daily[i] = row; else a.daily.push(row);
      changed = true;
    }
  }
  if (changed) { saveArchive(); return true; }
  return false;
}

let aHistCache = { at: 0, data: null };
/* 38 个板块的日线资金流历史（东财 daykline，121 天） */
async function fetchAHist() {
  const have = aHistCache.data ? Object.keys(aHistCache.data).reduce(function (s, k) { return s + Object.keys(aHistCache.data[k]).length; }, 0) : 0;
  /* 历史接口时通时断：拿到了就缓存 30 分钟，没拿到就 5 分钟重试一次 */
  const ttl = have > 20 ? 30 * 60 * 1000 : 5 * 60 * 1000;
  if (aHistCache.data && (Date.now() - aHistCache.at) < ttl) return aHistCache.data;
  const out = {};
  let i = 0;
  const worker = async () => {
    while (i < WATCH.length) {
      const w = WATCH[i++];
      try {
        let k = [];
        for (const h of ['https://push2his.eastmoney.com', 'https://push2delay.eastmoney.com']) {
          try {
            const r = await fetch(h + '/api/qt/stock/fflow/daykline/get?lmt=0&klt=101&secid=90.' + w[1] + '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63', { headers: UA, signal: AbortSignal.timeout(15000) });
            if (r.ok) { const j = await r.json(); const kk = (j.data && j.data.klines) || []; if (kk.length > k.length) k = kk; }
          } catch (e) {}
          if (k.length > 2) break;
        }
        const m = {};
        for (const line of k) { const p = line.split(','); m[p[0]] = { main: +p[1], pct: +p[12] }; }
        out[w[1]] = m;
      } catch (e) { out[w[1]] = {}; }
      await sleep(50);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  aHistCache = { at: Date.now(), data: out };
  const n = Object.keys(out).reduce(function (s, k) { return s + Object.keys(out[k]).length; }, 0);
  if (n > 20) { if (mergeAHistIntoArchive(out)) console.log('  A股日线历史已并入归档: ' + n + ' 条记录'); }
  return out;
}

function forwardFill(arr) { let last = null; for (let i = 0; i < arr.length; i++) { if (arr[i] === null) arr[i] = last; else last = arr[i]; } return arr; }
function backFill(arr) { let next = null; for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] === null) arr[i] = next; else next = arr[i]; } return arr; }

/* 最近可用交易日列表（美股 bar 的北京日期 ∪ A股日线日期） */
function availableDates(usIntr, aHist) {
  const set = new Set();
  for (const key of Object.keys(usIntr)) {
    const bars = usIntr[key] || [];
    for (const b of bars) {
      const conv = etBarToBjSlot(b.d, usBeijingOffset(String(b.d).slice(0, 10)));
      set.add(conv.date);
    }
  }
  for (const code of Object.keys(aHist)) for (const d of Object.keys(aHist[code])) set.add(d);
  for (const d of Object.keys(archive)) set.add(d);
  return [...set].sort().reverse().slice(0, 30);
}

/* 把 A 股分时、A 股日线、美股分时拼到指定交易日的 24 小时轴上 */
function buildReplay(date, latest) {
  const today = bjToday();
  const flow = latest.flow, usIntr = latest.usIntr, usRows = latest.usRows, aHist = latest.aHist;
  const isToday = (date === today);
  const aShare = [];
  /* 归档优先（含历史交易日），否则用当天的实时分时 */
  const src = archive[date] || (isToday && flow ? { times: flow.times, aShare: flow.series } : null);
  if (src) {
    for (let s = 0; s < src.aShare.length; s++) {
      const vals = new Array(SLOT_COUNT).fill(null);
      for (let k = 0; k < src.times.length; k++) {
        const p = src.times[k].split(':');
        const slot = Math.floor(((+p[0]) * 60 + (+p[1])) / SLOT_MIN);
        if (slot >= 0 && slot < SLOT_COUNT) vals[slot] = Math.round(src.aShare[s].vals[k] / 10000); /* 万元 */
      }
      aShare.push({ name: src.aShare[s].name, vals: forwardFill(vals) });
    }
  }
  /* 该日的 A 股日线口径（主力净额 + 涨跌幅），过去日期只有这个 */
  const archDaily = archive[date] && archive[date].daily;
  const aShareDaily = WATCH.map(function (w) {
    if (archDaily) { const d0 = archDaily.find(function (z) { return z.code === w[1]; }); if (d0) return { name: w[0], code: w[1], kind: w[2], main: d0.main, pct: d0.pct }; }
    const rec = (aHist[w[1]] || {})[date];
    return { name: w[0], code: w[1], kind: w[2], main: rec ? rec.main : null, pct: rec ? rec.pct : null };
  });
  /* VIX：分时（仅当个交易日）或日线收盘 */
  const vixVals = new Array(SLOT_COUNT).fill(null);
  let vixAny = false;
  for (const bar of (latest.vixIntra || [])) {
    const conv = etBarToBjSlot(bar.t, usBeijingOffset(String(bar.t).slice(0, 10)));
    if (conv.date !== date) continue;
    vixVals[conv.slot] = +bar.c.toFixed(2);
    vixAny = true;
  }
  let vixLastSlot = null;
  if (vixAny) { for (let i = vixVals.length - 1; i >= 0; i--) { if (vixVals[i] !== null) { vixLastSlot = i; break; } } forwardFill(vixVals); }
  let vixClose = null;
  const vh = latest.vixHist || {};
  if (vh[date] !== undefined) {
    const ks = Object.keys(vh).sort();
    const idx = ks.indexOf(date);
    vixClose = { close: vh[date], prev: idx > 0 ? vh[ks[idx - 1]] : null };
  }

  /* 美股分时（该北京日期） */
  const us = [];
  for (const sym of US_SYMBOLS) {
    const key = sym[0] + '.' + sym[1];
    const bars = usIntr[key];
    const q = (usRows || []).find(function (x) { return x.prefix + '.' + x.ticker === key; });
    if (!bars || !bars.length) continue;
    const vals = new Array(SLOT_COUNT).fill(null);
    let any = false;
    for (const b of bars) {
      const conv = etBarToBjSlot(b.d, usBeijingOffset(String(b.d).slice(0, 10)));
      if (conv.date !== date) continue;
      if (q && q.prev) vals[conv.slot] = +(((b.c - q.prev) / q.prev) * 100).toFixed(2);
      any = true;
    }
    if (!any) continue;
    us.push({ key: key, ticker: sym[1], cn: sym[2], group: sym[3], vals: forwardFill(vals) });
  }
  return {
    date: date, today: today, isToday: isToday, stepMin: SLOT_MIN, slots: SLOT_COUNT,
    aShare: aShare, aShareDaily: aShareDaily, us: us,
    aShareIntraday: aShare.length > 0, archived: !!archive[date],
    vixVals: vixAny ? vixVals : null, vixLastSlot: vixLastSlot, vixClose: vixClose,
    dates: availableDates(usIntr, aHist),
    generatedAt: new Date().toISOString()
  };
}

let cache = null, latest = null, refreshing = false, lastError = null, lastOk = null, refreshCount = 0;

async function refresh() {
  if (refreshing) return cache;
  refreshing = true;
  const t0 = Date.now();
  try {
    const aIndex = await fetchAIndex();
    const marketFlow = await fetchMarketFlow();
    const us = await fetchUS();
    if (!us.ok) throw new Error('us quotes empty');
    const watch = await fetchWatch();
    const seriesMap = await fetchSeries(WATCH.map(function (w) { return w[1]; }));
    const flow = buildSeries(seriesMap);
    const macro = await fetchMacro();
    const usExt = await fetchUsExt();
    const vixIntraNow = await fetchVixIntraday();
    let vix = await fetchVix();
    if (vix.err && macro.vix) vix = { source: 'FRED(前收)', time: macro.vix.date, last: macro.vix.value, chg: null, pct: null };
    const fx = await fetchUsdCny();
    if (!watch.length) throw new Error('watch list empty');
    try {
      const usIntr = await fetchUsIntraday();
      const aHist = await fetchAHist();
      archiveToday(flow, watch);
      const [vixIntra, vixHist] = [await fetchVixIntraday(), await fetchVixHist()];
      latest = { flow: flow, usIntr: usIntr, usRows: us.indices.concat(us.mega, us.broad, us.sectors, us.thematic, us.vixetf), aHist: aHist, vixIntra: vixIntra, vixHist: vixHist, at: Date.now() };
    } catch (e) { /* 分时失败不影响主数据 */ }
    cache = {
      updatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0,
      host: emHost,
      status: marketStatus(new Date()),
      aIndex, marketFlow,
      us, usExt, macro, fx, watch, vix,
      vixIntraday: vixIntraNow.slice(-3),
      times: flow.times,
      series: flow.series,
      errors: []
    };
    lastOk = new Date().toISOString(); lastError = null; refreshCount++;
    fs.writeFileSync(path.join(DIR, 'data.json'), JSON.stringify(cache));
    const emptySeries = flow.series.filter(function (s) { return !s.vals.some(function (v) { return v !== null; }); }).length;
    console.log('[' + new Date().toLocaleTimeString() + '] ok ' + (Date.now() - t0) + 'ms host=' + emHost.replace('https://', '') + ' watch=' + watch.length + ' points=' + flow.times.length + ' us=' + us.ok + '/' + us.total + ' vix=' + (vix.err ? ('ERR(' + vix.err + ')') : (vix.last + ' ' + vix.source))
      + (latest ? (' replay ok dates=' + availableDates(latest.usIntr, latest.aHist).length + ' archive=' + Object.keys(archive).length) : ' replay=none') + (emptySeries ? (' emptySeries=' + emptySeries) : ''));
  } catch (e) {
    lastError = String(e && e.message ? e.message : e);
    if (cache) cache.errors = ['本次刷新失败（显示的是上次成功数据）：' + lastError];
    console.error('[' + new Date().toLocaleTimeString() + '] refresh failed: ' + lastError);
  } finally { refreshing = false; }
  return cache;
}

/* ---------- 静态构建：把服务端逻辑变成一次性任务 ---------- */
const PUB = path.join(DIR, "public");
fs.mkdirSync(path.join(PUB, "replay"), { recursive: true });

let built = null;
for (let i = 0; i < 3; i++) {
  built = await refresh();
  if (built && built.watch && built.watch.length) break;
  console.error('第 ' + (i + 1) + ' 次抓取失败：' + (lastError || '未知') + '，12 秒后重试');
  await new Promise(function (s) { setTimeout(s, 12000); });
}
if (!built || !built.watch || !built.watch.length) { console.error("构建失败：refresh 未取到数据"); process.exit(1); }

/* 归档只保留最近 45 天 */
{
  const ks = Object.keys(archive).sort();
  if (ks.length > 30) { for (const k of ks.slice(0, ks.length - 30)) delete archive[k]; saveArchive(); }
}

fs.writeFileSync(path.join(PUB, "latest.json"), JSON.stringify(built));

const today = bjToday();
const dates = (latest ? availableDates(latest.usIntr, latest.aHist) : [today]).slice(0, 20);
let made = 0;
if (latest) {
  for (const d of dates) {
    const rp = buildReplay(d, latest);
    const js = JSON.stringify(rp);
    fs.writeFileSync(path.join(PUB, "replay", d + ".json"), js);
    if (d === today) fs.writeFileSync(path.join(PUB, "replay", "latest.json"), js);
    made++;
  }
}

/* 清理超出窗口的回放文件 */
{
  const keep = new Set(dates.concat(["latest"]));
  for (const f of fs.readdirSync(path.join(PUB, "replay"))) {
    if (!f.endsWith(".json")) continue;
    const k = f.replace(/\.json$/, "");
    if (!keep.has(k)) { try { fs.unlinkSync(path.join(PUB, "replay", f)); } catch (e) {} }
  }
}

const stamp = { builtAt: new Date().toISOString(), today: today, dates: dates, points: (built.times || []).length, watch: (built.watch || []).length, archive: Object.keys(archive).length };
fs.writeFileSync(path.join(PUB, "build.json"), JSON.stringify(stamp));
console.log("静态构建完成 " + JSON.stringify(stamp) + (built.errors && built.errors.length ? " | errors=" + built.errors.join(";") : ""));
