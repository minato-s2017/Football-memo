'use strict';

// ===== チームカラー（チーム名から自動決定：同じチームは常に同じ色） =====
const TEAM_COLORS = ['#ff5a5f','#ffd23f','#2dc653','#ff7c26','#b5179e','#00d4d4','#7aa0ff','#ff8fab','#9b5de5','#80ed99'];
function teamColor(name) {
  if (!name) return '#8a9bc8';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TEAM_COLORS[h % TEAM_COLORS.length];
}

// ===== イベント種別の定義 =====
const EVENT_TYPES = {
  goal:   { icon: '⚽', label: 'ゴール', cls: 'tl-goal' },
  yellow: { icon: '🟨', label: '警告',   cls: 'tl-yellow' },
  red:    { icon: '🟥', label: '退場',   cls: 'tl-red' },
  sub:    { icon: '🔄', label: '交代',   cls: 'tl-sub' },
  note:   { icon: '📝', label: 'メモ',   cls: 'tl-note' },
};
const WATCH_METHODS = { stadium: '🏟 スタジアム', tv: '📺 テレビ', stream: '💻 配信', other: 'その他' };

// ===== データ管理（localStorage・端末内のみ） =====
const DB = {
  load() {
    return { matches: JSON.parse(localStorage.getItem('swm_matches') || '[]') };
  },
  save(data) {
    localStorage.setItem('swm_matches', JSON.stringify(data.matches));
  },
  get matches() { return this.load().matches; },
  saveMatches(v) { const d = this.load(); d.matches = v; this.save(d); },
};

// ===== ユーティリティ =====
function uuid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function minuteLabel(min) { return (min === null || min === undefined || min === '') ? '—' : `${min}'`; }
function matchTitle(m) { return `${m.homeTeam || '?'} vs ${m.awayTeam || '?'}`; }
function goalCount(match, side) {
  return (match.events || []).filter(e => e.type === 'goal' && e.side === side).length;
}

// ===== 画面遷移 =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  const navMap = {
    home:'nav-home',
    create:'nav-create', live:'nav-create',
    history:'nav-history', detail:'nav-history',
    formation:'nav-formation',
    standings:'nav-standings',
    agg:'nav-agg',
  };
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navId = navMap[id];
  if (navId) document.getElementById(navId)?.classList.add('active');
}

// ===== トースト =====
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ===== ダイアログ =====
let dialogResolve;
function showDialog(title, message) {
  document.getElementById('dialog-title').textContent   = title;
  document.getElementById('dialog-message').textContent = message;
  document.getElementById('dialog').classList.remove('hidden');
  return new Promise(res => { dialogResolve = res; });
}
function closeDialog(result) {
  document.getElementById('dialog').classList.add('hidden');
  if (dialogResolve) dialogResolve(result);
}

// ===== 入力候補（datalist）の更新 =====
function refreshDatalists() {
  const matches = DB.matches;
  const teams = new Set();
  const comps = new Set();
  const players = new Set();
  matches.forEach(m => {
    if (m.homeTeam) teams.add(m.homeTeam);
    if (m.awayTeam) teams.add(m.awayTeam);
    if (m.competition) comps.add(m.competition);
    if (m.mom) players.add(m.mom);
    (m.events || []).forEach(e => { if (e.player) players.add(e.player); });
  });
  const fill = (id, set) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = [...set].sort().map(v => `<option value="${escHtml(v)}">`).join('');
  };
  fill('team-options', teams);
  fill('comp-options', comps);
  fill('player-options', players);
}

// ===== ホーム =====
function initHome() { refreshDatalists(); showScreen('home'); }

// ===== 観戦を記録（作成） =====
function openCreateScreen() {
  refreshDatalists();
  document.getElementById('m-comp').value  = '';
  document.getElementById('m-home').value  = '';
  document.getElementById('m-away').value  = '';
  document.getElementById('m-venue').value = '';
  document.getElementById('m-method').value = '';
  document.getElementById('m-date').value  = new Date().toISOString().slice(0, 10);
  showScreen('create');
  setTimeout(() => document.getElementById('m-home').focus(), 50);
}

function startMatch() {
  const homeTeam = document.getElementById('m-home').value.trim();
  const awayTeam = document.getElementById('m-away').value.trim();
  const date     = document.getElementById('m-date').value;
  if (!homeTeam || !awayTeam) { showToast('ホーム・アウェイの両チームを入力してください'); return; }
  if (!date) { showToast('日付を選択してください'); return; }

  const match = {
    id: uuid(),
    competition: document.getElementById('m-comp').value.trim(),
    homeTeam, awayTeam, date,
    venue:       document.getElementById('m-venue').value.trim(),
    watchMethod: document.getElementById('m-method').value,
    events: [],
    memo: '',
    rating: 0,
    mom: '',
    finished: false,
  };
  const matches = DB.matches;
  matches.push(match);
  DB.saveMatches(matches);
  openLiveScreen(match.id);
}

// ===== 観戦中（ライブメモ） =====
let currentMatchId = null;
let liveSide = 'home';
let liveType = 'goal';

