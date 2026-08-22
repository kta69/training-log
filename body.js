/* ===== 写真から体組成を推定 =====
   端末内で完結（MediaPipe Pose + セグメンテーションマスク）。写真は外部に送信しない。
   正面全身写真からシルエット幅を測り、身長でスケールして周径を推定 → 体脂肪率へ。
*/
import { FilesetResolver, PoseLandmarker } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

const NOSE = 0, EAR = { L: 7, R: 8 }, SH = { L: 11, R: 12 }, HIP = { L: 23, R: 24 },
      KN = { L: 25, R: 26 }, AN = { L: 27, R: 28 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const n1 = v => Math.round(v * 10) / 10;

/* 楕円周長（ラマヌジャン近似）: 幅W・奥行Dの断面 */
function ellipseC(W, D) {
  const a = W / 2, b = D / 2;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

let lm = null;
async function getLM(onStatus) {
  if (lm) return lm;
  onStatus('AIモデルを読み込み中…（初回のみ）');
  const fs = await FilesetResolver.forVisionTasks(WASM);
  const opt = d => ({
    baseOptions: { modelAssetPath: MODEL, delegate: d },
    runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: true
  });
  try { lm = await PoseLandmarker.createFromOptions(fs, opt('GPU')); }
  catch (e) { lm = await PoseLandmarker.createFromOptions(fs, opt('CPU')); }
  return lm;
}

/* ---------- マスクから幅を測る ---------- */
/* 指定した正規化yの行で、centerX を含む連続した人物領域の幅（正規化x）を返す */
function runWidth(mask, mw, mh, yNorm, cxNorm, thr = 0.5) {
  const y = clamp(Math.round(yNorm * mh), 0, mh - 1);
  const row = y * mw;
  let cx = clamp(Math.round(cxNorm * mw), 0, mw - 1);
  if (mask[row + cx] <= thr) {                 // 中心が外れていたら左右に探索
    let found = -1;
    for (let d = 1; d < mw; d++) {
      if (cx - d >= 0 && mask[row + cx - d] > thr) { found = cx - d; break; }
      if (cx + d < mw && mask[row + cx + d] > thr) { found = cx + d; break; }
    }
    if (found < 0) return null;
    cx = found;
  }
  let l = cx; while (l > 0 && mask[row + l - 1] > thr) l--;
  let r = cx; while (r < mw - 1 && mask[row + r + 1] > thr) r++;
  return (r - l + 1) / mw;
}

/* マスク上端（頭頂）の正規化y */
function topY(mask, mw, mh, thr = 0.5) {
  for (let y = 0; y < mh; y++) {
    const row = y * mw;
    for (let x = 0; x < mw; x++) if (mask[row + x] > thr) return y / mh;
  }
  return 0;
}

/* ---------- 推定 ---------- */
function estimate(pts, mask, mw, mh, imgW, imgH, heightCm, sex) {
  const P = i => pts[i];
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const shM = mid(P(SH.L), P(SH.R)), hipM = mid(P(HIP.L), P(HIP.R));
  const anM = mid(P(AN.L), P(AN.R)), earM = mid(P(EAR.L), P(EAR.R));

  const head = topY(mask, mw, mh);
  // 頭頂→外果 は身長の約95.5%
  const pxSpanY = (anM.y - head) * imgH;
  if (!(pxSpanY > 20)) return null;
  const cmPerPxY = (heightCm * 0.955) / pxSpanY;
  const cmPerPxX = cmPerPxY;                    // 画素は正方形と仮定

  const wAt = (yNorm, cx) => {
    const w = runWidth(mask, mw, mh, yNorm, cx);
    return w == null ? null : w * imgW * cmPerPxX;
  };

  // 首：耳〜肩の間で最も細い行
  let neckW = Infinity, neckY = null;
  for (let t = 0.25; t <= 0.95; t += 0.03) {
    const y = earM.y + t * (shM.y - earM.y);
    const w = wAt(y, (earM.x + shM.x) / 2);
    if (w && w < neckW) { neckW = w; neckY = y; }
  }
  if (!isFinite(neckW)) neckW = null;

  // 肩幅（三角筋の最大）
  let shW = 0, shYbest = shM.y;
  for (let t = -0.12; t <= 0.18; t += 0.02) {
    const y = shM.y + t * (hipM.y - shM.y);
    const w = wAt(y, shM.x);
    if (w && w > shW) { shW = w; shYbest = y; }
  }

  // ウエスト（最小幅）：肩‑腰の 35〜85% を走査
  let waistW = Infinity, waistY = null;
  for (let t = 0.35; t <= 0.86; t += 0.02) {
    const y = shM.y + t * (hipM.y - shM.y);
    const w = wAt(y, (shM.x + hipM.x) / 2);
    if (w && w < waistW) { waistW = w; waistY = y; }
  }
  // ヒップ（最大幅）：腰付近
  let hipW = 0;
  for (let t = -0.05; t <= 0.35; t += 0.02) {
    const y = hipM.y + t * (mid(P(KN.L), P(KN.R)).y - hipM.y);
    const w = wAt(y, hipM.x);
    if (w && w > hipW) hipW = w;
  }
  if (!neckW || !isFinite(waistW) || !hipW) return null;

  // 断面の奥行き比（正面幅→周径）。腹部は脂肪が付くほど前後に厚くなる
  const whr = waistW / heightCm;
  const kWaist = clamp(0.68 + (whr - 0.14) * 1.9, 0.66, 0.92);
  const waistC = ellipseC(waistW, waistW * kWaist);
  const neckC = ellipseC(neckW, neckW * 0.92);
  const hipC = ellipseC(hipW, hipW * 0.80);

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
  //    男性 WHtR 0.43→8% / 0.50→17% / 0.60→31% に合う一次近似
  const wht = waistC / heightCm;
  const ratioEst = sex === 'f' ? (wht - 0.241) * 123 : (wht - 0.371) * 135;

  const valid = v => isFinite(v) && v > 2 && v < 60;
  const parts = [navy, ratioEst].filter(valid);
  if (!parts.length) return null;
  let bf = parts.reduce((a, b) => a + b, 0) / parts.length;
  const spread = parts.length > 1 ? Math.abs(parts[0] - parts[1]) : 4;
  bf = clamp(bf, 3, 55);

  return {
    bf, navy: valid(navy) ? navy : null, ratioEst,
    band: clamp(2.5 + spread / 2, 2.5, 7),
    neckC, waistC, hipC, shW, waistW, hipW,
    vTaper: shW / waistW, whtr: wht,
    pose: { head, shY: shYbest, waistY, neckY, hipY: hipM.y, anY: anM.y, cx: shM.x }
  };
}

/* ---------- UI ---------- */
let st = { busy: false, msg: '', res: null, url: null, err: '' };

function cal() { return S.settings.bfCal || 0; }

function render(el) {
  const heightCm = S.settings.height;
  const r = st.res;
  const shown = r ? clamp(r.bf + cal(), 3, 55) : null;
  const hist = [...S.body].filter(b => b.bf != null).slice(-1);

  el.innerHTML = `
    <div class="card tight">
      <div class="b sm">写真から体脂肪率を推定</div>
      <div class="sm mut" style="margin-top:7px;line-height:1.7">
        <b>撮り方</b>：正面・全身が入るように。腕は体から少し離す（Vの字）。<br>
        体のラインが出る服装、または上半身裸。カメラは腰の高さで水平に、2〜3m離れて。
      </div>
      <div class="xs dim" style="margin-top:7px">身長 ${heightCm}cm で計算します（設定タブで変更）。</div>
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
            <div class="xs mut">およそ ${n1(Math.max(3, shown - r.band))} 〜 ${n1(shown + r.band)}%</div>
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
        <div class="advice ${r.whtr < 0.5 ? 'ok' : r.whtr < 0.55 ? 'warn' : 'bad'}" style="margin-top:11px">
          ウエスト/身長比 <b>${n1(r.whtr * 100) / 100}</b>（0.50未満が健康域）。
          V字比（肩幅÷ウエスト幅）は <b>${n1(r.vTaper)}</b>、1.45以上で明確なVテーパーです。
        </div>
        <button class="btn pri full" id="bf-use" style="margin-top:12px">この値を今日の記録に反映</button>
      </div>

      <h2 class="sec">実測値で補正</h2>
      <div class="card">
        <div class="sm mut" style="line-height:1.7">InBody や DEXA など実測値がわかる場合、ここに入れると以降の推定に補正がかかり、変化の追跡精度が上がります。</div>
        <div class="row" style="gap:9px;margin-top:10px">
          <div class="grow"><label class="fl">実測の体脂肪率 (%)</label><input id="bf-true" inputmode="decimal" placeholder="${n1(shown)}"></div>
          <button class="btn" id="bf-cal" style="align-self:flex-end">補正</button>
        </div>
        ${cal() ? `<div class="xs acc" style="margin-top:8px">現在の補正: ${cal() > 0 ? '+' : ''}${n1(cal())}% <button class="btn sm gho" id="bf-clear" style="margin-left:6px">解除</button></div>` : ''}
      </div>` : ''}

    <div class="card xs dim" style="margin-top:14px;line-height:1.7">
      正面1枚から奥行きを推定しているため、絶対値には誤差があります。特に<b>筋肉量が多い人は2〜4%高めに出ます</b>（ウエスト周径から推定する方式の既知のクセです）。
      実測値がわかったら一度「補正」しておくと、以降はそのズレが自動で差し引かれます。<br>
      <b>同じ場所・同じ距離・同じ服装</b>で撮り続ければ、変化の向きと大きさは十分に追えます。
      写真は端末内で処理され、保存も送信もされません。
      ${hist.length ? `<br>直近の記録: ${hist[0].bf}%（${hist[0].date}）` : ''}
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
    el.querySelector('#bf-cal').onclick = () => {
      const v = parseFloat(el.querySelector('#bf-true').value);
      if (!isFinite(v)) { toast('実測値を入力'); return; }
      S.settings.bfCal = v - st.res.bf; save(); render(el); toast('補正しました');
    };
    const cl = el.querySelector('#bf-clear');
    if (cl) cl.onclick = () => { S.settings.bfCal = 0; save(); render(el); };
  }
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
    x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    // 測定ラインを重ねる
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    const line = (yNorm, color) => {
      const y = oy + yNorm * dh;
      x.strokeStyle = color; x.lineWidth = 1.5; x.setLineDash([4, 3]);
      x.beginPath(); x.moveTo(ox, y); x.lineTo(ox + dw, y); x.stroke();
    };
    line(r.pose.waistY, '#ffb547');
    line(r.pose.shY, '#5b95ff');
    x.setLineDash([]);
  };
  img.src = url;
}

