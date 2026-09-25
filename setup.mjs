import dns from 'node:dns'; import fs from 'node:fs';
dns.setDefaultResultOrder('ipv4first');
const TOKEN = fs.readFileSync('C:/Users/31534/Desktop/qdii-pages/.ghtoken', 'utf8').trim();
const login = fs.readFileSync('C:/Users/31534/Desktop/qdii-pages/.ghlogin', 'utf8').trim();
const H = { 'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github+json', 'User-Agent': 'dash-board', 'X-GitHub-Api-Version': '2022-11-28' };
const api = async (m, p, body) => { const r = await fetch('https://api.github.com' + p, { method: m, headers: body ? Object.assign({ 'Content-Type': 'application/json' }, H) : H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { s: r.status, j, t }; };
const repo = 'market-dash';
let cr = await api('GET', '/repos/' + login + '/' + repo);
if (cr.s === 404) { cr = await api('POST', '/user/repos', { name: repo, description: 'A股 + 美股 板块资金流动看板（含 VIX 与 24 小时回放）', private: false, has_issues: false, has_wiki: false }); console.log('建仓库 HTTP' + cr.s + ' ' + (cr.j ? cr.j.full_name : cr.t.slice(0, 120))); }
else console.log('仓库已存在 ' + (cr.j ? cr.j.full_name : ''));
const pg = await api('POST', '/repos/' + login + '/' + repo + '/pages', { build_type: 'workflow' });
console.log('Pages -> HTTP' + pg.s + (pg.s === 409 ? ' (已存在)' : ''));
const ret = await api('PATCH', '/repos/' + login + '/' + repo, { retention_days: 1 });
console.log('artefact 保留天数 -> HTTP' + ret.s + ' ' + (ret.j ? ret.j.retention_days : ''));
fs.writeFileSync('C:/Users/31534/Desktop/dash-pages/.ghtoken', TOKEN);
fs.writeFileSync('C:/Users/31534/Desktop/dash-pages/.ghlogin', login);
console.log('PUSH=https://github.com/' + login + '/' + repo + '.git');
