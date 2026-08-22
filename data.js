/* ===== 種目データ =====
   t: 目標レップ / e: 片側(each) / s: マシン設定(椅子高さ等) / v: 動画撮影推奨
   seed: [前回, 前々回] の記録 [重量, レップ]  ("105+5" のような足し算表記OK)
   a: フォーム解析の種目タイプ
   alts: 代替種目
*/
const ex = (id, name, o = {}) => ({
  id, name,
  target: o.t ?? 6,
  each: !!o.e,
  setting: o.s || '',
  video: !!o.v,
  bw: !!o.bw,
  analyze: o.a || '',
  note: o.note || '',
  seed: o.seed || [],
  alts: (o.alts || [])
});

const PROGRAM = [
  {
    id: 'day1', name: 'Day 1', sub: '胸・背中・腕',
    warmup: ['Y Raise', 'Arm bar push'],
    items: [
      ex('bench', 'Bench Press', { v: 1, s: '8-4', t: 6, a: 'bench', seed: [['102.5', ''], ['100', '5']] }),
      ex('pullup', 'Pull Up', { v: 1, t: 6, a: 'scap', note: '加重', seed: [['30', '5'], ['25', '']],
        alts: [ex('npullup', 'N Pull Up', { t: 6, a: 'scap' })] }),
      ex('dbinclpress', 'DB Incline Press', { v: 1, t: 6, a: 'bench', seed: [['40', '5'], ['38', '5']],
        alts: [
          ex('inclpress', 'Incline Press', { s: '5.5', e: 1, t: 6, a: 'bench', seed: [['45', '7'], ['47.5', '5']] }),
          ex('inclmachpress', 'Incline Machine Press', { s: '1', e: 1, t: 6, seed: [['65', '3']] })
        ] }),
      ex('pulleyrow', 'Pulley Row', { t: 6, seed: [['105+5', '8'], ['105+5', '7']],
        alts: [
          ex('sapulleyrow', 'SA Pulley Row', { e: 1, t: 6, a: 'scap', seed: [['55', '8'], ['55', '8']] }),
          ex('machrow1', 'Machine Row', { s: '4', e: 1, t: 6, a: 'scap', seed: [['65', '6']] })
        ] }),
      ex('dips', 'Dips', { t: 6, note: '加重', seed: [['32.5', '7'], ['32.5', '']] }),
      ex('preachercurl', 'Preacher Curl', { t: 8, seed: [['22.5', '7'], ['22.5', '5']],
        alts: [ex('dbpreachercurl', 'DB Preacher Curl', { e: 1, t: 6, seed: [['16', '6'], ['14', '8']] })] }),
      ex('abroller1', 'Ab Roller', { bw: 1, t: 0 })
    ]
  },
  {
    id: 'day2', name: 'Day 2', sub: '脚・肩・腕',
    warmup: ['梨状筋ストレッチ', 'Clam Shell', 'Abd & Add'],
    items: [
      ex('backsq', 'Back SQ', { v: 1, s: '13-4', t: 6, a: 'squat', seed: [['147.5', '4'], ['142.5', '4']] }),
      ex('militarypress', 'Military Press', { v: 1, t: 6, a: 'ohp', seed: [['62.5', '4'], ['57.5', '']] }),
      ex('bulgariansq', 'Bulgarian SQ', { v: 1, e: 1, t: 6, a: 'squat', seed: [['92.5', '6'], ['92.5', '6']],
        alts: [ex('reverselunge', 'Reverse Lunge', { e: 1, t: 5, a: 'squat', seed: [['100', '5'], ['100', '5']] })] }),
      ex('dbsideraise', 'DB Side Raise', { t: 8, seed: [['14', '']],
        alts: [ex('machsideraise', 'Machine Side Raise', { t: 8, seed: [['12.5', '10'], ['12.5', '8']] })] }),
      ex('ezlyingtri', 'EZ Lying Tri Ex', { t: 8, seed: [['40', '7'], ['37.5', '7']],
        alts: [ex('spsmithnarrow', 'SP Smith Narrow Press', { t: 6 })] }),
      ex('legex', 'Leg Ex', { t: 8, seed: [['115', '12'], ['115', '9']],
        alts: [ex('sllegex', 'SL Leg Ex', { e: 1, t: 6, seed: [['36+3.4', '11'], ['36+3.4', '']] })] })
    ]
  },
  {
    id: 'day3', name: 'Day 3', sub: '胸・背中・腕',
    warmup: ['Y Raise (5) 6.8', 'Arm bar'],
    items: [
      ex('spsmithincl', 'SP Smith Incline Press (30°)', { v: 1, t: 6, a: 'bench', seed: [['75', '4'], ['70', '5']],
        alts: [
          ex('smithincl', 'Smith Incline Press (30°)', { t: 6, a: 'bench', seed: [['80', '6'], ['77.5', '5']] }),
          ex('inclbench', 'Incline Bench Press (30°)', { t: 6, a: 'bench', seed: [['85', '7'], ['85', '6']] })
        ] }),
      ex('nulatpull', 'NU Lat Pull Down', { t: 6, a: 'scap', seed: [['89+5', '9'], ['96', '6']],
        alts: [ex('salatpull', 'SA Lat Pull Down', { e: 1, t: 6, a: 'scap', seed: [['65', '5'], ['62.5', '4']] })] }),
      ex('dbbench', 'DB Bench Press', { t: 6, a: 'bench', seed: [['42', '']],
        alts: [ex('machchest', 'Machine Chest Press', { s: '6', t: 6, seed: [['86', '5'], ['84', '4']] })] }),
      ex('machrow3', 'Machine Row', { t: 6, a: 'scap', seed: [['82+5', '10'], ['89', '9']],
        alts: [
          ex('tbarrow', 'T-Bar Row', { t: 6, a: 'scap', seed: [['77.5', '8'], ['77.5', '7']] }),
          ex('supportedbor', 'Supported BOR', { t: 6, a: 'scap', seed: [['82.5', '6'], ['77.5', '6']] })
        ] }),
      ex('abroller3', 'Ab Roller', { bw: 1, t: 0 }),
      ex('bbarmcurl', 'BB Arm Curl', { t: 8, seed: [['35', '9'], ['35', '']],
        alts: [ex('cablearmcurl', 'Cable Arm Curl', { t: 6, seed: [['64', '8'], ['64', '6']] })] }),
      ex('tripushdown', 'Tri Push Down', { t: 8, seed: [['64', '12'], ['68', '11']],
        alts: [ex('satripushdown', 'SA Tri Push Down', { e: 1, t: 6, seed: [['32', '12'], ['27', '8']] })] })
    ]
  },
  {
    id: 'day4', name: 'Day 4', sub: '脚・肩・腕',
    warmup: ['梨状筋ストレッチ', 'Clam Shell', 'Abd & Add'],
    items: [
      ex('spsmithbacksq', 'SP Smith Back SQ', { v: 1, t: 6, a: 'squat', seed: [['122.5', '6'], ['117.5', '5']] }),
      ex('spsmithmil', 'SP Smith Military Press', { v: 1, t: 6, a: 'ohp', seed: [['57.5', '6'], ['55', '5']],
        alts: [
          ex('smithmil', 'Smith Military Press', { s: '6', t: 6, a: 'ohp', seed: [['62.5', '6'], ['57.5', '6']] }),
          ex('dbshoulderpress', 'DB Shoulder Press', { t: 6, a: 'ohp', seed: [['38', '5'], ['36', '6']] }),
          ex('machshoulderpress', 'Machine Shoulder Press', { s: '4', t: 6, seed: [['63', '']] })
        ] }),
      ex('pendulumsq', 'Pendulum SQ', { t: 6, a: 'squat', seed: [['102.5', '7'], ['102.5', '6']],
        alts: [
          ex('hacksq', 'Hack SQ', { t: 6, a: 'squat', seed: [['125', '5'], ['115', '7']] }),
          ex('legpress', 'Leg Press', { t: 6, seed: [['250', ''], ['235', '5']] })
        ] }),
      ex('rdl', 'RDL', { v: 1, t: 6, a: 'hinge', seed: [['135', '6'], ['135', '6']],
        alts: [ex('slrdl', 'SL RDL', { e: 1, t: 6, a: 'hinge' })] }),
      ex('cablesideraise', 'Cable Side Raise', { s: '6', e: 1, t: 6, seed: [['27', '11'], ['27', '10']],
        alts: [ex('cableuprightrow', 'Cable Upright Row', { e: 1, t: 6, seed: [['31.8+1.25', '8'], ['31.8+1.25', '6']] })] }),
      ex('dbfrenchpress', 'DB French Press', { t: 8, seed: [['36', '9'], ['36', '10']],
        alts: [ex('cablefrenchpress', 'Cable French Press', { s: '12', t: 8, seed: [['68', '']] })] }),
      ex('legcurlseated', 'Leg Curl (seated)', { t: 6, seed: [['90+3.75', '7'], ['90', '']],
        alts: [
          ex('legcurlprone', 'Leg Curl (prone)', { s: '3', t: 6, seed: [['54+3.4', '6'], ['50+2.3', '6']] }),
          ex('sllegcurl', 'SL Leg Curl', { e: 1, t: 6, seed: [['27+2.3', '8-5'], ['27', '8-6']] })
        ] })
    ]
  }
];