async function run(el, file) {
  if (st.url) URL.revokeObjectURL(st.url);
  st = { busy: true, msg: '準備中…', res: null, url: URL.createObjectURL(file), err: '' };
  render(el);
  const up = m => { st.msg = m; render(el); };
  try {
    const L = await getLM(up);
    up('姿勢を検出中…');
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = st.url;
    });
    // 巨大画像はリサイズ（検出は 1024px 程度で十分）
    const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
    const cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    cv.getContext('2d').drawImage(img, 0, 0, cw, ch);

    const out = L.detect(cv);
    if (!out.landmarks || !out.landmarks.length) throw new Error('人物を検出できませんでした。全身が写った正面の写真を使ってください。');
    if (!out.segmentationMasks || !out.segmentationMasks.length) throw new Error('体の輪郭を取得できませんでした。背景がはっきりした場所で撮り直してください。');

    const mObj = out.segmentationMasks[0];
    const mask = mObj.getAsFloat32Array();
    const mw = mObj.width, mh = mObj.height;
    const pts = out.landmarks[0];

    const vis = [SH.L, SH.R, HIP.L, HIP.R, AN.L, AN.R].map(i => pts[i] && pts[i].visibility);
    if (vis.some(v => v == null || v < 0.5))
      throw new Error('全身（肩から足首まで）が写っていません。少し離れて撮り直してください。');

    up('体組成を計算中…');
    const heightCm = S.settings.height;
    const sex = S.settings.sex || "m";
    const r = estimate(pts, mask, mw, mh, cw, ch, heightCm, sex);
    mObj.close && mObj.close();
    if (!r) throw new Error('計測に失敗しました。腕を体から離し、全身が入るように撮り直してください。');

    st.busy = false; st.res = r; render(el);
  } catch (e) {
    if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
    st.busy = false; st.res = null; st.err = e.message || String(e);
    render(el);
  }
}

window.BodyUI = { render };