function openLiveScreen(matchId) {
  currentMatchId = matchId;
  const m = DB.matches.find(x => x.id === matchId);
  if (!m) return;
  refreshDatalists();

  liveSide = 'home'; liveType = 'goal';
  syncSegButtons();

  document.getElementById('live-title').textContent = matchTitle(m);
  document.getElementById('live-sub').textContent =
    [formatDate(m.date), m.competition].filter(Boolean).join('　');

  document.getElementById('ev-minute').value = '';
  document.getElementById('ev-player').value = '';
  document.getElementById('ev-note').value   = '';
  document.getElementById('live-mom').value  = m.mom || '';
  document.getElementById('live-memo').value = m.memo || '';

  renderLiveScoreboard();
  renderTimeline();
  renderRatingStars();
  showScreen('live');
}

function setEvSide(side) { liveSide = side; syncSegButtons(); }
function setEvType(type) { liveType = type; syncSegButtons(); }
function syncSegButtons() {
  document.getElementById('evside-home').classList.toggle('active', liveSide === 'home');
  document.getElementById('evside-away').classList.toggle('active', liveSide === 'away');
  ['goal','yellow','red','sub','note'].forEach(t => {
    document.getElementById('evtype-' + t).classList.toggle('active', liveType === t);
  });
}

function addEvent() {
  const matches = DB.matches;
  const m = matches.find(x => x.id === currentMatchId);
  if (!m) return;

  const minuteRaw = document.getElementById('ev-minute').value.trim();
  const minute = minuteRaw === '' ? null : Math.max(0, parseInt(minuteRaw, 10) || 0);
  const player = document.getElementById('ev-player').value.trim();
  const note   = document.getElementById('ev-note').value.trim();

  if (!player && !note && liveType !== 'goal') {
    showToast('選手・内容を入力してください');
    return;
  }

  m.events.push({ id: uuid(), minute, type: liveType, side: liveSide, player, note });
  DB.saveMatches(matches);

  document.getElementById('ev-minute').value = '';
  document.getElementById('ev-player').value = '';
  document.getElementById('ev-note').value   = '';
  document.getElementById('ev-player').focus();

  renderLiveScoreboard();
  renderTimeline();
  refreshDatalists();
}

function deleteEvent(eid) {
  const matches = DB.matches;
  const m = matches.find(x => x.id === currentMatchId);
  if (!m) return;
  m.events = m.events.filter(e => e.id !== eid);
  DB.saveMatches(matches);
  renderLiveScoreboard();
  renderTimeline();
}

function renderLiveScoreboard() {
  const m = DB.matches.find(x => x.id === currentMatchId);
  if (!m) return;
  document.getElementById('live-scoreboard').innerHTML = scoreboardHtml(m);
}

function scoreboardHtml(m) {
  const hc = goalCount(m, 'home');
  const ac = goalCount(m, 'away');
  return `<div class="scoreboard">
    <div class="score-team">
      <div class="score-team-label">HOME</div>
      <div class="score-team-name"><span class="score-dot" style="background:${teamColor(m.homeTeam)}"></span>${escHtml(m.homeTeam || '?')}</div>
      <div class="score-team-pts">${hc}</div>
    </div>
    <div class="score-vs">VS</div>
    <div class="score-team">
      <div class="score-team-label">AWAY</div>
      <div class="score-team-name"><span class="score-dot" style="background:${teamColor(m.awayTeam)}"></span>${escHtml(m.awayTeam || '?')}</div>
      <div class="score-team-pts">${ac}</div>
    </div>
  </div>`;
}

function sortedEvents(m) {
  return (m.events || []).map((e, i) => ({ e, i })).sort((a, b) => {
    const ma = a.e.minute === null || a.e.minute === undefined ? Infinity : a.e.minute;
    const mb = b.e.minute === null || b.e.minute === undefined ? Infinity : b.e.minute;
    return ma - mb || a.i - b.i;
  }).map(x => x.e);
}

function timelineItemHtml(m, e, editable) {
  const def = EVENT_TYPES[e.type] || EVENT_TYPES.note;
  const teamName = e.side === 'home' ? m.homeTeam : (e.side === 'away' ? m.awayTeam : '');
  const tag = teamName
    ? `<span class="tl-team-tag" style="background:${teamColor(teamName)}">${escHtml(teamName)}</span>`
    : '';
  const main = e.player ? escHtml(e.player) : `<span style="color:var(--text-muted)">${def.label}</span>`;
  const del = editable ? `<button class="tl-del" onclick="deleteEvent('${e.id}')" title="削除">×</button>` : '';
  return `<div class="tl-item ${def.cls}">
    <div class="tl-minute">${minuteLabel(e.minute)}</div>
    <div class="tl-icon">${def.icon}</div>
    <div class="tl-main">
      <div class="tl-player">${tag}${main}</div>
      ${e.note ? `<div class="tl-note-text">${escHtml(e.note)}</div>` : ''}
    </div>
    ${del}
  </div>`;
}

