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
    settings: { height: 172, age: 30, sex: 'm', activity: 1.55, targetW: 70, targetBf: 10, bfCal: 0 },
    body: [],
    sessions: [],
    meals: {},
    names: {},
    pick: {},
    alts: {},
    targets: {},
    order: {},
    presets: {},
    memos: {},
    tab: 'workout',
    day: 'day1',
    mealDate: null,
    logDate: null
  };
}

let S;
try { S = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { S = null; }
if (!S) S = defaults();   // 新しい端末は空から始める（前回欄は「—」）
const _d = defaults();
S = Object.assign(_d, S);
S.settings = Object.assign(_d.settings, S.settings);
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

/* ============ 栄養計算 ============ */
function latestBody() {
  if (!S.body.length) return null;
  return [...S.body].sort((a, b) => b.date.localeCompare(a.date))[0];
}
const GOALS = { auto: '自動', recomp: 'リコンプ', cut: '減量', bulk: '増量', maint: '維持' };
const MODE_LABEL = { recomp: 'リコンプ', cut: '減量', bulk: '増量', maint: '維持' };
const MODE_WHY = {
  recomp: '体重をほぼ据え置きにしたまま脂肪を落とし、その分を筋肉に置き換える方針。維持カロリーのすぐ下（−5%前後）に留め、タンパク質を高く保ちます。',
  cut: '増やす除脂肪量より落とす脂肪量が大きいので、まず脂肪を削る方針です。',
  bulk: '目標体重までまだ余裕があるので、維持カロリー＋αで除脂肪量を増やす方針です。',
  maint: '現状と目標がほぼ一致しているため、維持カロリーで体組成をキープします。'
};

function plan() {
  const st = S.settings, b = latestBody();
  const w = b ? b.weight : st.targetW;
  const bf = b && b.bf != null ? b.bf : 15;
  const lbm = w * (1 - bf / 100);
  const bmr = 370 + 21.6 * lbm;
  const tdee = bmr * st.activity;
  const targetFatMass = st.targetW * st.targetBf / 100;
  const fatDelta = w * bf / 100 - targetFatMass;      // >0 → 落とす脂肪量
  const lbmDelta = (st.targetW - targetFatMass) - lbm; // >0 → 増やす除脂肪量

  const auto = !st.goal || st.goal === 'auto';
  let key = auto ? null : st.goal;
  if (!key) {
    // 脂肪も落としたいが除脂肪も増やしたい＝体重据え置き → リコンプ
    if (fatDelta > 1 && lbmDelta > 1) key = 'recomp';
    else if (fatDelta > 1) key = 'cut';
    else if (st.targetW - w > 1) key = 'bulk';
    else key = 'maint';
  }
  let kcal, deficit = 0, pk;
  if (key === 'cut') {
    deficit = Math.min(w * 0.005 * 7700 / 7, tdee * 0.22); kcal = tdee - deficit; pk = 2.4;
  } else if (key === 'recomp') {
    deficit = Math.min(tdee * 0.06, 180); kcal = tdee - deficit; pk = 2.6;
  } else if (key === 'bulk') {
    kcal = tdee + 280; pk = 2.2;
  } else { kcal = tdee; pk = 2.2; }
  const p = lbm * pk;
  const f = Math.max(kcal * 0.22 / 9, lbm * 0.7);
  const c = Math.max(0, (kcal - p * 4 - f * 9) / 4);
  const weeks = deficit > 0 && fatDelta > 0 ? fatDelta * 7700 / (deficit * 7) : null;
  return { w, bf, lbm, bmr, tdee, key, mode: MODE_LABEL[key], why: MODE_WHY[key], auto,
    kcal, p, f, c, deficit, fatDelta, lbmDelta, weeks, hasBody: !!b };
}
/* プリセット（ユーザー編集を優先） */
const presetOf = m => S.presets[m.id] || m;
const presetName = m => presetOf(m).n || m.n;
const presetItems = m => presetOf(m).items || m.items;
function editPreset(id) {
  const base = MEAL_PRESETS.find(m => m.id === id);
  if (!S.presets[id]) S.presets[id] = { n: base.n, items: base.items.map(i => ({ ...i })) };
  return S.presets[id];
}

function foodMacros(fid, g) {
  const F = FOODS[fid]; if (!F) return { kcal: 0, p: 0, f: 0, c: 0 };
  const k = F.unitG ? g : g / 100;
  return { kcal: F.kcal * k, p: F.p * k, f: F.f * k, c: F.c * k };
}
function dayTotals(date) {
  const items = S.meals[date] || [];
  const t = { kcal: 0, p: 0, f: 0, c: 0 };
  items.forEach(i => { const m = foodMacros(i.fid, i.g); t.kcal += m.kcal; t.p += m.p; t.f += m.f; t.c += m.c; });
  return t;
}

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
  const lit = S.tab === 'body' ? 'settings' : S.tab;
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === lit));
  const el = app();
  const V = { workout: viewWorkout, nutrition: viewNutrition, form: viewForm, history: viewHistory, settings: viewSettings, body: viewBody };
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
    const an = e.target.closest('[data-analyze]');
    if (an) { window.FA_PRESET = an.dataset.analyze; go('form'); }
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
  setting: '', video: main.video, bw: main.bw, sets: main.sets,
  analyze: main.analyze, note: '', seed: [], alts: []
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
      ${it.analyze ? `<button class="btn sm gho" data-analyze="${it.analyze}">解析</button>` : ''}
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

