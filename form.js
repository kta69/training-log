/* ============================================================
   フォーム解析エンジン
   MediaPipe Pose Landmarker（端末内で完結・動画は外部送信なし）
   ============================================================ */
import { FilesetResolver, PoseLandmarker } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

/* ---------- 種目タイプ ---------- */
const TYPES = {
  bench: {
    s: 'プレス', n: 'プレス系', sub: 'ベンチ / DBベンチ / インクライン',
    cam: '真横（バーの真横・胸の高さ）から、体全体が入るように。三脚かベンチの横に立てかけて。',
    focus: '前腕の垂直性・肘のタック角・バー軌道'
  },
  ohp: {
    s: 'OHP', n: 'オーバーヘッド', sub: 'ミリタリー / ショルダープレス',
    cam: '真横から。頭の上のロックアウト位置と足首まで全身が入るように引いて撮影。',
    focus: '腰椎の反り・腹圧の保持・ロックアウト位置'
  },
  scap: {
    s: '引く', n: '引く動作', sub: '懸垂 / ラットプル / ロウ',
    cam: '真横（またはやや斜め45°）から。耳・肩・肘が隠れない角度で。',
    focus: '肩甲骨の下制／挙上・左右差・可動域'
  },
  squat: {
    s: 'SQ', n: 'スクワット系', sub: 'バックSQ / ブルガリアン / ハック',
    cam: '真横から。足元から頭まで全身。ラック内なら支柱で隠れない位置に。',
    focus: '深さ・体幹角・バットウィンク'
  },
  hinge: {
    s: 'ヒンジ', n: 'ヒンジ系', sub: 'RDL / デッドリフト',
    cam: '真横から。バーと足首が見える位置で全身。',
    focus: '脊柱中立の維持・膝角度・バー軌道'
  }
};

/* ---------- geometry ---------- */
const NOSE = 0, EAR = { L: 7, R: 8 }, SH = { L: 11, R: 12 }, EL = { L: 13, R: 14 },
  WR = { L: 15, R: 16 }, HIP = { L: 23, R: 24 }, KN = { L: 25, R: 26 }, AN = { L: 27, R: 28 };
const D = 180 / Math.PI;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function ang3(a, b, c) { // b が頂点
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const d = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d))) * D;
}
// 垂直（画面上方向）からの角度。+ は画面右へ傾く
const vAng = (from, to) => Math.atan2(to.x - from.x, -(to.y - from.y)) * D;
// 上下反転に依存しないよう ±90° に折り返す（垂直「線」からのズレ）
const fold = a => { a = ((a + 180) % 360 + 360) % 360 - 180; return a > 90 ? a - 180 : a < -90 ? a + 180 : a; };
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function smooth(arr, k = 3) {
  return arr.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(arr.length - 1, i + k); j++) { s += arr[j]; n++; }
    return s / n;
  });
}
/* ピーク検出（プロミネンス方式：手ブレ由来の微小な山を除去） */
function peaks(sig, minSepIdx) {
  const range = Math.max(...sig) - Math.min(...sig);
  if (!(range > 0)) return [];
  const cand = [];
  for (let i = 1; i < sig.length - 1; i++)
    if (sig[i] >= sig[i - 1] && sig[i] >= sig[i + 1]) cand.push(i);
  const scored = cand.map(i => {
    let l = i; while (l > 0 && sig[l - 1] <= sig[i]) l--;
    let r = i; while (r < sig.length - 1 && sig[r + 1] <= sig[i]) r++;
    const lmin = Math.min(...sig.slice(l, i + 1)), rmin = Math.min(...sig.slice(i, r + 1));
    return { i, prom: sig[i] - Math.max(lmin, rmin) };
  }).filter(p => p.prom >= range * 0.30);
  scored.sort((a, b) => b.prom - a.prom);
  const kept = [];
  scored.forEach(p => { if (!kept.some(k => Math.abs(k - p.i) < minSepIdx)) kept.push(p.i); });
  return kept.sort((a, b) => a - b);
}

/* ---------- モデル ---------- */
let landmarker = null;
async function getLandmarker(onStatus) {
  if (landmarker) return landmarker;
  onStatus('AIモデルを読み込み中…（初回のみ・約10MB）');
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5
    });
  } catch (e) {
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
      runningMode: 'VIDEO', numPoses: 1
    });
  }
  return landmarker;
}

/* ---------- 動画からランドマーク抽出 ---------- */
function seekTo(video, t) {
  return new Promise(res => {
    let done = false;
    const h = () => { if (done) return; done = true; video.removeEventListener('seeked', h); res(); };
    video.addEventListener('seeked', h);
    video.currentTime = t;
    setTimeout(h, 900);
  });
}

