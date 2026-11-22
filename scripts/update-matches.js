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
const ZONE = {
  잉글랜드: 'Europe/London', 독일: 'Europe/Berlin', 스페인: 'Europe/Madrid', 포르투갈: 'Europe/Lisbon',
  벨기에: 'Europe/Brussels', 튀르키예: 'Europe/Istanbul', 덴마크: 'Europe/Copenhagen', 스위스: 'Europe/Zurich',
  오스트리아: 'Europe/Vienna', 스코틀랜드: 'Europe/London', 세르비아: 'Europe/Belgrade', 미국: 'America/Los_Angeles',
};
const TEAM_ZONE = { lafc: 'America/Los_Angeles', seattle: 'America/Los_Angeles', stlouis: 'America/Chicago' };
// TheSportsDB 대회 이름 → 한글
const LEAGUE_KO = {
  'German Bundesliga': '분데스리가', 'German 2. Bundesliga': '분데스리가2', 'Belgian Pro League': '프로리그',
  'Belgian Challenger Pro League': '챌린저 프로리그', 'Turkish Super Lig': '쉬페르리그', 'Turkish 1 Lig': 'TFF 1.리그',
  'Danish Superliga': '수페르리가', 'Swiss Super League': '슈퍼리그', 'Austrian Bundesliga': '오스트리아 분데스리가',
  'Scottish Premier League': '프리미어십', 'Serbian Super Liga': '수페르리가', 'American Major League Soccer': 'MLS',
  'UEFA Champions League': 'UEFA 챔피언스리그', 'UEFA Europa League': 'UEFA 유로파리그', 'UEFA Europa Conference League': 'UEFA 컨퍼런스리그', 'UEFA Conference League': 'UEFA 컨퍼런스리그',
};

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
  if (!token && !process.env.FD_MOCK_DIR && !process.env.SKIP_FD) { console.error('FOOTBALL_DATA_TOKEN 이 없어요. GitHub Secrets 설정을 확인하세요.'); process.exit(1); }
  const from = new Date(), to = new Date(Date.now() + 45 * 86400000);
  const found = {}; let okComps = 0;

  for (const [code, label] of (process.env.SKIP_FD ? [] : Object.entries(COMPETITIONS))) {
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

  if (okComps === 0 && !process.env.SKIP_FD) { console.error('가져온 대회가 하나도 없어요. 키 또는 요금제를 확인하세요.'); process.exit(1); }

  // ── 2차: football-data에 없는 팀은 TheSportsDB(공개 테스트 키)에서 가져오기 ──
  const TEAM_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/team-ids.json'), 'utf8'));
  let extraOk = 0, extraFail = 0;
  for (const t of PLAYERS) {
    if (found[t.id] || !TEAM_IDS[t.id]) continue;
    const zone = TEAM_ZONE[t.id] || ZONE[t.country]; if (!zone) continue;
    try {
      const r = await fetch('https://www.thesportsdb.com/api/v1/json/123/eventsnext.php?id=' + TEAM_IDS[t.id]);
      const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch (e) {}
      const ev = (j.events || []).filter(e => e.strTimestamp && new Date(e.strTimestamp + 'Z') > new Date())
        .sort((a, b) => new Date(a.strTimestamp) - new Date(b.strTimestamp))[0];
      if (!ev) { console.log(`[없음] ${t.name}: 앞으로 일정이 안 나와요 (HTTP ${r.status})`); extraFail++; }
      else {
        const isHome = ev.idHomeTeam === TEAM_IDS[t.id];
        found[t.id] = { ...localParts(ev.strTimestamp + 'Z', zone), opponent: isHome ? ev.strAwayTeam : ev.strHomeTeam, competition: LEAGUE_KO[ev.strLeague] || ev.strLeague, homeAway: isHome ? 'home' : 'away', _utc: ev.strTimestamp + 'Z' };
        extraOk++;
      }
    } catch (e) { console.log(`[실패] ${t.name}: ${e.message}`); extraFail++; }
    if (!process.env.FD_MOCK_DIR) await sleep(8000); // 무료 공개 키는 요청 제한이 빡빡해요
  }
  console.log(`TheSportsDB: 성공 ${extraOk}팀, 못 가져옴 ${extraFail}팀`);

  // 오래된 일정 정리: 이번에 새로 못 받은 팀의 일정이 어제보다 오래됐으면 지움
  const cutoff = ymd(new Date(Date.now() - 86400000));
  for (const id of Object.keys(matches)) {
    if (!found[id] && matches[id].date < cutoff) { delete matches[id]; console.log(`[정리] ${id}: 지난 일정 삭제`); }
  }
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