/* ============ 食事 ============ */
let editMode = false;
const foodOptions = sel => Object.entries(FOODS)
  .map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(v.n)}</option>`).join('');

function presetEditor(m) {
  const items = presetItems(m), custom = !!S.presets[m.id];
  return `<div class="peditor">
    <div class="row" style="gap:7px">
      <span>${m.icon}</span>
      <input class="pname grow" data-pname="${m.id}" value="${esc(presetName(m))}">
      ${custom ? `<button class="btn sm gho" data-preset-reset="${m.id}">既定に戻す</button>` : ''}
    </div>
    ${items.map((i, idx) => `<div class="prow">
      <select data-pf="${m.id}:${idx}">${foodOptions(i.fid)}</select>
      <input inputmode="decimal" data-pg="${m.id}:${idx}" value="${i.g}">
      <span class="xs dim">${FOODS[i.fid] ? FOODS[i.fid].u : ''}</span>
      <button class="del" data-pdel="${m.id}:${idx}">×</button>
    </div>`).join('')}
    <button class="btn sm gho full" data-padd="${m.id}" style="margin-top:7px">＋ 食材</button>
  </div>`;
}

function viewNutrition(el) {
  const date = S.mealDate || today();
  const P = plan(), T = dayTotals(date), items = S.meals[date] || [];
  document.getElementById('bar-title').textContent = '食事';
  document.getElementById('bar-right').innerHTML = `<span class="xs dim">${P.mode} ${n0(P.kcal)} kcal</span>`;

  const barRow = (label, v, tgt, unit, color) => {
    const pct = Math.min(100, tgt ? v / tgt * 100 : 0);
    const diff = v - tgt;
    return `<div style="margin-bottom:11px">
      <div class="row between xs"><span class="b" style="color:${color}">${label}</span>
        <span class="mono mut">${n0(v)} / ${n0(tgt)} ${unit}
          <span class="${Math.abs(diff) < tgt * .08 ? 'ok' : diff > 0 ? 'warn' : 'dim'}">(${diff >= 0 ? '+' : ''}${n0(diff)})</span></span></div>
      <div class="bar"><i style="width:${pct}%;background:${color}"></i></div></div>`;
  };

  el.innerHTML = `
    <div class="card tight row between">
      <button class="btn sm gho" id="pd">◀</button>
      <div class="b">${date === today() ? '今日' : date}</div>
      <button class="btn sm gho" id="nd" ${date === today() ? 'disabled style="opacity:.3"' : ''}>▶</button>
    </div>

    <div class="card">
      <div class="macro4" style="margin-bottom:14px">
        <div><b class="mono">${n0(T.kcal)}</b><span>KCAL</span></div>
        <div><b class="mono ok">${n0(T.p)}</b><span>P (g)</span></div>
        <div><b class="mono warn">${n0(T.f)}</b><span>F (g)</span></div>
        <div><b class="mono acc">${n0(T.c)}</b><span>C (g)</span></div>
      </div>
      ${barRow('カロリー', T.kcal, P.kcal, 'kcal', '#f2f5fa')}
      ${barRow('タンパク質', T.p, P.p, 'g', '#3ddc97')}
      ${barRow('脂質', T.f, P.f, 'g', '#ffb020')}
      ${barRow('糖質', T.c, P.c, 'g', '#d8ff45')}
    </div>

    <h2 class="sec">クイック追加</h2>
    <div class="card tight">
      <div class="row between" style="margin-bottom:8px">
        <span class="xs dim">1タップでまとめて記録</span>
        <button class="btn sm gho" id="pedit">${editMode ? '完了' : '中身を編集'}</button>
      </div>
      ${editMode ? MEAL_PRESETS.map(presetEditor).join('') : `
      <div class="row" style="flex-wrap:wrap;gap:7px">
        ${MEAL_PRESETS.map(m => `<button class="btn sm" data-preset="${m.id}">${m.icon} ${esc(presetName(m))}</button>`).join('')}
      </div>`}
      <div class="hr"></div>
      <div class="row" style="gap:7px">
        <select id="fsel" class="grow">${foodOptions()}</select>
        <input id="fg" inputmode="decimal" placeholder="量" style="width:74px;text-align:center">
        <button class="btn sm pri" id="fadd">追加</button>
      </div>
    </div>

    <h2 class="sec">記録 (${items.length})</h2>
    <div class="card">
      ${items.length ? items.map((i, idx) => {
        const F = FOODS[i.fid], m = foodMacros(i.fid, i.g);
        return `<div class="fitem">
          <div><div class="sm b">${esc(F ? F.n : i.fid)}</div>
            <div class="xs dim mono">${n0(m.kcal)}kcal · P${n1(m.p)} F${n1(m.f)} C${n1(m.c)}</div></div>
          <div class="row" style="gap:4px"><input inputmode="decimal" data-mi="${idx}" value="${i.g}"><span class="xs dim">${F ? F.u : ''}</span></div>
          <button class="del btn sm gho" data-mdel="${idx}">×</button></div>`;
      }).join('') : '<div class="sm dim" style="text-align:center;padding:14px 0">まだ記録がありません</div>'}
      ${items.length ? `<div class="hr"></div><button class="btn sm dan full" id="clr">この日をクリア</button>` : ''}
    </div>

    <h2 class="sec">アドバイス</h2>
    ${advice(P, T, date).map(a => `<div class="advice ${a.k}">${a.t}</div>`).join('')}

    ${(() => { const R = foodRecs(P, T, date); return R.length ? `
    <h2 class="sec">摂った方がいい食材</h2>
    <div class="card">${R.map(x => `<div class="frec">
      <span class="q">${esc(x.q)}</span>
      <div><b>${esc(x.n)}</b><div class="why">${x.why}</div></div>
    </div>`).join('')}</div>` : ''; })()}

    <h2 class="sec">目標の内訳</h2>
    <div class="card sm">
      ${P.hasBody ? '' : '<div class="advice warn" style="margin:0 0 10px">設定タブで体重・体脂肪率を記録すると精度が上がります（現在は仮の値）。</div>'}
      <div class="row between"><span class="mut">体重 / 体脂肪率</span><b class="mono">${n1(P.w)} kg / ${n1(P.bf)} %</b></div>
      <div class="row between"><span class="mut">除脂肪体重 (LBM)</span><b class="mono">${n1(P.lbm)} kg</b></div>
      <div class="row between"><span class="mut">基礎代謝 / 維持カロリー</span><b class="mono">${n0(P.bmr)} / ${n0(P.tdee)}</b></div>
      <div class="hr"></div>
      <div class="row between"><span class="mut">目標</span><b class="mono">${n1(S.settings.targetW)} kg / ${n1(S.settings.targetBf)} %</b></div>
      <div class="row between"><span class="mut">落とす脂肪 / 増やす除脂肪</span><b class="mono">${n1(P.fatDelta)} kg / ${P.lbmDelta >= 0 ? '+' : ''}${n1(P.lbmDelta)} kg</b></div>
      ${P.weeks ? `<div class="row between"><span class="mut">推定期間</span><b class="mono">約 ${n0(P.weeks)} 週</b></div>` : ''}
      <div class="hr"></div>
      <div class="row between" style="margin-bottom:6px">
        <span class="mut">方針</span>
        <label class="pill acc"><select id="goal" class="bare">${Object.entries(GOALS).map(([k, l]) =>
          `<option value="${k}" ${(S.settings.goal || 'auto') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="xs mut">${P.auto ? `自動判定 → <b class="acc">${P.mode}</b>。` : ''}${P.why}</div>
    </div>

    <h2 class="sec">${esc(CURRY_RECIPE.n)}</h2>
    <div class="card sm mut">${CURRY_RECIPE.lines.map(l => `<div>・${esc(l)}</div>`).join('')}</div>
  `;

  el.querySelector('#pd').onclick = () => { const d = new Date(date); d.setDate(d.getDate() - 1); S.mealDate = dstr(d); save(); render(); };
  el.querySelector('#nd').onclick = () => { const d = new Date(date); d.setDate(d.getDate() + 1); S.mealDate = dstr(d) > today() ? today() : dstr(d); save(); render(); };
  el.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    const m = MEAL_PRESETS.find(x => x.id === b.dataset.preset);
    const arr = S.meals[date] || (S.meals[date] = []);
    presetItems(m).forEach(i => arr.push({ ...i }));
    save(); render(); toast(presetName(m) + ' を追加');
  });
  el.querySelector('#pedit').onclick = () => { editMode = !editMode; render(); };
  // #app は使い回されるので、毎回作り直されるカードにだけ委譲を張る
  const pcard = el.querySelector('#pedit').closest('.card');
  pcard.addEventListener('input', e => {
    const nm = e.target.closest('[data-pname]');
    if (nm) { editPreset(nm.dataset.pname).n = nm.value.trim() || undefined; save(); return; }
    const g = e.target.closest('[data-pg]');
    if (g) {
      const [id, idx] = g.dataset.pg.split(':');
      editPreset(id).items[+idx].g = parseFloat(g.value) || 0; save();
    }
  });
  pcard.addEventListener('change', e => {
    const f = e.target.closest('[data-pf]');
    if (!f) return;
    const [id, idx] = f.dataset.pf.split(':');
    editPreset(id).items[+idx].fid = f.value; save(); render();
  });
  pcard.addEventListener('click', e => {
    const d = e.target.closest('[data-pdel]');
    if (d) { const [id, idx] = d.dataset.pdel.split(':'); editPreset(id).items.splice(+idx, 1); save(); render(); return; }
    const a = e.target.closest('[data-padd]');
    if (a) { editPreset(a.dataset.padd).items.push({ fid: Object.keys(FOODS)[0], g: 100 }); save(); render(); return; }
    const r = e.target.closest('[data-preset-reset]');
    if (r) { delete S.presets[r.dataset.presetReset]; save(); render(); toast('既定に戻しました'); }
  });
  el.querySelector('#fadd').onclick = () => {
    const fid = el.querySelector('#fsel').value, g = parseFloat(el.querySelector('#fg').value);
    if (!g) { toast('量を入力'); return; }
    (S.meals[date] || (S.meals[date] = [])).push({ fid, g });
    save(); render();
  };
  el.querySelectorAll('[data-mi]').forEach(i => i.oninput = () => {
    S.meals[date][+i.dataset.mi].g = parseFloat(i.value) || 0; save();
  });
  el.querySelectorAll('[data-mi]').forEach(i => i.onblur = () => render());
  el.querySelectorAll('[data-mdel]').forEach(b => b.onclick = () => { S.meals[date].splice(+b.dataset.mdel, 1); save(); render(); });
  el.querySelector('#goal').onchange = e => { S.settings.goal = e.target.value; save(); render(); };
  const c = el.querySelector('#clr');
  if (c) c.onclick = () => { delete S.meals[date]; save(); render(); };
}