async function extract(video, onProgress, onStatus) {
  const lm = await getLandmarker(onStatus);
  const W = video.videoWidth, H = video.videoHeight;
  let dur = video.duration;
  if (!isFinite(dur) || dur <= 0) {           // 一部の録画形式では duration が取れない
    video.currentTime = 1e6;
    await new Promise(r => { const h = () => { video.removeEventListener('seeked', h); r(); }; video.addEventListener('seeked', h); setTimeout(h, 1200); });
    dur = isFinite(video.duration) && video.duration > 0 ? video.duration : video.currentTime || 10;
  }
  dur = Math.min(dur, 30);
  const step = Math.max(1 / 12, dur / 260);
  const frames = [];
  onStatus('関節を検出中…');
  for (let t = 0; t < dur - 0.02; t += step) {
    await seekTo(video, t);
    let res;
    try { res = lm.detectForVideo(video, Math.round(t * 1000)); } catch (e) { continue; }
    const p = res.landmarks && res.landmarks[0];
    if (!p) { onProgress(t / dur); continue; }
    const pt = i => ({ x: p[i].x * W, y: p[i].y * H, v: p[i].visibility ?? 1 });
    frames.push({
      t,
      nose: pt(NOSE),
      L: { ear: pt(EAR.L), sh: pt(SH.L), el: pt(EL.L), wr: pt(WR.L), hip: pt(HIP.L), kn: pt(KN.L), an: pt(AN.L) },
      R: { ear: pt(EAR.R), sh: pt(SH.R), el: pt(EL.R), wr: pt(WR.R), hip: pt(HIP.R), kn: pt(KN.R), an: pt(AN.R) }
    });
    onProgress(t / dur);
  }
  return { frames, W, H };
}

/* ---------- 指標算出 ---------- */
function perFrame(f, s) {
  const j = f[s];
  const torso = dist(j.sh, j.hip) || 1;
  return {
    t: f.t, j,
    elbow: ang3(j.sh, j.el, j.wr),
    knee: ang3(j.hip, j.kn, j.an),
    hipAng: ang3(j.sh, j.hip, j.kn),
    trunk: fold(vAng(j.hip, j.sh)),
    forearm: fold(vAng(j.el, j.wr)),
    upperarm: vAng(j.sh, j.el),
    tuck: ang3(j.el, j.sh, j.hip),
    torso,
    earSh: (j.sh.y - j.ear.y) / torso,
    reach: dist(j.sh, j.wr) / torso,
    wrY: j.wr.y, wrX: j.wr.x, hipY: j.hip.y, shY: j.sh.y
  };
}

const M = (n, v, unit, status, hint, ideal) => ({ n, v, unit, status, hint, ideal });
const st3 = (v, good, warn) => Math.abs(v) <= good ? 'ok' : Math.abs(v) <= warn ? 'warn' : 'bad';

