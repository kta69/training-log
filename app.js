/* ============ Store ============ */
const KEY = 'gymlog_v1';
const uid = () => Math.random().toString(36).slice(2, 10);
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const dateAdd = n => { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); };
const fmtDate = s => s ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}` : '';
const daysAgo = s => Math.round((new Date(today()) - new Date(s)) / 86400000);

/* 全種目マップ */
const EX_MAP = {};
PROGRAM.forEach(d => d.items.forEach(it => {
  EX_MAP[it.id] = it; it.alts.forEach(a => { EX_MAP[a.id] = a; });
}));
const flatItems = day => day.items.flatMap(it => [it, ...it.alts]);

function defaults() {
  return {
    settings: { targetW: 70, targetBf: 10 },
    body: [],
    sessions: [],
    names: {},
    pick: {},
    alts: {},
    targets: {},
    order: {},
    memos: {},
    tab: 'workout',
    day: 'day1',
    logDate: null
  };
}

let S;
try { S = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { S = null; }
if (!S) S = defaults();   // 新しい端末は空から始める（前回欄は「—」）
S = Object.assign(defaults(), S);
const save = () => localStorage.setItem(KEY, JSON.stringify(S));

/* ============ Utils ============ */
const sumW = s => String(s ?? '').split('+').reduce((a, b) => a + (parseFloat(b) || 0), 0);
const firstNum = s => { const m = String(s ?? '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const n1 = v => Math.round(v * 10) / 10;
const n0 = v => Math.round(v);

function e1rm(set) {
  const w = sumW(set.w), r = firstNum(set.r);
  if (!w || !r) return null;
  return w * (1 + r / 30);
}
function bestOf(sets) {
  if (!sets || !sets.length) return null;
  let best = null;
  sets.forEach(s => {
    const e = e1rm(s);
    if (e != null && (!best || best.e == null || e > best.e)) best = { ...s, e };
    else if (e == null && !best && sumW(s.w)) best = { ...s, e: null };
  });
  return best;
}
const setLabel = s => `${s.w || '自重'}${s.r ? ' × ' + s.r : ''}`;
/* その日にやったセットを全部並べる（e1RM が最も高いセットを強調） */
function setList(sets, cls = '') {
  const rows = (sets || []).filter(s => s.w || s.r);
  if (!rows.length) return `<b class="dim">—</b>`;
  const best = bestOf(rows);
  return `<div class="psets">${rows.map(s =>
    `<div class="ps ${cls}${best && s.w === best.w && s.r === best.r ? ' top' : ''}">${esc(setLabel(s))}</div>`
  ).join('')}</div>`;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 1600);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ============ セッション ============ */
const logDate = () => S.logDate || today();
const exName = it => S.names[it.id] || it.name;
const nameOf = id => S.names[id] || (EX_MAP[id] ? EX_MAP[id].name : id);

function currentSession(dayId) {
  return S.sessions.find(s => s.date === logDate() && s.day === dayId && !s.done);
}
function openSession(dayId) {
  let s = currentSession(dayId);
  if (!s) { s = { id: uid(), date: logDate(), day: dayId, logs: {}, done: false }; S.sessions.push(s); save(); }
  return s;
}
function prevRecords(exId, excludeId) {
  return S.sessions
    .filter(s => s.id !== excludeId && s.logs[exId] && s.logs[exId].length)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/* ============ 体組成 ============ */
/* 日付の新しい順。ジムの体組成計の値を手入力する前提なので、絶対値より上下の動きを見る */
const bodyLog = () => [...S.body].sort((a, b) => b.date.localeCompare(a.date));
const latestBody = () => bodyLog()[0] || null;
const lbmOf = b => b && b.bf != null ? b.weight * (1 - b.bf / 100) : null;

/* ============ Chart ============ */
function chart(cv, pts, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const x = cv.getContext('2d'); x.scale(dpr, dpr);
  x.clearRect(0, 0, w, h);
  if (pts.length < 1) { x.fillStyle = '#5a616d'; x.font = '12px sans-serif'; x.fillText('データなし', 8, 20); return; }
  const vals = pts.map(p => p.v);
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (mx - mn < 1e-6) { mn -= 1; mx += 1; }
  const pd = (mx - mn) * .18; mn -= pd; mx += pd;
  const PL = 34, PR = 8, PT = 12, PB = 20;
  const X = i => PL + (w - PL - PR) * (pts.length === 1 ? .5 : i / (pts.length - 1));
  const Y = v => PT + (h - PT - PB) * (1 - (v - mn) / (mx - mn));
  x.strokeStyle = '#22262f'; x.lineWidth = 1; x.font = '9px sans-serif'; x.fillStyle = '#5a616d';
  for (let i = 0; i <= 2; i++) {
    const v = mn + (mx - mn) * i / 2, y = Y(v);
    x.beginPath(); x.moveTo(PL, y); x.lineTo(w - PR, y); x.stroke();
    x.fillText(n1(v).toString(), 2, y + 3);
  }
  x.strokeStyle = color || '#d8ff45'; x.lineWidth = 2; x.beginPath();
  pts.forEach((p, i) => i ? x.lineTo(X(i), Y(p.v)) : x.moveTo(X(i), Y(p.v)));
  x.stroke();
  x.fillStyle = color || '#d8ff45';
  pts.forEach((p, i) => { x.beginPath(); x.arc(X(i), Y(p.v), 2.8, 0, 7); x.fill(); });
  x.fillStyle = '#5a616d';
  [0, pts.length - 1].forEach(i => {
    if (i < 0) return;
    const t = x.measureText(pts[i].label).width;
    x.fillText(pts[i].label, Math.min(Math.max(X(i) - t / 2, PL), w - PR - t), h - 6);
  });
}

/* ============ Router ============ */
const app = () => document.getElementById('app');
function go(tab) { S.tab = tab; save(); render(); requestAnimationFrame(() => window.scrollTo(0, 0)); }

function render() {
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  const el = app();
  const V = { workout: viewWorkout, body: viewBody, history: viewHistory, settings: viewSettings };
  (V[S.tab] || viewWorkout)(el);
}
document.getElementById('tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (b) go(b.dataset.tab);
});

/* ============ 筋トレ ============ */
function viewWorkout(el) {
  const day = PROGRAM.find(d => d.id === S.day) || PROGRAM[0];
  const d0 = logDate();
  const sess = currentSession(day.id);
  const doneToday = S.sessions.find(s => s.date === d0 && s.day === day.id && s.done);
  document.getElementById('bar-title').textContent = day.name;
  document.getElementById('bar-right').innerHTML = '';

  el.innerHTML = `
    <div class="seg">${PROGRAM.map(d => `<button data-d="${d.id}" class="${d.id === day.id ? 'on' : ''}">${d.name.replace('Day ', 'D')}</button>`).join('')}</div>
    <div class="card tight">
      <div class="row" style="justify-content:flex-end">
        <label class="datepick">${d0 === today() ? '今日' : ''}<input type="date" id="logdate" value="${d0}"></label>
      </div>
      <div id="sessbar">${doneToday && !sess ? `<div class="hr"></div><div class="xs ok">✓ ${fmtDate(d0)} の ${day.name} は完了済み（追記すると再開します）</div>` : ''}</div>
    </div>
    <div id="exlist"></div>
    <div id="finishbar"></div>
  `;
  el.querySelector('.seg').onclick = e => {
    const b = e.target.closest('button[data-d]'); if (!b) return;
    S.day = b.dataset.d; save(); render();
  };
  el.querySelector('#logdate').onchange = e => {
    S.logDate = e.target.value === today() ? null : e.target.value; save(); render();
  };
  if (sess) showFinishBar(day);
  renderExList(el.querySelector('#exlist'), day, sess);
}

/* 最後の種目を入力したらそのまま押せるよう、完了ボタンは種目リストの直下に置く */
function showFinishBar(day) {
  const bar = document.getElementById('finishbar'); if (!bar) return;
  bar.innerHTML = `<div class="card finish">
    <div class="row between" style="margin-bottom:11px">
      <span class="xs acc">● 記録中（自動保存）</span>
      <span class="xs dim" id="finish-cnt"></span>
    </div>
    <button class="btn pri full" id="finish">セッション完了</button>
  </div>`;
  updateFinishCount(day);
  bar.querySelector('#finish').onclick = () => {
    const s = currentSession(day.id); if (!s) return;
    Object.keys(s.logs).forEach(k => { s.logs[k] = s.logs[k].filter(x => x.w || x.r); if (!s.logs[k].length) delete s.logs[k]; });
    if (!Object.keys(s.logs).length) { S.sessions = S.sessions.filter(x => x.id !== s.id); toast('記録なし：破棄しました'); }
    else { s.done = true; toast('保存しました'); }
    save(); render();
  };
}

/* 完了ボタンの上に「何種目・何セット入力済みか」を出す */
function updateFinishCount(day) {
  const el = document.getElementById('finish-cnt'); if (!el) return;
  const s = currentSession(day.id); if (!s) return;
  let ex = 0, sets = 0;
  Object.values(s.logs).forEach(list => {
    const n = list.filter(x => x.w || x.r).length;
    if (n) { ex++; sets += n; }
  });
  el.textContent = ex ? `${ex} 種目 · ${sets} セット` : '';
}

/* 並び順（ドラッグで変更可） */
function orderedItems(day) {
  const ord = S.order[day.id];
  if (!ord) return day.items;
  const by = {}; day.items.forEach(it => by[it.id] = it);
  const out = ord.map(id => by[id]).filter(Boolean);
  day.items.forEach(it => { if (!out.includes(it)) out.push(it); });
  return out;
}

function renderExList(host, day, sess) {
  const need = () => sess || (sess = openSession(day.id));
  host.innerHTML = orderedItems(day).map(it => exCard(it, sess)).join('');
  enableReorder(host, day);
  host.addEventListener('input', e => {
    const nm = e.target.closest('input[data-name]');
    if (nm) {
      const id = nm.dataset.name, v = nm.value.trim();
      if (!v || v === (EX_MAP[id] || {}).name) delete S.names[id]; else S.names[id] = v;
      nm.dataset.custom = S.names[id] ? '1' : '';
      save(); return;
    }
    const mo = e.target.closest('input[data-memo]');
    if (mo) {
      const id = mo.dataset.memo, v = mo.value.trim();
      if (v === (EX_MAP[id] || {}).setting) delete S.memos[id]; else S.memos[id] = v;
      const btn = mo.closest('.card.ex').querySelector('[data-memotgl]');
      if (btn) btn.classList.toggle('on', !!v);
      save(); return;
    }
    const tg = e.target.closest('input[data-tgt]');
    if (tg) {
      const id = tg.dataset.tgt, v = parseInt(tg.value, 10);
      if (!isFinite(v) || v < 0) delete S.targets[id]; else S.targets[id] = v;
      save(); return;
    }
    const inp = e.target.closest('input[data-ex]'); if (!inp) return;
    const first = !sess; need();
    const { ex, i, k } = inp.dataset;
    const arr = sess.logs[ex] || (sess.logs[ex] = []);
    while (arr.length <= +i) arr.push({ w: '', r: '' });
    arr[+i][k] = inp.value.trim();
    save();
    updateDelta(ex, sess);
    if (first) showFinishBar(day); else updateFinishCount(day);
  });
  host.addEventListener('focusout', e => {
    const nm = e.target.closest('input[data-name]');
    if (nm && !nm.value.trim()) nm.value = (EX_MAP[nm.dataset.name] || {}).name || '新しい種目';
  });
  const redrawCard = (node, mainId) => {
    const scroll = window.scrollY;
    node.outerHTML = exCard(EX_MAP[mainId], sess);
    window.scrollTo(0, scroll);
    if (sess) updateDelta(activeVar(EX_MAP[mainId]).id, sess);
  };
  host.addEventListener('click', e => {
    const mt = e.target.closest('[data-memotgl]');
    if (mt) {
      const id = mt.dataset.memotgl;
      const row = mt.closest('.card.ex').querySelector('.memorow');
      row.hidden = !row.hidden;
      if (row.hidden) memoOpen.delete(id);
      else { memoOpen.add(id); row.querySelector('input').focus(); }
      return;
    }
    const pk = e.target.closest('[data-pick]');
    if (pk) {
      const [mainId, exId] = pk.dataset.pick.split(':');
      if (exId === mainId) delete S.pick[mainId]; else S.pick[mainId] = exId;
      save();
      redrawCard(pk.closest('.card.ex'), mainId);
      return;
    }
    const na = e.target.closest('[data-newalt]');
    if (na) {
      const mainId = na.dataset.newalt, id = 'u' + uid();
      (S.alts[mainId] || (S.alts[mainId] = [])).push(id);
      S.pick[mainId] = id;
      save();
      const card = na.closest('.card.ex');
      redrawCard(card, mainId);
      const inp = host.querySelector(`input[data-name="${id}"]`);
      if (inp) { inp.focus(); inp.select(); }
      return;
    }
    const da = e.target.closest('[data-delalt]');
    if (da) {
      const [mainId, exId] = da.dataset.delalt.split(':');
      S.alts[mainId] = (S.alts[mainId] || []).filter(x => x !== exId);
      delete S.names[exId]; delete S.targets[exId]; delete S.pick[mainId];
      if (sess) delete sess.logs[exId];
      save();
      redrawCard(da.closest('.card.ex'), mainId);
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      need();
      const id = add.dataset.add;
      (sess.logs[id] || (sess.logs[id] = [])).push({ w: '', r: '' });
      save(); render(); return;
    }
    const del = e.target.closest('[data-del]');
    if (del && sess) {
      const [id, i] = del.dataset.del.split(':');
      sess.logs[id].splice(+i, 1); save(); render(); return;
    }
  });
  if (sess) day.items.forEach(it => {
    const a = activeVar(it);
    if (sess.logs[a.id]) updateDelta(a.id, sess);
  });
}

/* 指でドラッグして種目の並びを入れ替える */
function enableReorder(host, day) {
  let dragging = null;
  const commit = () => {
    S.order[day.id] = [...host.querySelectorAll('.card.ex')].map(c => c.dataset.main);
    save();
  };
  const slotBefore = y => [...host.querySelectorAll('.card.ex:not(.dragging)')]
    .reduce((best, c) => {
      const b = c.getBoundingClientRect(), off = y - (b.top + b.height / 2);
      return off < 0 && off > best.off ? { off, el: c } : best;
    }, { off: -Infinity, el: null }).el;

  host.addEventListener('pointerdown', e => {
    const g = e.target.closest('.grip'); if (!g) return;
    dragging = g.closest('.card.ex'); if (!dragging) return;
    e.preventDefault();
    g.setPointerCapture(e.pointerId);
    dragging.classList.add('dragging');
    host.classList.add('reordering');
  });
  host.addEventListener('pointermove', e => {
    if (!dragging) return;
    e.preventDefault();
    const after = slotBefore(e.clientY);
    if (after) { if (after !== dragging.nextElementSibling) host.insertBefore(dragging, after); }
    else if (dragging !== host.lastElementChild) host.appendChild(dragging);
  });
  const end = () => {
    if (!dragging) return;
    dragging.classList.remove('dragging');
    host.classList.remove('reordering');
    dragging = null;
    commit();
  };
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);
}

/* 自分で追加した種目：id だけ保存し、名前は S.names、他の属性はメインを継承 */
const userAlts = main => (S.alts[main.id] || []).map(id => ({
  id, name: '新しい種目', user: true, target: main.target, each: main.each,
  setting: '', bw: main.bw, sets: main.sets, note: '', alts: []
}));
const variantsOf = main => [main, ...main.alts, ...userAlts(main)];
function activeVar(main) {
  const vs = variantsOf(main);
  return vs.find(v => v.id === S.pick[main.id]) || main;
}
const targetOf = it => S.targets[it.id] ?? it.target;
/* 種目メモ（マシン設定など）。既定値は元データの setting */
const memoOf = it => S.memos[it.id] ?? it.setting ?? '';
const memoOpen = new Set();

function exCard(main, sess) {
  const vs = variantsOf(main);
  const it = activeVar(main);
  const p1 = prevRecords(it.id, sess && sess.id)[0];
  const b1 = p1 && bestOf(p1.logs[it.id]);
  const sets = (sess && sess.logs[it.id]) || [];
  const rows = sets.length ? sets : Array.from({ length: it.sets || 2 }, () => ({ w: '', r: '' }));

  const pills = [
    `<label class="pill tgt">目標<input inputmode="numeric" data-tgt="${it.id}" value="${esc(targetOf(it) || '')}" placeholder="—">${it.each ? 'e' : ''}reps</label>`,
    it.note ? `<span class="pill">${esc(it.note)}</span>` : ''
  ].join('');

  const memo = memoOf(it);
  const memoRow = `<div class="memorow" ${memoOpen.has(it.id) ? '' : 'hidden'}>
    <input data-memo="${it.id}" value="${esc(memo)}" placeholder="椅子の高さ・セーフティー位置など">
  </div>`;

  const others = vs.filter(v => v.id !== it.id);
  const swap = `
    <div class="swap">
      <span class="swaplbl">切替</span>
      ${others.map(v => {
        const has = sess && sess.logs[v.id] && sess.logs[v.id].some(s => s.w || s.r);
        return `<button class="vchip" data-pick="${main.id}:${v.id}">${esc(exName(v))}${has ? '<i class="dot"></i>' : ''}</button>`;
      }).join('')}
      <button class="vchip add" data-newalt="${main.id}">＋ 種目</button>
    </div>`;

  const prevHTML = `<div class="prev">
    ${b1 ? `<div class="prevbox"><span class="xs dim">前回 ${fmtDate(p1.date)}</span>${setList(p1.logs[it.id])}</div>`
         : `<div class="prevbox"><span class="xs dim">前回</span><b class="dim">—</b></div>`}
    <div class="prevbox now" id="dl-${it.id}"><span class="xs dim">今回</span><b class="dim">—</b></div>
  </div>`;

  const setRows = rows.map((s, i) => `
    <div class="setrow">
      <div class="idx">${i + 1}</div>
      <input inputmode="decimal" data-ex="${it.id}" data-i="${i}" data-k="w" value="${esc(s.w)}" placeholder="${it.bw ? '自重' : 'kg'}">
      <div class="x">×</div>
      <input inputmode="numeric" data-ex="${it.id}" data-i="${i}" data-k="r" value="${esc(s.r)}" placeholder="reps">
      <button class="del" data-del="${it.id}:${i}">×</button>
    </div>`).join('');

  return `<div class="card ex" data-main="${main.id}">
    <div class="exhead">
      <button class="grip" aria-label="並び替え">⠿</button>
      <div class="grow">
        <input class="exname" data-name="${it.id}" value="${esc(exName(it))}" placeholder="種目名"
          ${S.names[it.id] ? 'data-custom="1"' : ''}>
        <div class="row" style="gap:5px;margin-top:5px;flex-wrap:wrap">${pills}</div></div>
      <button class="memobtn ${memo ? 'on' : ''}" data-memotgl="${it.id}" aria-label="メモ">✎&#xFE0E;</button>
      ${it.user ? `<button class="btn sm gho" data-delalt="${main.id}:${it.id}">削除</button>` : ''}
    </div>
    ${memoRow}
    ${swap}
    ${prevHTML}
    ${setRows}
    <button class="btn sm gho addset" data-add="${it.id}">＋ セット</button>
  </div>`;
}

function updateDelta(exId, sess) {
  const box = document.getElementById('dl-' + exId); if (!box) return;
  const cur = bestOf(sess.logs[exId]);
  const prev = prevRecords(exId, sess.id)[0];
  const pb = prev && bestOf(prev.logs[exId]);
  if (!cur) { box.innerHTML = `<span class="xs dim">今回</span><b class="dim">—</b>`; return; }
  let badge = '';
  if (pb && cur.e != null && pb.e != null) {
    const d = cur.e - pb.e, pct = d / pb.e * 100;
    const cls = d > 0.4 ? 'ok' : d < -0.4 ? 'bad' : 'mut';
    badge = ` <span class="xs ${cls}">${d >= 0 ? '+' : ''}${n1(pct)}%</span>`;
  } else if (pb && sumW(cur.w) && sumW(pb.w)) {
    const d = sumW(cur.w) - sumW(pb.w);
    badge = ` <span class="xs ${d > 0 ? 'ok' : d < 0 ? 'bad' : 'mut'}">${d >= 0 ? '+' : ''}${n1(d)}kg</span>`;
  }
  box.innerHTML = `<span class="xs dim">今回 e1RM ${cur.e != null ? n1(cur.e) : '—'}${badge}</span>${setList(sess.logs[exId], 'acc')}`;
}

/* ============ 体組成 ============ */
/* ジムの体組成計は絶対値がブレるので、前回からの上下と全体の傾きだけを見せる */
const METRICS = {
  weight: { label: '体重',     unit: 'kg', color: '#f2f5fa', get: b => b.weight, goodUp: null },
  bf:     { label: '体脂肪率', unit: '%',  color: '#ffb020', get: b => b.bf,     goodUp: false },
  lbm:    { label: '除脂肪',   unit: 'kg', color: '#3ddc97', get: lbmOf,         goodUp: true }
};

function deltaHTML(m, cur, prev) {
  if (cur == null || prev == null) return '<span class="xs dim">—</span>';
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return '<span class="xs mut">±0</span>';
  const cls = m.goodUp === null ? 'mut' : (d > 0) === m.goodUp ? 'ok' : 'bad';
  return `<span class="xs ${cls}">${d > 0 ? '▲' : '▼'}${n1(Math.abs(d))}</span>`;
}

function viewBody(el) {
  document.getElementById('bar-title').textContent = '体組成';
  document.getElementById('bar-right').innerHTML = '';
  const log = bodyLog();
  const cur = log[0], prev = log[1];
  const key = METRICS[S.bodyMetric] ? S.bodyMetric : 'weight';
  const m = METRICS[key];
  const pts = [...log].reverse()
    .map(b => ({ label: fmtDate(b.date), v: m.get(b) }))
    .filter(p => p.v != null);

  el.innerHTML = `
    <div class="card">
      <div class="row" style="gap:9px">
        <div class="grow"><label class="fl">体重 (kg)</label><input id="bw" inputmode="decimal" placeholder="${cur ? n1(cur.weight) : '70.0'}"></div>
        <div class="grow"><label class="fl">体脂肪率 (%)</label><input id="bf" inputmode="decimal" placeholder="${cur && cur.bf != null ? n1(cur.bf) : '15.0'}"></div>
      </div>
      <label class="fl" style="margin-top:10px">日付</label>
      <input type="date" id="bdate" value="${today()}" max="${today()}">
      <button class="btn pri full" id="brec" style="margin-top:11px">記録する</button>
    </div>

    <div class="card">
      <div class="metric3">
        ${Object.values(METRICS).map(mm => {
          const v = cur && mm.get(cur);
          return `<div>
            <span class="xs dim">${mm.label}</span>
            <b class="mono" style="color:${mm.color}">${v != null ? n1(v) : '—'}<i>${mm.unit}</i></b>
            ${deltaHTML(mm, v, prev && mm.get(prev))}
          </div>`;
        }).join('')}
      </div>
      <div class="xs dim" style="margin-top:9px;text-align:center">
        ${cur ? `最終記録 ${cur.date}（${daysAgo(cur.date) === 0 ? '今日' : daysAgo(cur.date) + '日前'}）· 全${log.length}件`
              : '記録がありません'}
      </div>
    </div>

    <h2 class="sec">推移</h2>
    <div class="card">
      <div class="seg" style="margin-bottom:10px">
        ${Object.entries(METRICS).map(([k, mm]) =>
          `<button data-m="${k}" class="${k === key ? 'on' : ''}">${mm.label}</button>`).join('')}
      </div>
      <canvas class="chart" id="bc"></canvas>
      ${pts.length >= 2 ? (() => {
        const d = pts[pts.length - 1].v - pts[0].v;
        const cls = m.goodUp === null ? 'mut' : (d > 0) === m.goodUp ? 'ok' : 'bad';
        return `<div class="sm mut" style="margin-top:8px">${pts.length}件 · 初回比 <b class="${cls}">${d >= 0 ? '+' : ''}${n1(d)}${m.unit}</b></div>`;
      })() : ''}
    </div>

    <h2 class="sec">記録一覧</h2>
    ${log.length ? `<div class="card">${log.map(b => `<div class="brow">
      <span class="sm">${b.date}</span>
      <b class="mono">${n1(b.weight)}<i>kg</i></b>
      <b class="mono">${b.bf != null ? n1(b.bf) : '—'}<i>%</i></b>
      <button class="del" data-bdel="${b.date}">×</button>
    </div>`).join('')}</div>` : '<div class="card sm dim">まだ記録がありません</div>'}
  `;

  chart(el.querySelector('#bc'), pts, m.color);
  el.querySelector('.seg').onclick = e => {
    const b = e.target.closest('button[data-m]'); if (!b) return;
    S.bodyMetric = b.dataset.m; save(); render();
  };
  el.querySelector('#brec').onclick = () => {
    const w = parseFloat(el.querySelector('#bw').value);
    const bf = parseFloat(el.querySelector('#bf').value);
    const date = el.querySelector('#bdate').value || today();
    if (!w) { toast('体重を入力'); return; }
    S.body = S.body.filter(x => x.date !== date);
    S.body.push({ date, weight: w, bf: isNaN(bf) ? null : bf });
    save(); render(); toast('記録しました');
  };
  el.querySelectorAll('[data-bdel]').forEach(b => b.onclick = () => {
    S.body = S.body.filter(x => x.date !== b.dataset.bdel); save(); render();
  });
}

/* ============ 記録 ============ */
function viewHistory(el) {
  document.getElementById('bar-title').textContent = '記録';
  document.getElementById('bar-right').innerHTML = '';
  const sel = S.histEx || 'bench';
  const recs = S.sessions.filter(s => s.logs[sel]).sort((a, b) => a.date.localeCompare(b.date))
    .map(s => { const b = bestOf(s.logs[sel]); return b && b.e != null ? { label: fmtDate(s.date), v: n1(b.e), date: s.date, set: setLabel(b) } : null; })
    .filter(Boolean);
  const sessions = [...S.sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

  el.innerHTML = `
    <h2 class="sec">種目別 推定1RM</h2>
    <div class="card">
      <select id="hex" style="margin-bottom:10px">
        ${PROGRAM.map(d => `<optgroup label="${d.name}">${d.items.flatMap(variantsOf).map(it => `<option value="${it.id}" ${it.id === sel ? 'selected' : ''}>${esc(exName(it))}</option>`).join('')}</optgroup>`).join('')}
      </select>
      <canvas class="chart" id="c1"></canvas>
      ${recs.length >= 2 ? (() => {
        const d = recs[recs.length - 1].v - recs[0].v;
        return `<div class="sm mut" style="margin-top:8px">${recs.length}回の記録 · 初回比 <b class="${d >= 0 ? 'ok' : 'bad'}">${d >= 0 ? '+' : ''}${n1(d)}kg</b> · 最新 <b>${esc(recs[recs.length - 1].set)}</b></div>`;
      })() : ''}
    </div>

    <h2 class="sec">セッション履歴</h2>
    ${sessions.length ? sessions.map(s => {
      const day = PROGRAM.find(d => d.id === s.day);
      const n = Object.keys(s.logs).length;
      return `<div class="card tight">
        <div class="row between"><div><b class="sm">${day ? day.name : s.day}</b> <span class="xs dim">${s.date} (${daysAgo(s.date)}日前)</span></div>
        <div class="row" style="gap:6px"><span class="pill">${n}種目</span>${s.done ? '' : '<span class="pill acc">進行中</span>'}
        <button class="btn sm gho" data-sdel="${s.id}">×</button></div></div>
        <div class="xs mut" style="margin-top:6px">${Object.entries(s.logs).map(([k, v]) => { const b = bestOf(v); return b ? `${esc(nameOf(k))} ${esc(setLabel(b))}` : ''; }).filter(Boolean).join(' ／ ')}</div>
      </div>`;
    }).join('') : '<div class="card sm dim">履歴なし</div>'}
  `;
  chart(el.querySelector('#c1'), recs, '#d8ff45');
  el.querySelector('#hex').onchange = e => { S.histEx = e.target.value; save(); render(); };
  el.querySelectorAll('[data-sdel]').forEach(b => b.onclick = () => {
    if (!confirm('このセッションを削除しますか？')) return;
    S.sessions = S.sessions.filter(x => x.id !== b.dataset.sdel); save(); render();
  });
}

/* ============ 設定 ============ */
function viewSettings(el) {
  document.getElementById('bar-title').textContent = '設定';
  document.getElementById('bar-right').innerHTML = '';
  el.innerHTML = `
    <h2 class="sec">データ</h2>
    <div class="card">
      <button class="btn full" id="exp">バックアップを書き出す (JSON)</button>
      <div style="height:8px"></div>
      <label class="btn full" style="display:block">読み込む<input type="file" id="imp" accept="application/json" style="display:none"></label>
      <div class="hr"></div>
      <button class="btn full dan" id="rst">全データを削除</button>
      <div class="xs dim" style="margin-top:10px;line-height:1.7">
        データはこの端末のブラウザ内（localStorage）にのみ保存されます。サーバーには一切送信されません。<br>
        機種変更の前には必ずバックアップを書き出してください。
      </div>
    </div>

    <div class="card sm dim" style="text-align:center">
      Training Log · ${S.sessions.length} セッション / ${S.body.length} 件の体組成記録
    </div>
  `;
  el.querySelector('#exp').onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `traininglog-${today()}.json`; a.click();
  };
  el.querySelector('#imp').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { S = Object.assign(defaults(), JSON.parse(r.result)); save(); render(); toast('読み込みました'); }
      catch (err) { toast('読み込み失敗'); }
    };
    r.readAsText(f);
  };
  el.querySelector('#rst').onclick = () => {
    if (!confirm('全データを削除します。よろしいですか？')) return;
    localStorage.removeItem(KEY); S = defaults(); save(); render();
  };
}

render();
