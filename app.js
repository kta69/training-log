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
    settings: { height: 172, age: 30, sex: 'm', activity: 1.55, targetW: 70, targetBf: 10 },
    body: [],
    sessions: [],
    meals: {},
    names: {},
    tab: 'workout',
    day: 'day1',
    mealDate: null,
    logDate: null
  };
}

function seedSessions() {
  const out = [];
  PROGRAM.forEach((day, di) => {
    [0, 1].forEach(k => {
      const logs = {};
      flatItems(day).forEach(it => {
        const r = it.seed[k];
        if (r && r[0]) logs[it.id] = [{ w: r[0], r: r[1] || '' }];
      });
      if (Object.keys(logs).length)
        out.push({ id: uid(), date: dateAdd(-(7 * (k + 1) + di)), day: day.id, logs, done: true, seeded: true });
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

let S;
try { S = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { S = null; }
if (!S) { S = defaults(); S.sessions = seedSessions(); }
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

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 1600);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ============ セッション ============ */
const logDate = () => S.logDate || today();
const exName = it => S.names[it.id] || it.name;

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
  let mode, kcal, deficit = 0;
  if (fatDelta > 1) {
    mode = '減量';
    deficit = Math.min(w * 0.005 * 7700 / 7, tdee * 0.22);
    kcal = tdee - deficit;
  } else if (st.targetW - w > 1) {
    mode = '増量'; kcal = tdee + 280;
  } else { mode = '維持'; kcal = tdee; }
  const p = lbm * (mode === '減量' ? 2.4 : 2.0);
  const f = Math.max(kcal * 0.22 / 9, lbm * 0.7);
  const c = Math.max(0, (kcal - p * 4 - f * 9) / 4);
  const weeks = deficit > 0 ? fatDelta * 7700 / (deficit * 7) : null;
  return { w, bf, lbm, bmr, tdee, mode, kcal, p, f, c, fatDelta, lbmDelta, weeks, hasBody: !!b };
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
  if (pts.length < 1) { x.fillStyle = '#5d6678'; x.font = '12px sans-serif'; x.fillText('データなし', 8, 20); return; }
  const vals = pts.map(p => p.v);
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (mx - mn < 1e-6) { mn -= 1; mx += 1; }
  const pd = (mx - mn) * .18; mn -= pd; mx += pd;
  const PL = 34, PR = 8, PT = 12, PB = 20;
  const X = i => PL + (w - PL - PR) * (pts.length === 1 ? .5 : i / (pts.length - 1));
  const Y = v => PT + (h - PT - PB) * (1 - (v - mn) / (mx - mn));
  x.strokeStyle = '#262d3a'; x.lineWidth = 1; x.font = '9px sans-serif'; x.fillStyle = '#5d6678';
  for (let i = 0; i <= 2; i++) {
    const v = mn + (mx - mn) * i / 2, y = Y(v);
    x.beginPath(); x.moveTo(PL, y); x.lineTo(w - PR, y); x.stroke();
    x.fillText(n1(v).toString(), 2, y + 3);
  }
  x.strokeStyle = color || '#4d8dff'; x.lineWidth = 2; x.beginPath();
  pts.forEach((p, i) => i ? x.lineTo(X(i), Y(p.v)) : x.moveTo(X(i), Y(p.v)));
  x.stroke();
  x.fillStyle = color || '#4d8dff';
  pts.forEach((p, i) => { x.beginPath(); x.arc(X(i), Y(p.v), 2.8, 0, 7); x.fill(); });
  x.fillStyle = '#5d6678';
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
  ({ workout: viewWorkout, nutrition: viewNutrition, form: viewForm, history: viewHistory, settings: viewSettings }[S.tab])(el);
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
      <div class="row between">
        <div class="b sm">ウォームアップ</div>
        <label class="datepick">${d0 === today() ? '今日' : ''}<input type="date" id="logdate" value="${d0}"></label>
      </div>
      <div class="xs dim" style="margin:2px 0 8px">${day.sub}</div>
      <div class="warmup">${day.warmup.map(w => `<span class="pill">${esc(w)}</span>`).join('')}</div>
      <div id="sessbar">${doneToday && !sess ? `<div class="hr"></div><div class="xs ok">✓ ${fmtDate(d0)} の ${day.name} は完了済み（追記すると再開します）</div>` : ''}</div>
    </div>
    <div id="exlist"></div>
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

function showFinishBar(day) {
  const bar = document.getElementById('sessbar'); if (!bar) return;
  bar.innerHTML = `<div class="hr"></div><div class="row between"><span class="xs acc">● 記録中（自動保存）</span>
    <button class="btn sm pri" id="finish">セッション完了</button></div>`;
  bar.querySelector('#finish').onclick = () => {
    const s = currentSession(day.id); if (!s) return;
    Object.keys(s.logs).forEach(k => { s.logs[k] = s.logs[k].filter(x => x.w || x.r); if (!s.logs[k].length) delete s.logs[k]; });
    if (!Object.keys(s.logs).length) { S.sessions = S.sessions.filter(x => x.id !== s.id); toast('記録なし：破棄しました'); }
    else { s.done = true; toast('保存しました'); }
    save(); render();
  };
}

function renderExList(host, day, sess) {
  const need = () => sess || (sess = openSession(day.id));
  host.innerHTML = day.items.map(it => exCard(it, sess, false)).join('');
  host.querySelectorAll('.altbtn').forEach(b => b.onclick = () => {
    const box = b.nextElementSibling;
    const open = box.style.display !== 'none';
    box.style.display = open ? 'none' : 'block';
    b.querySelector('.chev').textContent = open ? '▾' : '▴';
  });
  host.addEventListener('input', e => {
    const nm = e.target.closest('input[data-name]');
    if (nm) {
      const id = nm.dataset.name, v = nm.value.trim();
      if (!v || v === (EX_MAP[id] || {}).name) delete S.names[id]; else S.names[id] = v;
      nm.dataset.custom = S.names[id] ? '1' : '';
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
    if (first) showFinishBar(day);
  });
  host.addEventListener('focusout', e => {
    const nm = e.target.closest('input[data-name]');
    if (nm && !nm.value.trim()) nm.value = (EX_MAP[nm.dataset.name] || {}).name || '';
  });
  host.addEventListener('click', e => {
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
}

function exCard(it, sess, isAlt) {
  const prev = prevRecords(it.id, sess && sess.id);
  const p1 = prev[0], p2 = prev[1];
  const b1 = p1 && bestOf(p1.logs[it.id]);
  const b2 = p2 && bestOf(p2.logs[it.id]);
  const sets = (sess && sess.logs[it.id]) || [];
  const rows = sets.length ? sets : Array.from({ length: it.sets || 2 }, () => ({ w: '', r: '' }));

  const pills = [
    it.setting ? `<span class="pill">${esc(it.setting)}</span>` : '',
    it.target ? `<span class="pill">${it.target}${it.each ? 'e' : ''} reps</span>` : '',
    it.note ? `<span class="pill">${esc(it.note)}</span>` : ''
  ].join('');

  const prevHTML = `<div class="prev">
    ${b1 ? `<div class="prevbox"><span class="xs dim">前回 ${fmtDate(p1.date)}</span><br><b>${esc(setLabel(b1))}</b></div>` : `<div class="prevbox xs dim">記録なし</div>`}
    ${b2 ? `<div class="prevbox"><span class="xs dim">前々回 ${fmtDate(p2.date)}</span><br><b class="mut">${esc(setLabel(b2))}</b></div>` : ''}
    <div class="prevbox now" id="dl-${it.id}"><span class="xs dim">今回</span><br><b class="dim">—</b></div>
  </div>`;

  const setRows = rows.map((s, i) => `
    <div class="setrow">
      <div class="idx">${i + 1}</div>
      <input inputmode="decimal" data-ex="${it.id}" data-i="${i}" data-k="w" value="${esc(s.w)}" placeholder="${it.bw ? '自重' : 'kg'}">
      <div class="x">×</div>
      <input inputmode="numeric" data-ex="${it.id}" data-i="${i}" data-k="r" value="${esc(s.r)}" placeholder="reps">
      <button class="del" data-del="${it.id}:${i}">×</button>
    </div>`).join('');

  const alts = !isAlt && it.alts.length ? `
    <div class="alts">
      <button class="altbtn"><span>代替種目 ${it.alts.length}件</span><span class="chev">▾</span></button>
      <div style="display:none">${it.alts.map(a => `<div class="altcard">${exCard(a, sess, true)}</div>`).join('')}</div>
    </div>` : '';

  const inner = `
    <div class="exhead">
      <div class="grow">
        <input class="exname" data-name="${it.id}" value="${esc(exName(it))}" placeholder="種目名"
          ${S.names[it.id] ? 'data-custom="1"' : ''}>
        <div class="row" style="gap:5px;margin-top:5px;flex-wrap:wrap">${pills}</div></div>
      ${it.analyze ? `<button class="btn sm gho" data-analyze="${it.analyze}">解析</button>` : ''}
    </div>
    ${prevHTML}
    ${setRows}
    <button class="btn sm gho" data-add="${it.id}" style="margin-top:8px;width:100%">＋ セット</button>
    ${alts}`;
  return isAlt ? inner : `<div class="card">${inner}</div>`;
}

function updateDelta(exId, sess) {
  const box = document.getElementById('dl-' + exId); if (!box) return;
  const cur = bestOf(sess.logs[exId]);
  const prev = prevRecords(exId, sess.id)[0];
  const pb = prev && bestOf(prev.logs[exId]);
  if (!cur) { box.innerHTML = `<span class="xs dim">今回</span><br><b class="dim">—</b>`; return; }
  let badge = '';
  if (pb && cur.e != null && pb.e != null) {
    const d = cur.e - pb.e, pct = d / pb.e * 100;
    const cls = d > 0.4 ? 'ok' : d < -0.4 ? 'bad' : 'mut';
    badge = ` <span class="xs ${cls}">${d >= 0 ? '+' : ''}${n1(pct)}%</span>`;
  } else if (pb && sumW(cur.w) && sumW(pb.w)) {
    const d = sumW(cur.w) - sumW(pb.w);
    badge = ` <span class="xs ${d > 0 ? 'ok' : d < 0 ? 'bad' : 'mut'}">${d >= 0 ? '+' : ''}${n1(d)}kg</span>`;
  }
  box.innerHTML = `<span class="xs dim">今回 e1RM ${cur.e != null ? n1(cur.e) : '—'}</span><br><b class="acc">${esc(setLabel(cur))}</b>${badge}`;
}

/* ============ 食事 ============ */
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
      ${barRow('カロリー', T.kcal, P.kcal, 'kcal', '#e8ecf3')}
      ${barRow('タンパク質', T.p, P.p, 'g', '#31d0a5')}
      ${barRow('脂質', T.f, P.f, 'g', '#ffb547')}
      ${barRow('糖質', T.c, P.c, 'g', '#4d8dff')}
    </div>

    <h2 class="sec">クイック追加</h2>
    <div class="card tight">
      <div class="row" style="flex-wrap:wrap;gap:7px">
        ${MEAL_PRESETS.map(m => `<button class="btn sm" data-preset="${m.id}">${m.icon} ${esc(m.n)}</button>`).join('')}
      </div>
      <div class="hr"></div>
      <div class="row" style="gap:7px">
        <select id="fsel" class="grow">${Object.entries(FOODS).map(([k, v]) => `<option value="${k}">${esc(v.n)}</option>`).join('')}</select>
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
      <div class="row between"><span class="mut">方針</span><b class="acc">${P.mode}</b></div>
    </div>

    <h2 class="sec">${esc(CURRY_RECIPE.n)}</h2>
    <div class="card sm mut">${CURRY_RECIPE.lines.map(l => `<div>・${esc(l)}</div>`).join('')}</div>
  `;

  el.querySelector('#pd').onclick = () => { const d = new Date(date); d.setDate(d.getDate() - 1); S.mealDate = dstr(d); save(); render(); };
  el.querySelector('#nd').onclick = () => { const d = new Date(date); d.setDate(d.getDate() + 1); S.mealDate = dstr(d) > today() ? today() : dstr(d); save(); render(); };
  el.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    const m = MEAL_PRESETS.find(x => x.id === b.dataset.preset);
    const arr = S.meals[date] || (S.meals[date] = []);
    m.items.forEach(i => arr.push({ ...i }));
    save(); render(); toast(m.n + ' を追加');
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
  const c = el.querySelector('#clr');
  if (c) c.onclick = () => { delete S.meals[date]; save(); render(); };
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

  if (Math.abs(dK) <= P.kcal * 0.05) a.push({ k: 'ok', t: `総カロリー <b>${n0(T.kcal)} kcal</b>（目標 ±5%以内）。この配分を維持してください。` });
  else if (dK > 0) a.push({ k: dK > P.kcal * .15 ? 'bad' : 'warn', t: `${n0(dK)} kcal オーバー。${P.mode === '減量' ? '週あたりの脂肪減が ' + n1(dK * 7 / 7700) + 'kg 目減りします。' : ''}` });
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
        ${PROGRAM.map(d => `<optgroup label="${d.name}">${d.items.flatMap(it => [it, ...it.alts]).map(it => `<option value="${it.id}" ${it.id === sel ? 'selected' : ''}>${esc(exName(it))}</option>`).join('')}</optgroup>`).join('')}
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
        <div class="xs mut" style="margin-top:6px">${Object.entries(s.logs).map(([k, v]) => { const b = bestOf(v); return b ? `${esc(EX_MAP[k] ? exName(EX_MAP[k]) : k)} ${esc(setLabel(b))}` : ''; }).filter(Boolean).join(' ／ ')}</div>
      </div>`;
    }).join('') : '<div class="card sm dim">履歴なし</div>'}
  `;
  chart(el.querySelector('#c1'), recs, '#4d8dff');
  chart(el.querySelector('#c2'), bodyPts, '#31d0a5');
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
    localStorage.removeItem(KEY); S = defaults(); S.sessions = seedSessions(); save(); render();
  };
}

render();
