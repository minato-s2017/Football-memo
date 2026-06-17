'use strict';

// ===== チームカラー（カスタム色 → 既定色 → チーム名ハッシュ の順で決定） =====
const TEAM_COLORS = ['#ff5a5f','#ffd23f','#2dc653','#ff7c26','#b5179e','#00d4d4','#7aa0ff','#ff8fab','#9b5de5','#80ed99'];
// チーム別の既定色（ユーザー未指定のときに使う）。日本は青。
const DEFAULT_TEAM_COLORS = { '日本': '#1e63e0' };
const TEAM_COLOR_KEY = 'swm_team_colors';
// ユーザーが設定したチーム色の上書き { チーム名: '#rrggbb' }
function teamColorOverrides() {
  try { const v = JSON.parse(localStorage.getItem(TEAM_COLOR_KEY)); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; } catch { return {}; }
}
function saveTeamColorOverrides(o) { localStorage.setItem(TEAM_COLOR_KEY, JSON.stringify(o)); }
function teamColor(name) {
  if (!name) return '#8a9bc8';
  const ov = teamColorOverrides();
  if (ov[name]) return ov[name];
  if (DEFAULT_TEAM_COLORS[name]) return DEFAULT_TEAM_COLORS[name];
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
const WATCH_METHODS = { stadium: 'スタジアム', tv: 'テレビ', stream: '配信', other: 'その他' };

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
    team:'nav-team',
    formation:'nav-formation',
    standings:'nav-standings',
    tournament:'nav-tournament',
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
  // TEAMタブに登録したチーム名も候補に含める
  try { TEAMDB.ensureSeed(); TEAMDB.allTeamNames().forEach(n => teams.add(n)); } catch {}
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

// ===== 観戦を記録（作成・大会モード） =====
let createStage = 'group';   // 'group' | 'knockout'
let createSel = [];          // 選択中チーム名（最大2・順序＝チーム1,チーム2）

function openCreateScreen() {
  refreshDatalists();
  TEAMDB.ensureSeed();
  createStage = 'group';
  createSel = [];
  document.getElementById('m-group').innerHTML =
    TEAMDB.data.groups.map(g => `<option value="${escHtml(g.id)}">グループ ${escHtml(g.id)}</option>`).join('');
  document.getElementById('m-date').value  = new Date().toISOString().slice(0, 10);
  document.getElementById('m-venue').value = '';
  setMatchStage('group');
  showScreen('create');
}

function setMatchStage(stage) {
  createStage = stage;
  createSel = [];
  document.getElementById('mstage-group').classList.toggle('active', stage === 'group');
  document.getElementById('mstage-knockout').classList.toggle('active', stage === 'knockout');
  document.getElementById('m-group-field').style.display = stage === 'group' ? '' : 'none';
  document.getElementById('m-team-pick-label').textContent = stage === 'group'
    ? 'チーム（グループから2つ選択：先に選んだ方がチーム1）'
    : 'チーム（ベスト32から2つ選択：先に選んだ方がチーム1）';
  renderTeamPick();
}

// 現在のステージ／グループで選べるチーム一覧
function createPickTeams() {
  if (createStage === 'group') {
    const gid = document.getElementById('m-group').value;
    const g = TEAMDB.data.groups.find(x => x.id === gid);
    return g ? g.teams.map(t => t.name) : [];
  }
  return TOURNEY.assignedTeams();
}

function renderTeamPick() {
  createSel = [];   // グループ／ステージ変更時は選択をリセット
  const teams = createPickTeams();
  const wrap = document.getElementById('m-team-pick');
  if (!teams.length) {
    wrap.innerHTML = createStage === 'knockout'
      ? `<div class="team-pick-empty">「Tournament」タブでベスト32にチームを割り当てると、ここから選べます。</div>`
      : `<div class="team-pick-empty">このグループにチームがありません。「Team」タブで追加してください。</div>`;
  } else {
    wrap.innerHTML = teams.map(t =>
      `<button type="button" class="team-pick-chip" data-team="${escHtml(t)}"><span class="tp-dot" style="background:${teamColor(t)}"></span>${escHtml(t)}</button>`
    ).join('');
  }
  syncTeamPickUI();
}

function toggleTeamPick(team) {
  const i = createSel.indexOf(team);
  if (i >= 0) createSel.splice(i, 1);
  else if (createSel.length < 2) createSel.push(team);
  else { showToast('チームは2つまで。選び直すには選択を解除してください'); return; }
  syncTeamPickUI();
}

function syncTeamPickUI() {
  document.querySelectorAll('#m-team-pick .team-pick-chip').forEach(ch => {
    const idx = createSel.indexOf(ch.dataset.team);
    ch.classList.toggle('selected', idx >= 0);
    const old = ch.querySelector('.tp-badge'); if (old) old.remove();
    if (idx >= 0) { const b = document.createElement('span'); b.className = 'tp-badge'; b.textContent = idx === 0 ? '1' : '2'; ch.appendChild(b); }
  });
  const t1 = createSel[0], t2 = createSel[1];
  document.getElementById('m-team-pick-sel').innerHTML = (t1 || t2)
    ? `<span class="tps-item">チーム1：<strong style="color:${t1 ? teamColor(t1) : 'inherit'}">${t1 ? escHtml(t1) : '—'}</strong></span>
       <span class="tps-vs">vs</span>
       <span class="tps-item">チーム2：<strong style="color:${t2 ? teamColor(t2) : 'inherit'}">${t2 ? escHtml(t2) : '—'}</strong></span>`
    : `<span class="tps-empty">チームを2つ選んでください</span>`;
}

function startMatch() {
  const homeTeam = createSel[0] || '';
  const awayTeam = createSel[1] || '';
  const date     = document.getElementById('m-date').value;
  if (!homeTeam || !awayTeam) { showToast('チームを2つ選択してください'); return; }
  if (!date) { showToast('日付を選択してください'); return; }

  const match = {
    id: uuid(),
    competition: 'FIFA WORLD CUP 26',
    stage: createStage,
    homeTeam, awayTeam, date,
    venue:       document.getElementById('m-venue').value.trim(),
    watchMethod: '',
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
let liveHalf = 1;

function openLiveScreen(matchId) {
  currentMatchId = matchId;
  const matches = DB.matches;
  const m = matches.find(x => x.id === matchId);
  if (!m) return;
  ensureLineup(m, 'home'); ensureLineup(m, 'away');   // Formationタブのベースをこの試合へコピー（初回のみ）
  DB.saveMatches(matches);
  refreshDatalists();

  liveSide = 'home'; liveType = 'goal'; liveHalf = 1;
  syncSegButtons();
  evSyncSubFields();

  document.getElementById('live-title').textContent = matchTitle(m);
  document.getElementById('live-sub').textContent =
    [formatDate(m.date), m.competition].filter(Boolean).join('　');

  document.getElementById('ev-minute').value = '';
  document.getElementById('ev-player').value = '';
  document.getElementById('ev-player2').value = '';
  document.getElementById('live-mom').value  = m.mom || '';
  document.getElementById('live-memo').value = m.memo || '';

  renderStartingMember();
  renderScorerPick();
  renderMomPick();
  renderLiveScoreboard();
  renderTimeline();
  renderRatingStars();
  showScreen('live');
}

function setEvSide(side) { liveSide = side; syncSegButtons(); renderScorerPick(); }
function setEvType(type) { liveType = type; syncSegButtons(); evSyncSubFields(); renderScorerPick(); }
function setEvHalf(h) { liveHalf = h; syncSegButtons(); }
function evSyncSubFields() {
  const isSub = liveType === 'sub';
  document.getElementById('ev-player2-field').style.display = isSub ? '' : 'none';
  document.getElementById('ev-player-label').textContent = isSub ? 'OUT（退く選手）' : '選手・内容';
}
function syncSegButtons() {
  document.getElementById('evside-home').classList.toggle('active', liveSide === 'home');
  document.getElementById('evside-away').classList.toggle('active', liveSide === 'away');
  document.getElementById('evhalf-1').classList.toggle('active', liveHalf === 1);
  document.getElementById('evhalf-2').classList.toggle('active', liveHalf === 2);
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
  const playerIn = liveType === 'sub' ? document.getElementById('ev-player2').value.trim() : '';

  const ev = { id: uuid(), minute, half: liveHalf, type: liveType, side: liveSide, player, playerIn, note: '', sketch: '' };
  m.events.push(ev);
  if (liveType === 'sub') applySub(m, ev);
  DB.saveMatches(matches);

  document.getElementById('ev-minute').value = '';
  document.getElementById('ev-player').value = '';
  document.getElementById('ev-player2').value = '';
  // ＋記録後はあえてフォーカスしない（iPadでキーボードが毎回出るのを防ぐ）

  renderLiveScoreboard();
  renderTimeline();
  renderStartingMember();
  renderScorerPick();
  renderMomPick();
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
  renderStartingMember();
  renderScorerPick();
  renderMomPick();
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
      <div class="score-team-label">TEAM 1</div>
      <div class="score-team-name"><span class="score-dot" style="background:${teamColor(m.homeTeam)}"></span>${escHtml(m.homeTeam || '?')}</div>
      <div class="score-team-pts">${hc}</div>
    </div>
    <div class="score-vs">VS</div>
    <div class="score-team">
      <div class="score-team-label">TEAM 2</div>
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
  let main;
  if (e.type === 'sub' && e.playerIn) {
    main = `${e.player ? escHtml(e.player) : '—'} <span class="tl-sub-arrow">→</span> ${escHtml(e.playerIn)}`;
  } else {
    main = e.player ? escHtml(e.player) : `<span style="color:var(--text-muted)">${def.label}</span>`;
  }
  const sketch = e.sketch
    ? `<img class="tl-sketch" src="${e.sketch}" onclick="openSketch('${e.id}')" alt="手書きメモ" title="手書きメモ">`
    : `<button class="tl-memo-btn" onclick="openSketch('${e.id}')" title="手書きメモを追加">✎</button>`;
  const del = editable ? `<button class="tl-del" onclick="deleteEvent('${e.id}')" title="削除">×</button>` : '';
  return `<div class="tl-item ${def.cls}">
    <div class="tl-minute">${minuteLabel(e.minute)}</div>
    <div class="tl-icon">${def.icon}</div>
    <div class="tl-main">
      <div class="tl-player">${tag}${main}</div>
      ${e.note ? `<div class="tl-note-text">${escHtml(e.note)}</div>` : ''}
    </div>
    ${sketch}
    ${del}
  </div>`;
}

// 前半・後半でグループ化して表示
function timelineHtml(m, editable) {
  const evs = sortedEvents(m);
  if (!evs.length) return `<div class="tl-empty">まだイベントがありません。${editable ? '上のフォームから記録してください。' : ''}</div>`;
  const h1 = evs.filter(e => (e.half || 1) === 1);
  const h2 = evs.filter(e => e.half === 2);
  let out = `<div class="tl-half-label">前半</div>`;
  out += h1.length ? h1.map(e => timelineItemHtml(m, e, editable)).join('') : `<div class="tl-empty">前半のイベントなし</div>`;
  out += `<div class="tl-half-label">後半</div>`;
  out += h2.length ? h2.map(e => timelineItemHtml(m, e, editable)).join('') : `<div class="tl-empty">後半のイベントなし</div>`;
  return out;
}

function renderTimeline() {
  const m = DB.matches.find(x => x.id === currentMatchId);
  if (!m) return;
  document.getElementById('live-timeline').innerHTML = timelineHtml(m, true);
}

// ===== 手書きメモ（各イベント・キャンバス描画） =====
let sketchEventId = null, sketchCtx = null, sketchDrawing = false, sketchLast = null;
let sketchColor = '#14245e', sketchEraser = false, sketchUndoStack = [];
const SKETCH_PEN = 6, SKETCH_ERASER = 24;
function sketchPitchBg() {
  const c = document.getElementById('sketch-canvas'); const ctx = sketchCtx, W = c.width, H = c.height;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#c8d2e0'; ctx.lineWidth = 1.5;
  const mg = 8;
  ctx.strokeRect(mg, mg, W - 2*mg, H - 2*mg);
  ctx.beginPath(); ctx.moveTo(mg, H/2); ctx.lineTo(W - mg, H/2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W/2, H/2, 34, 0, Math.PI*2); ctx.stroke();
  const bw = W*0.5, bh = H*0.12;
  ctx.strokeRect((W-bw)/2, mg, bw, bh);
  ctx.strokeRect((W-bw)/2, H - mg - bh, bw, bh);
}
function sketchSetColor(c, btnId) {
  sketchColor = c; sketchEraser = false;
  document.querySelectorAll('.sketch-color').forEach(b => b.classList.toggle('active', b.id === btnId));
  document.getElementById('sketch-eraser').classList.remove('active');
}
function sketchToggleEraser() {
  sketchEraser = !sketchEraser;
  document.getElementById('sketch-eraser').classList.toggle('active', sketchEraser);
}
function sketchPushUndo() {
  if (!sketchCtx) return;
  const c = document.getElementById('sketch-canvas');
  try { sketchUndoStack.push(sketchCtx.getImageData(0, 0, c.width, c.height)); } catch {}
  if (sketchUndoStack.length > 25) sketchUndoStack.shift();
}
function sketchUndo() {
  if (!sketchCtx || !sketchUndoStack.length) return;
  sketchCtx.putImageData(sketchUndoStack.pop(), 0, 0);
}
function openSketch(eid) {
  const m = DB.matches.find(x => x.id === currentMatchId); if (!m) return;
  const ev = m.events.find(e => e.id === eid); if (!ev) return;
  sketchEventId = eid;
  const c = document.getElementById('sketch-canvas');
  sketchCtx = c.getContext('2d');
  sketchColor = '#14245e'; sketchEraser = false; sketchUndoStack = [];
  document.querySelectorAll('.sketch-color').forEach((b, i) => b.classList.toggle('active', i === 0));
  document.getElementById('sketch-eraser').classList.remove('active');
  sketchPitchBg();
  if (ev.sketch) { const img = new Image(); img.onload = () => sketchCtx.drawImage(img, 0, 0, c.width, c.height); img.src = ev.sketch; }
  document.getElementById('sketch-modal').classList.remove('hidden');
}
function closeSketch() { document.getElementById('sketch-modal').classList.add('hidden'); sketchEventId = null; sketchDrawing = false; }
function sketchClear() { if (sketchCtx) { sketchPushUndo(); sketchPitchBg(); } }
function sketchPos(e) {
  const c = document.getElementById('sketch-canvas'); const r = c.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
}
function sketchDown(e) { if (!sketchCtx) return; e.preventDefault(); sketchPushUndo(); sketchDrawing = true; sketchLast = sketchPos(e); }
function sketchMove(e) {
  if (!sketchDrawing || !sketchCtx) return; e.preventDefault();
  const p = sketchPos(e), ctx = sketchCtx;
  ctx.strokeStyle = sketchEraser ? '#ffffff' : sketchColor;
  ctx.lineWidth = sketchEraser ? SKETCH_ERASER : SKETCH_PEN;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(sketchLast.x, sketchLast.y); ctx.lineTo(p.x, p.y); ctx.stroke();
  sketchLast = p;
}
function sketchEnd() { sketchDrawing = false; }
function sketchSave() {
  const c = document.getElementById('sketch-canvas');
  const data = c.toDataURL('image/png');
  const matches = DB.matches; const m = matches.find(x => x.id === currentMatchId);
  const ev = m && m.events.find(e => e.id === sketchEventId);
  if (ev) { ev.sketch = data; DB.saveMatches(matches); }
  closeSketch();
  const active = document.querySelector('.screen.active')?.id;
  if (active === 'screen-detail') openMatchDetail(currentMatchId);
  else renderTimeline();
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
    list.innerHTML = `<div class="empty-state">観戦の記録がありません。<br>「観戦を記録」から始めましょう。</div>`;
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

// ===== チーム名の色を編集（History画面） =====
function tcTeamsFromMatches() {
  return [...new Set(DB.matches.flatMap(m => [m.homeTeam, m.awayTeam]).filter(Boolean))].sort();
}
function tcListHtml() {
  const ov = teamColorOverrides();
  const teams = tcTeamsFromMatches();
  if (!teams.length) return `<div class="tc-empty">記録に登場するチームがありません。<br>観戦を記録すると、ここで色を変えられます。</div>`;
  return teams.map(t => {
    const c = teamColor(t);
    const badge = ov[t] ? `<span class="tc-badge">変更済</span>` : '';
    return `<div class="tc-row" data-team="${escHtml(t)}">
        <span class="tc-dot" style="background:${c}"></span>
        <span class="tc-name" style="color:${c}">${escHtml(t)}</span>
        ${badge}
        <input type="color" class="tc-input" value="${c}" aria-label="${escHtml(t)} の色">
        <button class="tc-reset" type="button">リセット</button>
      </div>`;
  }).join('');
}
function openTeamColorEdit() {
  document.getElementById('tc-list').innerHTML = tcListHtml();
  document.getElementById('team-color-modal').classList.remove('hidden');
}
function closeTeamColorEdit() {
  document.getElementById('team-color-modal').classList.add('hidden');
  openHistoryScreen();
}
function setTeamColor(team, color) {
  if (!team) return;
  const ov = teamColorOverrides();
  ov[team] = color;
  saveTeamColorOverrides(ov);
}
function clearTeamColor(team) {
  if (!team) return;
  const ov = teamColorOverrides();
  delete ov[team];
  saveTeamColorOverrides(ov);
  document.getElementById('tc-list').innerHTML = tcListHtml();
}
async function resetAllTeamColors() {
  const ok = await showDialog('色をリセット', 'すべてのチーム色をデフォルトに戻しますか？');
  if (!ok) return;
  localStorage.removeItem(TEAM_COLOR_KEY);
  document.getElementById('tc-list').innerHTML = tcListHtml();
  showToast('チーム色をデフォルトに戻しました');
}

// ===== 観戦の詳細 =====
function openMatchDetail(matchId) {
  currentMatchId = matchId;
  const matches = DB.matches;
  const m = matches.find(x => x.id === matchId);
  if (!m) return;
  ensureLineup(m, 'home'); ensureLineup(m, 'away');   // Formationタブのベースをこの試合へ用意（初回のみ）
  DB.saveMatches(matches);

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

  document.getElementById('detail-timeline').innerHTML = timelineHtml(m, false);

  const starHtml = [1,2,3,4,5].map(n => `<span class="star readonly ${n <= (m.rating||0) ? 'on' : ''}">★</span>`).join('');
  const reviewParts = [];
  reviewParts.push(`<div class="detail-review-row">
      <div class="rating-stars">${starHtml}</div>
      ${m.mom ? `<div class="mom-pill">MOM：${escHtml(m.mom)}</div>` : ''}
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

  renderSMInto(document.getElementById('detail-sm-canvas-wrap'), m);

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
  TEAMDB.ensureSeed();
  // グループリーグの試合のみ集計（決勝トーナメントは除外。stage未設定のレガシーはグループ扱い）
  const matches = DB.matches.filter(m => m.finished && m.homeTeam && m.awayTeam && m.stage !== 'knockout');

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

  const withPts = s => ({ ...s, pts: s.w * 3 + s.d, diff: s.gf - s.ga });
  const sortFn = (a, b) => b.pts - a.pts || b.diff - a.diff || b.gf - a.gf || a.name.localeCompare(b.name);
  const medal = ['gold','silver','bronze'];

  // チーム名 → 所属フォルダ(グループ)
  const teamFolder = {};
  TEAMDB.data.groups.forEach(g => g.teams.forEach(t => { teamFolder[t.name] = g.id; }));

  // 成績のあるチームをフォルダ別に振り分け
  const folderTeams = {};
  const unsorted = [];
  Object.values(stats).filter(s => s.gp > 0).forEach(s => {
    const fid = teamFolder[s.name];
    if (fid !== undefined) (folderTeams[fid] = folderTeams[fid] || []).push(withPts(s));
    else unsorted.push(withPts(s));
  });

  const tableHtml = (teams) => {
    const rows = teams.slice().sort(sortFn).map((t, rank) => `
      <div class="ranking-row">
        <div class="rank-num ${rank < 3 ? medal[rank] : ''}">${rank + 1}</div>
        <div class="rank-name"><div class="team-color-dot" style="background:${teamColor(t.name)}"></div>${escHtml(t.name)}</div>
        <div class="rank-cell">${t.gp}</div>
        <div class="rank-cell win">${t.w}</div>
        <div class="rank-cell draw">${t.d}</div>
        <div class="rank-cell loss">${t.l}</div>
        <div class="rank-cell">${t.diff >= 0 ? '+' : ''}${t.diff}</div>
        <div class="rank-cell pts-col">${t.pts}</div>
      </div>`).join('');
    return `<div class="ranking-table">
        <div class="ranking-header">
          <div></div><div>チーム</div>
          <div style="text-align:center">試合</div>
          <div style="text-align:center;color:var(--success)">勝</div>
          <div style="text-align:center">分</div>
          <div style="text-align:center;color:var(--danger)">負</div>
          <div style="text-align:center">得失</div>
          <div style="text-align:center;color:var(--accent-light)">勝点</div>
        </div>${rows}
      </div>`;
  };

  let html = '';
  TEAMDB.data.groups.forEach(g => {
    const ts = folderTeams[g.id];
    if (ts && ts.length) html += `<div class="standings-group"><div class="standings-group-head">グループ ${escHtml(g.id)}</div>${tableHtml(ts)}</div>`;
  });
  if (unsorted.length) html += `<div class="standings-group"><div class="standings-group-head">未分類（フォルダ未登録）</div>${tableHtml(unsorted)}</div>`;

  document.getElementById('standings-table-area').innerHTML = html ||
    `<div class="empty-state">グループリーグの記録がありません。<br>グループリーグの試合を記録すると成績表が作られます。</div>`;

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

// ===== 集計（大会・チームで絞り込み） =====
function openAggScreen() {
  const matches = DB.matches;
  const teams = [...new Set(matches.flatMap(m => [m.homeTeam, m.awayTeam]).filter(Boolean))].sort();
  const teamSel = document.getElementById('agg-team');
  const prevTeam = teamSel.value;
  teamSel.innerHTML = `<option value="">すべてのチーム</option>` + teams.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
  if ([...teamSel.options].some(o => o.value === prevTeam)) teamSel.value = prevTeam;
  calcAgg();
  showScreen('agg');
}

const AGG_MEDAL = ['gold', 'silver', 'bronze'];

function calcAgg() {
  const comp = 'FIFA WORLD CUP 26';   // 大会は固定（表示用）
  const team = document.getElementById('agg-team').value;
  let matches = DB.matches.slice();
  if (team) matches = matches.filter(m => m.homeTeam === team || m.awayTeam === team);

  const result = document.getElementById('agg-result');
  if (matches.length === 0) {
    result.innerHTML = `<div class="empty-state">該当する観戦記録がありません。</div>`;
    return;
  }

  if (team) { result.innerHTML = aggTeamHtml(matches, team, comp); return; }
  result.innerHTML = aggOverallHtml(matches, comp);
}

// チーム別スタッツ
function aggTeamHtml(matches, team, comp) {
  let gp = 0, w = 0, d = 0, l = 0, gf = 0, ga = 0, ratingSum = 0, ratingCnt = 0;
  const scorers = {};
  matches.forEach(m => {
    const side = m.homeTeam === team ? 'home' : 'away';
    const ts = goalCount(m, side), os = goalCount(m, side === 'home' ? 'away' : 'home');
    gp++; gf += ts; ga += os;
    if (m.finished) { if (ts > os) w++; else if (os > ts) l++; else d++; }
    (m.events || []).forEach(e => { if (e.type === 'goal' && e.side === side && e.player) scorers[e.player] = (scorers[e.player] || 0) + 1; });
    if (m.rating) { ratingSum += m.rating; ratingCnt++; }
  });
  const pts = w * 3 + d, diff = gf - ga, avg = ratingCnt ? (ratingSum / ratingCnt).toFixed(1) : '—';
  const summary = `<div class="summary-grid">
    <div class="summary-card"><div class="summary-value">${gp}</div><div class="summary-label">試合数</div></div>
    <div class="summary-card"><div class="summary-value">${w}-${d}-${l}</div><div class="summary-label">勝-分-負</div></div>
    <div class="summary-card"><div class="summary-value">${pts}</div><div class="summary-label">勝点</div></div>
    <div class="summary-card"><div class="summary-value">${gf} / ${ga}</div><div class="summary-label">得点 / 失点</div></div>
    <div class="summary-card"><div class="summary-value">${diff >= 0 ? '+' : ''}${diff}</div><div class="summary-label">得失点差</div></div>
    <div class="summary-card"><div class="summary-value">${avg}</div><div class="summary-label">平均★評価</div></div>
  </div>`;
  const arr = Object.entries(scorers).map(([n, g]) => ({ n, g })).sort((a, b) => b.g - a.g || a.n.localeCompare(b.n));
  const sRows = arr.length
    ? arr.map((s, i) => `<div class="stats-table-row"><div class="stat-rank ${i < 3 ? AGG_MEDAL[i] : ''}">${i + 1}</div><div class="stat-cell name">${escHtml(s.n)}</div><div class="stat-cell">${s.g}</div><div></div></div>`).join('')
    : `<div class="stats-table-row"><div></div><div class="stat-cell name" style="color:var(--text-muted)">得点者の記録なし</div><div></div><div></div></div>`;
  const scorerTable = `<div class="stats-table"><div class="stats-table-title">${escHtml(team)} の得点者</div><div class="stats-table-header"><div></div><div>選手</div><div style="text-align:center">ゴール</div><div></div></div>${sRows}</div>`;
  const matchRows = matches.slice().reverse().map(m => {
    const side = m.homeTeam === team ? 'home' : 'away';
    const ts = goalCount(m, side), os = goalCount(m, side === 'home' ? 'away' : 'home');
    const res = !m.finished ? '観戦中' : (ts > os ? '勝' : (os > ts ? '負' : '分'));
    const opp = side === 'home' ? m.awayTeam : m.homeTeam;
    return `<div class="event-row" onclick="openMatchDetail('${m.id}')">
        <div><div class="event-row-name">vs ${escHtml(opp)}</div><div class="event-row-date">${[formatDate(m.date), m.competition].filter(Boolean).join('　')}</div></div>
        <div class="event-row-score">${ts} - ${os}</div>
        <span class="event-badge ${m.finished ? '' : 'ongoing'}">${res}</span>
      </div>`;
  }).join('');
  return `<div style="margin-bottom:14px;"><div style="font-size:13px;color:var(--text-muted);">${escHtml(team)}${comp ? '（' + escHtml(comp) + '）' : ''} — ${gp}試合の集計</div></div>
    ${summary}${scorerTable}
    <div class="section-title" style="margin:6px 0 12px;">試合一覧</div><div class="event-list">${matchRows}</div>`;
}

// 全体（チーム指定なし）
function aggOverallHtml(matches, comp) {
  let totalGoals = 0, yellow = 0, red = 0, ratingSum = 0, ratingCnt = 0;
  const scorers = {}, moms = {};
  matches.forEach(m => {
    (m.events || []).forEach(e => {
      if (e.type === 'goal') { totalGoals++; if (e.player) { scorers[e.player] = scorers[e.player] || { g: 0, set: new Set() }; scorers[e.player].g++; scorers[e.player].set.add(m.id); } }
      else if (e.type === 'yellow') yellow++;
      else if (e.type === 'red') red++;
    });
    if (m.rating) { ratingSum += m.rating; ratingCnt++; }
    if (m.mom) moms[m.mom] = (moms[m.mom] || 0) + 1;
  });
  const avgGoals = (totalGoals / matches.length).toFixed(1);
  const avgRating = ratingCnt ? (ratingSum / ratingCnt).toFixed(1) : '—';
  const summary = `<div class="summary-grid">
    <div class="summary-card"><div class="summary-value">${matches.length}</div><div class="summary-label">観戦試合数</div></div>
    <div class="summary-card"><div class="summary-value">${totalGoals}</div><div class="summary-label">総ゴール数</div></div>
    <div class="summary-card"><div class="summary-value">${avgGoals}</div><div class="summary-label">平均ゴール / 試合</div></div>
    <div class="summary-card"><div class="summary-value">${avgRating}</div><div class="summary-label">平均★評価</div></div>
    <div class="summary-card"><div class="summary-value">${yellow}</div><div class="summary-label">警告（イエロー）</div></div>
    <div class="summary-card"><div class="summary-value">${red}</div><div class="summary-label">退場（レッド）</div></div>
  </div>`;
  const sArr = Object.entries(scorers).map(([n, s]) => ({ n, g: s.g, games: s.set.size })).sort((a, b) => b.g - a.g || a.n.localeCompare(b.n));
  const sRows = sArr.length
    ? sArr.map((s, i) => `<div class="stats-table-row"><div class="stat-rank ${i < 3 ? AGG_MEDAL[i] : ''}">${i + 1}</div><div class="stat-cell name">${escHtml(s.n)}</div><div class="stat-cell">${s.g}</div><div class="stat-cell sub">${s.games}試合</div></div>`).join('')
    : `<div class="stats-table-row"><div></div><div class="stat-cell name" style="color:var(--text-muted)">得点者の記録なし</div><div></div><div></div></div>`;
  const scorerTable = `<div class="stats-table"><div class="stats-table-title">得点者ランキング</div><div class="stats-table-header"><div></div><div>選手</div><div style="text-align:center">ゴール</div><div style="text-align:center">出場試合</div></div>${sRows}</div>`;
  const mArr = Object.entries(moms).map(([n, c]) => ({ n, c })).sort((a, b) => b.c - a.c || a.n.localeCompare(b.n));
  const momTable = mArr.length ? `<div class="stats-table"><div class="stats-table-title">MOM 獲得回数</div><div class="stats-table-header"><div></div><div>選手</div><div style="text-align:center">回数</div><div></div></div>${mArr.map((s, i) => `<div class="stats-table-row"><div class="stat-rank ${i < 3 ? AGG_MEDAL[i] : ''}">${i + 1}</div><div class="stat-cell name">${escHtml(s.n)}</div><div class="stat-cell">${s.c}</div><div></div></div>`).join('')}</div>` : '';
  return `<div style="margin-bottom:14px;"><div style="font-size:13px;color:var(--text-muted);">${comp ? escHtml(comp) : 'すべての大会'} — ${matches.length}試合を集計</div></div>${summary}${scorerTable}${momTable}`;
}

// ===== フォーメーション（チーム名で管理・TEAM選手連携・自由配置・PNG/PDF出力） =====
const FORMATIONS = {
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
  '3-4-2-1': [
    {pos:'GK', x:50, y:90},
    {pos:'CB', x:28, y:74}, {pos:'CB', x:50, y:76}, {pos:'CB', x:72, y:74},
    {pos:'LM', x:15, y:52}, {pos:'CM', x:38, y:54}, {pos:'CM', x:62, y:54}, {pos:'RM', x:85, y:52},
    {pos:'AM', x:35, y:32}, {pos:'AM', x:65, y:32},
    {pos:'ST', x:50, y:16},
  ],
  '4-4-2': [
    {pos:'GK', x:50, y:90},
    {pos:'LB', x:16, y:70}, {pos:'CB', x:38, y:74}, {pos:'CB', x:62, y:74}, {pos:'RB', x:84, y:70},
    {pos:'LM', x:16, y:44}, {pos:'CM', x:38, y:48}, {pos:'CM', x:62, y:48}, {pos:'RM', x:84, y:44},
    {pos:'ST', x:38, y:18}, {pos:'ST', x:62, y:18},
  ],
  '5-4-1': [
    {pos:'GK', x:50, y:90},
    {pos:'LB', x:12, y:72}, {pos:'CB', x:31, y:76}, {pos:'CB', x:50, y:78}, {pos:'CB', x:69, y:76}, {pos:'RB', x:88, y:72},
    {pos:'LM', x:16, y:48}, {pos:'CM', x:38, y:50}, {pos:'CM', x:62, y:50}, {pos:'RM', x:84, y:48},
    {pos:'ST', x:50, y:18},
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
  '5-3-2': [
    {pos:'GK', x:50, y:90},
    {pos:'LB', x:12, y:72}, {pos:'CB', x:31, y:76}, {pos:'CB', x:50, y:78}, {pos:'CB', x:69, y:76}, {pos:'RB', x:88, y:72},
    {pos:'CM', x:28, y:50}, {pos:'CM', x:50, y:52}, {pos:'CM', x:72, y:50},
    {pos:'ST', x:38, y:20}, {pos:'ST', x:62, y:20},
  ],
  '3-1-4-2': [
    {pos:'GK', x:50, y:90},
    {pos:'CB', x:28, y:75}, {pos:'CB', x:50, y:77}, {pos:'CB', x:72, y:75},
    {pos:'DM', x:50, y:60},
    {pos:'LM', x:16, y:44}, {pos:'CM', x:39, y:46}, {pos:'CM', x:61, y:46}, {pos:'RM', x:84, y:44},
    {pos:'ST', x:38, y:20}, {pos:'ST', x:62, y:20},
  ],
};
const PRESET_ORDER = ['4-3-3','4-2-3-1','3-4-2-1','4-4-2','5-4-1','3-5-2','3-4-3','5-3-2','3-1-4-2'];
const DEFAULT_PRESET = '4-4-2';

// チーム名をキーに保存：{ [teamName]: { preset, layout, assignments } }
const FDB = {
  get all() { try { const v = JSON.parse(localStorage.getItem('swm_formations')); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; } catch { return {}; } },
  saveAll(v) { localStorage.setItem('swm_formations', JSON.stringify(v)); },
  get(team) { return this.all[team] || null; },
  set(team, f) { const a = this.all; a[team] = f; this.saveAll(a); },
  remove(team) { const a = this.all; delete a[team]; this.saveAll(a); },
};

// 編集中の状態
let fmTeam = '';
let fmPreset = DEFAULT_PRESET;
let fmLayout = null;   // 'custom'時の座標 [{pos,x,y}]、それ以外は null
let fmAssign = {};     // slotIndex -> 選手名
let fmDrag = null;     // 選手のドラッグ
let fmSlotDrag = null; // スロット位置のドラッグ（カスタム）

function fmCurSlots() {
  if (fmPreset === 'custom' && Array.isArray(fmLayout)) return fmLayout;
  return FORMATIONS[fmPreset] || FORMATIONS[DEFAULT_PRESET];
}
function fmSquadOf(team) {
  if (!team) return [];
  const sq = fmSquadByPos(team);
  return sq ? [...(sq.GK||[]), ...(sq.DF||[]), ...(sq.MF||[]), ...(sq.FW||[])] : [];
}
function fmSquadByPos(team) {
  if (!team) return null;
  for (const g of TEAMDB.data.groups) {
    const t = g.teams.find(x => x.name === team);
    if (t && t.squad) return t.squad;
  }
  return null;
}
function fmAssignedNames() { return new Set(Object.values(fmAssign)); }

// チーム選択セレクトを Team タブのチームで埋める（フォルダごとに optgroup）
function fmPopulateTeamSelect(ensureTeam) {
  const sel = document.getElementById('fm-team');
  if (!sel) return;
  let html = `<option value="">（チームを選択）</option>`;
  TEAMDB.data.groups.forEach(g => {
    if (!g.teams.length) return;
    html += `<optgroup label="グループ ${escHtml(g.id)}">` +
      g.teams.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join('') + `</optgroup>`;
  });
  if (ensureTeam && !TEAMDB.allTeamNames().includes(ensureTeam)) {
    html += `<optgroup label="その他"><option value="${escHtml(ensureTeam)}">${escHtml(ensureTeam)}</option></optgroup>`;
  }
  sel.innerHTML = html;
}

// 新規作成（画面をリセットして続けて作れるように）
function fmNewFormation() {
  fmMatchCtx = null;
  fmTeam = ''; fmPreset = DEFAULT_PRESET; fmLayout = null; fmAssign = {};
  fmPopulateTeamSelect();
  document.getElementById('fm-team').value = '';
  document.getElementById('fm-preset').value = DEFAULT_PRESET;
  fmUpdateMatchBanner();
  fmPersist();
  renderFormation();
  renderSavedFormations();
  showToast('新規作成：チームを選んでください');
}

function openFormationScreen() {
  TEAMDB.ensureSeed();
  fmMatchCtx = null;
  let cur = null;
  try { cur = JSON.parse(localStorage.getItem('swm_formation_current')); } catch {}
  if (cur && cur.team !== undefined) {
    fmTeam = cur.team || ''; fmPreset = cur.preset || DEFAULT_PRESET; fmLayout = cur.layout || null; fmAssign = cur.assignments || {};
  } else { fmTeam = ''; fmPreset = DEFAULT_PRESET; fmLayout = null; fmAssign = {}; }
  refreshDatalists();
  fmPopulateTeamSelect(fmTeam);
  document.getElementById('fm-team').value = fmTeam;
  document.getElementById('fm-preset').value = fmPreset;
  fmUpdateMatchBanner();
  renderFormation();
  renderSavedFormations();
  showScreen('formation');
}

function fmPersist() {
  localStorage.setItem('swm_formation_current', JSON.stringify({ team: fmTeam, preset: fmPreset, layout: fmLayout, assignments: fmAssign }));
}

function fmSelectTeam() {
  fmTeam = document.getElementById('fm-team').value.trim();
  const saved = FDB.get(fmTeam);
  if (saved) { fmPreset = saved.preset || DEFAULT_PRESET; fmLayout = saved.layout || null; fmAssign = Object.assign({}, saved.assignments); }
  else { fmPreset = DEFAULT_PRESET; fmLayout = null; fmAssign = {}; }
  document.getElementById('fm-preset').value = fmPreset;
  fmPersist(); renderFormation(); renderSavedFormations();
}

// 「背番号 名前」を分解（背番号は〇内に、名前は全表示）
function splitPlayer(s) {
  const str = String(s == null ? '' : s).trim();
  const mm = str.match(/^(\d+)\s+(.+)$/);
  return mm ? { no: mm[1], name: mm[2] } : { no: '', name: str };
}
// 名前を1行に収めるフォントサイズ（改行を避ける）。幅 maxW(px) に合わせて 11→7px で縮小。
let _fmNameMeasure = null;
function fmFitFont(text, maxW) {
  if (!_fmNameMeasure) _fmNameMeasure = document.createElement('canvas').getContext('2d');
  const f = px => `700 ${px}px -apple-system,'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif`;
  let fs = 11;
  _fmNameMeasure.font = f(fs);
  while (_fmNameMeasure.measureText(text).width > maxW && fs > 7) { fs -= 0.5; _fmNameMeasure.font = f(fs); }
  return fs;
}
function renderFormation() {
  const slots = fmCurSlots();
  const isCustom = fmPreset === 'custom';
  const pitch = document.getElementById('fm-pitch-slots');
  pitch.innerHTML = slots.map((s, i) => {
    const name = fmAssign[i];
    const mv = isCustom ? ' fm-slot-movable' : '';
    if (name) {
      const sp = splitPlayer(name);
      return `<div class="fm-slot filled${mv}" data-slot="${i}" style="left:${s.x}%;top:${s.y}%">
                <button class="fm-slot-x" onclick="event.stopPropagation();fmUnassign(${i})" title="外す">×</button>
                <div class="fm-slot-dot">${escHtml(sp.no || s.pos)}</div>
                <div class="fm-slot-name" style="font-size:${fmFitFont(sp.name, 92)}px">${escHtml(sp.name)}</div>
              </div>`;
    }
    return `<div class="fm-slot empty${mv}" data-slot="${i}" style="left:${s.x}%;top:${s.y}%">
              <div class="fm-slot-dot">${escHtml(s.pos)}</div>
            </div>`;
  }).join('');

  const sq = fmSquadByPos(fmTeam);
  const benchEl = document.getElementById('fm-bench');
  const total = sq ? (sq.GK||[]).length + (sq.DF||[]).length + (sq.MF||[]).length + (sq.FW||[]).length : 0;
  if (!fmTeam) {
    benchEl.innerHTML = `<div class="fm-bench-empty">上の「チーム」を選ぶと選手が並びます</div>`;
  } else if (total === 0) {
    benchEl.innerHTML = `<div class="fm-bench-empty">「${escHtml(fmTeam)}」の選手が未登録です。Teamタブで登録してください</div>`;
  } else {
    const assigned = fmAssignedNames();
    let html = '';
    ['GK','DF','MF','FW'].forEach(pos => {
      const list = (sq[pos] || []).filter(n => !assigned.has(n));
      if (!list.length) return;
      html += `<div class="fm-bench-pos"><span class="fm-bench-pos-label">${pos}</span>` +
        list.map(n => `<div class="fm-chip" data-drag="bench" data-name="${escHtml(n)}">${escHtml(n)}</div>`).join('') + `</div>`;
    });
    benchEl.innerHTML = html || `<div class="fm-bench-empty">全員配置済み</div>`;
  }
  document.getElementById('fm-custom-hint').style.display = isCustom ? '' : 'none';
}

function fmChangePreset() {
  const val = document.getElementById('fm-preset').value;
  if (val === 'custom') {
    const base = (fmPreset === 'custom' && Array.isArray(fmLayout)) ? fmLayout : fmCurSlots();
    fmLayout = base.map(s => ({ pos: s.pos, x: s.x, y: s.y }));
    fmPreset = 'custom';
  } else {
    fmPreset = val; fmLayout = null;
  }
  fmPersist();
  renderFormation();
}

// ---- ドラッグ＆ドロップ（Pointer Events：マウス・タッチ共通） ----
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
  if (e.target.closest('.fm-slot-x')) return; // ×ボタンはタップ動作を優先

  // カスタム：スロットの位置をドラッグで移動
  if (fmPreset === 'custom') {
    const slotEl = e.target.closest('.fm-slot');
    if (slotEl && slotEl.dataset.slot !== undefined) {
      e.preventDefault();
      const rect = document.getElementById('fm-pitch').getBoundingClientRect();
      fmSlotDrag = { i: +slotEl.dataset.slot, el: slotEl, rect, pointerId: e.pointerId };
      try { slotEl.setPointerCapture(e.pointerId); } catch {}
      document.addEventListener('pointermove', fmSlotMove);
      document.addEventListener('pointerup', fmSlotUp);
      document.addEventListener('pointercancel', fmSlotUp);
      return;
    }
  }

  // 通常：選手のドラッグ（控え→枠、枠↔枠）
  const chip = e.target.closest('.fm-chip');
  const slot = e.target.closest('.fm-slot.filled');
  let info = null;
  if (chip) info = { from: 'bench', name: chip.dataset.name, srcEl: chip };
  else if (slot) { const i = +slot.dataset.slot; info = { from: 'slot', slotIndex: i, name: fmAssign[i], srcEl: slot }; }
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
  if (!fmDrag.moved && dx * dx + dy * dy < 36) return;
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
  if (!drag.moved) return;

  const tgt = fmElToTarget(document.elementFromPoint(e.clientX, e.clientY));
  if (!tgt) return;
  const A = fmAssign;
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
  fmPersist();
  renderFormation();
}

function fmSlotMove(e) {
  if (!fmSlotDrag || e.pointerId !== fmSlotDrag.pointerId) return;
  e.preventDefault();
  const r = fmSlotDrag.rect;
  let x = (e.clientX - r.left) / r.width * 100;
  let y = (e.clientY - r.top) / r.height * 100;
  x = Math.max(4, Math.min(96, x)); y = Math.max(4, Math.min(96, y));
  fmLayout[fmSlotDrag.i].x = Math.round(x * 10) / 10;
  fmLayout[fmSlotDrag.i].y = Math.round(y * 10) / 10;
  fmSlotDrag.el.style.left = x + '%';
  fmSlotDrag.el.style.top = y + '%';
}
function fmSlotUp(e) {
  if (!fmSlotDrag || e.pointerId !== fmSlotDrag.pointerId) return;
  document.removeEventListener('pointermove', fmSlotMove);
  document.removeEventListener('pointerup', fmSlotUp);
  document.removeEventListener('pointercancel', fmSlotUp);
  try { fmSlotDrag.el.releasePointerCapture(fmSlotDrag.pointerId); } catch {}
  fmSlotDrag = null;
  fmPersist();
}

function fmUnassign(i) { delete fmAssign[i]; fmPersist(); renderFormation(); }

function saveFormation() {
  if (fmMatchCtx) {
    const matches = DB.matches;
    const m = matches.find(x => x.id === fmMatchCtx.matchId);
    if (!m) { showToast('試合が見つかりません'); return; }
    if (!m.lineups) m.lineups = {};
    m.lineups[fmMatchCtx.side] = JSON.parse(JSON.stringify({ preset: fmPreset, layout: fmLayout, assignments: fmAssign }));
    DB.saveMatches(matches);
    showToast('この試合の布陣を保存しました（プリセットは変更なし）');
    return;
  }
  if (!fmTeam) { showToast('チームを選択してください'); return; }
  FDB.set(fmTeam, { preset: fmPreset, layout: fmLayout, assignments: fmAssign });
  fmPersist();
  renderSavedFormations();
  showToast(`「${fmTeam}」のフォーメーションを保存しました`);
}

function renderSavedFormations() {
  const all = FDB.all;
  const teams = Object.keys(all);
  const el = document.getElementById('fm-saved-list');
  if (!teams.length) { el.innerHTML = `<div class="fm-saved-empty">保存済みフォーメーションはありません</div>`; return; }
  el.innerHTML = teams.map(tn => {
    const f = all[tn];
    const cnt = Object.keys(f.assignments || {}).length;
    const active = tn === fmTeam ? ' active' : '';
    const pl = f.preset === 'custom' ? 'カスタム' : (f.preset || '');
    return `<div class="fm-saved-item${active}" data-team="${escHtml(tn)}" onclick="fmLoadSaved(event)">
        <div class="fm-saved-main">
          <div class="fm-saved-name">${escHtml(tn)}</div>
          <div class="fm-saved-sub">${escHtml(pl)}・${cnt}/11人</div>
        </div>
        <button class="fm-saved-x" data-team="${escHtml(tn)}" onclick="event.stopPropagation();fmDeleteSaved(event)" title="削除">×</button>
      </div>`;
  }).join('');
}
function fmLoadSaved(e) {
  const team = e.currentTarget.dataset.team;
  document.getElementById('fm-team').value = team;
  fmSelectTeam();
}
async function fmDeleteSaved(e) {
  const team = e.currentTarget.dataset.team;
  const ok = await showDialog('削除', `「${team}」の保存フォーメーションを削除しますか？`);
  if (!ok) return;
  FDB.remove(team);
  renderSavedFormations();
  showToast('削除しました');
}

// ---- PNG / PDF 出力 ----
function fmRenderCanvas(opts) {
  opts = opts || {};
  const team   = opts.team !== undefined ? opts.team : fmTeam;
  const preset = opts.preset !== undefined ? opts.preset : fmPreset;
  const layout = opts.layout !== undefined ? opts.layout : fmLayout;
  const assign = opts.assignments !== undefined ? opts.assignments : fmAssign;
  const slots = (preset === 'custom' && Array.isArray(layout)) ? layout : (FORMATIONS[preset] || FORMATIONS[DEFAULT_PRESET]);
  const W = 620, H = 920;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 12; i++) { ctx.fillStyle = i % 2 ? '#0d2659' : '#103072'; ctx.fillRect(0, H/12*i, W, H/12 + 1); }
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2;
  const m = 14;
  ctx.strokeRect(m, m, W - 2*m, H - 2*m);
  ctx.beginPath(); ctx.moveTo(m, H/2); ctx.lineTo(W - m, H/2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W/2, H/2, 56, 0, Math.PI*2); ctx.stroke();
  const boxW = W*0.5, boxH = H*0.11;
  ctx.strokeRect((W - boxW)/2, m, boxW, boxH);
  ctx.strokeRect((W - boxW)/2, H - m - boxH, boxW, boxH);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = 'bold 26px sans-serif'; ctx.fillText(team || 'Formation', m + 6, m + 6);
  ctx.font = '15px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(preset === 'custom' ? 'カスタム' : preset, m + 6, m + 38);
  slots.forEach((s, i) => {
    const cx = s.x/100*W, cy = s.y/100*H, raw = assign[i];
    const sp = splitPlayer(raw);
    ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI*2);
    ctx.fillStyle = raw ? '#1f4488' : 'rgba(255,255,255,0.12)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    // 〇の中：埋まっていれば背番号（大きめ）、空きはポジション
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const inCircle = raw ? (sp.no || s.pos) : s.pos;
    ctx.font = `bold ${(raw && sp.no) ? 17 : 11}px sans-serif`;
    ctx.fillText(inCircle, cx, cy);
    if (raw) {
      // 選手名は全表示（…で切らない）。幅に応じてフォントを縮小して必ず収める。
      let fs = 13;
      ctx.font = `bold ${fs}px sans-serif`;
      while (ctx.measureText(sp.name).width > 150 && fs > 8.5) { fs -= 0.5; ctx.font = `bold ${fs}px sans-serif`; }
      const tw = ctx.measureText(sp.name).width;
      const bw = tw + 14, bh = 20, by = cy + 26, bx = cx - bw/2, rr = 9;
      ctx.fillStyle = 'rgba(8,12,28,0.92)';
      ctx.beginPath();
      ctx.moveTo(bx+rr, by); ctx.arcTo(bx+bw, by, bx+bw, by+bh, rr); ctx.arcTo(bx+bw, by+bh, bx, by+bh, rr);
      ctx.arcTo(bx, by+bh, bx, by, rr); ctx.arcTo(bx, by, bx+bw, by, rr); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      ctx.fillText(sp.name, cx, by + bh/2);
    }
  });
  return canvas;
}
function fmExportPNG() {
  if (!fmTeam) { showToast('チームを選択してください'); return; }
  fmRenderCanvas().toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = (fmTeam || 'formation') + '.png'; a.click();
    URL.revokeObjectURL(url);
  });
  showToast('PNGを書き出しました');
}
function fmExportPDF() {
  if (!fmTeam) { showToast('チームを選択してください'); return; }
  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) { showToast('PDF機能の準備中です。少し待って再度お試しください'); return; }
  const canvas = fmRenderCanvas();
  const img = canvas.toDataURL('image/png');
  const pdf = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pw = pdf.internal.pageSize.getWidth();
  const margin = 36, iw = pw - margin*2, ih = iw * (canvas.height / canvas.width);
  pdf.addImage(img, 'PNG', margin, margin, iw, ih);
  pdf.save((fmTeam || 'formation') + '.pdf');
  showToast('PDFを書き出しました');
}

