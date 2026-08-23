/* ===== 写真から体組成を推定 =====
   端末内で完結（MediaPipe Pose + セグメンテーションマスク）。写真は外部に送信しない。

   計測の流れ:
     1) 全身を検出 → 人物のバウンディングボックスに切り抜いて再検出（マスク解像度を稼ぐ）
     2) 各行のシルエットを「連続領域(run)」に分解し、腕の run を捨てて胴体だけを測る
     3) サブピクセル境界 + 縦方向スムージングで幅プロファイルを作り、ウエスト/ヒップを取る
     4) 前面幅 → 楕円周長で周径へ。実測テープ値があればその人の奥行き比を較正して使う
     5) US Navy 式 + ウエスト身長比式のアンサンブル
*/
import { FilesetResolver, PoseLandmarker } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

const EAR = { L: 7, R: 8 }, SH = { L: 11, R: 12 }, EL = { L: 13, R: 14 },
      HIP = { L: 23, R: 24 }, KN = { L: 25, R: 26 }, AN = { L: 27, R: 28 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const n1 = v => Math.round(v * 10) / 10;
const DEG = 180 / Math.PI;

/* 楕円周長（ラマヌジャン近似）: 幅W・奥行D の断面 */
function ellipseC(W, D) {
  const a = W / 2, b = D / 2;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}
/* 前面幅 W と実測周径 C から、その人の奥行き比 k = D/W を逆算 */
function solveK(W, C) {
  let lo = 0.25, hi = 1.9;
  if (!(W > 0) || !(C > 0)) return null;
  if (ellipseC(W, W * hi) < C || ellipseC(W, W * lo) > C) return null;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (ellipseC(W, W * m) < C) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

let lm = null;
async function getLM(onStatus) {
  if (lm) return lm;
  onStatus('AIモデルを読み込み中…（初回のみ）');
  const fs = await FilesetResolver.forVisionTasks(WASM);
  const opt = d => ({
    baseOptions: { modelAssetPath: MODEL, delegate: d },
    runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: true,
    minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4
  });
  try { lm = await PoseLandmarker.createFromOptions(fs, opt('GPU')); }
  catch (e) { lm = await PoseLandmarker.createFromOptions(fs, opt('CPU')); }
  return lm;
}

/* ============ シルエット解析 ============ */

/* 行 yNorm を連続領域(run)に分解する。両端はマスク値の線形補間でサブピクセル化。 */
function runsAt(mask, mw, mh, yNorm, thr = 0.5) {
  const y = clamp(Math.round(yNorm * (mh - 1)), 0, mh - 1), row = y * mw;
  const runs = [];
  let s = -1;
  for (let x = 0; x < mw; x++) {
    const on = mask[row + x] > thr;
    if (on && s < 0) s = x;
    if (s >= 0 && (!on || x === mw - 1)) {
      const e = on ? x : x - 1;
      const lE = s > 0 ? (s - 1) + (thr - mask[row + s - 1]) / ((mask[row + s] - mask[row + s - 1]) || 1) : s - 0.5;
      const rE = e < mw - 1 ? e + (mask[row + e] - thr) / ((mask[row + e] - mask[row + e + 1]) || 1) : e + 0.5;
      runs.push({ l: lE, r: rE, w: rE - lE, c: (lE + rE) / 2 });
      s = -1;
    }
  }
  return runs.filter(r => r.w > mw * 0.006);      // 髪の毛や輪郭のノイズを捨てる
}

/* 腕を除いた胴体だけの幅（正規化）。腕が胴体から離れていれば run が 3 本に割れる。 */
function torsoAt(mask, mw, mh, yNorm, cxNorm) {
  const runs = runsAt(mask, mw, mh, yNorm);
  if (!runs.length) return null;
  const cx = cxNorm * mw;
  let hit = runs.find(r => cx >= r.l && cx <= r.r);
  if (!hit) hit = runs.reduce((a, b) => Math.abs(b.c - cx) < Math.abs(a.c - cx) ? b : a);
  // run が 1 本 = 腕が胴体に接触していて分離できていない
  return { w: hit.w / mw, sep: runs.length >= 3, n: runs.length };
}

/* y0→y1 を走査して胴体幅のプロファイルを作り、縦方向に移動平均をかける */
function profile(mask, mw, mh, y0, y1, cxAt, steps = 34) {
  const raw = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, y = y0 + t * (y1 - y0);
    const r = torsoAt(mask, mw, mh, y, cxAt(t));
    raw.push(r ? { y, w: r.w, sep: r.sep } : null);
  }
  return raw.map((v, i) => {
    if (!v) return null;
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) if (raw[j]) { s += raw[j].w; n++; }
    return { y: v.y, w: s / n, sep: v.sep };
  }).filter(Boolean);
}