/* ===== 食品データベース (可食部100gあたり / 一部は個数・缶・袋単位) ===== */
const FOODS = {
  milk:        { n: '牛乳',              u: 'ml', kcal: 61,  p: 3.3,  f: 3.8,  c: 4.8 },
  kiwi:        { n: 'キウイ',            u: 'g',  kcal: 51,  p: 1.0,  f: 0.2,  c: 13.4 },
  yogurt:      { n: 'ヨーグルト(プレーン)', u: 'g', kcal: 56,  p: 3.6,  f: 3.0,  c: 4.9 },
  banana:      { n: 'バナナ',            u: 'g',  kcal: 93,  p: 1.1,  f: 0.2,  c: 22.5 },
  blueberry:   { n: 'ブルーベリー',      u: 'g',  kcal: 48,  p: 0.5,  f: 0.1,  c: 12.9 },
  honey:       { n: 'はちみつ',          u: 'g',  kcal: 329, p: 0.3,  f: 0,    c: 81.9 },
  coffee:      { n: 'コーヒー(粉)',      u: 'g',  kcal: 4,   p: 0.2,  f: 0,    c: 0.7 },
  creatine:    { n: 'クレアチン',        u: 'g',  kcal: 0,   p: 0,    f: 0,    c: 0 },
  whey:        { n: 'プロテイン(WPC)',   u: 'g',  kcal: 384, p: 80,   f: 5,    c: 7 },
  pocari:      { n: '粉ポカリ(1L分)',    u: '袋', kcal: 250, p: 0,    f: 0,    c: 62, unitG: 1 },
  natto:       { n: '納豆',              u: 'g',  kcal: 190, p: 16.5, f: 10.0, c: 12.1 },
  egg:         { n: 'ゆで卵',            u: 'g',  kcal: 134, p: 12.5, f: 10.4, c: 0.3 },
  saba:        { n: 'サバ水煮缶',        u: '缶', kcal: 330, p: 30,   f: 22,   c: 0.6, unitG: 1 },
  satsumaimo:  { n: 'さつまいも(蒸し)',  u: 'g',  kcal: 129, p: 0.9,  f: 0.2,  c: 31.9 },
  maitake:     { n: '舞茸',              u: 'g',  kcal: 22,  p: 2.0,  f: 0.5,  c: 4.4 },
  spinach:     { n: 'ほうれん草',        u: 'g',  kcal: 18,  p: 2.2,  f: 0.4,  c: 3.1 },
  broccoli:    { n: 'ブロッコリー',      u: 'g',  kcal: 37,  p: 5.4,  f: 0.6,  c: 6.6 },
  tomatocan:   { n: 'トマト缶',          u: 'g',  kcal: 20,  p: 0.9,  f: 0.2,  c: 4.4 },
  currypowder: { n: 'カレー粉',          u: 'g',  kcal: 415, p: 13.0, f: 12.2, c: 63.3 },
  chicken:     { n: '鶏胸肉(皮なし・生)', u: 'g', kcal: 105, p: 23.3, f: 1.9,  c: 0.1 },
  garlic:      { n: 'にんにく',          u: 'g',  kcal: 129, p: 6.4,  f: 0.9,  c: 27.5 },
  soysauce:    { n: '醤油(濃口)',        u: 'g',  kcal: 77,  p: 7.7,  f: 0,    c: 7.9 },
  consomme:    { n: 'コンソメ(顆粒)',    u: 'g',  kcal: 233, p: 12.0, f: 4.3,  c: 41.8 },
  rice:        { n: '米(精白米・生)',    u: 'g',  kcal: 342, p: 6.1,  f: 0.9,  c: 77.1 },
  wakame:      { n: '乾燥わかめ',        u: 'g',  kcal: 117, p: 13.6, f: 1.6,  c: 41.3 },
  // 予備
  oikos:       { n: 'ギリシャヨーグルト', u: 'g', kcal: 66,  p: 10.2, f: 0,    c: 5.6 },
  oatmeal:     { n: 'オートミール',      u: 'g',  kcal: 350, p: 13.7, f: 5.7,  c: 69.1 },
  whitefish:   { n: '白身魚',            u: 'g',  kcal: 90,  p: 19,   f: 1,    c: 0 },
  beefred:     { n: '牛赤身',            u: 'g',  kcal: 140, p: 21,   f: 5.5,  c: 0.3 },
  oliveoil:    { n: 'オリーブオイル',    u: 'g',  kcal: 894, p: 0,    f: 100,  c: 0 },
  almond:      { n: 'アーモンド',        u: 'g',  kcal: 609, p: 19.6, f: 51.8, c: 20.9 }
};