function renderTimeline() {
  const m = DB.matches.find(x => x.id === currentMatchId);
  if (!m) return;
  const list = document.getElementById('live-timeline');
  const events = sortedEvents(m);
  list.innerHTML = events.length === 0
    ? `<div class="tl-empty">まだイベントがありません。上のフォームから記録してください。</div>`
    : events.map(e => timelineItemHtml(m, e, true)).join('');
}

function renderRatingStars() {
  const m = DB.matches.find(x => x.id === currentMatchId);
  if (!m) return;
  const cont = document.getElementById('live-rating');
  cont.innerHTML = [1,2,3,4,5].map(n =>
    `<span class="star ${n <= (m.rating || 0) ? 'on' : ''}" onclick="setRating(${n})">★</span>`
  ).join('');
}
function setRating(n) {
  const matches = DB.matches;
  const m = matches.find(x => x.id === currentMatchId);
  if (!m) return;
  m.rating = (m.rating === n) ? 0 : n;
  DB.saveMatches(matches);
  renderRatingStars();
}
function saveMom(val) {
  const matches = DB.matches;
  const m = matches.find(x => x.id === currentMatchId);
  if (!m) return;
  m.mom = val.trim();
  DB.saveMatches(matches);
}
function saveMemo(val) {
  const matches = DB.matches;
  const m = matches.find(x => x.id === currentMatchId);
  if (!m) return;
  m.memo = val;
  DB.saveMatches(matches);
}

async function endMatch() {
  const ok = await showDialog('観戦を終える', '観戦を終了して記録を確定しますか？\n（あとから「再開」で追記もできます）');
  if (!ok) return;
  const matches = DB.matches;
  const m = matches.find(x => x.id === currentMatchId);
  if (m) { m.finished = true; DB.saveMatches(matches); }
  openHistoryScreen();
  showToast('観戦を記録しました');
}