/* 摂った方がいい食材：実際に不足しているものだけを、余った枠に収まる範囲で出す */
function foodRecs(P, T, date) {
  const items = S.meals[date] || [];
  if (!items.length) return [];
  const has = (...ids) => ids.some(f => items.some(i => i.fid === f));
  const dP = T.p - P.p, dF = T.f - P.f, dC = T.c - P.c, dK = T.kcal - P.kcal;
  const done = P.kcal ? T.kcal / P.kcal : 0;   // その日の記録の進み具合
  const r = [];

  // ① 不足マクロを埋める（足りているものは出さない）
  if (dP < -15) {
    r.push(dK < -200
      ? { n: '鶏胸肉（皮なし）', q: `${n0(-dP / 0.233)}g`, why: `P が ${n0(-dP)}g 足りません。100gでP23.3g・脂質1.9gなので、カロリー枠 ${n0(-dK)}kcal を圧迫せずにPだけ積めます。` }
      : { n: 'プロテイン(WPC)', q: `${Math.ceil(-dP / 24)}杯`, why: `P が ${n0(-dP)}g 足りない一方、カロリー枠はもう余っていません。1杯 115kcal でP24g のWPCが最も枠を食いません。` });
  }
  if (dC < -50) {
    r.push({ n: 'さつまいも（蒸し）', q: `${n0(-dC / 0.319)}g`, why: `糖質が ${n0(-dC)}g 不足。GIが低く食物繊維も取れるので血糖が安定します。トレ前2時間に寄せると高重量セットの後半が保ちます。` });
  }
  if (dF < -15) {
    r.push({ n: 'アーモンド / オリーブオイル', q: '20g / 小さじ1', why: `脂質が ${n0(-dF)}g 不足。総カロリーの15%を割る状態が続くとテストステロンが下がりやすくなります。` });
  }

  // ② ＋αで効くもの（1日の記録が6割以上埋まってから＝食べ忘れではなく本当に抜けている時だけ）
  if (done > 0.6) {
    if (!has('saba', 'whitefish')) {
      r.push({ n: 'サバ水煮缶', q: '1缶', why: 'EPA/DHA（オメガ3）が今日ゼロです。トレ後の炎症を鎮めて回復を早めます。P30gも同時に入るので、Pが足りない日はこれ1つで両方埋まります。' });
    }
    if (!has('spinach', 'broccoli', 'maitake', 'tomatocan', 'kiwi')) {
      r.push({ n: 'ほうれん草 / ブロッコリー', q: '各100g', why: '野菜が入っていません。鉄と葉酸が不足すると酸素運搬が落ちて高レップの粘りが減り、ビタミンC不足は腱・靭帯のコラーゲン合成を鈍らせます。2つで55kcalです。' });
    }
    if (!has('creatine')) {
      r.push({ n: 'クレアチン', q: '5g', why: '今日まだ摂れていません。高強度セットの反復を平均1〜2レップ押し上げる、最も再現性の高いサプリです。タイミングは不問で、毎日続けることが全てです。' });
    }
  }

  // ③ 就寝前（1日ほぼ終わっていて、まだPが下限未満のときだけ）
  if (done > 0.8 && P.key === 'recomp' && T.p < P.lbm * 2.2 && !has('oikos')) {
    r.push({ n: 'ギリシャヨーグルト（就寝前）', q: '150g', why: `リコンプ中はP ${n0(P.lbm * 2.2)}g（LBM×2.2）が下限で、今日は ${n0(T.p)}g。消化の遅いカゼインを寝る前に入れると睡眠中の分解を抑えられます。` });
  }
  return r.slice(0, 3);
}