/* ===== 食事プリセット ===== */
const MEAL_PRESETS = [
  {
    id: 'breakfast', n: '朝（スムージー）', icon: '☀',
    items: [
      { fid: 'milk', g: 250 }, { fid: 'kiwi', g: 85 }, { fid: 'yogurt', g: 20 },
      { fid: 'banana', g: 90 }, { fid: 'blueberry', g: 30 }, { fid: 'honey', g: 15 },
      { fid: 'coffee', g: 8 }, { fid: 'creatine', g: 8 }, { fid: 'whey', g: 30 }
    ]
  },
  { id: 'intra', n: 'トレ中', icon: '⚡', items: [{ fid: 'pocari', g: 1 }] },
  {
    id: 'lunch', n: '昼', icon: '🍠',
    items: [
      { fid: 'natto', g: 45 }, { fid: 'egg', g: 150 }, { fid: 'saba', g: 1 }, { fid: 'satsumaimo', g: 375 }
    ]
  },
  {
    id: 'dinner', n: '夜（無水カレー）', icon: '🍛',
    note: '6食分レシピの1/6 ＋ 米1合',
    items: [
      { fid: 'chicken', g: 333 }, { fid: 'tomatocan', g: 133 }, { fid: 'maitake', g: 50 },
      { fid: 'spinach', g: 50 }, { fid: 'broccoli', g: 50 }, { fid: 'currypowder', g: 4 },
      { fid: 'garlic', g: 5 }, { fid: 'soysauce', g: 6 }, { fid: 'consomme', g: 1.7 },
      { fid: 'rice', g: 150 }, { fid: 'wakame', g: 2 }
    ]
  }
];

/* 無水カレー 6食分の買い物リスト（表示用） */
const CURRY_RECIPE = {
  n: '無水カレー（6食分）',
  lines: [
    '鶏胸肉（皮なし） 2kg',
    'トマト缶 2缶',
    '舞茸 300g / ほうれん草 300g / ブロッコリー 300g',
    'カレー粉 大さじ4',
    'にんにく 15cm',
    '醤油 大さじ2 / コンソメ 小さじ4',
    '米 1合（1食あたり） / 乾燥わかめ 適量'
  ]
};