function analyze(type, frames, heightCm) {
  // 撮影側の判定（見えている側）
  const vis = s => mean(frames.map(f => mean(['sh', 'el', 'wr', 'hip', 'kn'].map(k => f[s][k].v))));
  const side = vis('L') >= vis('R') ? 'L' : 'R';
  const F = frames.map(f => perFrame(f, side));
  const Fo = frames.map(f => perFrame(f, side === 'L' ? 'R' : 'L'));
  const facing = Math.sign(mean(frames.map(f => f.nose.x - f[side].hip.x))) || 1;

  // 実寸スケール: 前腕長 ≒ 身長 × 0.146
  const foreLenPx = mean(F.map(f => dist(f.j.el, f.j.wr)));
  const cmPerPx = (heightCm * 0.146) / (foreLenPx || 1);

  // レップ信号
  const sigOf = {
    bench: F.map(f => f.wrY),
    ohp: F.map(f => -f.wrY),
    scap: (() => {                 // 肘角度を主信号に。追跡が不安定なら肩‑手首距離で代替
      const e = F.map(f => f.elbow);
      return (Math.max(...e) - Math.min(...e)) >= 25 ? e.map(v => -v) : F.map(f => -f.reach);
    })(),
    squat: F.map(f => f.hipY),
    hinge: F.map(f => f.shY)
  }[type];
  const sig = smooth(sigOf, 2);
  const dt = (F[F.length - 1].t - F[0].t) / Math.max(1, F.length - 1);
  const pk = peaks(sig, Math.max(3, Math.round(0.55 / dt)));
  const keys = pk.length ? pk : [sig.indexOf(Math.max(...sig))];
  const reps = keys.length;

  // 各レップの区間（谷→谷）
  const segs = keys.map((k, i) => {
    let a = i === 0 ? 0 : keys[i - 1], b = i === keys.length - 1 ? F.length - 1 : keys[i + 1];
    let lo = k; for (let x = k; x > a; x--) if (sig[x] < sig[lo]) lo = x;
    let hi = k; for (let x = k; x < b; x++) if (sig[x] < sig[hi]) hi = x;
    return { start: lo, key: k, end: hi };
  });
  const tempo = segs.map(s => ({
    ecc: (F[s.key].t - F[s.start].t), con: (F[s.end].t - F[s.key].t)
  }));

  const ms = [], adv = [];
  const K = keys.map(i => F[i]);            // キーフレーム（ボトム/ロックアウト）
  const Ko = keys.map(i => Fo[i]);
  const startF = F[segs[0] ? segs[0].start : 0];
  const push = (...a) => ms.push(M(...a));

  if (type === 'bench') {
    const fa = mean(K.map(f => Math.abs(f.forearm)));
    const faDir = mean(K.map(f => f.forearm)) * facing > 0 ? '頭側' : '足側';
    push('前腕の垂直性（ボトム）', fa, '°', st3(fa, 5, 12),
      `ボトムで前腕が${faDir}に ${fa.toFixed(1)}° 倒れています`, '0〜5°');

    const tuck = mean(K.map(f => f.tuck));
    push('肘のタック角（上腕×体幹）', tuck, '°', tuck >= 45 && tuck <= 70 ? 'ok' : tuck < 38 || tuck > 80 ? 'bad' : 'warn',
      tuck > 70 ? '肘が開きすぎ：肩前部・上腕二頭腱にストレス' : tuck < 45 ? '締めすぎ：大胸筋の関与が減り上腕三頭寄りに' : '大胸筋に適した角度', '45〜70°');

    const rom = mean(K.map(f => f.elbow));
    push('ボトム肘角度（可動域）', rom, '°', rom <= 75 ? 'ok' : rom <= 95 ? 'warn' : 'bad',
      rom > 95 ? 'ボトムが浅い：ストレッチ刺激が不足' : '十分な深さ', '≦75°');

    const drift = segs.map(s => {
      const xs = F.slice(s.start, s.end + 1).map(f => f.wrX);
      return (Math.max(...xs) - Math.min(...xs)) * cmPerPx;
    });
    const dr = mean(drift);
    push('バー軌道の水平移動', dr, 'cm', dr <= 8 ? 'ok' : dr <= 14 ? 'warn' : 'bad',
      'ボトム（胸）とトップ（肩の真上）の水平差。適度な斜め軌道は正常', '4〜8cm');

    const asym = Math.abs(mean(K.map(f => Math.abs(f.forearm))) - mean(Ko.map(f => Math.abs(f.forearm))));
    push('左右の前腕角度差', asym, '°', st3(asym, 3, 7), '奥側は推定精度が落ちるため参考値', '≦3°');

    const scapDrop = mean(K.map(f => f.earSh)) - startF.earSh;
    const shrugPct = scapDrop * 100;
    push('ボトムでの肩のすくみ', shrugPct, '%', shrugPct <= 4 ? 'ok' : shrugPct <= 9 ? 'warn' : 'bad',
      shrugPct > 4 ? 'ボトムで肩がすくみ、肩甲骨の下制・内転が抜けています' : '下制を保持できています', '≦4%');

    const foreCm = heightCm * 0.146;
    const shiftCm = foreCm * Math.sin(fa * Math.PI / 180);
    if (fa > 5) adv.push({ k: fa > 12 ? 'bad' : 'warn', t: `<b>前腕角度</b>：ボトムで前腕が${faDir}へ ${fa.toFixed(1)}° 倒れています。前腕が垂直でないと、バーの重量ベクトルが肘関節にモーメント（回転力）を生み、その分を上腕三頭・肩で相殺することになります。修正は<b>「バーを下ろす位置」</b>で行ってください。前腕が${faDir}に倒れている＝バーの接触点が${faDir === '頭側' ? '上（鎖骨寄り）すぎ' : '下（腹寄り）すぎ'}です。ボトムのバー位置を約 <b>${shiftCm.toFixed(1)}cm ${faDir === '頭側' ? '下げて' : '上げて'}</b>（前腕長 ${foreCm.toFixed(0)}cm × sin${fa.toFixed(0)}°）、肘が手首の真下に来る位置を探してください。` });
    else adv.push({ k: 'ok', t: `<b>前腕角度</b>：ボトムでの垂直性 ${fa.toFixed(1)}° は理想的です。肘関節に無駄なモーメントが発生していません。この時のバー接触位置を基準として覚えてください。` });

    if (tuck > 70) adv.push({ k: 'bad', t: `<b>タック角 ${tuck.toFixed(0)}°</b>：肘が開きすぎています。上腕が外転70°を超えると上腕骨頭が肩峰下スペースを狭め、インピンジメントのリスクが上がります。脇を締めて 55〜65° を狙ってください（バーを下ろす軌道が自然に胸骨下端寄りになります）。` });
    else if (tuck < 45) adv.push({ k: 'warn', t: `<b>タック角 ${tuck.toFixed(0)}°</b>：締めすぎです。大胸筋の水平内転モーメントアームが短くなり、上腕三頭優位のプレスになっています。102.5kgを胸で伸ばすなら 50〜65° まで開いた方が総出力は上がります。` });
    else adv.push({ k: 'ok', t: `<b>タック角 ${tuck.toFixed(0)}°</b>：大胸筋の力発揮と肩の安全性のバランスが取れた角度です。` });

    if (shrugPct > 4) adv.push({ k: 'warn', t: `<b>肩甲骨</b>：切り返しで肩の挙上が ${shrugPct.toFixed(1)}% 検出されました。ボトムで肩甲骨の下制・内転が抜けると、胸郭のアーチが潰れてストロークが伸び、肩前部の負担が増えます。セットアップで「肩甲骨を尻ポケットに入れる」意識を、<b>挙上局面の最後まで</b>維持してください。` });
  }

  if (type === 'ohp') {
    const lean = K.map(f => -facing * f.trunk);
    const leanMax = Math.max(...F.map(f => -facing * f.trunk));
    const leanStart = -facing * startF.trunk;
    const leanΔ = leanMax - leanStart;
    push('体幹の後傾角（最大）', leanMax, '°', leanMax <= 8 ? 'ok' : leanMax <= 15 ? 'warn' : 'bad',
      '直立からの後ろへの倒れ。ストリクトなら 10°以内', '≦8°');
    push('挙上中の後傾の増加', leanΔ, '°', st3(leanΔ, 5, 10),
      leanΔ > 5 ? 'バーが顔の前を通る局面で反って逃げています' : '安定', '≦5°');

    const hipExt = mean(K.map(f => 180 - f.hipAng));
    const hipExtStart = 180 - startF.hipAng;
    const arch = hipExtStart - hipExt;
    push('股関節の前方突き出し', arch, '°', arch <= 4 ? 'ok' : arch <= 9 ? 'warn' : 'bad',
      arch > 4 ? '骨盤が前に出て腰椎の伸展（反り）で支えています' : '骨盤中間位を保持', '≦4°');

    const torsoStart = startF.torso, torsoKey = mean(K.map(f => f.torso));
    const rib = (torsoKey - torsoStart) / torsoStart * 100;
    push('肩‑骨盤距離の伸び（腹圧の指標）', rib, '%', rib <= 2.5 ? 'ok' : rib <= 5 ? 'warn' : 'bad',
      rib > 2.5 ? '胸郭が引き上がり、肋骨が開いています＝腹圧が抜けたサイン' : '胸郭と骨盤の位置関係を維持', '≦2.5%');

    const braceSd = mean(segs.map(s => sd(F.slice(s.start, s.end + 1).map(f => -facing * f.trunk))));
    push('挙上中の体幹のブレ', braceSd, '°', st3(braceSd, 3, 6), '体幹角度の標準偏差。大きいほど剛性不足', '≦3°');

    const align = mean(K.map(f => Math.abs(f.j.wr.x - f.j.an.x) * cmPerPx));
    push('ロックアウト位置（手首↔足首）', align, 'cm', align <= 5 ? 'ok' : align <= 10 ? 'warn' : 'bad',
      'バーは中足部の真上が最も安定します', '≦5cm');

    const rom = Math.min(...F.map(f => f.elbow));
    push('ボトム肘角度', rom, '°', rom <= 80 ? 'ok' : 'warn', '深すぎず、鎖骨〜顎の高さまで', '≦80°');

    if (leanMax > 8 || arch > 4) adv.push({ k: leanMax > 15 || arch > 9 ? 'bad' : 'warn', t: `<b>腰の反り</b>：後傾 ${leanMax.toFixed(1)}°、股関節の前方突き出し ${arch.toFixed(1)}° を検出。バーが顔をかわす局面で腰椎伸展に逃げています。順序は「① 息を吸って腹腔内圧を作る → ② <b>殿筋を締めて骨盤を後傾</b>させ肋骨を下げる → ③ 顎を引いてバーを鼻先ギリギリで通す → ④ 頭が抜けたら頭を前に出す」。特に②が抜けると腰が反ります。62.5kg×4 は Smith 57.5kg より高重量なので、フリーでは<b>ラックの高さを一段下げてスタート姿勢を作り直す</b>のも有効です。` });
    else adv.push({ k: 'ok', t: `<b>腰椎</b>：後傾 ${leanMax.toFixed(1)}°・股関節の突き出し ${arch.toFixed(1)}° と良好。中間位を保てています。` });

    if (rib > 2.5) adv.push({ k: rib > 5 ? 'bad' : 'warn', t: `<b>腹圧</b>：肩‑骨盤の距離が挙上中に ${rib.toFixed(1)}% 伸びています。これは肋骨が開いて（胸郭挙上）腹横筋のテンションが抜けた典型パターンで、腰椎の剪断力が増えます。対策は<b>各レップの前に息を吸い直さない</b>こと。ボトムで一度呼気を少しだけ吐きつつ腹圧は保つ（バルサルバの部分解放）。ロックアウトで肋骨を骨盤に近づける（"みぞおちを閉じる"）意識を持ってください。` });
    else adv.push({ k: 'ok', t: `<b>腹圧</b>：胸郭‑骨盤の位置関係が ${rib.toFixed(1)}% の変化に収まっており、体幹の剛性は維持できています。` });

    if (align > 5) adv.push({ k: 'warn', t: `<b>ロックアウト</b>：バーが中足部から ${align.toFixed(1)}cm ずれています。頭上でバー・肩・股関節・中足部が一直線に乗ると、重量が骨で支えられ肩の等尺性負担が下がります。頭を抜いた後に「バーを後ろへ運ぶ」動作を明確に入れてください。` });
  }

  if (type === 'scap') {
    const es = F.map(f => f.earSh);
    const esO = Fo.map(f => f.earSh);
    const startEs = mean(es.slice(0, Math.max(2, Math.round(es.length * 0.08))));
    const keyEs = mean(K.map(f => f.earSh));
    const minEs = Math.min(...es), maxEs = Math.max(...es);
    const shrug = (startEs - minEs) / (Math.abs(startEs) || 1) * 100;
    const range = (maxEs - minEs) * 100;

    push('肩甲骨の下制レンジ', range, '%', range >= 8 ? 'ok' : range >= 4 ? 'warn' : 'bad',
      '耳‑肩距離（体幹長で正規化）の変動幅。小さすぎ＝肩甲骨が動いていない', '≧8%');
    push('トップでの下制保持', (keyEs - startEs) * 100, '%', keyEs - startEs >= -0.02 ? 'ok' : keyEs - startEs >= -0.05 ? 'warn' : 'bad',
      keyEs < startEs ? '最大収縮位で肩がすくんでいます' : '下制を保持できています', '0%以上');
    const asym = Math.abs(mean(K.map(f => f.earSh)) - mean(Ko.map(f => f.earSh))) * 100;
    push('左右の肩の高さ差', asym, '%', st3(asym, 4, 8), '大きい場合は片側の広背筋／下部僧帽の機能差', '≦4%');
    const romE = Math.max(...F.map(f => f.elbow)) - Math.min(...F.map(f => f.elbow));
    push('肘の可動域', romE, '°', romE >= 85 ? 'ok' : romE >= 60 ? 'warn' : 'bad', 'ストレッチ位から最大収縮までの角度変化', '≧85°');
    const scapFirst = (() => {
      const s0 = segs[0] || { start: 0, key: keys[0] };
      const half = Math.round((s0.key - s0.start) * 0.3) + s0.start;
      const dScap = (es[Math.max(0, half)] - es[s0.start]);
      const dElb = (F[Math.max(0, half)].elbow - F[s0.start].elbow);
      return dScap * 100 / (Math.abs(dElb) + 1);
    })();
    push('肩甲骨先行度', scapFirst * 10, 'pt', scapFirst * 10 >= 2 ? 'ok' : scapFirst * 10 >= 0.5 ? 'warn' : 'bad',
      '引き始めの30%で肘より肩甲骨が先に動いているか', '≧2');

    if (range < 8) adv.push({ k: 'bad', t: `<b>肩甲骨の可動</b>：下制レンジが ${range.toFixed(1)}% しかありません。肩甲上腕リズム（上腕2：肩甲骨1）が働かず、肩甲骨が固定されたまま腕だけで引いています。プル系の前に <b>Scapular Pull-up（肩甲骨だけで身体を1〜2cm上げ下げ）× 8回</b>を入れ、動作中は「肘を下げる前にまず肩を下げる」を分離して練習してください。` });
    else if (keyEs - startEs < -0.02) adv.push({ k: 'warn', t: `<b>すくみ</b>：最大収縮位で肩が ${Math.abs((keyEs - startEs) * 100).toFixed(1)}% 挙上しています。上部僧帽が代償し、広背筋・下部僧帽への刺激が逃げています。重量を1段下げ、トップで「肩を耳から遠ざけたまま1秒静止」を条件にしてください。加重懸垂30kg×5 なら 25kg で下制保持を優先した方が最終的に伸びます。` });
    else adv.push({ k: 'ok', t: `<b>肩甲骨</b>：下制レンジ ${range.toFixed(1)}%、トップでの保持も良好。肩甲上腕リズムが機能しています。` });

    if (scapFirst * 10 < 2) adv.push({ k: 'warn', t: `<b>動作順序</b>：引き始めで肘の屈曲が肩甲骨の下制より先行しています。「肩甲骨の下制・下方回旋 → 肩関節の伸展／内転 → 肘の屈曲」の順に発火させると、広背筋のモーメントアームが最も長い区間を使えます。開始1/3をわざとゆっくりにして順序を作ってください。` });
    if (asym > 4) adv.push({ k: 'warn', t: `<b>左右差 ${asym.toFixed(1)}%</b>：片側優位が出ています。SA Pulley Row / SA Lat Pull Down（片手種目）で弱い側から先に始め、強い側は弱い側のレップ数に揃えてください。` });
  }

  if (type === 'squat') {
    const hipBelowKnee = mean(K.map(f => (f.j.hip.y - f.j.kn.y) / f.torso * 100));
    push('深さ（股関節 vs 膝）', hipBelowKnee, '%', hipBelowKnee >= 0 ? 'ok' : hipBelowKnee >= -8 ? 'warn' : 'bad',
      hipBelowKnee >= 0 ? '股関節が膝より低い（パラレル以下）' : 'パラレルに届いていません', '≧0%');
    const hipMin = mean(K.map(f => f.hipAng));
    push('ボトム股関節角度', hipMin, '°', hipMin <= 70 ? 'ok' : hipMin <= 90 ? 'warn' : 'bad', '小さいほど深い', '≦70°');
    const trunkB = mean(K.map(f => Math.abs(f.trunk)));
    push('ボトム体幹前傾角', trunkB, '°', trunkB <= 45 ? 'ok' : trunkB <= 58 ? 'warn' : 'bad',
      trunkB > 50 ? 'グッドモーニング化：脊柱起立筋への負担大' : 'ハイバーとして適正', '30〜45°');

    // バットウィンク: ボトム近傍での体幹角の急変
    const wink = mean(segs.map(s => {
      const w = 3, a = Math.max(s.start, s.key - w), b = Math.min(s.end, s.key + w);
      const seq = F.slice(a, b + 1).map(f => Math.abs(f.trunk));
      let mx = 0;
      for (let i = 1; i < seq.length; i++) mx = Math.max(mx, seq[i] - seq[i - 1]);
      return mx;
    }));
    push('バットウィンク疑い', wink, '°/frame', st3(wink, 2.5, 5),
      wink > 2.5 ? 'ボトム直前で体幹角が急変＝骨盤後傾／腰椎屈曲の可能性' : '滑らかに切り返せています', '≦2.5°');

    const barShift = mean(K.map(f => Math.abs(f.j.sh.x - f.j.an.x) * cmPerPx));
    push('重心（肩↔足首の水平差）', barShift, 'cm', barShift <= 4 ? 'ok' : barShift <= 8 ? 'warn' : 'bad',
      'バーは常に中足部の真上に', '≦4cm');
    const romSd = sd(K.map(f => f.hipAng));
    push('レップ間の深さのばらつき', romSd, '°', st3(romSd, 4, 9), 'ばらつきが大きいと前回比較の信頼性が落ちます', '≦4°');
    const tem = mean(tempo.map(t => t.ecc));
    push('下降時間（平均）', tem, '秒', tem >= 1.2 ? 'ok' : tem >= 0.8 ? 'warn' : 'bad', '落下でなくコントロール', '≧1.2秒');

    if (hipBelowKnee < 0) adv.push({ k: 'warn', t: `<b>深さ</b>：股関節が膝より ${Math.abs(hipBelowKnee).toFixed(1)}%（体幹長比）高い位置で切り返しています。147.5kg×4 の記録を伸ばす前に、まず深さを一定にした方が指標として意味を持ちます。足関節背屈が制限ならリフティングシューズかヒール、股関節ならスタンスを2〜3cm広げて爪先を5°外に。` });
    if (wink > 2.5) adv.push({ k: wink > 5 ? 'bad' : 'warn', t: `<b>バットウィンク</b>：ボトム直前で体幹角が急に ${wink.toFixed(1)}°/frame 変化しています。骨盤後傾＝腰椎屈曲が高負荷下で起きると椎間板への剪断が増えます。ウォームアップの梨状筋ストレッチ・Clam Shell は継続しつつ、<b>急変が始まる直前の深さ</b>を当面のボトムに設定してください。` });
    if (trunkB > 50) adv.push({ k: 'warn', t: `<b>体幹角 ${trunkB.toFixed(0)}°</b>：前傾が強く、大腿四頭筋よりも股関節伸展筋・脊柱起立筋への依存が大きい状態です。Day4 の Pendulum SQ / Hack SQ で四頭の絶対的な強さを上げると、Back SQ の前傾も自然に減ります。` });
  }

  if (type === 'hinge') {
    const kneeB = mean(K.map(f => f.knee));
    push('ボトム膝角度', kneeB, '°', kneeB >= 150 && kneeB <= 172 ? 'ok' : 'warn',
      kneeB < 150 ? '膝が曲がりすぎ＝スクワット化' : '膝が伸びすぎ＝ハム過伸長', '155〜170°');
    const kneeRange = Math.max(...F.map(f => f.knee)) - Math.min(...F.map(f => f.knee));
    push('膝角度の変動', kneeRange, '°', kneeRange <= 22 ? 'ok' : kneeRange <= 35 ? 'warn' : 'bad', 'RDLは膝角度をほぼ一定に', '≦22°');
    const trunkB = mean(K.map(f => Math.abs(f.trunk)));
    push('ボトム体幹前傾角', trunkB, '°', trunkB >= 60 ? 'ok' : trunkB >= 45 ? 'warn' : 'bad', 'ハムのストレッチが入る深さか', '≧60°');
    const flex = (startF.torso - mean(K.map(f => f.torso))) / startF.torso * 100;
    push('脊柱の丸まり（肩‑腰の短縮）', flex, '%', flex <= 2.5 ? 'ok' : flex <= 5 ? 'warn' : 'bad',
      flex > 2.5 ? '胸椎／腰椎の屈曲が起きています' : '中立を維持', '≦2.5%');
    const barGap = mean(K.map(f => Math.abs(f.j.wr.x - f.j.hip.x) * cmPerPx));
    push('バーと身体の距離', barGap, 'cm', barGap <= 12 ? 'ok' : barGap <= 20 ? 'warn' : 'bad', 'バーは脚を擦る軌道で', '≦12cm');

    if (flex > 2.5) adv.push({ k: flex > 5 ? 'bad' : 'warn', t: `<b>脊柱中立</b>：ボトムで肩‑腰の距離が ${flex.toFixed(1)}% 短縮＝背中が丸まっています。135kg×6 は既に高重量なので、丸まりが出る直前の深さで止めてください。「バーを下ろす」のではなく<b>「股関節を後ろの壁に当てにいく」</b>意識に変え、ハムのストレッチが限界＝可動域の終点とします。` });
    if (kneeRange > 22) adv.push({ k: 'warn', t: `<b>膝の使いすぎ</b>：膝角度が ${kneeRange.toFixed(0)}° 動いており、RDLというよりデッドリフト寄りの動きになっています。ハムへの刺激を最大化するなら膝は15〜20°で固定してください。` });
    if (barGap > 12) adv.push({ k: 'warn', t: `<b>バー軌道</b>：バーが身体から ${barGap.toFixed(1)}cm 離れています。距離が伸びるほど腰椎のモーメントが増えます。広背筋でバーを脚に押し付け続けてください。` });
    if (!adv.length) adv.push({ k: 'ok', t: '主要な指標がすべて基準内です。この動きを維持したまま漸進的に重量を伸ばしてください。' });
  }

  // テンポ・共通
  const tEcc = mean(tempo.map(t => t.ecc)), tCon = mean(tempo.map(t => t.con));
  const score = Math.round(100 - ms.reduce((a, m) => a + (m.status === 'bad' ? 16 : m.status === 'warn' ? 7 : 0), 0));

  return {
    side: side === 'L' ? '左（手前）' : '右（手前）',
    reps, tEcc, tCon, score: clamp(score, 0, 100),
    metrics: ms, advices: adv,
    keyIdx: keys[Math.floor(keys.length / 2)],
    series: F.map((f, i) => ({ label: f.t.toFixed(1), v: sig[i] })),
    frames: F, sig
  };
}