/* マスク上端（頭頂）の正規化 y */
function topY(mask, mw, mh, thr = 0.5) {
  for (let y = 0; y < mh; y++) {
    const row = y * mw;
    for (let x = 0; x < mw; x++) if (mask[row + x] > thr) return y / mh;
  }
  return 0;
}
/* マスク全体のバウンディングボックス（正規化） */
function bbox(mask, mw, mh, thr = 0.5) {
  let x0 = mw, x1 = -1, y0 = mh, y1 = -1;
  for (let y = 0; y < mh; y++) {
    const row = y * mw;
    for (let x = 0; x < mw; x++) if (mask[row + x] > thr) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0: x0 / mw, x1: (x1 + 1) / mw, y0: y0 / mh, y1: (y1 + 1) / mh };
}

/* ============ 計測 ============ */
function measure(pts, world, mask, mw, mh, imgW, imgH, heightCm) {
  const P = i => pts[i];
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const shM = mid(P(SH.L), P(SH.R)), hipM = mid(P(HIP.L), P(HIP.R));
  const anM = mid(P(AN.L), P(AN.R)), earM = mid(P(EAR.L), P(EAR.R));
  const knM = mid(P(KN.L), P(KN.R));

  /* --- スケール: 頭頂→足首ランドマーク は身長の約96.1%（外果は床上約3.9%） --- */
  const head = topY(mask, mw, mh);
  const pxSpanY = (anM.y - head) * imgH;
  if (!(pxSpanY > 40)) return { err: '全身が小さすぎます。人物が縦方向いっぱいに写るよう近づいて撮り直してください。' };
  const cmPerPx = (heightCm * 0.961) / pxSpanY;   // 画素は正方形と仮定

  /* --- 姿勢の品質チェック --- */
  const q = { warn: [], fail: [] };

  // ① 正対しているか: world 座標の肩ラインが奥行き方向にどれだけ回っているか
  let turn = 0;
  if (world && world[SH.L] && world[SH.R]) {
    const dx = world[SH.R].x - world[SH.L].x, dz = world[SH.R].z - world[SH.L].z;
    turn = Math.abs(Math.atan2(dz, dx)) * DEG;
    if (turn > 90) turn = 180 - turn;
  }
  if (turn > 25) q.fail.push(`体が ${Math.round(turn)}° 横を向いています。カメラに正対して撮り直してください。`);
  else if (turn > 12) q.warn.push(`体がわずかに回転しています（${Math.round(turn)}°）。正対するとウエストの誤差が減ります。`);

  // ② 直立しているか: 肩中心→腰中心 が垂直から何度ずれているか
  const lean = Math.abs(Math.atan2((hipM.x - shM.x) * imgW, (hipM.y - shM.y) * imgH)) * DEG;
  if (lean > 9) q.fail.push(`体が ${Math.round(lean)}° 傾いています。まっすぐ立って撮り直してください。`);
  else if (lean > 5) q.warn.push(`やや傾いています（${Math.round(lean)}°）。`);

  // ③ フレーム内に収まっているか
  const bb = bbox(mask, mw, mh);
  if (bb && (bb.y0 < 0.004 || bb.y1 > 0.996)) q.fail.push('頭または足がフレームから切れています。全身が入るよう離れて撮り直してください。');

  // ④ マスクの実効解像度
  const maskPx = (anM.y - head) * mh;
  if (maskPx < 110) q.warn.push('人物が小さく、輪郭の精度が落ちています。');

  /* --- 首: 耳〜肩の間で最も細い行 --- */
  const neckP = profile(mask, mw, mh, earM.y + 0.25 * (shM.y - earM.y), shM.y + 0.02 * (hipM.y - shM.y),
    t => (earM.x + (shM.x - earM.x) * t), 22);
  const neckW = neckP.length ? Math.min(...neckP.map(p => p.w)) * imgW * cmPerPx : null;

  /* --- 肩幅（三角筋の最大） --- */
  const shP = profile(mask, mw, mh, shM.y - 0.12 * (hipM.y - shM.y), shM.y + 0.18 * (hipM.y - shM.y),
    () => shM.x, 20);
  let shW = 0, shY = shM.y;
  shP.forEach(p => { if (p.w * imgW * cmPerPx > shW) { shW = p.w * imgW * cmPerPx; shY = p.y; } });

  /* --- ウエスト: 肩‑腰の 35〜86% で最小。ここは腕の除外が必須 --- */
  const waistP = profile(mask, mw, mh, shM.y + 0.35 * (hipM.y - shM.y), shM.y + 0.86 * (hipM.y - shM.y),
    t => shM.x + (hipM.x - shM.x) * (0.35 + t * 0.51), 34);
  const wSep = waistP.filter(p => p.sep);
  if (!waistP.length) return { err: '胴体を計測できませんでした。背景がはっきりした場所で撮り直してください。' };
  if (wSep.length < waistP.length * 0.5) {
    return { err: '腕が胴体に重なっていて、ウエストを腕ごと測ってしまいます。<b>脇を 15cm ほど開けて、腕をハの字に</b>して撮り直してください（これが精度に一番効きます）。' };
  }
  let waistW = Infinity, waistY = null;
  wSep.forEach(p => { const cm = p.w * imgW * cmPerPx; if (cm < waistW) { waistW = cm; waistY = p.y; } });

  /* --- ヒップ: 腰〜膝の上部で最大 --- */
  const hipP = profile(mask, mw, mh, hipM.y - 0.05 * (knM.y - hipM.y), hipM.y + 0.35 * (knM.y - hipM.y),
    () => hipM.x, 24).filter(p => p.sep);
  let hipW = 0, hipY = hipM.y;
  hipP.forEach(p => { const cm = p.w * imgW * cmPerPx; if (cm > hipW) { hipW = cm; hipY = p.y; } });

  if (!neckW || !isFinite(waistW) || !hipW) return { err: '計測に失敗しました。腕を体から離し、全身が入るように撮り直してください。' };

  /* --- 妥当性レンジ（明らかな破綻を数値として出さない） --- */
  if (neckW < 8 || neckW > 22) q.warn.push('首の輪郭が不安定です（髪やフードが被っていませんか）。');
  if (waistW < 15 || waistW > 55) q.fail.push('ウエスト幅が現実的な範囲を外れています。身長設定と撮影距離を確認してください。');

  return {
    cmPerPx, neckW, shW, waistW, hipW, turn, lean, maskPx, q,
    pose: { head, shY, waistY, hipY, anY: anM.y, cx: shM.x }
  };
}