// ===== 観戦の記録（履歴） =====
function openHistoryScreen() {
  const matches = DB.matches.slice().reverse();
  const list = document.getElementById('match-list');
  if (matches.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div>観戦の記録がありません。<br>「観戦を記録」から始めましょう。</div>`;
  } else {
    list.innerHTML = matches.map(m => {
      const badge = m.finished
        ? '<span class="event-badge">記録済</span>'
        : '<span class="event-badge ongoing">観戦中</span>';
      const sub = [formatDate(m.date), m.competition].filter(Boolean).join('　');
      const stars = m.rating ? `<span class="event-rating">${'★'.repeat(m.rating)}</span>` : '';
      return `
        <div class="event-row" onclick="openMatchDetail('${m.id}')">
          <div>
            <div class="event-row-name">
              <span style="color:${teamColor(m.homeTeam)}">${escHtml(m.homeTeam || '?')}</span>
              <span style="color:var(--text-muted)"> vs </span>
              <span style="color:${teamColor(m.awayTeam)}">${escHtml(m.awayTeam || '?')}</span>
            </div>
            <div class="event-row-date">${sub}</div>
          </div>
          <div class="event-row-score">${goalCount(m,'home')} - ${goalCount(m,'away')}</div>
          ${stars}
          ${badge}
        </div>`;
    }).join('');
  }
  showScreen('history');
}

// ===== 観戦の詳細 =====
function openMatchDetail(matchId) {
  currentMatchId = matchId;
  const m = DB.matches.find(x => x.id === matchId);
  if (!m) return;

  document.getElementById('detail-name').innerHTML =
    `<span style="color:${teamColor(m.homeTeam)}">${escHtml(m.homeTeam || '?')}</span>` +
    `<span style="color:var(--text-muted)"> vs </span>` +
    `<span style="color:${teamColor(m.awayTeam)}">${escHtml(m.awayTeam || '?')}</span>`;
  document.getElementById('detail-sub').textContent =
    formatDate(m.date) + (m.finished ? '　（記録済）' : '　（観戦中）');

  document.getElementById('detail-scoreboard').innerHTML = scoreboardHtml(m);

  const meta = [];
  if (m.competition) meta.push(['大会', m.competition]);
  if (m.venue)       meta.push(['会場', m.venue]);
  if (m.watchMethod) meta.push(['視聴', WATCH_METHODS[m.watchMethod] || m.watchMethod]);
  document.getElementById('detail-meta').innerHTML = meta.length
    ? meta.map(([k,v]) => `<div class="meta-item"><span class="meta-label">${k}：</span><span>${escHtml(v)}</span></div>`).join('')
    : `<span style="color:var(--text-muted)">（大会・会場・視聴方法の記録はありません）</span>`;

  const events = sortedEvents(m);
  document.getElementById('detail-timeline').innerHTML = events.length === 0
    ? `<div class="tl-empty">イベントの記録はありません。</div>`
    : events.map(e => timelineItemHtml(m, e, false)).join('');

  const starHtml = [1,2,3,4,5].map(n => `<span class="star readonly ${n <= (m.rating||0) ? 'on' : ''}">★</span>`).join('');
  const reviewParts = [];
  reviewParts.push(`<div class="detail-review-row">
      <div class="rating-stars">${starHtml}</div>
      ${m.mom ? `<div class="mom-pill">⭐ MOM：${escHtml(m.mom)}</div>` : ''}
    </div>`);
  if (m.memo && m.memo.trim()) {
    reviewParts.push(`<div class="detail-memo-text">${escHtml(m.memo)}</div>`);
  } else {
    reviewParts.push(`<div style="color:var(--text-muted);font-size:13px;">自由メモはありません。</div>`);
  }
  document.getElementById('detail-review').innerHTML =
    `<div class="section-title" style="margin-top:6px;">試合の総評</div>
     <div class="detail-review-card">${reviewParts.join('')}</div>`;

  document.getElementById('resume-btn-placeholder').innerHTML = !m.finished
    ? `<button class="btn btn-primary" onclick="openLiveScreen('${m.id}')">▶ 観戦を再開</button>`
    : `<button class="btn btn-secondary" onclick="openLiveScreen('${m.id}')">✎ 追記・編集</button>`;

  showScreen('detail');
}

async function deleteMatch() {
  const m = DB.matches.find(x => x.id === currentMatchId);
  if (!m) return;
  const ok = await showDialog('観戦記録を削除', `「${matchTitle(m)}」を削除しますか？\nこの操作は取り消せません。`);
  if (!ok) return;
  DB.saveMatches(DB.matches.filter(x => x.id !== currentMatchId));
  openHistoryScreen();
  showToast('観戦記録を削除しました');
}

// ===== チーム成績 =====
function openStandingsScreen() {
  const matches = DB.matches.filter(m => m.finished && m.homeTeam && m.awayTeam);

  const stats = {};
  const ensure = name => { if (!stats[name]) stats[name] = { name, gp:0, w:0, d:0, l:0, gf:0, ga:0 }; return stats[name]; };

  matches.forEach(m => {
    const hs = goalCount(m, 'home');
    const as = goalCount(m, 'away');
    const H = ensure(m.homeTeam);
    const A = ensure(m.awayTeam);
    H.gp++; A.gp++;
    H.gf += hs; H.ga += as;
    A.gf += as; A.ga += hs;
    if (hs > as)      { H.w++; A.l++; }
    else if (as > hs) { A.w++; H.l++; }
    else              { H.d++; A.d++; }
  });

  const ranked = Object.values(stats).map(s => ({
    ...s, pts: s.w * 3 + s.d, diff: s.gf - s.ga,
  })).sort((a, b) => b.pts - a.pts || b.diff - a.diff || b.gf - a.gf);

  const medal = ['gold','silver','bronze'];
  const rows = ranked.map((t, rank) => `
      <div class="ranking-row">
        <div class="rank-num ${rank < 3 ? medal[rank] : ''}">${rank + 1}</div>
        <div class="rank-name">
          <div class="team-color-dot" style="background:${teamColor(t.name)}"></div>
          ${escHtml(t.name)}
        </div>
        <div class="rank-cell">${t.gp}</div>
        <div class="rank-cell win">${t.w}</div>
        <div class="rank-cell draw">${t.d}</div>
        <div class="rank-cell loss">${t.l}</div>
        <div class="rank-cell">${t.diff >= 0 ? '+' : ''}${t.diff}</div>
        <div class="rank-cell pts-col">${t.pts}</div>
      </div>`).join('');

  document.getElementById('standings-table-area').innerHTML = ranked.length === 0
    ? `<div class="empty-state"><div class="empty-icon">🏆</div>記録済みの観戦がありません。<br>観戦を記録すると成績表が作られます。</div>`
    : `<div class="ranking-table">
        <div class="ranking-header">
          <div></div><div>チーム</div>
          <div style="text-align:center">試合</div>
          <div style="text-align:center;color:var(--success)">勝</div>
          <div style="text-align:center">分</div>
          <div style="text-align:center;color:var(--danger)">負</div>
          <div style="text-align:center">得失</div>
          <div style="text-align:center;color:var(--accent-light)">勝点</div>
        </div>
        ${rows}
      </div>`;

  const matchRows = matches.slice().reverse().map(m => `
      <div class="event-row" onclick="openMatchDetail('${m.id}')">
        <div>
          <div class="event-row-name">
            <span style="color:${teamColor(m.homeTeam)}">${escHtml(m.homeTeam)}</span>
            <span style="color:var(--text-muted)"> vs </span>
            <span style="color:${teamColor(m.awayTeam)}">${escHtml(m.awayTeam)}</span>
          </div>
          <div class="event-row-date">${[formatDate(m.date), m.competition].filter(Boolean).join('　')}</div>
        </div>
        <div class="event-row-score">${goalCount(m,'home')} - ${goalCount(m,'away')}</div>
        <span class="event-badge">記録済</span>
      </div>`).join('');

  document.getElementById('standings-match-list').innerHTML = matches.length
    ? `<div class="section-title" style="margin:24px 0 12px;">観戦結果</div><div class="event-list">${matchRows}</div>`
    : '';

  showScreen('standings');
}

// ===== 集計 =====
function openAggScreen() {
  const matches = DB.matches.slice().reverse();
  const list = document.getElementById('agg-match-list');
  if (matches.length === 0) {
    list.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">観戦の記録がありません。</div>`;
  } else {
    list.innerHTML = matches.map(m => `
        <div class="agg-event-item" id="agg-check-${m.id}" onclick="toggleAggMatch('${m.id}')">
          <div class="check-box" id="agg-checkmark-${m.id}"></div>
          <div style="flex:1;min-width:0;">
            <div class="agg-event-name">${escHtml(m.homeTeam || '?')} vs ${escHtml(m.awayTeam || '?')}　<span style="color:var(--text-muted);font-weight:600;">${goalCount(m,'home')}-${goalCount(m,'away')}</span></div>
            <div class="agg-event-date">${[formatDate(m.date), m.competition].filter(Boolean).join('　')}</div>
          </div>
        </div>`).join('');
  }
  document.getElementById('agg-result').innerHTML = `
    <div class="agg-placeholder">
      <div class="agg-placeholder-icon">📊</div>
      <div>左の一覧から試合を選択して<br>「集計する」ボタンを押してください</div>
    </div>`;
  showScreen('agg');
}

