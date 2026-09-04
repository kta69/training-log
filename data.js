/* ===== 種目データ =====
   t: 目標レップ / e: 片側(each) / s: マシン設定(椅子高さ等)
   bw: 自重種目 / sets: 既定のセット数（未指定は2）
   alts: 代替種目
*/
const ex = (id, name, o = {}) => ({
  id, name,
  target: o.t ?? 6,
  each: !!o.e,
  setting: o.s || '',
  bw: !!o.bw,
  sets: o.sets ?? 2,
  note: o.note || '',
  alts: (o.alts || [])
});

const PROGRAM = [
  {
    id: 'day1', name: 'Day 1', sub: '胸・背中・腕',
    warmup: ['Y Raise', 'Arm bar push'],
    items: [
      ex('bench', 'Bench Press', { s: '8-4', t: 6 }),
      ex('pullup', 'Pull Up', { t: 6, note: '加重',
        alts: [ex('npullup', 'N Pull Up', { t: 6 })] }),
      ex('dbinclpress', 'DB Incline Press', { t: 6,
        alts: [
          ex('inclpress', 'Incline Press', { s: '5.5', e: 1, t: 6 }),
          ex('inclmachpress', 'Incline Machine Press', { s: '1', e: 1, t: 6 })
        ] }),
      ex('pulleyrow', 'Pulley Row', { t: 6,
        alts: [
          ex('sapulleyrow', 'SA Pulley Row', { e: 1, t: 6 }),
          ex('machrow1', 'Machine Row', { s: '4', e: 1, t: 6 })
        ] }),
      ex('dips', 'Dips', { t: 6, note: '加重' }),
      ex('preachercurl', 'Preacher Curl', { t: 8,
        alts: [ex('dbpreachercurl', 'DB Preacher Curl', { e: 1, t: 6 })] }),
      ex('abroller1', 'Ab Roller', { bw: 1, t: 0, sets: 1 })
    ]
  },
  {
    id: 'day2', name: 'Day 2', sub: '脚・肩・腕',
    warmup: ['梨状筋ストレッチ', 'Clam Shell', 'Abd & Add'],
    items: [
      ex('backsq', 'Back SQ', { s: '13-4', t: 6 }),
      ex('militarypress', 'Military Press', { t: 6 }),
      ex('bulgariansq', 'Bulgarian SQ', { e: 1, t: 6,
        alts: [ex('reverselunge', 'Reverse Lunge', { e: 1, t: 5 })] }),
      ex('dbsideraise', 'DB Side Raise', { t: 8,
        alts: [ex('machsideraise', 'Machine Side Raise', { t: 8 })] }),
      ex('ezlyingtri', 'EZ Lying Tri Ex', { t: 8,
        alts: [ex('spsmithnarrow', 'SP Smith Narrow Press', { t: 6 })] }),
      ex('legex', 'Leg Ex', { t: 8,
        alts: [ex('sllegex', 'SL Leg Ex', { e: 1, t: 6 })] })
    ]
  },
  {
    id: 'day3', name: 'Day 3', sub: '胸・背中・腕',
    warmup: ['Y Raise (5) 6.8', 'Arm bar'],
    items: [
      ex('spsmithincl', 'SP Smith Incline Press (30°)', { t: 6,
        alts: [
          ex('smithincl', 'Smith Incline Press (30°)', { t: 6 }),
          ex('inclbench', 'Incline Bench Press (30°)', { t: 6 })
        ] }),
      ex('nulatpull', 'NU Lat Pull Down', { t: 6,
        alts: [ex('salatpull', 'SA Lat Pull Down', { e: 1, t: 6 })] }),
      ex('dbbench', 'DB Bench Press', { t: 6,
        alts: [ex('machchest', 'Machine Chest Press', { s: '6', t: 6 })] }),
      ex('machrow3', 'Machine Row', { t: 6,
        alts: [
          ex('tbarrow', 'T-Bar Row', { t: 6 }),
          ex('supportedbor', 'Supported BOR', { t: 6 })
        ] }),
      ex('abroller3', 'Ab Roller', { bw: 1, t: 0, sets: 1 }),
      ex('bbarmcurl', 'BB Arm Curl', { t: 8,
        alts: [ex('cablearmcurl', 'Cable Arm Curl', { t: 6 })] }),
      ex('tripushdown', 'Tri Push Down', { t: 8,
        alts: [ex('satripushdown', 'SA Tri Push Down', { e: 1, t: 6 })] })
    ]
  },
  {
    id: 'day4', name: 'Day 4', sub: '脚・肩・腕',
    warmup: ['梨状筋ストレッチ', 'Clam Shell', 'Abd & Add'],
    items: [
      ex('spsmithbacksq', 'SP Smith Back SQ', { t: 6 }),
      ex('spsmithmil', 'SP Smith Military Press', { t: 6,
        alts: [
          ex('smithmil', 'Smith Military Press', { s: '6', t: 6 }),
          ex('dbshoulderpress', 'DB Shoulder Press', { t: 6 }),
          ex('machshoulderpress', 'Machine Shoulder Press', { s: '4', t: 6 })
        ] }),
      ex('pendulumsq', 'Pendulum SQ', { t: 6,
        alts: [
          ex('hacksq', 'Hack SQ', { t: 6 }),
          ex('legpress', 'Leg Press', { t: 6 })
        ] }),
      ex('rdl', 'RDL', { t: 6,
        alts: [ex('slrdl', 'SL RDL', { e: 1, t: 6 })] }),
      ex('cablesideraise', 'Cable Side Raise', { s: '6', e: 1, t: 6,
        alts: [ex('cableuprightrow', 'Cable Upright Row', { e: 1, t: 6 })] }),
      ex('dbfrenchpress', 'DB French Press', { t: 8,
        alts: [ex('cablefrenchpress', 'Cable French Press', { s: '12', t: 8 })] }),
      ex('legcurlseated', 'Leg Curl (seated)', { t: 6,
        alts: [
          ex('legcurlprone', 'Leg Curl (prone)', { s: '3', t: 6 }),
          ex('sllegcurl', 'SL Leg Curl', { e: 1, t: 6 })
        ] })
    ]
  }
];