/* ============ 体脂肪率の合成 ============ */
function compose(m, heightCm, sex, K) {
  // 断面の奥行き比。実測テープ値で較正済みならその人の値を使う
  const whr = m.waistW / heightCm;
  const kAuto = clamp(0.68 + (whr - 0.14) * 1.9, 0.66, 0.92);
  const kW = K.waist || kAuto;
  const kN = K.neck || 0.92;
  const kH = K.hip || 0.80;

  const waistC = ellipseC(m.waistW, m.waistW * kW);
  const neckC = ellipseC(m.neckW, m.neckW * kN);
  const hipC = ellipseC(m.hipW, m.hipW * kH);

  // ① US Navy 法（インチ）
  const inch = c => c / 2.54, hIn = inch(heightCm);
  let navy;
  if (sex === 'f') {
    navy = 163.205 * Math.log10(inch(waistC) + inch(hipC) - inch(neckC))
         - 97.684 * Math.log10(hIn) - 78.387;
  } else {
    navy = 86.010 * Math.log10(inch(waistC) - inch(neckC)) - 70.041 * Math.log10(hIn) + 36.76;
  }

  // ② ウエスト/身長比からの推定（Navy が破綻する痩身域の保険）
  const wht = waistC / heightCm;
  const ratioEst = sex === 'f' ? (wht - 0.241) * 123 : (wht - 0.371) * 135;

  const valid = v => isFinite(v) && v > 2 && v < 60;
  const parts = [navy, ratioEst].filter(valid);
  if (!parts.length) return null;
  let bf = parts.reduce((a, b) => a + b, 0) / parts.length;
  const spread = parts.length > 1 ? Math.abs(parts[0] - parts[1]) : 5;

  // 信頼区間: モデル間のばらつき + 撮影品質 + 較正の有無
  let band = 1.6 + spread / 2;
  if (!K.waist) band += 1.9;                            // 奥行きが推定値のまま
  band += clamp(m.turn / 12, 0, 1.6) + clamp(m.lean / 6, 0, 1.2);
  if (m.maskPx < 110) band += 1.0;
  band += m.q.warn.length * 0.5;

  return {
    bf: clamp(bf, 3, 55), navy: valid(navy) ? navy : null, ratioEst,
    band: clamp(band, 1.2, 9), calibrated: !!K.waist,
    waistC, neckC, hipC, kW,
    vTaper: m.shW / m.waistW, whtr: wht,
    shW: m.shW, waistW: m.waistW, hipW: m.hipW,
    turn: m.turn, lean: m.lean, q: m.q, pose: m.pose
  };
}

