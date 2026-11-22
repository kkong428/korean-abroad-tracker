// football-data.org 무료 플랜에서 앞으로의 일정을 가져와 data/matches.json을 갱신합니다.
// 키는 환경변수 FOOTBALL_DATA_TOKEN 으로만 받습니다(파일에 적지 않음).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLAYERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/players.json'), 'utf8'));
const MATCHES_FILE = path.join(ROOT, 'data/matches.json');
const matches = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));

// 무료 플랜에 포함된 대회 (코드 → 한글 이름)
const COMPETITIONS = {
  PL: '프리미어리그', ELC: '챔피언십', BL1: '분데스리가',
  PD: '라리가', PPL: '프리메이라리가', CL: 'UEFA 챔피언스리그',
};
// 우리 팀 id → API 팀 이름에 들어 있을 글자(소문자, 악센트 제거)
const ALIAS = {
  brentford: ['brentford'], stoke: ['stoke'], birmingham: ['birmingham'], swansea: ['swansea'],
  bayern: ['bayern'], mainz: ['mainz'], augsburg: ['augsburg'], unionberlin: ['union berlin'],
  gladbach: ['gladbach', 'monchengladbach'], atletico: ['atletico'], porto: ['porto'],
  arouca: ['arouca'], nacional: ['nacional'], estrelaamadora: ['estrela', 'amadora'],
  clubbrugge: ['club brugge'], besiktas: ['besiktas'], celtic: ['celtic'], rangers: ['rangers'],
  midtjylland: ['midtjylland'],
};
const ZONE = { 잉글랜드: 'Europe/London', 독일: 'Europe/Berlin', 스페인: 'Europe/Madrid', 포르투갈: 'Europe/Lisbon' };

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = d => d.toISOString().slice(0, 10);

function ourTeamOf(apiName) {
  const n = norm(apiName);
  return PLAYERS.find(t => (ALIAS[t.id] || []).some(a => n.includes(a)));
}
function koName(apiTeam) {
  const t = ourTeamOf(apiTeam.name) || ourTeamOf(apiTeam.shortName);
  return t ? t.name : (apiTeam.shortName || apiTeam.name);
}
function localParts(utcIso, zone) {
  const d = new Date(utcIso);
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, tz: String(Math.round((asUtc - d.getTime()) / 3600000)) };
}

async function getJSON(url, token) {
  if (process.env.FD_MOCK_DIR) { // 시험용: 가짜 응답 파일 사용
    const code = url.match(/competitions\/(\w+)\//)[1];
    const f = path.join(process.env.FD_MOCK_DIR, code + '.json');
    if (!fs.existsSync(f)) return { status: 403, body: { message: 'mock: not available' } };
    return { status: 200, body: JSON.parse(fs.readFileSync(f, 'utf8')) };
  }
  const r = await fetch(url, { headers: { 'X-Auth-Token': token } });
  let body = {}; try { body = await r.json(); } catch (e) {}
  return { status: r.status, body };
}

(async () => {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token && !process.env.FD_MOCK_DIR) { console.error('FOOTBALL_DATA_TOKEN 이 없어요. GitHub Secrets 설정을 확인하세요.'); process.exit(1); }
  const from = new Date(), to = new Date(Date.now() + 45 * 86400000);
  const found = {}; let okComps = 0;

  for (const [code, label] of Object.entries(COMPETITIONS)) {
    const url = `https://api.football-data.org/v4/competitions/${code}/matches?status=SCHEDULED,TIMED&dateFrom=${ymd(from)}&dateTo=${ymd(to)}`;
    const { status, body } = await getJSON(url, token);
    if (status !== 200 || !body.matches) { console.log(`[실패] ${code} ${label}: HTTP ${status} ${body.message || ''}`); }
    else {
      okComps++; console.log(`[성공] ${code} ${label}: 앞으로 ${body.matches.length}경기`);
      for (const m of body.matches) {
        for (const side of ['homeTeam', 'awayTeam']) {
          const ours = ourTeamOf(m[side].name) || ourTeamOf(m[side].shortName);
          if (!ours) continue;
          const zone = ZONE[ours.country]; if (!zone) continue;
          const prev = found[ours.id];
          if (prev && new Date(prev._utc) <= new Date(m.utcDate)) continue;
          const isHome = side === 'homeTeam';
          found[ours.id] = { ...localParts(m.utcDate, zone), opponent: koName(isHome ? m.awayTeam : m.homeTeam), competition: label, homeAway: isHome ? 'home' : 'away', _utc: m.utcDate };
        }
      }
    }
    if (!process.env.FD_MOCK_DIR) await sleep(7000); // 무료 한도: 분당 10회
  }

  if (okComps === 0) { console.error('가져온 대회가 하나도 없어요. 키 또는 요금제를 확인하세요.'); process.exit(1); }
  let changed = 0;
  for (const [id, m] of Object.entries(found)) {
    const { _utc, ...clean } = m;
    if (JSON.stringify(matches[id]) !== JSON.stringify(clean)) { matches[id] = clean; changed++; }
  }
  fs.writeFileSync(MATCHES_FILE, JSON.stringify(matches, null, 1));
  const miss = PLAYERS.filter(t => !found[t.id]).map(t => t.name);
  console.log(`일정이 새로 잡힌 팀 ${Object.keys(found).length}개, 바뀐 팀 ${changed}개`);
  console.log(`이번에 자동으로 못 찾은 팀(무료 범위 밖이거나 일정 없음) ${miss.length}개: ${miss.join(', ')}`);
})();