/* ---------- 骨格描画 ---------- */
const BONES = [['ear', 'sh'], ['sh', 'el'], ['el', 'wr'], ['sh', 'hip'], ['hip', 'kn'], ['kn', 'an']];
function drawSkeleton(cv, frame, W, H) {
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.clearRect(0, 0, W, H);
  ['R', 'L'].forEach(s => {
    const j = frame[s], main = s === (frame._side || 'L');
    x.strokeStyle = main ? '#4d8dff' : 'rgba(140,150,170,.45)';
    x.lineWidth = Math.max(2, W / 260); x.lineCap = 'round';
    BONES.forEach(([a, b]) => { x.beginPath(); x.moveTo(j[a].x, j[a].y); x.lineTo(j[b].x, j[b].y); x.stroke(); });
    x.fillStyle = main ? '#31d0a5' : 'rgba(140,150,170,.5)';
    Object.values(j).forEach(p => { x.beginPath(); x.arc(p.x, p.y, Math.max(3, W / 190), 0, 7); x.fill(); });
  });
}

/* ---------- UI ---------- */
let state = { type: 'bench', file: null, result: null, busy: false, msg: '', prog: 0, raw: null };

function render(el) {
  if (window.FA_PRESET) { state.type = window.FA_PRESET; window.FA_PRESET = null; state.result = null; }
  const T = TYPES[state.type];
  const r = state.result;
  const hist = (JSON.parse(localStorage.getItem('gymform_v1') || '[]')).filter(h => h.type === state.type);

  el.innerHTML = `
    <div class="seg">${Object.entries(TYPES).map(([k, v]) =>
      `<button data-t="${k}" class="${k === state.type ? 'on' : ''}" style="font-size:12px">${v.s}</button>`).join('')}</div>

    <div class="card tight">
      <div class="b sm">${T.n} <span class="dim xs">— ${T.sub}</span></div>
      <div class="sm mut" style="margin-top:6px"><b>撮影</b>：${T.cam}</div>
      <div class="sm mut" style="margin-top:3px"><b>評価</b>：${T.focus}</div>
      <div class="xs dim" style="margin-top:6px">1〜3レップ・10秒以内が最も精度が出ます。</div>
    </div>

    <div id="fa-stage"><video playsinline muted preload="auto"></video><canvas></canvas></div>

    ${state.busy ? `
      <div class="card">
        <div class="row" style="gap:8px"><span class="spin"></span><span class="sm">${state.msg}</span></div>
        <div class="bar" style="margin-top:10px"><i style="width:${Math.round(state.prog * 100)}%"></i></div>
      </div>` : `
      <label class="dropzone" style="display:block">
        <div style="font-size:26px">＋</div>
        <div class="b sm" style="margin-top:4px">動画を選択</div>
        <div class="xs dim" style="margin-top:4px">カメラロールから／その場で撮影</div>
        <input type="file" accept="video/*" id="fa-file" style="display:none">
      </label>`}

    ${r ? resultHTML(r) : ''}

    ${hist.length ? `<h2 class="sec">この種目の履歴</h2>
      <div class="card">${hist.slice(-8).reverse().map(h =>
        `<div class="row between sm" style="padding:6px 0;border-bottom:1px solid var(--line)">
          <span class="mut">${h.date}</span>
          <span><b class="mono ${h.score >= 85 ? 'ok' : h.score >= 65 ? 'warn' : 'bad'}">${h.score}</b><span class="xs dim">/100</span>
          <span class="xs dim"> · ${h.reps}rep</span></span></div>`).join('')}
      </div>` : ''}

    <div class="card xs dim" style="margin-top:14px;line-height:1.7">
      解析は端末内（MediaPipe Pose）で完結し、動画がネットワークに出ることはありません。<br>
      2D推定のため奥行きは推定値です。数値は絶対値より<b>同一アングルでの前後比較</b>に使ってください。
    </div>
  `;

  el.querySelector('.seg').onclick = e => {
    const b = e.target.closest('button[data-t]'); if (!b) return;
    state.type = b.dataset.t; state.result = null; state.raw = null; render(el);
  };
  const fi = el.querySelector('#fa-file');
  if (fi) fi.onchange = e => { const f = e.target.files[0]; if (f) run(el, f); };
  if (r) {
    const c = el.querySelector('#fa-chart');
    if (c) requestAnimationFrame(() => drawSeries(c, r));
    if (state.raw) {
      const stage = el.querySelector('#fa-stage');
      stage.style.display = 'block';
      const v = stage.querySelector('video');
      v.src = state.raw.url;
      v.onloadeddata = () => {
        const f = state.raw.frames[r.keyIdx];
        v.currentTime = f ? f.t : 0;
        if (f) { f._side = r.side.startsWith('左') ? 'L' : 'R'; drawSkeleton(stage.querySelector('canvas'), f, state.raw.W, state.raw.H); }
      };
    }
  }
}