/* ============ UI ============ */
let st = { busy: false, msg: '', res: null, url: null, err: '' };

const cal = () => S.settings.bfCal || 0;
const tapeK = () => S.settings.tapeK || {};

function render(el) {
  const heightCm = S.settings.height;
  const r = st.res;
  const shown = r ? clamp(r.bf + cal(), 3, 55) : null;
  const K = tapeK();

  el.innerHTML = `
    <div class="card tight">
      <div class="b sm">写真から体組成を推定</div>
      <ol class="shot">
        <li><b>腕をハの字に開く</b> — 脇を 15cm ほど空ける。ここが精度に一番効きます</li>
        <li>正面・全身。カメラは腰の高さで水平に、2〜3m 離して</li>
        <li>体のラインが出る服装、または上半身裸。無地の壁の前で</li>
      </ol>
      <div class="xs dim" style="margin-top:8px">身長 ${heightCm}cm で計算（設定タブで変更）${K.waist ? ' · <span class="acc">実測較正済み</span>' : ''}</div>
    </div>

    ${st.busy ? `
      <div class="card"><div class="row" style="gap:9px"><span class="spin"></span><span class="sm">${st.msg}</span></div></div>`
    : `<label class="dropzone" style="display:block">
        <div style="font-size:26px">＋</div>
        <div class="b sm" style="margin-top:4px">写真を選択</div>
        <div class="xs dim" style="margin-top:4px">カメラロールから／その場で撮影</div>
        <input type="file" accept="image/*" id="bf-file" style="display:none">
      </label>`}

    ${st.err ? `<div class="advice bad" style="margin-top:11px">${st.err}</div>` : ''}

    ${r ? `
      <div class="card bfcard" style="margin-top:12px">
        <div class="row between" style="align-items:flex-end">
          <div>
            <div class="xs dim">推定 体脂肪率</div>
            <div class="bfbig">${n1(shown)}<span>%</span></div>
            <div class="xs mut">${n1(Math.max(3, shown - r.band))} 〜 ${n1(shown + r.band)}%（±${n1(r.band)}）</div>
          </div>
          <canvas id="bf-thumb" class="bfthumb"></canvas>
        </div>
        <div class="hr"></div>
        <div class="macro4">
          <div><b>${n1(r.waistC)}</b><span>ウエスト cm</span></div>
          <div><b>${n1(r.neckC)}</b><span>首まわり cm</span></div>
          <div><b>${n1(r.hipC)}</b><span>ヒップ cm</span></div>
          <div><b>${n1(r.vTaper)}</b><span>V字比</span></div>
        </div>

        ${r.q.warn.map(w => `<div class="advice warn" style="margin-top:9px">${w}</div>`).join('')}
        ${!r.calibrated ? `<div class="advice warn" style="margin-top:9px">
          断面の奥行きを標準体型から<b>推定</b>しています。メジャーでウエストと首を1回測って下に入れると、以降は自分の体型で計算され誤差が半分以下になります。</div>` : ''}

        <div class="advice ${r.whtr < 0.5 ? 'ok' : r.whtr < 0.55 ? 'warn' : 'bad'}" style="margin-top:9px">
          ウエスト/身長比 <b>${n1(r.whtr * 100) / 100}</b>（0.50未満が健康域）。
          V字比（肩幅÷ウエスト幅）は <b>${n1(r.vTaper)}</b>、1.45以上で明確なVテーパーです。
        </div>
        <button class="btn pri full" id="bf-use" style="margin-top:12px">この値を今日の記録に反映</button>
      </div>

      <h2 class="sec">メジャーで較正（1回だけ）</h2>
      <div class="card">
        <div class="sm mut" style="line-height:1.7">実際にメジャーで測った周径を入れると、その人の断面の奥行き比を逆算して保存します。これ以降の写真はすべてその比率で計算されるため、<b>推定の絶対値が実測レベルまで寄ります</b>。体型が大きく変わるまで測り直す必要はありません。</div>
        <div class="row" style="gap:9px;margin-top:10px">
          <div class="grow"><label class="fl">ウエスト実測 (cm)</label><input id="tape-w" inputmode="decimal" placeholder="${n1(r.waistC)}"></div>
          <div class="grow"><label class="fl">首まわり実測 (cm)</label><input id="tape-n" inputmode="decimal" placeholder="${n1(r.neckC)}"></div>
        </div>
        <button class="btn full" id="tape-save" style="margin-top:10px">周径で較正する</button>
        ${K.waist ? `<div class="xs acc" style="margin-top:8px">較正済み（奥行き比 ${n1(K.waist * 100) / 100}）
          <button class="btn sm gho" id="tape-clear" style="margin-left:6px">解除</button></div>` : ''}
      </div>

      <h2 class="sec">実測の体脂肪率で補正</h2>
      <div class="card">
        <div class="sm mut" style="line-height:1.7">InBody や DEXA の値がわかる場合はここへ。残った差が一律のオフセットとして引かれます。</div>
        <div class="row" style="gap:9px;margin-top:10px">
          <div class="grow"><label class="fl">実測の体脂肪率 (%)</label><input id="bf-true" inputmode="decimal" placeholder="${n1(shown)}"></div>
          <button class="btn" id="bf-cal" style="align-self:flex-end">補正</button>
        </div>
        ${cal() ? `<div class="xs acc" style="margin-top:8px">現在の補正: ${cal() > 0 ? '+' : ''}${n1(cal())}%
          <button class="btn sm gho" id="bf-clear" style="margin-left:6px">解除</button></div>` : ''}
      </div>` : ''}

    <div class="card xs dim" style="margin-top:14px;line-height:1.7">
      正面1枚から奥行きを推定する方式のため、較正前の絶対値には誤差があります。腕を胴体から離せていない写真は<b>計測を中止</b>します（腕ごと測ると10%以上ずれるため）。<br>
      <b>同じ場所・同じ距離・同じ服装</b>で撮り続ければ、較正前でも変化の向きと大きさは追えます。写真は端末内で処理され、保存も送信もされません。
    </div>`;

  const fi = el.querySelector('#bf-file');
  if (fi) fi.onchange = e => { const f = e.target.files[0]; if (f) run(el, f); };

  if (r) {
    const th = el.querySelector('#bf-thumb');
    if (th && st.url) requestAnimationFrame(() => drawThumb(th, st.url, r));

    el.querySelector('#bf-use').onclick = () => {
      const b = [...S.body].sort((a, c) => c.date.localeCompare(a.date))[0];
      const w = b ? b.weight : S.settings.targetW;
      S.body = S.body.filter(x => x.date !== today());
      S.body.push({ date: today(), weight: w, bf: n1(shown) });
      save(); toast('体脂肪率を記録しました'); go('settings');
    };

    el.querySelector('#tape-save').onclick = () => {
      const wv = parseFloat(el.querySelector('#tape-w').value);
      const nv = parseFloat(el.querySelector('#tape-n').value);
      if (!isFinite(wv)) { toast('ウエスト実測値を入力'); return; }
      const kw = solveK(st.res.waistW, wv);
      if (!kw) { toast('その値では計算できません'); return; }
      const K2 = { waist: kw };
      if (isFinite(nv)) { const kn = solveK(st.res.neckW, nv); if (kn) K2.neck = kn; }
      S.settings.tapeK = K2; save();
      recompose(el); toast('較正しました');
    };
    const tc = el.querySelector('#tape-clear');
    if (tc) tc.onclick = () => { delete S.settings.tapeK; save(); recompose(el); };

    el.querySelector('#bf-cal').onclick = () => {
      const v = parseFloat(el.querySelector('#bf-true').value);
      if (!isFinite(v)) { toast('実測値を入力'); return; }
      S.settings.bfCal = v - st.res.bf; save(); render(el); toast('補正しました');
    };
    const cl = el.querySelector('#bf-clear');
    if (cl) cl.onclick = () => { S.settings.bfCal = 0; save(); render(el); };
  }
}