function advice(P, T, date) {
  const a = [];
  if (!(S.meals[date] || []).length) {
    a.push({ k: '', t: `目標は <b>${n0(P.kcal)} kcal / P ${n0(P.p)}g・F ${n0(P.f)}g・C ${n0(P.c)}g</b>（${P.mode}期）。上のプリセットで1タップ記録できます。` });
    return a;
  }
  const dK = T.kcal - P.kcal, dP = T.p - P.p, dF = T.f - P.f, dC = T.c - P.c;
  if (dP < -12) a.push({ k: 'bad', t: `タンパク質が <b>${n0(-dP)}g 不足</b>。プロテイン ${Math.ceil(-dP / 24)} 杯、または鶏胸肉 ${n0(-dP / 0.233)}g を追加してください。LBM×2.0g を下回ると筋量維持が不利になります。` });
  else if (dP > 45) a.push({ k: '', t: `タンパク質が目標を ${n0(dP)}g 上回っています。過剰分は主にエネルギーになるので、その分は糖質に回した方がトレーニングのパフォーマンスは上がります。` });
  else a.push({ k: 'ok', t: `タンパク質 <b>${n0(T.p)}g</b>（LBM 1kgあたり ${n1(T.p / P.lbm)}g）— 適正範囲です。` });

  if (dF < -14) a.push({ k: 'warn', t: `脂質が ${n0(-dF)}g 不足。総カロリーの15%を下回る状態が続くとテストステロンが落ちやすくなります。卵を1個増やす（+5g）かオリーブオイル小さじ1（+4g）を。` });
  else if (dF > 22) a.push({ k: 'warn', t: `脂質が ${n0(dF)}g オーバー。同じカロリーなら糖質に置き換えた方がトレーニング中の出力が保てます。` });

  if (dC < -45) a.push({ k: 'warn', t: `糖質が ${n0(-dC)}g 不足。さつまいも ${n0(-dC / 0.319)}g、または米（生）${n0(-dC / 0.771)}g を追加。特にトレ前後2時間に寄せると Day2・Day4 の高重量スクワットで効きます。` });
  else if (dC > 60) a.push({ k: '', t: `糖質が ${n0(dC)}g オーバー。減量が停滞するなら、まず夜の米 1合→0.7合（-45g）から削るのが体感の少ない削り方です。` });

  if (P.key === 'recomp') a.push({ k: '', t: `リコンプ中は体重ではなく <b>挙上重量の伸び</b> が指標です。週あたりの体重減が 0.2kg を超えて続くなら +150kcal、4週間 e1RM が伸びないなら −150kcal で微調整してください。` });
  if (Math.abs(dK) <= P.kcal * 0.05) a.push({ k: 'ok', t: `総カロリー <b>${n0(T.kcal)} kcal</b>（目標 ±5%以内）。この配分を維持してください。` });
  else if (dK > 0) a.push({ k: dK > P.kcal * .15 ? 'bad' : 'warn', t: `${n0(dK)} kcal オーバー。${P.deficit > 0 ? '週あたりの脂肪減が ' + n1(dK * 7 / 7700) + 'kg 目減りします。' : ''}` });
  else a.push({ k: dK < -P.kcal * .18 ? 'bad' : 'warn', t: `${n0(-dK)} kcal 不足。過度な赤字は除脂肪量の減少とパフォーマンス低下を招きます。糖質で埋めてください。` });

  a.push({ k: '', t: `<b>タイミング</b>：クレアチン8gは毎日（タイミング不問・継続が全て）。トレ中の粉ポカリ（C 62g）は Day2/Day4 のような高強度日に有効。就寝前は消化の遅いタンパク質（ヨーグルト・カゼイン）が回復に効きます。` });
  return a;
}