function resultHTML(r) {
  const badge = s => `<span class="pill ${s}">${s === 'ok' ? '良好' : s === 'warn' ? '要改善' : '要修正'}</span>`;
  return `
    <h2 class="sec">総合</h2>
    <div class="card">
      <div class="row between">
        <div><div style="font-size:34px;font-weight:800;line-height:1"
          class="${r.score >= 85 ? 'ok' : r.score >= 65 ? 'warn' : 'bad'}">${r.score}<span class="dim" style="font-size:15px">/100</span></div>
          <div class="xs dim" style="margin-top:4px">${r.reps} レップ検出 · 解析側 ${r.side}</div></div>
        <div class="sm mut mono" style="text-align:right">
          下降 ${r.tEcc.toFixed(2)}s<br>挙上 ${r.tCon.toFixed(2)}s<br>
          <span class="xs dim">Tempo ${(r.tEcc / (r.tCon || 1)).toFixed(1)}:1</span></div>
      </div>
      <canvas class="chart" id="fa-chart" style="height:110px;margin-top:10px"></canvas>
      <div class="xs dim">バー／身体の高さ推移（山＝キーポジション）</div>
    </div>

    <h2 class="sec">計測値</h2>
    <div class="card">
      ${r.metrics.map(m => `<div class="metric">
        <div class="grow"><div class="mn b">${m.n}</div><div class="mh">${m.hint}　<span class="dim">目安 ${m.ideal}</span></div></div>
        <div style="text-align:right;white-space:nowrap">
          <div class="mv ${m.status}">${m.v.toFixed(1)}<span class="xs dim"> ${m.unit}</span></div>
          ${badge(m.status)}</div></div>`).join('')}
    </div>

    <h2 class="sec">バイオメカニクス評価</h2>
    ${r.advices.map(a => `<div class="advice ${a.k}">${a.t}</div>`).join('')}
  `;
}