/* 較正値が変わったら、写真を読み直さずに数値だけ再計算する */
function recompose(el) {
  if (st.raw) st.res = compose(st.raw, S.settings.height, S.settings.sex || 'm', tapeK());
  render(el);
}

function drawThumb(cv, url, r) {
  const img = new Image();
  img.onload = () => {
    const W = 96, H = 128;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const x = cv.getContext('2d'); x.scale(dpr, dpr);
    const s = Math.max(W / img.width, H / img.height);
    const dw = img.width * s, dh = img.height * s;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    x.drawImage(img, ox, oy, dw, dh);
    const line = (yNorm, color) => {
      const y = oy + yNorm * dh;
      x.strokeStyle = color; x.lineWidth = 1.5; x.setLineDash([4, 3]);
      x.beginPath(); x.moveTo(ox, y); x.lineTo(ox + dw, y); x.stroke();
    };
    line(r.pose.waistY, '#ffb020');
    line(r.pose.shY, '#d8ff45');
    x.setLineDash([]);
  };
  img.src = url;
}

/* 画像を canvas に載せる（長辺 max px に縮小） */
function toCanvas(img, sx, sy, sw, sh, max) {
  const s = Math.min(1, max / Math.max(sw, sh));
  const cv = document.createElement('canvas');
  cv.width = Math.round(sw * s); cv.height = Math.round(sh * s);
  cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return cv;
}