/* ============ フォーム解析（本体は form.js） ============ */
function viewForm(el) {
  document.getElementById('bar-title').textContent = 'フォーム解析';
  document.getElementById('bar-right').innerHTML = '';
  if (window.FormUI) window.FormUI.render(el);
  else el.innerHTML = '<div class="card sm mut">解析エンジンを読み込み中… <span class="spin"></span></div>';
}

/* ============ 写真から体組成（本体は body.js） ============ */
function viewBody(el) {
  document.getElementById('bar-title').textContent = '体組成スキャン';
  document.getElementById('bar-right').innerHTML = '<button class="btn sm gho" id="bback">戻る</button>';
  document.getElementById('bback').onclick = () => go('settings');
  if (window.BodyUI) window.BodyUI.render(el);
  else el.innerHTML = '<div class="card sm mut">解析エンジンを読み込み中… <span class="spin"></span></div>';
}

/* ============ 記録 ============ */
function viewHistory(el) {
  document.getElementById('bar-title').textContent = '記録';
  document.getElementById('bar-right').innerHTML = '';
  const allEx = Object.values(EX_MAP);
  const sel = S.histEx || 'bench';
  const recs = S.sessions.filter(s => s.logs[sel]).sort((a, b) => a.date.localeCompare(b.date))
    .map(s => { const b = bestOf(s.logs[sel]); return b && b.e != null ? { label: fmtDate(s.date), v: n1(b.e), date: s.date, set: setLabel(b) } : null; })
    .filter(Boolean);
  const bodyPts = [...S.body].sort((a, b) => a.date.localeCompare(b.date)).map(b => ({ label: fmtDate(b.date), v: b.weight }));
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

    <h2 class="sec">体重の推移</h2>
    <div class="card"><canvas class="chart" id="c2"></canvas></div>

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
  chart(el.querySelector('#c2'), bodyPts, '#3ddc97');
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
  const st = S.settings, b = latestBody();
  const F = (k, label, v, extra = '') => `<div class="grow"><label class="fl">${label}</label><input id="s-${k}" inputmode="decimal" value="${v}" ${extra}></div>`;

  el.innerHTML = `
    <h2 class="sec">今日の身体データ</h2>
    <div class="card">
      <div class="row" style="gap:9px">
        <div class="grow"><label class="fl">体重 (kg)</label><input id="bw" inputmode="decimal" value="${b ? b.weight : ''}" placeholder="70.0"></div>
        <div class="grow"><label class="fl">体脂肪率 (%)</label><input id="bf" inputmode="decimal" value="${b && b.bf != null ? b.bf : ''}" placeholder="15.0"></div>
      </div>
      <button class="btn pri full" id="brec" style="margin-top:11px">今日の記録として保存</button>
      <button class="btn full" id="bscan" style="margin-top:8px">写真から体脂肪率を推定</button>
      ${b ? `<div class="xs dim" style="margin-top:8px;text-align:center">最終記録: ${b.date}（${daysAgo(b.date)}日前）· 全${S.body.length}件</div>` : ''}
    </div>

    <h2 class="sec">プロフィール / 目標</h2>
    <div class="card">
      <div class="row" style="gap:9px">${F('height', '身長 (cm)', st.height)}${F('age', '年齢', st.age)}</div>
      <div class="row" style="gap:9px;margin-top:10px">${F('targetW', '目標体重 (kg)', st.targetW)}${F('targetBf', '目標体脂肪率 (%)', st.targetBf)}</div>
      <div style="margin-top:10px"><label class="fl">活動量</label>
        <select id="s-activity">
          ${[[1.375, '軽い（デスクワーク中心＋週2-3トレ）'], [1.55, '中程度（週4-5トレ）'], [1.725, '高い（立ち仕事＋週5-6トレ）']]
            .map(([v, l]) => `<option value="${v}" ${+st.activity === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
      <button class="btn pri full" id="ssave" style="margin-top:12px">保存</button>
    </div>

    <h2 class="sec">データ</h2>
    <div class="card">
      <button class="btn full" id="exp">バックアップを書き出す (JSON)</button>
      <div style="height:8px"></div>
      <label class="btn full" style="display:block">読み込む<input type="file" id="imp" accept="application/json" style="display:none"></label>
      <div class="hr"></div>
      <button class="btn full dan" id="rst">全データを削除</button>
      <div class="xs dim" style="margin-top:10px;line-height:1.7">
        データはこの端末のブラウザ内（localStorage）にのみ保存されます。サーバーには一切送信されません。
        動画も端末内で解析され、外部に送られません。<br>
        機種変更の前には必ずバックアップを書き出してください。
      </div>
    </div>
  `;
  el.querySelector('#bscan').onclick = () => go('body');
  el.querySelector('#brec').onclick = () => {
    const w = parseFloat(el.querySelector('#bw').value), bf = parseFloat(el.querySelector('#bf').value);
    if (!w) { toast('体重を入力'); return; }
    S.body = S.body.filter(x => x.date !== today());
    S.body.push({ date: today(), weight: w, bf: isNaN(bf) ? null : bf });
    save(); render(); toast('記録しました');
  };
  el.querySelector('#ssave').onclick = () => {
    ['height', 'age', 'targetW', 'targetBf'].forEach(k => {
      const v = parseFloat(el.querySelector('#s-' + k).value); if (!isNaN(v)) st[k] = v;
    });
    st.activity = parseFloat(el.querySelector('#s-activity').value);
    save(); toast('保存しました'); render();
  };
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