function toggleAggMatch(id) {
  const item = document.getElementById('agg-check-' + id);
  const box  = document.getElementById('agg-checkmark-' + id);
  const checked = item.classList.toggle('checked');
  box.textContent = checked ? '✓' : '';
}

function calcAgg() {
  const selected = DB.matches.filter(m => document.getElementById('agg-check-' + m.id)?.classList.contains('checked'));
  if (selected.length === 0) { showToast('試合を1つ以上選択してください'); return; }

  let totalGoals = 0, yellow = 0, red = 0, ratingSum = 0, ratingCount = 0;
  const scorers = {};
  const moms = {};

  selected.forEach(m => {
    (m.events || []).forEach(e => {
      if (e.type === 'goal') {
        totalGoals++;
        if (e.player) {
          if (!scorers[e.player]) scorers[e.player] = { goals: 0, matches: new Set() };
          scorers[e.player].goals++;
          scorers[e.player].matches.add(m.id);
        }
      } else if (e.type === 'yellow') yellow++;
      else if (e.type === 'red') red++;
    });
    if (m.rating) { ratingSum += m.rating; ratingCount++; }
    if (m.mom) moms[m.mom] = (moms[m.mom] || 0) + 1;
  });

  const avgGoals  = (totalGoals / selected.length).toFixed(1);
  const avgRating = ratingCount ? (ratingSum / ratingCount).toFixed(1) : '—';

  const summary = `
    <div class="summary-grid">
      <div class="summary-card"><div class="summary-value">${selected.length}</div><div class="summary-label">観戦試合数</div></div>
      <div class="summary-card"><div class="summary-value">${totalGoals}</div><div class="summary-label">総ゴール数</div></div>
      <div class="summary-card"><div class="summary-value">${avgGoals}</div><div class="summary-label">平均ゴール / 試合</div></div>
      <div class="summary-card"><div class="summary-value">${avgRating}</div><div class="summary-label">平均★評価</div></div>
      <div class="summary-card"><div class="summary-value">🟨 ${yellow}</div><div class="summary-label">警告（イエロー）</div></div>
      <div class="summary-card"><div class="summary-value">🟥 ${red}</div><div class="summary-label">退場（レッド）</div></div>
    </div>`;

  const medal = ['gold','silver','bronze'];
  const scorerArr = Object.entries(scorers).map(([name, s]) => ({ name, goals: s.goals, games: s.matches.size }))
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
  const scorerRows = scorerArr.length === 0
    ? `<div class="stats-table-row"><div></div><div class="stat-cell name" style="color:var(--text-muted)">得点者の記録がありません</div><div></div><div></div></div>`
    : scorerArr.map((s, i) => `
        <div class="stats-table-row">
          <div class="stat-rank ${i < 3 ? medal[i] : ''}">${i + 1}</div>
          <div class="stat-cell name">${escHtml(s.name)}</div>
          <div class="stat-cell">${s.goals}</div>
          <div class="stat-cell sub">${s.games}試合</div>
        </div>`).join('');

  const scorerTable = `
    <div class="stats-table">
      <div class="stats-table-title">⚽ 得点者ランキング</div>
      <div class="stats-table-header"><div></div><div>選手</div><div style="text-align:center">ゴール</div><div style="text-align:center">出場試合</div></div>
      ${scorerRows}
    </div>`;

  const momArr = Object.entries(moms).map(([name, c]) => ({ name, c })).sort((a, b) => b.c - a.c || a.name.localeCompare(b.name));
  const momTable = momArr.length === 0 ? '' : `
    <div class="stats-table">
      <div class="stats-table-title">⭐ MOM 獲得回数</div>
      <div class="stats-table-header"><div></div><div>選手</div><div style="text-align:center">回数</div><div></div></div>
      ${momArr.map((s, i) => `
        <div class="stats-table-row">
          <div class="stat-rank ${i < 3 ? medal[i] : ''}">${i + 1}</div>
          <div class="stat-cell name">${escHtml(s.name)}</div>
          <div class="stat-cell">${s.c}</div>
          <div></div>
        </div>`).join('')}
    </div>`;

  document.getElementById('agg-result').innerHTML = `
    <div style="margin-bottom:14px;"><div style="font-size:13px;color:var(--text-muted);">${selected.length}試合を集計</div></div>
    ${summary}${scorerTable}${momTable}`;
}

