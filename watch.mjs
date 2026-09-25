import dns from 'node:dns'; import fs from 'node:fs';
dns.setDefaultResultOrder('ipv4first');
const TOKEN = fs.readFileSync('C:/Users/31534/Desktop/dash-pages/.ghtoken', 'utf8').trim();
const H = { 'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github+json', 'User-Agent': 'dash' };
const repo = 'a3153423343-crypto/market-dash';
const api = async (p) => { const r = await fetch('https://api.github.com' + p, { headers: H, signal: AbortSignal.timeout(30000) }); return { s: r.status, j: await r.json().catch(() => null) }; };
let run = null;
for (let i = 0; i < 30; i++) {
  const w = await api('/repos/' + repo + '/actions/runs?per_page=3');
  const runs = (w.j && w.j.workflow_runs) || [];
  if (runs.length) { run = runs[0]; console.log('[' + i + '] #' + run.run_number + ' ' + run.status + '/' + (run.conclusion || '-')); if (run.status === 'completed') break; }
  else console.log('[' + i + '] 无运行');
  await new Promise(s => setTimeout(s, 12000));
}
if (run && run.conclusion !== 'success') {
  const jobs = await api('/repos/' + repo + '/actions/runs/' + run.id + '/jobs');
  for (const j of ((jobs.j && jobs.j.jobs) || [])) for (const st of (j.steps || [])) console.log('  ' + st.number + '. ' + st.name + ' -> ' + (st.conclusion || st.status));
}
const BASE = 'https://a3153423343-crypto.github.io/market-dash/';
for (let i = 0; i < 10; i++) {
  try {
    const a = await fetch(BASE, { signal: AbortSignal.timeout(25000), cache: 'no-store' });
    const b = await fetch(BASE + 'latest.json', { signal: AbortSignal.timeout(25000), cache: 'no-store' });
    console.log('页面 HTTP' + a.status + ' | latest.json HTTP' + b.status);
    if (a.status === 200 && b.status === 200) { const j = await b.json(); console.log('数据时间 ' + j.updatedAt + ' | 板块 ' + (j.watch || []).length + ' | 分时点 ' + (j.times || []).length + ' | 美股 ' + (j.us ? j.us.ok + '/' + j.us.total : '-')); break; }
  } catch (e) { console.log('  等待中 ' + String(e).slice(0, 60)); }
  await new Promise(s => setTimeout(s, 15000));
}
const rp = await fetch(BASE + 'replay/latest.json', { signal: AbortSignal.timeout(25000), cache: 'no-store' });
console.log('replay/latest.json HTTP' + rp.status);
if (rp.status === 200) { const j = await rp.json(); console.log('回放日期 ' + j.date + ' | 可选 ' + (j.dates || []).length + ' 天 | A股分时 ' + j.aShare.length + ' 条 | 美股 ' + j.us.length + ' 条 | VIX ' + (j.vixVals ? '有' : '无')); }