function drawSeries(cv, r) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const x = cv.getContext('2d'); x.scale(dpr, dpr); x.clearRect(0, 0, w, h);
  const s = r.sig, mn = Math.min(...s), mx = Math.max(...s);
  const X = i => 4 + (w - 8) * i / (s.length - 1 || 1);
  const Y = v => 8 + (h - 16) * (1 - (v - mn) / ((mx - mn) || 1));
  x.strokeStyle = '#4d8dff'; x.lineWidth = 2; x.beginPath();
  s.forEach((v, i) => i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)));
  x.stroke();
  x.fillStyle = '#31d0a5';
  x.beginPath(); x.arc(X(r.keyIdx), Y(s[r.keyIdx]), 4, 0, 7); x.fill();
}

async function run(el, file) {
  state.busy = true; state.msg = '動画を読み込み中…'; state.prog = 0; state.result = null;
  if (state.raw) { URL.revokeObjectURL(state.raw.url); state.raw = null; }
  render(el);
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.src = url; v.muted = true; v.playsInline = true; v.preload = 'auto';
  try {
    await new Promise((res, rej) => {
      v.onloadeddata = res; v.onerror = () => rej(new Error('動画を読み込めませんでした'));
      setTimeout(() => rej(new Error('読み込みタイムアウト')), 20000);
    });
    const { frames, W, H } = await extract(v,
      p => { state.prog = p; const b = el.querySelector('.bar > i'); if (b) b.style.width = Math.round(p * 100) + '%'; },
      m => { state.msg = m; render(el); });
    if (frames.length < 8) throw new Error('人物を検出できたフレームが足りません。全身が映るよう、明るい場所で撮り直してください。');
    state.msg = '指標を計算中…'; render(el);
    const heightCm = (JSON.parse(localStorage.getItem('gymlog_v1') || '{}').settings || {}).height || 172;
    const r = analyze(state.type, frames, heightCm);
    state.raw = { url, frames, W, H };
    state.result = r;
    const hist = JSON.parse(localStorage.getItem('gymform_v1') || '[]');
    hist.push({ type: state.type, date: new Date().toISOString().slice(0, 10), score: r.score, reps: r.reps });
    localStorage.setItem('gymform_v1', JSON.stringify(hist.slice(-100)));
  } catch (e) {
    URL.revokeObjectURL(url);
    alert(e.message || '解析に失敗しました');
  }
  state.busy = false;
  render(el);
}

window.FormUI = { render };
if (typeof S !== 'undefined' && S.tab === 'form') render(document.getElementById('app'));