// ===== フォーメーション（eフットボール風 ドラッグ＆ドロップ） =====
const FORMATIONS = {
  '4-4-2': [
    {pos:'GK', x:50, y:90},
    {pos:'LB', x:16, y:70}, {pos:'CB', x:38, y:74}, {pos:'CB', x:62, y:74}, {pos:'RB', x:84, y:70},
    {pos:'LM', x:16, y:44}, {pos:'CM', x:38, y:48}, {pos:'CM', x:62, y:48}, {pos:'RM', x:84, y:44},
    {pos:'ST', x:38, y:18}, {pos:'ST', x:62, y:18},
  ],
  '4-3-3': [
    {pos:'GK', x:50, y:90},
    {pos:'LB', x:16, y:70}, {pos:'CB', x:38, y:74}, {pos:'CB', x:62, y:74}, {pos:'RB', x:84, y:70},
    {pos:'CM', x:30, y:48}, {pos:'CM', x:50, y:52}, {pos:'CM', x:70, y:48},
    {pos:'LW', x:18, y:20}, {pos:'ST', x:50, y:16}, {pos:'RW', x:82, y:20},
  ],
  '4-2-3-1': [
    {pos:'GK', x:50, y:90},
    {pos:'LB', x:16, y:71}, {pos:'CB', x:38, y:75}, {pos:'CB', x:62, y:75}, {pos:'RB', x:84, y:71},
    {pos:'DM', x:38, y:57}, {pos:'DM', x:62, y:57},
    {pos:'LM', x:20, y:37}, {pos:'AM', x:50, y:34}, {pos:'RM', x:80, y:37},
    {pos:'ST', x:50, y:15},
  ],
  '3-5-2': [
    {pos:'GK', x:50, y:90},
    {pos:'CB', x:30, y:74}, {pos:'CB', x:50, y:76}, {pos:'CB', x:70, y:74},
    {pos:'LM', x:12, y:50}, {pos:'CM', x:34, y:50}, {pos:'CM', x:50, y:54}, {pos:'CM', x:66, y:50}, {pos:'RM', x:88, y:50},
    {pos:'ST', x:38, y:18}, {pos:'ST', x:62, y:18},
  ],
  '3-4-3': [
    {pos:'GK', x:50, y:90},
    {pos:'CB', x:30, y:74}, {pos:'CB', x:50, y:76}, {pos:'CB', x:70, y:74},
    {pos:'LM', x:16, y:48}, {pos:'CM', x:38, y:50}, {pos:'CM', x:62, y:50}, {pos:'RM', x:84, y:48},
    {pos:'LW', x:22, y:20}, {pos:'ST', x:50, y:16}, {pos:'RW', x:78, y:20},
  ],
};
const DEFAULT_PRESET = '4-4-2';

const FDB = {
  get list() { try { return JSON.parse(localStorage.getItem('swm_formations') || '[]'); } catch { return []; } },
  saveList(v) { localStorage.setItem('swm_formations', JSON.stringify(v)); },
  get current() { try { return JSON.parse(localStorage.getItem('swm_formation_current')); } catch { return null; } },
  saveCurrent(v) { localStorage.setItem('swm_formation_current', JSON.stringify(v)); },
};

function blankFormation() {
  return { id: null, name: '', preset: DEFAULT_PRESET, team: '', assignments: {}, roster: [] };
}
let currentFormation = blankFormation();
let fmDrag = null;

function openFormationScreen() {
  const saved = FDB.current;
  currentFormation = (saved && saved.preset && FORMATIONS[saved.preset]) ? saved : blankFormation();
  if (!currentFormation.assignments) currentFormation.assignments = {};
  if (!currentFormation.roster) currentFormation.roster = [];
  document.getElementById('fm-name').value   = currentFormation.name || '';
  document.getElementById('fm-team').value   = currentFormation.team || '';
  document.getElementById('fm-preset').value = currentFormation.preset || DEFAULT_PRESET;
  renderFormation();
  renderSavedFormations();
  showScreen('formation');
}

function persistCurrent() { FDB.saveCurrent(currentFormation); }
function assignedNames() { return new Set(Object.values(currentFormation.assignments)); }