// ===== 試合の布陣（交代で反映・クイックアクセス・試合モード編集） =====
function ensureLineup(m, side) {
  if (!m.lineups) m.lineups = {};
  if (!m.lineups[side]) {
    const teamName = side === 'home' ? m.homeTeam : m.awayTeam;
    const preset = (typeof FDB !== 'undefined') ? FDB.get(teamName) : null;
    m.lineups[side] = preset
      ? JSON.parse(JSON.stringify({ preset: preset.preset || DEFAULT_PRESET, layout: preset.layout || null, assignments: preset.assignments || {} }))
      : { preset: DEFAULT_PRESET, layout: null, assignments: {} };
  }
  return m.lineups[side];
}
function applySub(m, ev) {
  if (ev.type !== 'sub' || !ev.player || !ev.playerIn) return;
  const L = ensureLineup(m, ev.side);
  const idx = Object.keys(L.assignments).find(k => L.assignments[k] === ev.player);
  if (idx !== undefined) L.assignments[idx] = ev.playerIn;
}

// ===== スタメン（観戦画面に2チーム横並びで常時表示：Formationタブのベースを表示。編集はこの試合のみ保存） =====
// 指定の wrap に2チーム横並びのスタメン盤面を描画（Live・History詳細で共通）
function renderSMInto(wrap, m) {
  if (!wrap || !m) return;
  wrap.innerHTML = '';
  ['home', 'away'].forEach(side => {
    const teamName = side === 'home' ? m.homeTeam : m.awayTeam;
    const L = (m.lineups && m.lineups[side]) || { preset: DEFAULT_PRESET, layout: null, assignments: {} };
    const col = document.createElement('div');
    col.className = 'sm-col';
    const head = document.createElement('div');
    head.className = 'sm-col-head';
    head.innerHTML = `<span class="sm-col-name"><span class="sm-col-dot" style="background:${teamColor(teamName)}"></span>${escHtml(teamName || (side === 'home' ? 'チーム1' : 'チーム2'))}</span>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary sm-edit-btn';
    btn.textContent = '編集';
    btn.addEventListener('click', () => editStartingMember(side));
    head.appendChild(btn);
    col.appendChild(head);
    const cc = document.createElement('div');
    cc.className = 'sm-col-canvas';
    cc.appendChild(fmRenderCanvas({ team: teamName, preset: L.preset, layout: L.layout, assignments: L.assignments }));
    col.appendChild(cc);
    wrap.appendChild(col);
  });
}
function renderStartingMember() {
  const m = DB.matches.find(x => x.id === currentMatchId);
  renderSMInto(document.getElementById('sm-canvas-wrap'), m);
}
// この試合だけのスタメン編集（Formation画面を試合モードで開く＝保存先は試合のみ、ベースは不変）
function editStartingMember(side) { if (currentMatchId) openMatchFormationEdit(currentMatchId, side || 'home'); }

// イベント種別ごとの選手トグル：goal/yellow/red=現スタメンから1人、sub=OUT(現スタメン)＋IN(控え=squad−現スタメン)。note は非表示。交代すると候補が入れ替わる。
const byJerseyNo = (a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999);
function espChipGroup(label, names, targetId) {
  if (!names.length) return `<div class="esp-group"><div class="esp-label">${escHtml(label)}</div><div class="esp-empty">候補の選手がいません</div></div>`;
  const cur = (document.getElementById(targetId).value || '').trim();
  return `<div class="esp-group"><div class="esp-label">${escHtml(label)}：タップで選択</div><div class="esp-chips">` +
    names.map(n => `<button type="button" class="esp-chip${n === cur ? ' active' : ''}" data-target="${targetId}" data-name="${escHtml(n)}">${escHtml(n)}</button>`).join('') +
    `</div></div>`;
}
function setEvInputReadonly(id, ro) { const el = document.getElementById(id); if (el) el.readOnly = ro; }
function renderScorerPick() {
  const wrap = document.getElementById('ev-scorer-pick');
  if (!wrap) return;
  const m = DB.matches.find(x => x.id === currentMatchId);
  if (!m || liveType === 'note') {
    wrap.style.display = 'none'; wrap.innerHTML = '';
    // メモは「内容」を手入力するので編集可（キーボードOK）
    setEvInputReadonly('ev-player', false); setEvInputReadonly('ev-player2', false);
    return;
  }
  wrap.style.display = '';
  const L = m.lineups && m.lineups[liveSide];
  const onPitch = (L ? Object.values(L.assignments).filter(Boolean) : []).slice().sort(byJerseyNo);
  const sideLabel = liveSide === 'home' ? 'チーム1' : 'チーム2';
  if (liveType === 'sub') {
    const teamName = liveSide === 'home' ? m.homeTeam : m.awayTeam;
    const bench = fmSquadOf(teamName).filter(n => !onPitch.includes(n)).slice().sort(byJerseyNo);
    wrap.innerHTML = espChipGroup(`OUT（退く選手・${sideLabel}）`, onPitch, 'ev-player') +
                     espChipGroup('IN（入る選手・控え）', bench, 'ev-player2');
    // 候補チップがあればタップ選択（iPadでキーボードを出さない）。無ければ手入力可。
    setEvInputReadonly('ev-player', onPitch.length > 0);
    setEvInputReadonly('ev-player2', bench.length > 0);
  } else {
    const label = liveType === 'goal' ? '得点者' : liveType === 'yellow' ? '警告を受けた選手' : liveType === 'red' ? '退場した選手' : '選手';
    wrap.innerHTML = espChipGroup(`${label}（${sideLabel}）`, onPitch, 'ev-player');
    setEvInputReadonly('ev-player', onPitch.length > 0);
    setEvInputReadonly('ev-player2', false);
  }
}

// MOM（マン・オブ・ザ・マッチ）トグル：両チームの現在のスタメンから1人選ぶ（試合全体・どちらのチームでも可）
function renderMomPick() {
  const wrap = document.getElementById('mom-pick');
  if (!wrap) return;
  const m = DB.matches.find(x => x.id === currentMatchId);
  // MOM候補＝その試合で出場した全選手：現在のスタメン ＋ 交代で退いた選手(交代前) ＋ 交代で入った選手(交代後)
  const candidatesOf = side => {
    const L = m && m.lineups && m.lineups[side];
    const set = new Set(L ? Object.values(L.assignments).filter(Boolean) : []);
    (m ? m.events : []).forEach(e => {
      if (e.type === 'sub' && e.side === side) {
        if (e.player)   set.add(e.player);    // 交代で退いた選手（交代前）
        if (e.playerIn) set.add(e.playerIn);  // 交代で入った選手（交代後）
      }
    });
    return [...set].sort(byJerseyNo);
  };
  const home = candidatesOf('home'), away = candidatesOf('away');
  if (!home.length && !away.length) {
    wrap.style.display = 'none'; wrap.innerHTML = '';
    setEvInputReadonly('live-mom', false);   // 候補が無ければ手入力可
    return;
  }
  wrap.style.display = '';
  wrap.innerHTML = (home.length ? espChipGroup(m.homeTeam || 'チーム1', home, 'live-mom') : '') +
                   (away.length ? espChipGroup(m.awayTeam || 'チーム2', away, 'live-mom') : '');
  setEvInputReadonly('live-mom', true);   // 候補があればタップ選択（iPadでキーボードを出さない）
}

let currentLineupSide = 'home';
function openLineup(side) {
  const matches = DB.matches;
  const m = matches.find(x => x.id === currentMatchId);
  if (!m) return;
  currentLineupSide = side || 'home';
  ensureLineup(m, 'home'); ensureLineup(m, 'away');
  DB.saveMatches(matches);
  renderLineupView();
  document.getElementById('lineup-modal').classList.remove('hidden');
}
function setLineupSide(side) { currentLineupSide = side; renderLineupView(); }
function renderLineupView() {
  const m = DB.matches.find(x => x.id === currentMatchId);
  if (!m) return;
  const side = currentLineupSide;
  const teamName = side === 'home' ? m.homeTeam : m.awayTeam;
  const L = ensureLineup(m, side);
  document.getElementById('lineup-side-home').classList.toggle('active', side === 'home');
  document.getElementById('lineup-side-away').classList.toggle('active', side === 'away');
  document.getElementById('lineup-title').textContent = `布陣：${teamName || (side === 'home' ? 'チーム1' : 'チーム2')}`;
  const canvas = fmRenderCanvas({ team: teamName, preset: L.preset, layout: L.layout, assignments: L.assignments });
  const wrap = document.getElementById('lineup-canvas-wrap');
  wrap.innerHTML = '';
  wrap.appendChild(canvas);
}
function closeLineup() { document.getElementById('lineup-modal').classList.add('hidden'); }
function editMatchLineup() { closeLineup(); openMatchFormationEdit(currentMatchId, currentLineupSide); }

// フォーメーション画面を「試合モード」で開く（保存先＝試合の布陣コピー。プリセットは不変）
let fmMatchCtx = null;
function openMatchFormationEdit(matchId, side) {
  const m = DB.matches.find(x => x.id === matchId);
  if (!m) return;
  const origin = document.querySelector('.screen.active')?.id;   // 'screen-detail' か 'screen-live'
  const L = ensureLineup(m, side);
  fmMatchCtx = { matchId, side, origin };
  fmTeam = side === 'home' ? m.homeTeam : m.awayTeam;
  fmPreset = L.preset || DEFAULT_PRESET;
  fmLayout = L.layout || null;
  fmAssign = Object.assign({}, L.assignments);
  fmPopulateTeamSelect(fmTeam);
  document.getElementById('fm-team').value = fmTeam;
  document.getElementById('fm-preset').value = fmPreset;
  fmUpdateMatchBanner();
  renderFormation();
  renderSavedFormations();
  showScreen('formation');
}
function fmUpdateMatchBanner() {
  const banner = document.getElementById('fm-match-banner');
  const teamInput = document.getElementById('fm-team');
  const savedWrap = document.getElementById('fm-saved-wrap');
  if (fmMatchCtx) {
    const sideLabel = fmMatchCtx.side === 'home' ? 'チーム1' : 'チーム2';
    banner.innerHTML = `<div>この試合のスタメンを編集中：<strong>${escHtml(fmTeam)}</strong>（${sideLabel}）— 保存しても「Formation」タブのベースは変わりません</div>
      <button class="btn btn-secondary" onclick="fmBackToMatch()">← 試合に戻る</button>`;
    banner.style.display = '';
    teamInput.disabled = true;
    if (savedWrap) savedWrap.style.display = 'none';
  } else {
    banner.style.display = 'none';
    teamInput.disabled = false;
    if (savedWrap) savedWrap.style.display = '';
  }
}
function fmBackToMatch() {
  const ctx = fmMatchCtx;
  fmMatchCtx = null;
  fmUpdateMatchBanner();
  if (ctx && ctx.matchId) {
    if (ctx.origin === 'screen-detail') openMatchDetail(ctx.matchId);   // 詳細から編集した時は詳細へ戻す
    else openLiveScreen(ctx.matchId);
  } else initHome();
}

// ===== TEAM（グループ→チーム→選手） =====
const TEAMDB = {
  ensureSeed() {
    if (!localStorage.getItem('swm_teams') && window.WC_TEAMS_DATA) {
      localStorage.setItem('swm_teams', JSON.stringify(window.WC_TEAMS_DATA));
    }
  },
  get data() {
    try { return JSON.parse(localStorage.getItem('swm_teams')) || { groups: [] }; } catch { return { groups: [] }; }
  },
  save(d) { localStorage.setItem('swm_teams', JSON.stringify(d)); },
  reset() { if (window.WC_TEAMS_DATA) this.save(JSON.parse(JSON.stringify(window.WC_TEAMS_DATA))); },
  allTeamNames() { const n = []; this.data.groups.forEach(g => g.teams.forEach(t => n.push(t.name))); return n; },
};

let teamView = null; // null=チーム一覧, {gi,ti}=選手一覧（チーム詳細）

function openTeamScreen() {
  TEAMDB.ensureSeed();
  teamView = null;
  renderTeam();
  showScreen('team');
}

function squadCount(t) {
  const s = t.squad || {};
  return (s.GK||[]).length + (s.DF||[]).length + (s.MF||[]).length + (s.FW||[]).length;
}

function renderTeam() { if (teamView) renderTeamDetail(); else renderTeamList(); }

function renderTeamList() {
  const d = TEAMDB.data;
  document.getElementById('team-title').textContent = 'チーム';
  document.getElementById('team-sub').textContent = 'フォルダ → チーム → 選手（チームをタップで選手一覧）';
  document.getElementById('team-header-actions').innerHTML =
    `<button class="btn btn-primary" onclick="openTeamAdd()">＋ 追加</button>
     <button class="btn btn-ghost" onclick="teamResetDefault()">初期データに戻す</button>`;
  const groupsHtml = d.groups.map((g, gi) => `
    <div class="team-group">
      <div class="team-group-head">
        <span>グループ ${escHtml(g.id)}</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="tg-count">${g.teams.length}チーム</span>
          <button class="tg-del" onclick="teamDeleteGroup(${gi})" title="フォルダ削除">×</button>
        </div>
      </div>
      <div class="team-chip-list">
        ${g.teams.map((t, ti) => `
          <button class="team-chip-btn" onclick="openTeamDetail(${gi},${ti})">
            <span class="tcb-name">${escHtml(t.name)}</span>
            <span class="tcb-count">${squadCount(t)}名</span>
            <span class="tcb-del" onclick="event.stopPropagation();teamDeleteTeam(${gi},${ti})" title="削除">×</span>
          </button>`).join('') || '<span class="team-empty">チーム未登録（右上の＋から追加）</span>'}
      </div>
    </div>`).join('');
  document.getElementById('team-content').innerHTML =
    `<div class="team-groups">${groupsHtml || '<div class="empty-state">フォルダがありません。右上の＋から追加してください。</div>'}</div>`;
}

// ＋追加（フォルダ／チームを選択）
let teamAddMode = 'folder';
function openTeamAdd() {
  teamAddSetMode('folder');
  document.getElementById('tam-folder-name').value = '';
  document.getElementById('tam-team-name').value = '';
  document.getElementById('tam-team-folder').innerHTML =
    TEAMDB.data.groups.map((g, gi) => `<option value="${gi}">グループ ${escHtml(g.id)}</option>`).join('');
  document.getElementById('team-add-modal').classList.remove('hidden');
}
function closeTeamAdd() { document.getElementById('team-add-modal').classList.add('hidden'); }
function teamAddSetMode(mode) {
  teamAddMode = mode;
  document.getElementById('tam-mode-folder').classList.toggle('active', mode === 'folder');
  document.getElementById('tam-mode-team').classList.toggle('active', mode === 'team');
  document.getElementById('tam-folder-fields').style.display = mode === 'folder' ? '' : 'none';
  document.getElementById('tam-team-fields').style.display = mode === 'team' ? '' : 'none';
}
function doTeamAdd() {
  const d = TEAMDB.data;
  if (teamAddMode === 'folder') {
    const id = document.getElementById('tam-folder-name').value.trim();
    if (!id) { showToast('フォルダ名を入力してください'); return; }
    if (d.groups.some(g => g.id === id)) { showToast('同じフォルダがあります'); return; }
    d.groups.push({ id, teams: [] });
    TEAMDB.save(d); closeTeamAdd(); renderTeam(); showToast(`フォルダ「${id}」を作成しました`);
  } else {
    const gi = parseInt(document.getElementById('tam-team-folder').value, 10);
    const name = document.getElementById('tam-team-name').value.trim();
    if (isNaN(gi) || !d.groups[gi]) { showToast('フォルダを選んでください'); return; }
    if (!name) { showToast('チーム名を入力してください'); return; }
    if (d.groups[gi].teams.some(t => t.name === name)) { showToast('同じチームがあります'); return; }
    d.groups[gi].teams.push({ name, squad: { GK:[], DF:[], MF:[], FW:[] } });
    TEAMDB.save(d); closeTeamAdd(); renderTeam(); showToast(`「${name}」を追加しました`);
  }
}

function renderTeamDetail() {
  const d = TEAMDB.data;
  const g = d.groups[teamView.gi]; if (!g) { teamView = null; return renderTeamList(); }
  const t = g.teams[teamView.ti]; if (!t) { teamView = null; return renderTeamList(); }
  if (!t.squad) t.squad = { GK:[], DF:[], MF:[], FW:[] };
  document.getElementById('team-title').textContent = t.name;
  document.getElementById('team-sub').textContent = `グループ ${escHtml(g.id)}・${squadCount(t)}名`;
  document.getElementById('team-header-actions').innerHTML =
    `<button class="btn btn-secondary" onclick="backToTeamList()">← 一覧へ</button>`;
  const sections = ['GK','DF','MF','FW'].map(pos => {
    const list = t.squad[pos] || [];
    const chips = list.map((nm, pi) => `
      <span class="squad-chip">${escHtml(nm)}<button class="squad-chip-x" onclick="teamRemovePlayer('${pos}',${pi})" title="削除">×</button></span>`
    ).join('') || '<span class="team-empty">未登録</span>';
    return `
      <div class="squad-section">
        <div class="squad-section-title">${pos}<span>${list.length}</span></div>
        <div class="squad-chips">${chips}</div>
        <div class="input-row squad-add-row">
          <input id="team-pl-input-${pos}" class="input-field" type="text" placeholder="${pos} に選手を追加" maxlength="30" autocomplete="off" onkeydown="if(event.key==='Enter')teamAddPlayer('${pos}')">
          <button class="btn btn-secondary" onclick="teamAddPlayer('${pos}')">追加</button>
        </div>
      </div>`;
  }).join('');
  document.getElementById('team-content').innerHTML = `<div class="squad-grid">${sections}</div>`;
}

function openTeamDetail(gi, ti) { teamView = { gi, ti }; renderTeam(); }
function backToTeamList() { teamView = null; renderTeam(); }

function teamAddTeam(gi) {
  const input = document.getElementById('team-add-input-' + gi);
  const name = (input?.value || '').trim(); if (!name) return;
  const d = TEAMDB.data;
  if (d.groups[gi].teams.some(t => t.name === name)) { showToast('同じチームがあります'); return; }
  d.groups[gi].teams.push({ name, squad: { GK:[], DF:[], MF:[], FW:[] } });
  TEAMDB.save(d); renderTeam();
}
function teamDeleteTeam(gi, ti) {
  const d = TEAMDB.data; d.groups[gi].teams.splice(ti, 1); TEAMDB.save(d); renderTeam();
}
function teamAddGroup() {
  const input = document.getElementById('team-add-group-input');
  const id = (input?.value || '').trim(); if (!id) return;
  const d = TEAMDB.data;
  if (d.groups.some(g => g.id === id)) { showToast('同じグループがあります'); return; }
  d.groups.push({ id, teams: [] }); TEAMDB.save(d); renderTeam();
}
async function teamDeleteGroup(gi) {
  const d = TEAMDB.data; const g = d.groups[gi]; if (!g) return;
  const ok = await showDialog('グループを削除', `グループ ${g.id}（${g.teams.length}チーム）を削除しますか？`);
  if (!ok) return;
  d.groups.splice(gi, 1); TEAMDB.save(d); renderTeam();
}
function teamAddPlayer(pos) {
  if (!teamView) return;
  const input = document.getElementById('team-pl-input-' + pos);
  const name = (input?.value || '').trim(); if (!name) return;
  const d = TEAMDB.data; const t = d.groups[teamView.gi].teams[teamView.ti];
  if (!t.squad[pos]) t.squad[pos] = [];
  t.squad[pos].push(name); TEAMDB.save(d);
  renderTeam();
  setTimeout(() => document.getElementById('team-pl-input-' + pos)?.focus(), 20);
}
function teamRemovePlayer(pos, pi) {
  if (!teamView) return;
  const d = TEAMDB.data; const t = d.groups[teamView.gi].teams[teamView.ti];
  t.squad[pos].splice(pi, 1); TEAMDB.save(d); renderTeam();
}
async function teamResetDefault() {
  const ok = await showDialog('初期データに戻す', '編集内容を破棄して、48カ国の初期データに戻しますか？');
  if (!ok) return;
  TEAMDB.reset(); teamView = null; renderTeam(); showToast('初期データに戻しました');
}

// ===== Tournament（32チーム決勝トーナメント：R32→R16→QF→SF→Final＋3位） =====
// データ＝R32スロットのチーム割当のみ保存。勝ち上がりは「決勝Tの試合結果」から都度計算（保存しない）。
const TOURNEY = {
  load() { try { const v = JSON.parse(localStorage.getItem('swm_tournament')); return (v && typeof v === 'object' && v.slots) ? v : { slots: {} }; } catch { return { slots: {} }; } },
  save(v) { localStorage.setItem('swm_tournament', JSON.stringify(v)); },
  get slots() { return this.load().slots; },
  setSlot(i, team) { const t = this.load(); if (team) t.slots[i] = team; else delete t.slots[i]; this.save(t); },
  assignedTeams() { const s = this.slots, arr = []; for (let i = 0; i < 32; i++) if (s[i]) arr.push(s[i]); return arr; },
  assignedCount() { return this.assignedTeams().length; },
  clearAll() { this.save({ slots: {} }); },
};

// チーム a,b の決勝T試合（記録済み・stage==='knockout'）から勝敗を解決
function tourneyResolve(a, b) {
  const res = { a: a || '', b: b || '', winner: '', loser: '', score: '' };
  if (!a || !b) return res;
  const ms = DB.matches.filter(m => m.finished && m.stage === 'knockout' &&
    ((m.homeTeam === a && m.awayTeam === b) || (m.homeTeam === b && m.awayTeam === a)));
  if (!ms.length) return res;
  const m = ms[ms.length - 1];
  const ga = goalCount(m, m.homeTeam === a ? 'home' : 'away');
  const gb = goalCount(m, m.homeTeam === b ? 'home' : 'away');
  res.score = `${ga}-${gb}`;
  if (ga > gb) { res.winner = a; res.loser = b; }
  else if (gb > ga) { res.winner = b; res.loser = a; }
  return res; // 引き分けは winner='' のまま（PK等は未対応）
}

// R32割当＋記録結果からブラケット全体を計算
function tourneyCompute() {
  const s = TOURNEY.slots;
  const out = { R32: [], R16: [], QF: [], SF: [], F: null, TH: null };
  for (let i = 0; i < 16; i++) out.R32.push(tourneyResolve(s[2*i] || '', s[2*i+1] || ''));
  for (let i = 0; i < 8;  i++) out.R16.push(tourneyResolve(out.R32[2*i].winner, out.R32[2*i+1].winner));
  for (let i = 0; i < 4;  i++) out.QF.push(tourneyResolve(out.R16[2*i].winner, out.R16[2*i+1].winner));
  for (let i = 0; i < 2;  i++) out.SF.push(tourneyResolve(out.QF[2*i].winner, out.QF[2*i+1].winner));
  out.F  = tourneyResolve(out.SF[0].winner, out.SF[1].winner);
  out.TH = tourneyResolve(out.SF[0].loser,  out.SF[1].loser);
  return out;
}

function openTournamentScreen() {
  TEAMDB.ensureSeed();
  renderTournament();
  showScreen('tournament');
}

// チーム選択肢（フォルダごとに optgroup）
function tourneyTeamOptions(selected) {
  let html = `<option value="">（未定）</option>`;
  TEAMDB.data.groups.forEach(g => {
    if (!g.teams.length) return;
    html += `<optgroup label="グループ ${escHtml(g.id)}">` +
      g.teams.map(t => `<option value="${escHtml(t.name)}"${t.name === selected ? ' selected' : ''}>${escHtml(t.name)}</option>`).join('') +
      `</optgroup>`;
  });
  if (selected && !TEAMDB.allTeamNames().includes(selected)) {
    html += `<optgroup label="その他"><option value="${escHtml(selected)}" selected>${escHtml(selected)}</option></optgroup>`;
  }
  return html;
}

function tourneyTeamRow(team, isWin, editable, slotIndex) {
  if (editable) {
    return `<div class="tk-team tk-team-edit${isWin ? ' tk-win' : ''}">
        <select class="tk-slot" data-slot="${slotIndex}">${tourneyTeamOptions(team)}</select>
      </div>`;
  }
  const inner = team
    ? `<span class="tk-dot" style="background:${teamColor(team)}"></span><span class="tk-name">${escHtml(team)}</span>`
    : `<span class="tk-tbd">勝者未定</span>`;
  return `<div class="tk-team${isWin ? ' tk-win' : ''}">${inner}</div>`;
}

function tourneyMatchCard(m, editable, idx) {
  const sA = 2*idx, sB = 2*idx + 1;
  const mid = m.score ? `<span class="tk-score">${escHtml(m.score)}</span>` : `<span class="tk-vs">vs</span>`;
  return `<div class="tk-match">
      ${tourneyTeamRow(m.a, m.winner && m.winner === m.a, editable, sA)}
      <div class="tk-mid">${mid}</div>
      ${tourneyTeamRow(m.b, m.winner && m.winner === m.b, editable, sB)}
    </div>`;
}

function tourneyColHtml(name, cardsHtml) {
  return `<div class="tk-col"><div class="tk-col-head">${escHtml(name)}</div>${cardsHtml}</div>`;
}

function renderTournament() {
  const b = tourneyCompute();
  const cols = [];
  cols.push(tourneyColHtml('ベスト32', b.R32.map((m, i) => tourneyMatchCard(m, true, i)).join('')));
  cols.push(tourneyColHtml('ベスト16', b.R16.map((m, i) => tourneyMatchCard(m, false, i)).join('')));
  cols.push(tourneyColHtml('準々決勝', b.QF.map((m, i) => tourneyMatchCard(m, false, i)).join('')));
  cols.push(tourneyColHtml('準決勝',   b.SF.map((m, i) => tourneyMatchCard(m, false, i)).join('')));
  let last = `<div class="tk-final-label">決勝</div>${tourneyMatchCard(b.F, false, 0)}`;
  last += `<div class="tk-final-label">3位決定戦</div>${tourneyMatchCard(b.TH, false, 0)}`;
  if (b.F.winner) last += `<div class="tk-champion"><div class="tk-champion-label">優勝</div><div class="tk-champion-name">${escHtml(b.F.winner)}</div></div>`;
  cols.push(tourneyColHtml('決勝・3位', last));
  const assigned = TOURNEY.assignedCount();
  document.getElementById('tournament-bracket').innerHTML =
    `<div class="tk-status">ベスト32：${assigned}/32 チーム割当済み</div>` +
    `<div class="tk-grid">${cols.join('')}</div>`;
}

async function tourneyClearAll() {
  const ok = await showDialog('割当をクリア', 'ベスト32のチーム割当をすべてクリアしますか？\n（記録した試合は消えません）');
  if (!ok) return;
  TOURNEY.clearAll();
  renderTournament();
  showToast('割当をクリアしました');
}

// ===== キーボード・初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ev-player').addEventListener('keydown', e => { if (e.key === 'Enter') addEvent(); });
  document.getElementById('ev-minute').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('ev-player').focus(); });
  document.getElementById('screen-formation').addEventListener('pointerdown', fmPointerDown);
  const sc = document.getElementById('sketch-canvas');
  if (sc) {
    sc.addEventListener('pointerdown', sketchDown);
    sc.addEventListener('pointermove', sketchMove);
    sc.addEventListener('pointerup', sketchEnd);
    sc.addEventListener('pointercancel', sketchEnd);
    sc.addEventListener('pointerleave', sketchEnd);
  }

  // チーム色編集：色入力・リセットをイベント委譲で処理（チーム名のエスケープ不要）
  const tcList = document.getElementById('tc-list');
  if (tcList) {
    tcList.addEventListener('input', e => {
      if (!e.target.classList.contains('tc-input')) return;
      const row = e.target.closest('.tc-row'); const team = row && row.dataset.team;
      if (!team) return;
      setTeamColor(team, e.target.value);
      const dot = row.querySelector('.tc-dot'); if (dot) dot.style.background = e.target.value;
      const nm = row.querySelector('.tc-name'); if (nm) nm.style.color = e.target.value;
      if (nm && !row.querySelector('.tc-badge')) {
        const b = document.createElement('span'); b.className = 'tc-badge'; b.textContent = '変更済'; nm.after(b);
      }
    });
    tcList.addEventListener('click', e => {
      if (!e.target.classList.contains('tc-reset')) return;
      const team = e.target.closest('.tc-row') && e.target.closest('.tc-row').dataset.team;
      if (team) clearTeamColor(team);
    });
  }

  // Tournament：ベスト32スロットのチーム割当
  const tb = document.getElementById('tournament-bracket');
  if (tb) {
    tb.addEventListener('change', e => {
      if (!e.target.classList.contains('tk-slot')) return;
      TOURNEY.setSlot(+e.target.dataset.slot, e.target.value);
      renderTournament();
    });
  }

  // Record：チーム選択（トグル）
  const tp = document.getElementById('m-team-pick');
  if (tp) {
    tp.addEventListener('click', e => {
      const chip = e.target.closest('.team-pick-chip');
      if (chip && chip.dataset.team) toggleTeamPick(chip.dataset.team);
    });
  }

  // 観戦：得点者トグル（現在のスタメンから選択・もう一度タップで解除）
  const esp = document.getElementById('ev-scorer-pick');
  if (esp) {
    esp.addEventListener('click', e => {
      const chip = e.target.closest('.esp-chip');
      if (!chip) return;
      const inp = document.getElementById(chip.dataset.target || 'ev-player');
      if (!inp) return;
      inp.value = (inp.value.trim() === chip.dataset.name) ? '' : chip.dataset.name;
      renderScorerPick();
    });
  }

  // 観戦：MOM トグル（両チームのスタメンから選択・もう一度タップで解除）
  const momWrap = document.getElementById('mom-pick');
  if (momWrap) {
    momWrap.addEventListener('click', e => {
      const chip = e.target.closest('.esp-chip');
      if (!chip) return;
      const inp = document.getElementById('live-mom');
      inp.value = (inp.value.trim() === chip.dataset.name) ? '' : chip.dataset.name;
      saveMom(inp.value);
      renderMomPick();
    });
  }

  refreshDatalists();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
});