function detect(L, cv) {
  const out = L.detect(cv);
  if (!out.landmarks || !out.landmarks.length) return null;
  if (!out.segmentationMasks || !out.segmentationMasks.length) return null;
  const mObj = out.segmentationMasks[0];
  return {
    pts: out.landmarks[0], world: (out.worldLandmarks || [])[0],
    mask: mObj.getAsFloat32Array(), mw: mObj.width, mh: mObj.height,
    w: cv.width, h: cv.height, close: () => mObj.close && mObj.close()
  };
}

async function run(el, file) {
  if (st.url) URL.revokeObjectURL(st.url);
  st = { busy: true, msg: '準備中…', res: null, raw: null, url: URL.createObjectURL(file), err: '' };
  render(el);
  const up = m => { st.msg = m; render(el); };
  try {
    const L = await getLM(up);
    up('姿勢を検出中…');
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = st.url;
    });

    // --- 1st pass: 全身から人物の位置を掴む ---
    const p1 = detect(L, toCanvas(img, 0, 0, img.width, img.height, 1024));
    if (!p1) throw new Error('人物を検出できませんでした。全身が写った正面の写真を使ってください。');

    const vis = [SH.L, SH.R, HIP.L, HIP.R, AN.L, AN.R].map(i => p1.pts[i] && p1.pts[i].visibility);
    if (vis.some(v => v == null || v < 0.5)) {
      p1.close();
      throw new Error('全身（肩から足首まで）が写っていません。少し離れて撮り直してください。');
    }

    // --- 2nd pass: 人物に切り抜いて再検出。マスクの実効解像度が上がる ---
    up('輪郭を精密化中…');
    let use = p1;
    const bb = bbox(p1.mask, p1.mw, p1.mh);
    if (bb) {
      const padX = (bb.x1 - bb.x0) * 0.16, padY = (bb.y1 - bb.y0) * 0.05;
      const sx = clamp(bb.x0 - padX, 0, 1) * img.width;
      const sx1 = clamp(bb.x1 + padX, 0, 1) * img.width;
      const sy = clamp(bb.y0 - padY, 0, 1) * img.height;
      const sy1 = clamp(bb.y1 + padY, 0, 1) * img.height;
      const sw = sx1 - sx, sh = sy1 - sy;
      // 切り抜きで横方向の解像度が 1.2 倍以上になる時だけやる価値がある
      if (sw > 40 && sh > 80 && img.width / sw > 1.2) {
        const p2 = detect(L, toCanvas(img, sx, sy, sw, sh, 1024));
        const v2 = p2 && [SH.L, SH.R, HIP.L, HIP.R, AN.L, AN.R].every(i => (p2.pts[i].visibility ?? 0) >= 0.5);
        if (v2) { p1.close(); use = p2; } else if (p2) p2.close();
      }
    }

    up('体組成を計算中…');
    const heightCm = S.settings.height;
    const m = measure(use.pts, use.world, use.mask, use.mw, use.mh, use.w, use.h, heightCm);
    use.close();
    if (m.err) throw new Error(m.err);
    if (m.q.fail.length) throw new Error(m.q.fail.join('<br>'));

    const r = compose(m, heightCm, S.settings.sex || 'm', tapeK());
    if (!r) throw new Error('計測に失敗しました。腕を体から離し、全身が入るように撮り直してください。');

    st.busy = false; st.raw = m; st.res = r; render(el);
  } catch (e) {
    if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
    st.busy = false; st.res = null; st.raw = null; st.err = e.message || String(e);
    render(el);
  }
}

window.BodyUI = { render };