function renderFormation() {
  const slots = FORMATIONS[currentFormation.preset] || FORMATIONS[DEFAULT_PRESET];
  const pitch = document.getElementById('fm-pitch-slots');
  pitch.innerHTML = slots.map((s, i) => {
    const name = currentFormation.assignments[i];
    if (name) {
      return `<div class="fm-slot filled" data-slot="${i}" style="left:${s.x}%;top:${s.y}%">
                <button class="fm-slot-x" onclick="event.stopPropagation();fmUnassign(${i})" title="外す">×</button>
                <div class="fm-slot-dot">${escHtml(s.pos)}</div>
                <div class="fm-slot-name">${escHtml(name)}</div>
              </div>`;
    }
    return `<div class="fm-slot empty" data-slot="${i}" style="left:${s.x}%;top:${s.y}%">
              <div class="fm-slot-dot">${escHtml(s.pos)}</div>
            </div>`;
  }).join('');

  const assigned = assignedNames();
  const bench = currentFormation.roster.filter(n => !assigned.has(n));
  const benchEl = document.getElementById('fm-bench');
  benchEl.innerHTML = bench.length
    ? bench.map(n => `<div class="fm-chip" data-drag="bench" data-name="${escHtml(n)}">
          <span>${escHtml(n)}</span>
          <button class="fm-chip-x" data-name="${escHtml(n)}" onclick="fmDeletePlayer(event)" title="削除">×</button>
        </div>`).join('')
    : `<div class="fm-bench-empty">控え選手はいません（全員配置済み、または未追加）</div>`;
}

// ドラッグ＆ドロップ（Pointer Events：マウス・タッチ・ペン共通でiPad対応）
function fmElToTarget(el) {
  if (!el) return null;
  const slot = el.closest('.fm-slot');
  if (slot && slot.dataset.slot !== undefined) return { type: 'slot', index: +slot.dataset.slot, el: slot };
  const bench = el.closest('#fm-bench');
  if (bench) return { type: 'bench', el: bench };
  return null;
}

function fmClearHints() {
  document.querySelectorAll('.fm-drop-hint').forEach(el => el.classList.remove('fm-drop-hint'));
  document.getElementById('fm-bench')?.classList.remove('fm-bench-over');
}

function fmPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.target.closest('.fm-chip-x, .fm-slot-x')) return; // ×ボタンはタップ動作を優先
  const chip = e.target.closest('.fm-chip');
  const slot = e.target.closest('.fm-slot.filled');
  let info = null;
  if (chip) info = { from: 'bench', name: chip.dataset.name, srcEl: chip };
  else if (slot) { const i = +slot.dataset.slot; info = { from: 'slot', slotIndex: i, name: currentFormation.assignments[i], srcEl: slot }; }
  if (!info || !info.name) return;
  e.preventDefault();
  fmDrag = { ...info, pointerId: e.pointerId, moved: false, ghost: null, startX: e.clientX, startY: e.clientY };
  try { info.srcEl.setPointerCapture(e.pointerId); } catch {}
  document.addEventListener('pointermove', fmPointerMove);
  document.addEventListener('pointerup', fmPointerUp);
  document.addEventListener('pointercancel', fmPointerUp);
}

function fmPointerMove(e) {
  if (!fmDrag || e.pointerId !== fmDrag.pointerId) return;
  const dx = e.clientX - fmDrag.startX, dy = e.clientY - fmDrag.startY;
  if (!fmDrag.moved && dx * dx + dy * dy < 36) return; // 6px動いたらドラッグ開始
  fmDrag.moved = true;
  e.preventDefault();
  if (!fmDrag.ghost) {
    const g = document.createElement('div');
    g.className = 'fm-ghost';
    g.textContent = fmDrag.name;
    document.body.appendChild(g);
    fmDrag.ghost = g;
  }
  fmDrag.ghost.style.left = e.clientX + 'px';
  fmDrag.ghost.style.top = e.clientY + 'px';
  fmDrag.ghost.style.display = 'none';
  const tgt = fmElToTarget(document.elementFromPoint(e.clientX, e.clientY));
  fmDrag.ghost.style.display = '';
  fmClearHints();
  if (tgt && tgt.type === 'slot') tgt.el.classList.add('fm-drop-hint');
  else if (tgt && tgt.type === 'bench') tgt.el.classList.add('fm-bench-over');
}

function fmPointerUp(e) {
  if (!fmDrag || e.pointerId !== fmDrag.pointerId) return;
  document.removeEventListener('pointermove', fmPointerMove);
  document.removeEventListener('pointerup', fmPointerUp);
  document.removeEventListener('pointercancel', fmPointerUp);
  const drag = fmDrag; fmDrag = null;
  if (drag.ghost) drag.ghost.remove();
  fmClearHints();
  try { drag.srcEl.releasePointerCapture(drag.pointerId); } catch {}
  if (!drag.moved) return; // 動かなければただのタップ（誤操作防止）

  const tgt = fmElToTarget(document.elementFromPoint(e.clientX, e.clientY));
  if (!tgt) return;
  const A = currentFormation.assignments;
  if (tgt.type === 'slot') {
    const i = tgt.index;
    if (drag.from === 'bench') {
      A[i] = drag.name;
    } else if (drag.from === 'slot') {
      const fromI = drag.slotIndex;
      if (fromI === i) return;
      const moving = A[fromI];
      if (A[i] !== undefined) A[fromI] = A[i]; else delete A[fromI];
      A[i] = moving;
    }
  } else if (tgt.type === 'bench') {
    if (drag.from === 'slot') delete A[drag.slotIndex];
  }
  persistCurrent();
  renderFormation();
}

function fmUnassign(i) {
  delete currentFormation.assignments[i];
  persistCurrent();
  renderFormation();
}

function fmAddPlayer() {
  const input = document.getElementById('fm-player-input');
  const name = input.value.trim();
  if (!name) { showToast('選手名を入力してください'); return; }
  if (currentFormation.roster.includes(name)) { showToast('同じ選手がいます'); return; }
  currentFormation.roster.push(name);
  input.value = '';
  input.focus();
  persistCurrent();
  renderFormation();
}

function fmDeletePlayer(e) {
  e.stopPropagation();
  const name = e.currentTarget.dataset.name;
  currentFormation.roster = currentFormation.roster.filter(n => n !== name);
  Object.keys(currentFormation.assignments).forEach(k => {
    if (currentFormation.assignments[k] === name) delete currentFormation.assignments[k];
  });
  persistCurrent();
  renderFormation();
}

function fmChangePreset() {
  const val = document.getElementById('fm-preset').value;
  currentFormation.preset = val;
  const len = FORMATIONS[val].length;
  Object.keys(currentFormation.assignments).forEach(k => { if (+k >= len) delete currentFormation.assignments[k]; });
  persistCurrent();
  renderFormation();
}

function saveFormation() {
  const name = document.getElementById('fm-name').value.trim();
  if (!name) { showToast('フォーメーション名を入力してください'); return; }
  currentFormation.name = name;
  currentFormation.team = document.getElementById('fm-team').value.trim();
  const list = FDB.list;
  if (!currentFormation.id) currentFormation.id = uuid();
  const copy = JSON.parse(JSON.stringify(currentFormation));
  const idx = list.findIndex(f => f.id === currentFormation.id);
  if (idx >= 0) list[idx] = copy; else list.push(copy);
  FDB.saveList(list);
  persistCurrent();
  renderSavedFormations();
  showToast(`「${name}」を保存しました`);
}

function newFormation() {
  currentFormation = blankFormation();
  document.getElementById('fm-name').value   = '';
  document.getElementById('fm-team').value   = '';
  document.getElementById('fm-preset').value = DEFAULT_PRESET;
  persistCurrent();
  renderFormation();
  renderSavedFormations();
}

function loadFormation(id) {
  const f = FDB.list.find(x => x.id === id);
  if (!f) return;
  currentFormation = JSON.parse(JSON.stringify(f));
  if (!currentFormation.assignments) currentFormation.assignments = {};
  if (!currentFormation.roster) currentFormation.roster = [];
  document.getElementById('fm-name').value   = currentFormation.name || '';
  document.getElementById('fm-team').value   = currentFormation.team || '';
  document.getElementById('fm-preset').value = currentFormation.preset || DEFAULT_PRESET;
  persistCurrent();
  renderFormation();
  renderSavedFormations();
  showToast(`「${f.name}」を読み込みました`);
}

async function deleteFormation(id) {
  const f = FDB.list.find(x => x.id === id);
  if (!f) return;
  const ok = await showDialog('フォーメーションを削除', `「${f.name}」を削除しますか？`);
  if (!ok) return;
  FDB.saveList(FDB.list.filter(x => x.id !== id));
  if (currentFormation.id === id) { currentFormation.id = null; persistCurrent(); }
  renderSavedFormations();
  showToast('削除しました');
}

function renderSavedFormations() {
  const list = FDB.list;
  const el = document.getElementById('fm-saved-list');
  if (!list.length) { el.innerHTML = `<div class="fm-saved-empty">保存済みフォーメーションはありません</div>`; return; }
  el.innerHTML = list.map(f => {
    const count = Object.keys(f.assignments || {}).length;
    const active = f.id === currentFormation.id ? ' active' : '';
    return `<div class="fm-saved-item${active}" onclick="loadFormation('${f.id}')">
        <div class="fm-saved-main">
          <div class="fm-saved-name">${escHtml(f.name)}</div>
          <div class="fm-saved-sub">${escHtml(f.preset)}${f.team ? '・' + escHtml(f.team) : ''}・${count}/11人</div>
        </div>
        <button class="fm-saved-x" onclick="event.stopPropagation();deleteFormation('${f.id}')" title="削除">×</button>
      </div>`;
  }).join('');
}

// ===== キーボード・初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ev-player').addEventListener('keydown', e => { if (e.key === 'Enter') addEvent(); });
  document.getElementById('ev-note').addEventListener('keydown',   e => { if (e.key === 'Enter') addEvent(); });
  document.getElementById('ev-minute').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('ev-player').focus(); });
  document.getElementById('m-away').addEventListener('keydown',    e => { if (e.key === 'Enter') startMatch(); });
  document.getElementById('fm-player-input').addEventListener('keydown', e => { if (e.key === 'Enter') fmAddPlayer(); });
  document.getElementById('screen-formation').addEventListener('pointerdown', fmPointerDown);
  refreshDatalists();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
});
