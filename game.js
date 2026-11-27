
(function(){
"use strict";

/* ================= 画布 ================= */
var cvs = document.getElementById('game');
/* alpha:false 是可选优化：老浏览器会忽略这个选项（不会失败），但被插件禁用 Canvas 时会直接返回 null */
var ctx = null;
try { ctx = cvs.getContext('2d', { alpha: false }) || cvs.getContext('2d'); } catch(e){ ctx = null; }
if (!ctx){
  try{
    document.body.innerHTML = '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;'
      + 'padding:24px;text-align:center;font:14px/1.7 system-ui,sans-serif;color:#dfe9e6;background:#071012">'
      + '当前浏览器无法创建 Canvas 2D 画布，游戏不能运行。<br>请升级浏览器，或在设置里关闭「禁止画布/指纹追踪」类选项后刷新。</div>';
  }catch(e){}
  return;
}
var VW = 0, VH = 0, DPR = 1, VZ = 1, VWW = 0, VHH = 0, SAFE_T = 0, SAFE_B = 0, SAFE_L = 0, SAFE_R = 0;
var AUTOQ = {on:false, lv:0, slow:0, fast:0};
var vig = null, bgLayer = null;

var _lastVW = -1, _lastVH = -1, _lastDPR = -1, _lastUi = '';
var _lastRawDPR = -1;
function resize(){
  _lastRawDPR = window.devicePixelRatio || 1;
  var dprCap = (typeof S !== 'undefined' && S && S.set && S.set.quality === 'low') ? 1.5 : 2;
  /* 省电模式限了 30fps 但分辨率还是 2x，每帧像素量翻倍；压到 1x 才是真的省 */
  if (typeof S !== 'undefined' && S && S.set && S.set.eco) dprCap = Math.min(dprCap, 1.0);
  if (AUTOQ.lv === 1) dprCap = Math.min(dprCap, 1.3);
  if (AUTOQ.lv === 2) dprCap = Math.min(dprCap, 1.0);
  if (AUTOQ.lv >= 3) dprCap = Math.min(dprCap, 0.8);
  DPR = Math.min(window.devicePixelRatio || 1, dprCap);
  VW = window.innerWidth; VH = window.innerHeight;
  /* 画布是全屏的（viewport-fit=cover），刘海/灵动岛会盖住顶部 HUD，这里读出安全区高度给 HUD 让位 */
  var _cs = getComputedStyle(document.documentElement);
  SAFE_T = Math.min(64, parseFloat(_cs.getPropertyValue('--sat')) || 0);
  SAFE_B = Math.min(48, parseFloat(_cs.getPropertyValue('--sab')) || 0);
  /* 横屏时刘海/挖孔在左侧或右侧：HUD 必须让开，否则左上角的等级/血量会被直接压掉 */
  SAFE_L = Math.min(72, parseFloat(_cs.getPropertyValue('--sal')) || 0);
  SAFE_R = Math.min(72, parseFloat(_cs.getPropertyValue('--sar')) || 0);
  /* 低画质/省电：面板不再做实时模糊 */
  try {
    var lfx = !!(S && S.set && (S.set.quality === 'low' || S.set.eco));
    if (lfx !== !!document.body.classList.contains('lowfx')) document.body.classList.toggle('lowfx', lfx);
  } catch(e){}
  VZ = clamp(1, Math.min(VW, VH) / 520, 2.4);
  VWW = VW / VZ; VHH = VH / VZ;
  var ui = clamp(1, Math.min(VW*0.92/580, VH*0.88/560), 2.2);
  var uiS = ui.toFixed(3);
  if (uiS !== _lastUi){ document.documentElement.style.setProperty('--ui', uiS); _lastUi = uiS; }
  /* 地址栏伸缩会连续触发 resize：尺寸没真变就别重设画布、更别重烘背景层 */
  if (VW === _lastVW && VH === _lastVH && DPR === _lastDPR) return;
  _lastVW = VW; _lastVH = VH; _lastDPR = DPR;
  cvs.width = Math.round(VW*DPR); cvs.height = Math.round(VH*DPR);
  cvs.style.width = VW + 'px'; cvs.style.height = VH + 'px';
  buildVignette();
  _needDraw = 1;
}

/* ================= 皮肤（更换调色板即可整套换风格） ================= */
var SKIN_STORE = 'gz_skin';
var SKIN = 'huaxia';
try { var _sk = localStorage.getItem(SKIN_STORE); if (_sk === 'huaxia' || _sk === 'classic') SKIN = _sk; } catch(e){}
var PAL_ROWS = {
  classic: {bg0:'#050c0d', bgA:'#102a2c', bgB:'#0a1a1c', grid:'rgba(79,209,197,0.11)',
            cy:'#4fd1c5', cyRGB:'79,209,197', scout:'#8fd6a0', scoutRGB:'143,214,160',
            am:'#f0b429', amRGB:'240,180,41', amSoft:'#ffd166',
            ink:'#dfe9e6', inkRGB:'223,233,230', dim:'#8fa6a0', dimRGB:'143,166,160',
            red:'#ff6a4a', redRGB:'255,106,74',
            e1:'#8fbf6a', e2:'#e07a5f', e3:'#9aa7b1', e4:'#d96b8a', e5:'#c9d36a'},
  huaxia:  {bg0:'#0f0d0a', bgA:'#211d16', bgB:'#14110c', grid:'rgba(200,180,130,0.10)',
            cy:'#7fb3a0', cyRGB:'127,179,160', scout:'#a3b98a', scoutRGB:'163,185,138',
            am:'#d8b45c', amRGB:'216,180,92', amSoft:'#e8c87c',
            ink:'#f2e9d6', inkRGB:'242,233,214', dim:'#9a8e76', dimRGB:'154,142,118',
            red:'#c0392b', redRGB:'192,57,43',
            e1:'#8ba36a', e2:'#b5674a', e3:'#9a9484', e4:'#a35a70', e5:'#b7a25a'}
};
var P = PAL_ROWS[SKIN];
/* 颜色字符串缓存：每帧几十次拼接会产生大量垃圾，命中率很高 */
var _rgbaCache = Object.create(null), _rgbaN = 0;
function rgbaOf(rgb, a){
  /* 原来 key = rgb + '|' + a，每帧几十次拼接本身就在制造垃圾。
     改成两级表 + alpha 量化到 1/1000，纯数字 key，零字符串分配 */
  var m = _rgbaCache[rgb];
  if (!m){ m = _rgbaCache[rgb] = Object.create(null); }
  var q = Math.round(a * 1000);
  if (q < 0) q = 0; else if (q > 1000) q = 1000;
  var v = m[q];
  if (v === undefined){
    v = 'rgba(' + rgb + ',' + (q / 1000) + ')';
    if (_rgbaN < 1024){ m[q] = v; _rgbaN++; }
  }
  return v;
}
P.rgba = rgbaOf;
var THEME_CLASSIC = [
  {name:'苔原', tint:'rgba(20,64,54,0.16)',  fill:'rgba(22,42,42,0.5)',  line:'rgba(79,209,197,0.09)'},
  {name:'熔渣', tint:'rgba(92,34,16,0.20)',  fill:'rgba(54,26,18,0.55)', line:'rgba(255,138,80,0.10)'},
  {name:'冰原', tint:'rgba(24,50,84,0.20)',  fill:'rgba(20,34,52,0.55)', line:'rgba(143,176,194,0.10)'},
  {name:'虚空', tint:'rgba(46,24,66,0.22)',  fill:'rgba(34,24,46,0.55)', line:'rgba(190,140,255,0.10)'}
];
var THEME_HX = [
  {name:'青岚', tint:'rgba(38,70,52,0.16)',  fill:'rgba(28,40,32,0.50)', line:'rgba(200,180,130,0.09)'},
  {name:'丹霞', tint:'rgba(96,40,22,0.20)',  fill:'rgba(58,30,20,0.55)', line:P.rgba(P.amRGB,0.10)},
  {name:'寒潭', tint:'rgba(26,52,66,0.20)',  fill:'rgba(20,32,42,0.55)', line:'rgba(160,190,190,0.10)'},
  {name:'玄夜', tint:'rgba(40,28,48,0.22)', fill:'rgba(30,24,34,0.55)', line:'rgba(190,160,150,0.10)'}
];

function applySkin(){
  P = PAL_ROWS[SKIN] || PAL_ROWS.classic;
  P.rgba = rgbaOf;
  try { document.body.dataset.skin = SKIN; } catch(e){}
  THEME = (SKIN === 'huaxia' ? THEME_HX : THEME_CLASSIC);
  CHARS.vanguard.color = P.cy; CHARS.gunner.color = P.am; CHARS.scout.color = P.scout;
  EDEF.grunt.col = P.e1; EDEF.runner.col = P.e2; EDEF.tank.col = P.e3;
  EDEF.shooter.col = P.e4; EDEF.swarm.col = P.e5; EDEF.elite.col = P.am;
  /* 换肤色后这些缓存的渐变对象还带着旧调色板，不清掉会一直发光晕旧颜色 */
  drawPlayer._glow = null;
  if (G){ G.comboGrad = null; G.comboGradW = -1; }
  /* 敌人的 col 是在生成时拷进实例的：换皮肤后场上的旧怪还穿旧配色，
     和新刷出来的颜色混在一起很明显，这里按类型重新上一次色 */
  if (typeof G !== 'undefined' && G && G.enemies){
    for (var ei = 0; ei < G.enemies.length; ei++){
      var en = G.enemies[ei];
      if (en.boss || en.elite || en.mini) continue;
      var ed = EDEF[en.type];
      if (ed && ed.col) en.col = ed.col;
    }
  }
  buildVignette();
}

function buildVignette(){
  bgLayer = document.createElement('canvas');
  bgLayer.width = Math.max(1, Math.round(VW/2)); bgLayer.height = Math.max(1, Math.round(VH/2));
  var bc = bgLayer.getContext('2d');
  var bg2 = bc.createRadialGradient(bgLayer.width/2, bgLayer.height/2, 4,
                                    bgLayer.width/2, bgLayer.height/2, Math.max(bgLayer.width,bgLayer.height)*0.85);
  bg2.addColorStop(0,P.bgA);
  bg2.addColorStop(0.45,P.bgB);
  bg2.addColorStop(1,P.bg0);
  bc.fillStyle = bg2; bc.fillRect(0,0,bgLayer.width,bgLayer.height);
  /* 地貌底色是半透明全屏叠加，每帧合一次很贵（DPR=2 时更贵）；
     直接烘进这张半分辨率底图，只有换地貌/换皮/改窗口大小时才重建 */
  var bth = THEME[(typeof G !== 'undefined' && G && G.theme) || 0];
  if (bth){ bc.fillStyle = bth.tint; bc.fillRect(0,0,bgLayer.width,bgLayer.height); }
  vig = document.createElement('canvas');
  vig.width = Math.max(1, Math.round(VW/2)); vig.height = Math.max(1, Math.round(VH/2));
  var c = vig.getContext('2d');
  var g = c.createRadialGradient(vig.width/2, vig.height/2, Math.min(vig.width,vig.height)*0.42,
                                 vig.width/2, vig.height/2, Math.max(vig.width,vig.height)*0.78);
  g.addColorStop(0,'rgba(0,0,0,0)');
  g.addColorStop(1,'rgba(0,0,0,0.55)');
  c.fillStyle = g; c.fillRect(0,0,vig.width,vig.height);
}

/* ================= 配置表 ================= */
var CFG = { world:1600, waveLen:40, maxEnemies:300 };

var EDEF = {
  grunt:  {hp:9,   spd:80,  r:12, dmg:5,  col:'#8ba36a', xp:1, shape:'hex'},
  runner: {hp:6,   spd:152, r:10, dmg:4,  col:'#b5674a', xp:1, shape:'tri'},
  tank:   {hp:40,  spd:48,  r:20, dmg:9,  col:'#9a9484', xp:3, shape:'box'},
  shooter:{hp:16,  spd:58,  r:13, dmg:6,  col:'#a35a70', xp:2, shape:'dia', shoot:true},
  swarm:  {hp:4,   spd:128, r:7,  dmg:2,  col:'#b7a25a', xp:1, shape:'dot'},
  elite:  {hp:120, spd:66,  r:23, dmg:11, col:P.am, xp:8, shape:'box', shoot:true}
};


/* ================= 语言（自动跟随浏览器） ================= */
var LANG_PREF = null;
try { LANG_PREF = localStorage.getItem('gz_lang'); } catch(e){}
var EN_LANG = LANG_PREF ? (LANG_PREF === 'en') : !/^zh/i.test((navigator.language || navigator.userLanguage || 'zh'));
try { if (!LANG_PREF){ if (/[?&]lang=en/.test(location.search)) EN_LANG = true; if (/[?&]lang=zh/.test(location.search)) EN_LANG = false; } } catch(e){}



var UI_EN = null, EN_DATA = null, _enPackDone = 0;
/* 英文表放在页面里的 #enPack JSON 块里：中文模式下完全不解析、也不进混淆器，
   切到英文时第一次用到才 JSON.parse 一次 */
function ensureEN(){
  if (_enPackDone) return;
  _enPackDone = 1;
  try{
    var node = document.getElementById('enPack');
    var p = JSON.parse((node && node.textContent) || '{}');
    UI_EN = p.ui || {}; EN_DATA = p.en || {};
  }catch(e){ UI_EN = {}; EN_DATA = {}; }
}
var TXC = Object.create(null), TXN = 0;
function tx(v){
  if (!EN_LANG || v == null) return v;
  ensureEN();
  var t = String(v);
  if (!/[\u4e00-\u9fa5]/.test(t)) return v;
  var hit = TXC[t];
  if (hit !== undefined) return hit;
  if (UI_EN[t] !== undefined){ TXC[t] = UI_EN[t]; return UI_EN[t]; }
  t = t.replace(/^第\s*(\d+)\s*波$/, 'Wave $1')
       .replace(/^击杀\s*([\d,]+)$/, 'Kills $1')
       .replace(/^金币\s*([\d,.]+)$/, 'Gold $1')
       .replace(/^等级\s*(\d+)$/, 'Level $1')
       .replace(/^下一波\s*([\d.]+)s?/, 'Next wave $1s')
       .replace(/^Lv\s*(\d+)\s*/, 'Lv $1 ')
       .replace(/场上\s*/g, 'alive ')
       .replace(/减伤\s*/g, 'DR ')
       .replace(/暴击\s*/g, 'Crit ')
       .replace(/射速\s*/g, 'AS ')
       .replace(/异变\s*/g, 'Mutations ')
       .replace(/每日挑战\s*/g, 'Daily ')
       .replace(/最佳\s*/g, 'Best ')
       .replace(/继续上一局 · 第 /g, 'Continue · wave ')
       .replace(/生命/g, 'HP')
       .replace(/伤害/g, 'Damage')
       .replace(/移速/g, 'Speed')
       .replace(/护甲/g, 'Armor')
       .replace(/拾取/g, 'Pickup')
       .replace(/\u3000/g, '   ');
  if (TXN > 600){ TXC = Object.create(null); TXN = 0; }
  TXC[v] = t; TXN++;
  return t;
}



function localizeData(){
  if (!EN_LANG) return;
  ensureEN();
  function ap(arr, key){ var t = EN_DATA[key] || {}; for (var i=0;i<arr.length;i++){ var d = t[arr[i].id]; if (!d) continue; if (Array.isArray(d)){ arr[i].name = d[0]; if (d[1]) arr[i].desc = d[1]; } } }
  ap(UPG,'upg'); ap(EVO,'evo'); ap(MODS,'mods'); ap(SHOP_POOL,'shop'); ap(META,'meta'); ap(ACH,'ach');
  var ch = EN_DATA.chars; for (var ck in CHARS){ if (ch[ck]){ CHARS[ck].name = ch[ck][0]; CHARS[ck].desc = ch[ck][1]; } }
  for (var dk in DIFF){ if (EN_DATA.diff[dk]) DIFF[dk].name = EN_DATA.diff[dk]; }
  for (var bk=0; bk<BDEF.length; bk++){ var bd = EN_DATA.bdef[BDEF[bk].key]; if (bd){ BDEF[bk].name = bd[0]; BDEF[bk].desc = bd[1]; } }
  for (var ek in EDEF){ if (EN_DATA.edef[ek]) EDEF[ek].name = EN_DATA.edef[ek]; }
  for (var ti=0; ti<THEME.length; ti++){ if (EN_DATA.theme[ti]) THEME[ti].name = EN_DATA.theme[ti]; }
  var sc = {ball:['Ballistics','Projectiles +1, pierce +1, fire rate +20%','Ballistics Surge'],
            blast:['Blast','Hits splash 40% damage nearby','Fission Warhead'],
            field:['Field','Shock and burn radius +60%, regen +0.8','Field Resonance']};
  for (var sk in SCHOOLS){ if (sc[sk]){ SCHOOLS[sk].name = sc[sk][0]; SCHOOLS[sk].desc = sc[sk][1]; SCHOOLS[sk].title = sc[sk][2]; } }
}

/* ================= 界面英文化 ================= */
function localizeDOM(){
  if (!EN_LANG || !document.body) return;
  ensureEN();
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  var n, list = [];
  while ((n = walker.nextNode())){ if (/[\u4e00-\u9fa5]/.test(n.nodeValue)) list.push(n); }
  for (var i=0;i<list.length;i++){
    var raw = list[i].nodeValue, lead = (raw.match(/^\s*/) || [''])[0], tail = (raw.match(/\s*$/) || [''])[0];
    var core = raw.trim();
    if (!core || !/[\u4e00-\u9fa5]/.test(core)) continue;
    var out = UI_EN[core];
    if (out === undefined) out = tx(core);
    if (out !== core) list[i].nodeValue = lead + out + tail;
  }
  var btns = document.querySelectorAll('button,a,span.best');
  for (var b=0;b<btns.length;b++){
    var t2 = btns[b].textContent.trim();
    if (t2 && /[\u4e00-\u9fa5]/.test(t2) && UI_EN[t2] !== undefined && btns[b].children.length === 0) btns[b].textContent = UI_EN[t2];
  }
}

if (EN_LANG){
  document.documentElement.lang = 'en';
  var _ft = ctx.fillText;
  ctx.fillText = function(t, x, y, mw){ return _ft.call(ctx, tx(t), x, y, mw); };
  var boot = function(){
    localizeData();
    var br = document.getElementById('brand');
    if (br) br.innerHTML = 'HORDE <span>Survivor</span>';
    localizeDOM();
  };
  if (document.readyState === 'complete') setTimeout(boot, 0);
  else window.addEventListener('load', boot);
  setTimeout(boot, 0);
  setInterval(function(){ if (EN_LANG && !document.hidden) localizeDOM(); }, 1500);
}

var THEME = [
  {name:'青岚', tint:'rgba(38,70,52,0.16)',  fill:'rgba(28,40,32,0.50)', line:'rgba(200,180,130,0.09)'},
  {name:'丹霞', tint:'rgba(96,40,22,0.20)',  fill:'rgba(58,30,20,0.55)', line:P.rgba(P.amRGB,0.10)},
  {name:'寒潭', tint:'rgba(26,52,66,0.20)',  fill:'rgba(20,32,42,0.55)', line:'rgba(160,190,190,0.10)'},
  {name:'玄夜', tint:'rgba(40,28,48,0.22)',  fill:'rgba(30,24,34,0.55)', line:'rgba(190,160,150,0.10)'}
];

var BDEF = [
  {key:'crush',  name:'碾碎者', hp:860,  spd:46, r:42, dmg:26, col:P.red, pattern:'fan',    interval:2.0, desc:'正面扇形炮击，逼你绕后。'},
  {key:'hatch',  name:'孵化者', hp:1000, spd:34, r:44, dmg:22, col:'#6aa9ff', pattern:'summon', interval:2.6, desc:'不断生出小怪，拖久了会被围死。'},
  {key:'lancer', name:'裂地者', hp:940,  spd:62, r:38, dmg:30, col:'#b5563a', pattern:'dash',   interval:3.0, desc:'周期性俯冲撞击，注意横向拉扯。'}
];

var UPG = [
  {id:'dmg',    name:'重型弹头', desc:'全部伤害 +25%（加法叠加）', max:12, apply:function(p){p.dmgAdd+=0.25;}},
  {id:'rate',   name:'快速扳机', desc:'射速 +22%',                     max:12, apply:function(p){p.rate*=1.22;}},
  {id:'shot',   name:'多管齐射', desc:'每次射击 +1 发弹丸',             max:5, apply:function(p){p.shots++;}},
  {id:'pierce', name:'穿甲弹芯', desc:'弹丸穿透 +1 个敌人',             max:5, apply:function(p){p.pierce++;}},
  {id:'spd',    name:'轻量装甲', desc:'移动速度 +12%',                  max:8, apply:function(p){p.spd*=1.12;}},
  {id:'hp',     name:'强化装甲', desc:'生命上限 +40 并立即回复',        max:8, apply:function(p){p.hpMax+=40;p.hp+=40;}},
  {id:'regen',  name:'自愈模块', desc:'每秒回复 +0.9 生命',             max:7, apply:function(p){p.regen+=0.9;}},
  {id:'crit',   name:'弱点洞察', desc:'暴击率 +10%，暴击伤害 +10%',     max:8, apply:function(p){p.crit+=0.10;p.cmul+=0.10;}},
  {id:'collect',name:'磁力回收', desc:'经验拾取范围 +35%',              max:6, apply:function(p){p.collect*=1.35;}},
  {id:'range',  name:'远距校准', desc:'射程 +20%，弹速 +15%',           max:6, apply:function(p){p.rng*=1.2;p.pbs*=1.15;}},
  {id:'shock',  name:'冲击发生器',desc:'每 3.5 秒释放一次环形冲击',      max:4, apply:function(p){p.shock++;}},
  {id:'aura',   name:'灼烧领域', desc:'身边持续灼烧贴近的敌人',          max:4, apply:function(p){p.aura++;}},
  {id:'armor',  name:'复合涂层', desc:'护甲 +10%（减伤收益递减）',       max:6, apply:function(p){p.armor+=0.10;}},
  {id:'core',   name:'资源回收', desc:'本局星核收益 +20%',              max:4, apply:function(p){p.coreGain+=0.2;}},
  {id:'luck',   name:'幸运齿轮', desc:'补给掉落概率 +6%',               max:4, apply:function(p){p.luck+=0.06;}},
  {id:'heal',   name:'战场急救', desc:'立即回复 45% 生命',              max:0, apply:function(p){p.hp=Math.min(p.hpMax,p.hp+p.hpMax*0.45);}},
  /* 稀有卡：第 8 波后、12 级后才进池，用代价换更高的上限 */
  {id:'over',   name:'过载核心', desc:'伤害 +30%、射速 +18%，代价是生命上限 -12%', max:2, rare:true,
   apply:function(p){p.dmgAdd+=0.30;p.rate*=1.18;p.hpMax=Math.max(40,Math.round(p.hpMax*0.88));p.hp=Math.min(p.hp,p.hpMax);}},
  {id:'wing',   name:'双翼齐射', desc:'每次射击 +2 发弹丸，射速 -15%', max:2, rare:true,
   apply:function(p){p.shots+=2;p.rate*=0.85;}},
  {id:'vein',   name:'星核矿脉', desc:'本局星核结算收益 +35%（可叠加）', max:2, rare:true,
   apply:function(p){p.coreGain+=0.35;}}
];

/* 双卡合成进化：两张卡各达到 req 级后必定出现 */
var EVO = [
  {id:'evo_a', name:'湮灭弹头', need:['dmg','crit'],  req:3, desc:'重型弹头 + 弱点洞察 → 伤害 +60%，暴击 +15%',
   apply:function(p){p.dmgAdd+=0.6;p.crit+=0.15;p.cmul+=0.2;}},
  {id:'evo_b', name:'散射风暴', need:['shot','pierce'], req:3, desc:'多管齐射 + 穿甲弹芯 → 弹丸 +2，穿透 +2',
   apply:function(p){p.shots+=2;p.pierce+=2;}},
  {id:'evo_c', name:'领域超载', need:['shock','aura'], req:3, desc:'冲击发生器 + 灼烧领域 → 范围翻倍，伤害 +40%',
   apply:function(p){p.dmg*=1.4;p.shock*=2;p.aura*=2;}},
  {id:'evo_d', name:'穿云弹道', need:['range','rate'], req:3, desc:'远距校准 + 快速扳机 → 射程 +30%，射速 +30%',
   apply:function(p){p.rng*=1.3;p.pbs*=1.25;p.rate*=1.3;}},
  {id:'evo_e', name:'钢铁壁垒', need:['hp','armor'],  req:3, desc:'强化装甲 + 复合涂层 → 上限 +60，减伤 +12%',
   apply:function(p){p.hpMax+=60;p.hp+=60;p.armor+=0.12;}},
  {id:'evo_f', name:'嗜血回收', need:['collect','regen'], req:3, desc:'磁力回收 + 自愈模块 → 拾取 +70%，回复 +1.5',
   apply:function(p){p.collect*=1.7;p.regen+=1.5;}}
];

/* 同系三张 → 质变（不占卡位，自动触发） */
var SCHOOL_OF = {dmg:'blast', crit:'blast', shock:'blast', rate:'ball', shot:'ball', pierce:'ball', range:'ball',
                 regen:'field', aura:'field', armor:'field'};
for (var su=0; su<UPG.length; su++) UPG[su].school = SCHOOL_OF[UPG[su].id] || null;

var SCHOOLS = {
  ball: {name:'弹道', need:3, title:'弹幕质变',
         desc:'弹丸 +1、穿透 +1、射速 +20%',
         apply:function(p){p.shots+=1;p.pierce+=1;p.rate*=1.2;}},
  blast:{name:'爆裂', need:3, title:'裂变弹头',
         desc:'命中时对周围敌人溅射 40% 伤害',
         apply:function(p){p.splash=(p.splash||0)+0.4;}},
  field:{name:'领域', need:3, title:'领域共振',
         desc:'冲击与灼烧范围 +60%，秒回 +0.8',
         apply:function(p){p.shock*=1.6;p.aura*=1.6;p.regen+=0.8;}}
};

var MODS = [
  {id:'fog',   name:'雾潮',    tip:'视野压缩，怪物从暗处涌来'},
  {id:'gem',   name:'结晶雨',  tip:'晶体成片落下，本波升级飞快'},
  {id:'air',   name:'补给空投', tip:'怪物变少，补给与金币翻倍'},
  {id:'elite', name:'精英潮',  tip:'只出精英与重甲，击杀额外星核'},
  {id:'hunter',name:'追猎者',  tip:'一只杀不死的猎手持续逼近'},
  {id:'zone',  name:'收缩毒圈', tip:'安全区不断缩小，出界持续掉血'},
  {id:'hold',  name:'战线守护', tip:'守住中央发生器，离场超过 5 秒即失守'},
  {id:'storm', name:'静电风暴', tip:'射速 +40%、射程 -30%、弹道随机偏转'},
  {id:'reso',  name:'同系共鸣', tip:'某一系强化权重翻倍，质变只需 2 张'},
  {id:'twin',  name:'双生首领', tip:'两只弱化首领同时压场'},
  {id:'bloodmoon', name:'血月', tip:'敌人伤害 +40%，金币 ×3'},
  {id:'swift', name:'疾行潮',  tip:'敌人移速 +35%，经验 ×1.6'},
  {id:'meteor',name:'陨石雨',  tip:'陨石连续砸落，命中范围敌人'},
  {id:'magnet',name:'磁力过载', tip:'拾取范围 ×3，晶体落地即吸附'},
  {id:'split', name:'分裂体',  tip:'普通怪死亡 30% 分裂成两只小虫'},
  {id:'hunt',  name:'精英围猎', tip:'每 7 秒刷出一只强化精英'},
  {id:'rush',  name:'铁壁潮',  tip:'敌人数量减少，血量 +60%'},
  {id:'greed', name:'贪欲',    tip:'金币 ×2，敌人血量 +25%'},
  {id:'barrage', name:'弹幕压制', tip:'敌方远程射速 +70%、弹速 +25%'},
  {id:'gravity', name:'重力井',  tip:'你的移速 -20%，但攻击力 +35%'},
  {id:'echo',   name:'回响弹',  tip:'每发子弹有 20% 概率额外射出一发'},
  {id:'thunder',name:'链电',    tip:'每 2.2 秒落下一道闪电，连锁 3 个目标'},
  {id:'famine', name:'饥荒',    tip:'经验 -40%，金币 +40%'},
  {id:'brittle',name:'脆甲',    tip:'护甲 -35%，移速 +15%、射速 +10%'},
  {id:'phantom',name:'虚影',    tip:'每 6 秒进入 0.9 秒无敌'},
  {id:'siege',  name:'围城',    tip:'敌人数量 +45%，但血量 -15%'},
  {id:'armored', name:'铁甲潮',  tip:'所有敌人受到的伤害 -25%'},
  {id:'frenzy',  name:'濒死狂化', tip:'敌人血量低于 35% 时移速 +50%'},
  {id:'sniper',  name:'狙击手',  tip:'远程敌人弹速 +60%、伤害 +35%'},
  {id:'swarmlord',name:'虫群领主', tip:'每波额外刷出 6 只小怪'},
  {id:'noheal',  name:'绝疗',    tip:'治疗掉落 -70%，所有回血 -40%'},
  {id:'bossrage',name:'首领狂怒', tip:'首领攻速 +25%、伤害 +25%'},
  {id:'pact',    name:'血债',    tip:'伤害 +50%，生命上限 -20%'},
  {id:'shadow',  name:'疾影',    tip:'移速 +35%，护甲 -50%'},
  {id:'greedpact',name:'贪婪契约', tip:'金币 ×3，经验 -35%'},
  {id:'allin',   name:'孤注',    tip:'射速 +60%，受到的伤害 +30%'}
];

var SHOP_POOL = [
  {id:'med',    name:'急救包',   base:26, desc:'缺血越多补得越多；满血只补 20%，价格也减半',
   apply:function(p){ var miss = Math.min(1, Math.max(0, 1 - p.hp/(p.hpMax||1))); p.hp = Math.min(p.hpMax, p.hp + p.hpMax*(0.2 + 0.3*miss)); }},
  {id:'plate',  name:'装甲板',   base:32, desc:'生命上限 +30，并回满这部分',    apply:function(p){p.hpMax+=30;p.hp+=30;}},
  {id:'ammo',   name:'弹头校准', base:38, desc:'全部伤害 +12%',                apply:function(p){p.dmgAdd+=0.12;}},
  {id:'loader', name:'快速装填', base:38, desc:'射速 +10%',                    apply:function(p){p.rate*=1.1;}},
  {id:'magnet', name:'磁力核心', base:26, desc:'拾取范围 +30%',                apply:function(p){p.collect*=1.3;}},
  {id:'boots',  name:'轻装鞋',   base:30, desc:'移动速度 +8%',                 apply:function(p){p.spd*=1.08;}},
  {id:'luck',   name:'幸运护符', base:28, desc:'补给掉落概率 +6%',            apply:function(p){p.luck+=0.06;}},
  {id:'reroll', name:'战术重抽', base:24, desc:'每级重抽次数永久 +1',        apply:function(p){G.rerollExtra=(G.rerollExtra||0)+1; G.rerolls++;}},
  {id:'shock',  name:'冲击电容', base:44, desc:'冲击发生器 +1 级',             apply:function(p){p.shock++;}},
  {id:'aura',   name:'灼烧核心', base:44, desc:'灼烧领域 +1 级',               apply:function(p){p.aura++;}}
];

var META = [
  {id:'power',  name:'动能校准', desc:'全部伤害 +5%',        max:10, cost:60},
  {id:'vigor',  name:'结构加固', desc:'生命上限 +12',        max:10, cost:55},
  {id:'swift',  name:'步频优化', desc:'移动速度 +3%',        max:8,  cost:70},
  {id:'magnet', name:'磁力线圈', desc:'拾取范围 +6%',        max:6,  cost:80},
  {id:'focus',  name:'目标锁定', desc:'暴击率 +2%',          max:6,  cost:95},
  {id:'fortune',name:'资源回收', desc:'星核获取 +10%',       max:6,  cost:110},
  {id:'armor',  name:'复合涂层', desc:'护甲 +3%（减伤收益递减）', max:6, cost:130}
];

var CHARS = {
  vanguard:{key:'vanguard', name:'先锋',   desc:'均衡型：生命、火力、机动都在平均线上，适合第一次出战。', hp:130, dmg:13, rate:2.4,  spd:255, collect:74,  shots:2, color:P.cy, cost:0},
  gunner:  {key:'gunner',   name:'炮手',   desc:'高单发伤害、低射速、血薄，需要用走位换取输出窗口。',   hp:100, dmg:19, rate:1.75, spd:245, collect:70,  shots:2, color:P.am, cost:900},
  scout:   {key:'scout',    name:'侦察兵', desc:'移速与拾取范围极高，靠吃满经验快速滚雪球，但很脆。',   hp:110, dmg:12, rate:2.6,  spd:305, collect:112, shots:2, color:P.scout, cost:1600}
};

var DIFF = {
  easy:     {key:'easy',      name:'休闲', hpMul:0.80, rateMul:0.82, reward:0.70},
  normal:   {key:'normal',    name:'普通', hpMul:1.00, rateMul:1.00, reward:1.0},
  hard:     {key:'hard',      name:'困难', hpMul:1.32, rateMul:1.28, reward:1.6},
  nightmare:{key:'nightmare', name:'噩梦', hpMul:1.75, rateMul:1.55, reward:2.3},
  inferno:  {key:'inferno',   name:'地狱', hpMul:2.20, rateMul:1.90, reward:3.2}
};

var ACH = [
  {id:'first', name:'第一次活下来', desc:'完成一局游戏',        check:function(s){return s.stats.runs >= 1;}},
  {id:'w10',   name:'十波老手',     desc:'单局撑过 10 波',      check:function(s){return s.best.wave >= 10;}},
  {id:'w20',   name:'二十波怪物',   desc:'单局撑过 20 波',      check:function(s){return s.best.wave >= 20;}},
  {id:'k500',  name:'清场专家',     desc:'单局击杀 500 只',     check:function(s){return s.best.kills >= 500;}},
  {id:'boss3', name:'首领终结者',   desc:'击败全部 3 种首领',   check:function(s){var b=s.stats.bosses; return !!(b.crush&&b.hatch&&b.lancer);}},
  {id:'total', name:'长期战线',     desc:'累计击杀 3000 只',    check:function(s){return s.stats.kills >= 3000;}},
  {id:'lv15',  name:'进化完成',     desc:'单局升到 15 级',      check:function(s){return s.stats.maxLevel >= 15;}},
  {id:'allch', name:'全员集结',     desc:'解锁全部角色',        check:function(s){return !!(s.chars.gunner && s.chars.scout);}}
];

/* ================= 存档 ================= */
var SAVE_KEY = 'gz_survivor_v2';
var S = null;

function defaultSave(){
  return {
    core:0,
    v:2,
    best:{wave:0, time:0, kills:0},
    runs:[],
    stats:{runs:0, kills:0, maxLevel:1, bosses:{crush:false, hatch:false, lancer:false}},
    up:{}, chars:{vanguard:true}, char:'vanguard', diff:'normal',
    set:{sfx:true, bgm:true, bgmSet:false, vib:true, quality:'high', stick:'fixed', speed:1, cycle:1, keys:'both', volHit:0.8, perf:false, shakeOff:false},
    ach:{}, tutorial:false, modSeen:{}, modBest:{}, daily:{date:'', best:0}, vol:0.8, volBgm:0.8, padSens:1,
    hudInfo:true, eco:false,
    pickStats:{}, bossBook:{}, checkpoint:null, autoResume:false, lastRescue:0,
    quests:{date:'', runs:0, boss:0, best:0, paid:{}}
  };
}

function loadSave(){
  var base = defaultSave();
  try{
    var raw = localStorage.getItem(SAVE_KEY);
    if (raw){
      var d = JSON.parse(raw);
      if (d && typeof d === 'object' && d.v === undefined){
        try{ localStorage.setItem(SAVE_KEY + '_v1bak', raw); }catch(e){}
        d.v = 2;
      }
      for (var k in base){
        if (d[k] === undefined) continue;
        if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && k !== 'best'){
          var dv = d[k];
          /* 存档里这个键被写成 null / 数字 / 字符串时，直接拿它去下钻会抛异常，
             整段 try 吞掉后等于把全部进度清空，所以坏字段一律保留默认 */
          if (!dv || typeof dv !== 'object' || Array.isArray(dv)) continue;
          for (var k2 in base[k]){ if (dv[k2] === undefined) dv[k2] = base[k][k2]; }
          base[k] = dv;
        } else {
          base[k] = d[k];
        }
      }
      /* 主存档可用时清掉旧版备份，避免长期占配额 */
      try{ if (raw.length > 60000) localStorage.removeItem(SAVE_KEY + '_v1bak'); }catch(e){}
    }
  }catch(e){}
  S = base;
  if (!S.up) S.up = {};
  if (!S.ach) S.ach = {};
  if (!Array.isArray(S.runs)) S.runs = [];
  if (!S.modSeen) S.modSeen = {};
  if (!S.daily) S.daily = {date:'', best:0};
  if (typeof S.set.vol !== 'number') S.set.vol = 0.8;
  if (typeof S.set.volBgm !== 'number') S.set.volBgm = 0.8;
  if (!S.pickStats) S.pickStats = {};
  if (typeof S.set.hudInfo !== 'boolean') S.set.hudInfo = true;
  /* 系统开启"减少动态效果"（前庭/晕动症用户常开）时，屏幕震动默认关闭，可在设置里改回来 */
  if (typeof S.set.shakeOff !== 'boolean'){
    var _rm = false;
    try{ _rm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }catch(e){}
    S.set.shakeOff = _rm;
  }
  if (typeof S.set.eco !== 'boolean') S.set.eco = false;
  if (!S.bossBook) S.bossBook = {};
  if (!S.quests) S.quests = {date:'', runs:0, boss:0, best:0, paid:{}};
  if (!S.stats || typeof S.stats !== 'object') S.stats = {runs:0, kills:0, maxLevel:1, bosses:{}};
  if (!S.stats.bosses) S.stats.bosses = {crush:false, hatch:false, lancer:false};
  /* 关键数值被写坏（NaN/字符串）时，后面 Math.max/min 会一路传毒，这里统一收口 */
  var _nf = function(o, key, dflt){ if (typeof o[key] !== 'number' || !isFinite(o[key])) o[key] = dflt; };
  _nf(S.set, 'cycle', 1); _nf(S.set, 'speed', 1); _nf(S.set, 'volHit', 0.8);
  if (S.set.cycle < 1) S.set.cycle = 1;
  _nf(S, 'vol', 0.8); _nf(S, 'volBgm', 0.8); _nf(S, 'padSens', 1); _nf(S, 'core', 0);
  if (S.best && typeof S.best === 'object'){ _nf(S.best,'wave',0); _nf(S.best,'time',0); _nf(S.best,'kills',0); }
  else S.best = {wave:0, time:0, kills:0};
  if (!S.bestByDiff || typeof S.bestByDiff !== 'object') S.bestByDiff = {};
  /* 难度收敛为 3 档：旧的困难/噩梦映射到现档位 */
  if (S.diff === 'hard') S.diff = 'normal';
  else if (S.diff === 'nightmare') S.diff = 'inferno';
  if (!DIFF[S.diff]) S.diff = 'normal';
}

function purgeBigCaches(){
  try{
    var ks = [], i;
    for (i=0;i<localStorage.length;i++){
      var k = localStorage.key(i);
      if (!k) continue;
      if (k.indexOf('gzpk_') === 0 || k === SAVE_KEY + '_v1bak') ks.push(k);
    }
    for (i=0;i<ks.length;i++) localStorage.removeItem(ks[i]);
  }catch(e){}
}
var _saveTimer = 0, _savePending = false;
/* 设置页每点一下、商店每刷一次都会连着触发存档。原来每次都同步 stringify + 写盘，
   短时间连点会明显卡一下；这里把 120ms 内的多次写盘合并，关键路径（结算/退出/切后台）仍走立即写 */
function saveNow(immediate){
  if (!immediate){
    if (_savePending) return;
    _savePending = true;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function(){ _savePending = false; saveNow(true); }, 120);
    return;
  }
  _savePending = false;
  clearTimeout(_saveTimer);
  saveNowReal();
}

var _saveWarned = false;
function saveNowReal(){
  S.v = 2;
  var txt = '';
  try{ txt = JSON.stringify(S); }catch(e){ return; }
  try{ localStorage.setItem(SAVE_KEY, txt); return; }catch(e){}
  /* 配额满：清缓存/旧备份后重试，仍不行就精简战绩再试 */
  purgeBigCaches();
  try{ localStorage.setItem(SAVE_KEY, txt); return; }catch(e){}
  try{
    if (S.runs && S.runs.length > 20) S.runs = S.runs.slice(0, 20);
    txt = JSON.stringify(S);
    localStorage.setItem(SAVE_KEY, txt);
    return;
  }catch(e){}
  /* 三次都写不进去：多半是无痕/隐私模式或站点存储被禁用。别静默失败，让玩家知道进度不会保存 */
  if (!_saveWarned){
    _saveWarned = true;
    try{ toast('本地存储不可用：本局进度不会保存，刷新后无法继续'); }catch(e){}
  }
}

/* ================= 音效 ================= */
var AU = {ctx:null, bgmTimer:null, step:0};
var BGM_NOTES = [396,0,440,0,349,0,392,0,330,0,392,0,294,0,330,0];

function audioCtx(){
  if (!AU.ctx){
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    AU.ctx = new AC();
  }
  if (AU.ctx.state === 'suspended'){ try{ AU.ctx.resume(); }catch(e){} }
  return AU.ctx;
}

var _toneLast = {t:0, f:0};

function tone(freq, dur, type, vol, music, hit){
  /* 开关统一在这里把住：sfx() 里有检查，但开局音、BGM 二次音这些直接调 tone 的地方会漏 */
  if (typeof S !== 'undefined' && S && S.set){
    if (music){ if (S.set.bgm === false) return; }
    else if (S.set.sfx === false) return;
  }
  var now = Date.now();
  if (Math.abs(freq - _toneLast.f) < 1 && now - _toneLast.t < 55) return;
  _toneLast.f = freq; _toneLast.t = now;
  var ac = audioCtx();
  if (!ac) return;
  try{
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    var mv = (S && S.set) ? (music ? (typeof S.set.volBgm === 'number' ? S.set.volBgm : 0.8)
                                   : (typeof S.set.vol === 'number' ? S.set.vol : 1)) : 1;
    if (hit && S && S.set && typeof S.set.volHit === 'number') mv *= S.set.volHit;
    var vv = (vol || 0.04) * mv;
    g.gain.value = Math.max(0.0001, vv);
    o.connect(g); g.connect(ac.destination);
    /* 播完主动断开：振荡器被 destination 引用，不 disconnect 会一直挂在音频图上 */
    o.onended = function(){ try{ o.disconnect(); g.disconnect(); }catch(e){} };
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.stop(ac.currentTime + dur + 0.02);
  }catch(e){}
}

var _sfxKillT = 0;   /* 连杀击杀音效的节流时间戳（必须声明，否则严格读未声明变量直接抛错） */
function sfx(kind){
  if (!S.set.sfx) return;
  if (G && G.speed >= 5 && (kind === 'shoot' || kind === 'kill')) return;
  if (kind === 'shoot')  tone(940, 0.035, 'square', 0.016);
  if (kind === 'kill'){
    /* 连杀时每秒几十次击杀，音效必须节流，否则每只怪都新建振荡器 */
    var kt = Date.now();
    if (kt - (_sfxKillT || 0) < 55) return;
    _sfxKillT = kt;
    tone(520 + Math.min(G.comboK || 0, 10)*22, 0.06, 'triangle', 0.025, false, true);
  }
  if (kind === 'killBig'){ tone(560, 0.16, 'triangle', 0.05, false, true); tone(300, 0.22, 'sine', 0.04, false, true); }
  if (kind === 'crit')    tone(900, 0.07, 'square', 0.03, false, true);
  if (kind === 'hurt')   tone(180, 0.09,  'sawtooth', 0.05);
  if (kind === 'level'){ tone(660, 0.12, 'sine', 0.06); setTimeout(function(){ tone(880, 0.14, 'sine', 0.06); }, 90); }
  if (kind === 'boss')   tone(110, 0.55,  'sawtooth', 0.07);
  if (kind === 'coin')   tone(1240, 0.05, 'sine', 0.03);
  if (kind === 'ui')     tone(640, 0.05, 'sine', 0.04);
  if (kind === 'revive'){ tone(300,0.18,'sine',0.06); setTimeout(function(){ tone(540,0.2,'sine',0.06); }, 140); }
}

function bgmApply(){
  if (AU.bgmTimer){ clearInterval(AU.bgmTimer); AU.bgmTimer = null; }
  if (!S.set.bgm) return;
  AU.step = 0;
  AU.bgmTimer = setInterval(function(){
    /* 暂停、升级弹窗、结算时把节拍挂起，别在面板背后继续演奏 */
    if (G && G.state && G.state !== 'playing') return;
    var tense = !!(G && G.boss);
    var low = !!(G && G.player && G.player.hp < G.player.hpMax*0.3);
    var arr = tense ? [262,0,247,0,233,0,247,0] : BGM_NOTES;
    var f = arr[AU.step % arr.length];
    AU.step++;
    if (f) tone(f * (tense ? 0.5 : 1) * (low ? 0.55 : 1), 0.85, 'sine', 0.028, true);
    if (AU.step % 8 === 0) tone(low ? 84 : 196, 1.6, 'triangle', 0.012, true);
  }, 900);
}

var SRC_NAME = {swarm:'虫群', grunt:'爬行者', runner:'疾行虫', tank:'重甲兽', shooter:'吐酸者', elite:'精英', boss:'首领', hunter:'猎手', zone:'毒圈', hold:'发生器'};

/* ================= 工具 ================= */
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
/* 金币内部允许小数（异变倍率会产出 1.4 枚），显示与花钱判断统一向下取整 */
function coinNow(){ var c = G && G.coins ? G.coins : 0; return Math.floor(c + 1e-9); }
function rnd(a,b){ return a + Math.random()*(b-a); }
function dist2(ax,ay,bx,by){ var dx=ax-bx, dy=ay-by; return dx*dx + dy*dy; }
/* toLocaleString 在手机上很贵且 HUD 每帧都要调用，这里手写千分位 */
var _fmtIn = null, _fmtOut = '0';
function fmt(n){
  n = Math.round(n);
  if (!isFinite(n)) return '0';
  if (n === _fmtIn) return _fmtOut;
  var _raw = n;
  var neg = n < 0; if (neg) n = -n;
  var str = '' + n, out = '', cnt = 0;
  for (var i=str.length-1; i>=0; i--){
    out = str.charAt(i) + out;
    if (++cnt % 3 === 0 && i > 0) out = ',' + out;
  }
  _fmtIn = (neg ? -_raw : _raw);
  _fmtOut = _fmtIn < 0 ? ('-' + out) : out;
  return _fmtOut;
}

/* 结算页一行要放得下：上万的数改写成"2.4万 / 1.0亿"，避免被折成第三行 */
function kfmt(n){
  n = Math.round(n);
  if (!isFinite(n) || n <= 0) return '0';
  if (n >= 1e8) return (n/1e8).toFixed(1).replace(/\.0$/, '') + '亿';
  if (n >= 1e4) return (n/1e4).toFixed(1).replace(/\.0$/, '') + '万';
  return fmt(n);
}

/* ================= 局内状态 ================= */
var G = null;
var keys = {};
var JOY = {active:false, id:null, bx:0, by:0, dx:0, dy:0, tx:0, ty:0};

function newGame(){
  /* 模块级异变标志是新局最容易漏刷的一处：不清就等于继承上一局的判定 */
  MODF.armored = false; MODF.swift = false; MODF.famine = false; COINMUL = 1;
  var ch = CHARS[S.char] || CHARS.vanguard;
  var m = S.up || {};

  var p = {
    x:0, y:0, r:14,
    spd: ch.spd * (1 + 0.03*(m.swift||0)),
    hpMax: ch.hp + 12*(m.vigor||0), hp: ch.hp + 12*(m.vigor||0),
    regen:0, regenBoost:0, armor: 0.03*(m.armor||0),
    dmg: ch.dmg * (1 + 0.05*(m.power||0)), dmgAdd:0,
    rate: ch.rate, cd:0,
    shots: ch.shots, pierce:0, pbs:1250, rng:Math.max(175, Math.min(430, Math.min(VWW||VW,VHH||VH)*0.52)),
    crit: 0.05 + 0.02*(m.focus||0), cmul:1.9,
    collect: ch.collect * (1 + 0.06*(m.magnet||0)),
    coreGain: 1 + 0.10*(m.fortune||0),
    luck:0,
    vx:0, vy:0, smvx:0, smvy:0,
    level:1, exp:0, expNext:8,
    shock:0, aura:0, aim:-Math.PI/2,
    char: ch.key, charName: ch.name, color: ch.color,
    invul:0, hurtFlash:0
  };
  /* 玩法扩展：流派被动 */
  p.school = ch.school || 'blast';
  if (p.school === 'blast') p.splash = (p.splash||0) + 0.12;
  if (p.school === 'ball') p.pierce += 1;
  if (p.school === 'field') p.regen += 0.4;

  var dust = [];
  for (var d0=0;d0<70;d0++){
    dust.push({x:rnd(-CFG.world,CFG.world), y:rnd(-CFG.world,CFG.world), r:rnd(0.8,2.2), a:rnd(0,6.28)});
  }
  var deco = [];
  for (var i=0;i<32;i++){
    deco.push({
      x: rnd(-CFG.world*0.92, CFG.world*0.92),
      y: rnd(-CFG.world*0.92, CFG.world*0.92),
      r: rnd(16,48), rot: rnd(0,6.28), n: 3 + Math.floor(Math.random()*3)
    });
  }

  /* 开局补给：脚边撒两枚晶体，warmup 时不用干站着 */
  var starterGems = [
    {x:p.x+118, y:p.y-16, v:5, pull:false, age:0},
    {x:p.x-104, y:p.y+58, v:5, pull:false, age:0},
    {x:p.x+22, y:p.y-126, v:5, pull:false, age:0}
  ];

  return {
    state:'playing', rerolls:2, rerollExtra:0, speed:1,
    time:0, wave:1, waveT:0, waveLen:CFG.waveLen, half:CFG.world,
    kills:0, coreEarned:0, coins:0,
    cam:{x:p.x, y:p.y},
    player:p, stacks:{}, evoDone:{}, school:{}, schoolDone:{},
    enemies:[], bullets:[], ebullets:[], gems: starterGems.slice(), pickups:[],
    parts:[], partPool:[], dmgs:[], rings:[],
    deco: deco, dust: dust,
    spawnT:0.35, shockT:3.5, auraT:0, guard:null, shopBuys:0, shopRolls:0, splitQ:[],
    shake:0, hitstop:0, comboK:0, comboT:0, comboBreak:0, waveHeal:0, deathCause:'', lastSrc:'', heartT:0, saveUsed:false, bossKills:0, breathe:false, wdmg:0, wtaken:0, runDmg:0, runTaken:0, hist:[], hellBonus:0,
    boss:null, bossDef:null,
    mods:[], modState:{}, modUsed:[], hunter:null, zone:null, hold:null, meteors:[], zaps:[], coresBonus:0,
    cycle: Math.max(1, S.set.cycle || 1), theme:0, bossWarn:null,
    diff: DIFF[S.diff] || DIFF.normal,
    revived:false, canRevive:true,
    swords:0, swordDmg:false, swordCool:[0,0,0], swordBlock:0, gate:null, quest:null,
    training:false, escortT:0, meteorT2:0, comboBest:0,
    bountyRef:null, bountyDone:0, expOver:0
  };
}

/* ================= 实体工具 ================= */
function modHpMul(){
  var m = 1;
  if (modOn('rush')) m *= 1.6;
  if (modOn('greed')) m *= 1.25;
  if (modOn('siege')) m *= 0.85;
  return m;
}

function enemyCap(){
  var c = CFG.maxEnemies;
  if (VW < 640) c = Math.min(c, 200);
  if (AUTOQ.lv >= 1) c = Math.min(c, 220);
  if (AUTOQ.lv >= 2) c = Math.min(c, 160);
  if (AUTOQ.lv >= 3) c = Math.min(c, 120);
  return c;
}
function spawnEnemy(type, atX, atY){
  if (G.enemies.length >= enemyCap()) return null;
  var t = EDEF[type], p = G.player;
  var ang = rnd(0, Math.PI*2);
  if (p.mvx*p.mvx + p.mvy*p.mvy > 0.02) ang = Math.atan2(p.mvy, p.mvx) + rnd(-1.15, 1.15);
  var ca = Math.cos(ang), sa = Math.sin(ang);
  var rad = Math.min(920, Math.max((VWW/2 + rnd(60,140)) / Math.max(1e-3, Math.abs(ca)),
                                   (VHH/2 + rnd(60,140)) / Math.max(1e-3, Math.abs(sa))));
  var wN = Math.max(0, G.wave - 20);
  var lvK = Math.min(2.0, 1 + 0.022 * Math.max(0, (p.level || 1) - 1));
  var k = (1 + 0.07*(G.wave-1)) * Math.sqrt(G.diff.hpMul)
        * (wN > 0 ? Math.min(1800, Math.pow(1.052, wN)) : 1)
        * lvK;
  var hpMulCached = modHpMul();
  var e = {
    type:type,
    x: atX !== undefined ? atX : p.x + Math.cos(ang)*rad,
    y: atY !== undefined ? atY : p.y + Math.sin(ang)*rad,
    r: t.r,
    hp: t.hp*k*hpMulCached, hpMax: t.hp*k*hpMulCached,
    spd: t.spd*(1 + 0.017*(G.wave-1))*(MODF.swift ? 1.35 : 1)*(1 + 0.08*Math.max(0,(G.cycle||1)-1))*(G.wave <= 3 ? 0.85 : 1),
    dmg: t.dmg*Math.min(4.2, (1 + 0.055*(G.wave-1)) * (wN > 0 ? Math.min(3.2, Math.pow(1.045, wN)) : 1))*(modOn('bloodmoon') ? 1.4 : 1), col: t.col, xp: t.xp, shape: t.shape,
    rot: rnd(0,6.28), tcd:0, shootT: rnd(0.8,2.4),
    hurt:0, dead:false, boss:false, shoot:!!t.shoot, elite:false
  };
  var hb = (G.half || CFG.world) - 26;
  e.x = clamp(e.x, -hb, hb); e.y = clamp(e.y, -hb, hb);
  G.enemies.push(e);
  return e;
}

function aimLead(e, speed){
  var p = G.player;
  var adx = p.x-e.x, ady = p.y-e.y;
  var t = Math.min(1.1, Math.sqrt(adx*adx + ady*ady) / Math.max(1, speed));
  return Math.atan2(p.y + (p.vy||0)*t - e.y, p.x + (p.vx||0)*t - e.x);
}

function spawnBoss(){
  var idx = (Math.floor(G.wave/5) - 1) % BDEF.length;
  if (idx < 0) idx = 0;
  var b = BDEF[idx], p = G.player;
  var ang = rnd(0, Math.PI*2);
  if (p.mvx*p.mvx + p.mvy*p.mvy > 0.02) ang = Math.atan2(p.mvy, p.mvx) + rnd(-1.15, 1.15);
  var ca = Math.cos(ang), sa = Math.sin(ang);
  var rad = Math.min(900, Math.max((VWW/2 + 90) / Math.max(1e-3, Math.abs(ca)),
                                   (VHH/2 + 90) / Math.max(1e-3, Math.abs(sa))));
  var k = (1 + 0.34*(G.wave-5)) * G.diff.hpMul * 2.4
        * (1 + 0.12*Math.max(0, (G.cycle||1)-1));
  G.bossWarn = {t:3.0, def:b, ang:ang, rad:rad, k:k};
  sfx('boss');
  return null;
}

function strongestSelf(){
  var bw = 0, bl = 1, runs = S.runs || [];
  for (var i=0;i<runs.length;i++){
    var r = runs[i];
    if ((r.w||0) > bw){ bw = r.w; bl = r.lv || 1; }
    else if ((r.w||0) === bw && (r.lv||1) > bl) bl = r.lv || 1;
  }
  if (!bw && S.best && S.best.wave) bw = S.best.wave;
  var fb = !bw;
  if (fb){ bw = 30; bl = 30; }
  return {w:bw, lv:bl, fb:fb};
}

function spawnGuard(){
  var ss = strongestSelf();
  var p = G.player;
  var hp = Math.round(140 + ss.w*22 + ss.lv*9);
  G.guard = {x:p.x+34, y:p.y-40, hp:hp, hpMax:hp, r:22, t:0, hurt:0, ss:ss};
  G.shake = Math.max(G.shake, 6);
  toast(ss.fb ? '无存档记录 · 三十关标准的自己替你挡枪' : ('存档最强 · 第' + ss.w + '波的自己替你挡枪'));
  sfx('revive');
}

function guardHit(dmg){
  var g = G.guard;
  if (!g) return;
  g.hp -= dmg; g.hurt = 0.24;
  G.shake = Math.max(G.shake, 3);
  if (g.hp <= 0){
    burst(g.x, g.y, '#a8d0c2', 160, 12);
    G.guard = null;
    toast('援护分身已消散');
  }
}

function updateGuard(dt){
  var g = G.guard;
  if (!g || !G.player) return;
  var p = G.player;
  g.t += dt;
  if (g.hurt > 0) g.hurt -= dt;
  var ax = p.x, ay = p.y - 48;
  var tgt = nearestEnemy(p.x, p.y, 460);
  if (tgt){
    var a = Math.atan2(tgt.y-p.y, tgt.x-p.x);
    ax = p.x + Math.cos(a)*58; ay = p.y + Math.sin(a)*58;
  }
  var k = Math.min(1, dt*7);
  g.x += (ax-g.x)*k; g.y += (ay-g.y)*k;
}

function spawnBossNow(w){
  var b = w.def, p = G.player;
  G.bossWarn = null;
  var e = {
    type:'boss',
    x: p.x + Math.cos(w.ang)*w.rad,
    y: p.y + Math.sin(w.ang)*w.rad,
    r: b.r, hp: b.hp*w.k, hpMax: b.hp*w.k,
    spd: b.spd*(1 + 0.08*Math.max(0,(G.cycle||1)-1)),
    dmg: b.dmg * (1 + 0.035*Math.max(0, G.wave-5)), col: b.col, xp:20,
    rot:0, tcd:0, timer:1.2, hurt:0, dead:false,
    boss:true, shoot:true, bossDef:b, dashT:0, dashVX:0, dashVY:0,
    phase:1, haste:1, introT:0.6
  };
  if (modOn('bossrage')){ e.dmg *= 1.25; e.haste = (e.haste || 1) * 0.8; }
  G.enemies.push(e);
  G.boss = e; G.bossDef = b;
  G.shake = 14;
  toast(b.name + ' 出现');
  return e;
}

var GRID = {cell:96, map:null, bm:null};
/* 网格键用整数：nearestEnemy 每帧要查 100+ 个格子，字符串键的 hash 成本不小 */
function gKey(cx, cy){ return (cx + 1024) * 4096 + (cy + 1024); }
function gridBuild(){
  var cell = GRID.cell;
  /* 每帧新建 Map 与上百个格子数组纯属浪费，桶对象复用，只把长度清零 */
  var m = GRID.bm;
  if (m){
    var it = m.values(), v = it.next();
    while (!v.done){ v.value.length = 0; v = it.next(); }
  } else {
    m = GRID.bm = new Map();
  }
  for (var i=0;i<G.enemies.length;i++){
    var e = G.enemies[i];
    if (e.dead) continue;
    var key = gKey(Math.floor(e.x/cell), Math.floor(e.y/cell));
    var arr = m.get(key);
    if (arr) arr.push(e); else m.set(key, [e]);
  }
  GRID.map = m;
}
function nearestEnemy(x,y,range){
  var r0 = nearestEnemyCore(x,y,range);
  if (r0 || nearestEnemy.allowTrain) return r0;
  /* 只有练习场才存在"被过滤掉的假人"，普通模式空场直接返回，省掉第二次全网格扫描 */
  if (!(G.practice || G.training)) return null;
  nearestEnemy.allowTrain = true;
  var r1 = nearestEnemyCore(x,y,range);
  nearestEnemy.allowTrain = false;
  return r1;
}
function nearestEnemyCore(x,y,range){
  var best = null, bd = range*range;
  var m = GRID.map;
  if (!m){ gridBuild(); m = GRID.map; }
  var cell = GRID.cell, rc = Math.ceil(range/cell);
  var cx0 = Math.floor(x/cell), cy0 = Math.floor(y/cell);
  for (var cx=cx0-rc; cx<=cx0+rc; cx++){
    for (var cy=cy0-rc; cy<=cy0+rc; cy++){
      var arr = m.get((cx + 1024) * 4096 + (cy + 1024));
      if (!arr) continue;
      for (var i=0;i<arr.length;i++){
        var e = arr[i];
        if (e.dead) continue;
        if (e.training && !nearestEnemy.allowTrain) continue;
        var d = dist2(x,y,e.x,e.y);
        if (d < bd){ bd = d; best = e; }
      }
    }
  }
  return best;
}

function burst(x,y,col,size,count){
  if (S.set.quality === 'low') count = Math.ceil(count*0.5);
  if (AUTOQ.lv === 1) count = Math.ceil(count*0.55);
  if (AUTOQ.lv === 2) count = Math.ceil(count*0.25);
  if (AUTOQ.lv >= 3) count = Math.ceil(count*0.12);
  var fps = (G && G.fps) ? G.fps : 60;
  if (fps < 50) count = Math.ceil(count*0.35);
  if (fps < 40) count = Math.ceil(count*0.15);
  if (fps < 30) return;
  if (count < 1) return;
  var capParts = (S && S.set && S.set.eco) ? 70 : 240;
  if (fps < 40) capParts = 60;
  if (fps < 30) capParts = 24;
  var pool = G.partPool || (G.partPool = []);
  for (var i=0;i<count;i++){
    if (G.parts.length > capParts) break;
    var ang = rnd(0,6.28), spd = rnd(40,size);
    var life = rnd(0.2,0.55);
    /* max 跟 life 走，粒子才是"出生满亮、逐渐淡出"；对象走池，不再每颗都新建 */
    var pt = pool.length ? pool.pop() : {};
    pt.x = x; pt.y = y;
    pt.vx = Math.cos(ang)*spd; pt.vy = Math.sin(ang)*spd;
    pt.life = life; pt.max = life; pt.col = col; pt.r = rnd(1.5,3.5);
    G.parts.push(pt);
  }
}

function addDmg(x,y,v,big,ent){
  /* 合并条件必须确认这枚飘字仍归这个敌人所有：对象池回收后会换主人，
     否则伤害数字会叠到别人的数字上，或者写进已经下屏的飘字里直接消失 */
  var own = ent && ent._dt && ent._dt.ent === ent && ent._dt.t < 0.28 && ent._dt.life > 0;
  if (own){
    ent._dt.acc += v; ent._dt.t = 0; ent._dt.x = ent.x + rnd(-4,4); ent._dt.y = ent.y - 10;
    ent._dt.v = Math.round(ent._dt.acc);
    return;
  }
  var pool = window._DMG_POOL || (window._DMG_POOL = []);
  var ref;
  /* 飘字每帧每条一次 fillText，是文字渲染里最贵的一类；
     上限从 48 收到 30，卡顿时更狠，视觉上也更清爽 */
  var dmgCap = 30;
  /* 满级之后经验已经折成金币，伤害数字只是背景噪声：30 条同时飞会糊住一半屏幕，
     而且每条都是一次 fillText。收到 12 条，既省字渲染也不挡视线 */
  if (G && G.player && G.player.level >= LEVEL_CAP) dmgCap = 12;
  if (G && G.fps && G.fps < 45) dmgCap = 14;
  if (G && G.fps && G.fps < 30) dmgCap = 8;
  if (G.dmgs.length > dmgCap){
    ref = G.dmgs.shift();
    ref.ent = null;
    pool.push(ref);
    if (pool.length > 40){
      var drop = pool.shift();
      if (drop && drop.ent && drop.ent._dt === drop) drop.ent._dt = null;
    }
  }
  var lastN = G.dmgs[G.dmgs.length-1];
  if (!big && !ent && lastN && lastN.t < 0.14 && Math.abs(lastN.x - x) < 26 && Math.abs(lastN.y - y) < 26){
    lastN.acc += v; lastN.v = Math.round(lastN.acc); lastN.t = 0;
    return;
  }
  ref = pool.pop() || {};
  ref.x = x + rnd(-6,6); ref.y = y - 10; ref.v = Math.round(v); ref.acc = v;
  ref.t = 0; ref.life = big ? 0.85 : 0.7; ref.big = !!big;
  ref.ent = ent || null;
  if (ent) ent._dt = ref;
  G.dmgs.push(ref);
}

/* 治疗衰减：每波恢复量超过生命上限 40% 后，后续治疗仅 25% 生效 */
function healPlayer(amt){
  var p = G.player;
  var cap = p.hpMax * 0.4;
  var used = G.waveHeal || 0;
  var eff = amt;
  if (used >= cap) eff = amt * 0.25;
  else if (used + amt > cap) eff = (cap - used) + (amt - (cap - used)) * 0.25;
  G.waveHeal = used + eff;
  var before = p.hp;
  p.hp = Math.min(p.hpMax, p.hp + eff);
  return p.hp - before;
}

var BUL_CAP = 240;   /* 射速×弹数×回响最多也就几十颗在飞，超过 240 纯属极端数值，直接封顶 */
function fire(t){
  var p = G.player;
  if (!t) t = nearestEnemy(p.x, p.y, p.rng);   /* 调用方常已有目标，别再扫一遍网格 */
  if (!t) return;

  /* 预判提前量：按飞行时间估算目标位移 */
  var tx = t.x - p.x, ty = t.y - p.y;
  var td = Math.sqrt(tx*tx + ty*ty) || 1;
  var ft = td / p.pbs;
  var leadX = t.x - (tx / td) * t.spd * ft;
  var leadY = t.y - (ty / td) * t.spd * ft;
  var base = Math.atan2(leadY - p.y, leadX - p.x);
  var n = p.shots, spread = 0.13;
  var echoOn = modOn('echo');   /* 原来每颗子弹都遍历一遍异变表，白烧 */
  for (var i=0;i<n;i++){
    if (G.bullets.length >= BUL_CAP) break;
    var a = base + (n===1 ? 0 : (-spread*(n-1)/2 + spread*i));
    if (modOn('storm')) a += rnd(-0.06, 0.06);
    G.bullets.push({
      x:p.x+Math.cos(a)*20, y:p.y+Math.sin(a)*20,
      vx:Math.cos(a)*p.pbs, vy:Math.sin(a)*p.pbs,
      r:5, pierce:p.pierce, life:1.4, hits:[]
    });
    if (echoOn){
      if (G.bullets.length < BUL_CAP && Math.random() < 0.2){
        var ea = a + rnd(-0.09, 0.09);
        G.bullets.push({
          x:p.x+Math.cos(ea)*20, y:p.y+Math.sin(ea)*20,
          vx:Math.cos(ea)*p.pbs, vy:Math.sin(ea)*p.pbs,
          r:5, pierce:p.pierce, life:1.4, hits:[]
        });
      }
    }
  }
  sfx('shoot');
}

function distSeg2(px, py, ax, ay, bx, by){
  var dx = bx-ax, dy = by-ay;
  var len2 = dx*dx + dy*dy;
  var t = 0;
  if (len2 > 1e-6) t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy)/len2));
  var qx = ax + dx*t, qy = ay + dy*t;
  return (px-qx)*(px-qx) + (py-qy)*(py-qy);
}

var PHASE_NAME = ['', '一阶段', '二阶段', '狂暴'];

/* 伤害飘字固定字体：每帧拼字号字符串会持续产生垃圾 */
var FONT_DMG = '700 13px "Noto Serif SC","Songti SC","STSong",serif';
var FONT_DMG_BIG = '900 18px "Noto Serif SC","Songti SC","STSong",serif';

/* 经验晶体：落点就近合并，避免满屏碎晶 */
var GEM_CAP = 240;
function addGem(x, y, v, pull){
  var arr = G.gems, best = -1, bd = 64*64;
  /* 后期每秒几百次击杀，晶体不设上限会堆到三四百颗：每颗每帧要算距离、要进合批路径。
     超限时把最老的一颗"吃掉"，经验并进新晶体，玩家不会白丢 */
  if (arr.length >= GEM_CAP){
    var g0 = arr.shift();
    if (g0) v += (g0.v || 0);
  }
  for (var i=0;i<arr.length;i++){
    var d2 = (arr[i].x-x)*(arr[i].x-x) + (arr[i].y-y)*(arr[i].y-y);
    if (d2 < bd){ bd = d2; best = i; }
  }
  if (best >= 0){ arr[best].v += v; if (pull) arr[best].pull = true; return; }
  if (arr.length >= 120){ arr[Math.floor(Math.random()*arr.length)].v += v; return; }
  arr.push({x:x, y:y, v:v, pull:!!pull, age:0});
}

function hitEnemy(e, dmg, big, noSplash){
  if (e.dead) return;
  if (MODF.armored) dmg *= 0.75;
  e.hp -= dmg;
  if (e.training) e.tDmg = (e.tDmg || 0) + dmg;
  G.wdmg = (G.wdmg || 0) + dmg;
  G.runDmg = (G.runDmg || 0) + dmg;
  if (e.boss && !e.dead){
    var ratio = e.hp / e.hpMax;
    var want = ratio <= 0.15 ? 3 : (ratio <= 0.4 ? 2 : 1);
    if (want > (e.phase || 1) && ratio > 0){
      e.phase = want;
      e.haste = Math.pow(0.86, want - 1);
      e.spd *= 1.08;
      G.shake = Math.max(G.shake, 16);
      G.slowmo = 1.2;
      burst(e.x, e.y, P.amSoft, 260, 16);
      toast(PHASE_NAME[want] + '：' + (e.bossDef ? e.bossDef.name : '首领'));
      sfx('boss');
    }
  }
  e.hurt = 0.12;
  addDmg(e.x, e.y, dmg, big, e);
  if (!noSplash && G.player && G.player.splash){
    var R = 64, sd = dmg * G.player.splash, R2 = R*R;
    /* 敌人少时直接扫全场（最准，且本来就不贵）；满屏时改走已有的敌方格子表，
       只查周边 5×5 格再精确验距 —— 原来每次溅射命中都要扫几百个敌人 */
    if (G.enemies.length <= 60){
      for (var si=0; si<G.enemies.length; si++){
        var o0 = G.enemies[si];
        if (o0 === e || o0.dead) continue;
        if (dist2(o0.x, o0.y, e.x, e.y) < R2) hitEnemy(o0, sd, false, true);
      }
    } else {
      if (!GRID.map) gridBuild();
      var gm = GRID.map, gcell = GRID.cell;
      var gcx = Math.floor(e.x/gcell), gcy = Math.floor(e.y/gcell);
      for (var scx=gcx-2; scx<=gcx+2; scx++){
        for (var scy=gcy-2; scy<=gcy+2; scy++){
          var sarr = gm.get((scx + 1024) * 4096 + (scy + 1024));
          if (!sarr) continue;
          for (var si=0; si<sarr.length; si++){
            var o = sarr[si];
            if (o === e || o.dead) continue;
            if (dist2(o.x, o.y, e.x, e.y) < R2) hitEnemy(o, sd, false, true);
          }
        }
      }
    }
    /* 字段必须和更新循环一致：life/mx 缺一个，这个环就永远不消失（会一直累积） */
    /* 爆裂击杀的范围环去掉：只留冲击发生器的环，避免满屏线团 */
  }
  if (e.hp <= 0) killEnemy(e);
}

var COMBO_CORES = {30: 3, 60: 8, 100: 16};
function killEnemy(e){
  e.dead = true;
  G.kills++;
  /* 图鉴战绩：按怪种累计击杀数 */
  if (!e.boss && e.type){
    S.monKills = S.monKills || {};
    S.monKills[e.type] = (S.monKills[e.type] || 0) + 1;
  }
  var cm = COINMUL;   /* 赏金倍率已预先算好，见 refreshModFlags */
  if (e.bounty){
    G.bountyDone = (G.bountyDone || 0) + 1;
    G.bountyRef = null;
    G.coins += 45 * cm;
    G.coresBonus += 3;
    G.shake = Math.max(G.shake, 6);
    toast('悬赏已清除 · +45 金币 +3 星核');
    sfx('coin');
  }
  /* 不再逐笔 Math.round：小数增益（异变倍率 1.4/1.6 等）会被每只怪舍掉，累积少给很多 */
  G.coins += ((e.boss ? 20 : (e.elite ? 6 : ({tank:3, shooter:2}[e.type] || 1))) * cm);
  if (modOn('elite') && e.elite) G.coresBonus++;
  if (modOn('split') && !e.boss && !e.elite && Math.random() < 0.3){
    /* 分裂怪不能当场 push：正在 for(enemies)/子弹遍历里，新增会被同一遍历立刻命中且绕过上限。记入队列，帧末 updateSpawn 统一生成。 */
    (G.splitQ || (G.splitQ = [])).push({x: e.x, y: e.y});
  }
  burst(e.x, e.y, e.col, e.boss ? 320 : 200, e.boss ? 34 : 9);
  G.comboK = (G.comboK || 0) + 1;
  G.comboT = 0.7;
  if (G.comboK > (G.comboBest || 0)) G.comboBest = G.comboK;
  /* 连杀里程碑：30/60/100 各给一次星核碎片，不掺进金币经济 */
  var cmMark = COMBO_CORES;
  if (cmMark[G.comboK]){
    G.comboCores = (G.comboCores || 0) + cmMark[G.comboK];
    comboToast('连杀 ' + G.comboK + ' · 星核 +' + cmMark[G.comboK]);
    sfx('coin');
  }
  if (e.boss) G.shake = Math.max(G.shake, 12);
  if (G.speed <= 3) G.hitstop = Math.max(G.hitstop || 0, e.boss ? 0.09 : 0.035);
  sfx('kill');

  if (e.boss){
    G.bossKills = (G.bossKills || 0) + 1;
    G.boss = null;
    G.shake = 18;
    if (e.bossDef && e.bossDef.key){
      S.stats.bosses[e.bossDef.key] = true;
      var bb = S.bossBook[e.bossDef.key] || {kills:0, best:0};
      bb.kills += 1;
      if (!bb.best || G.time < bb.best) bb.best = Math.floor(G.time);
      S.bossBook[e.bossDef.key] = bb;
    }
    G.player.hp = Math.min(G.player.hpMax, G.player.hp + G.player.hpMax*0.3);
    for (var i=0;i<8;i++) addGem(e.x+rnd(-46,46), e.y+rnd(-46,46), 6, false);
    pushPickup({type:'chest', x:e.x, y:e.y, t:0});
  } else {
    var waveK = 1 + Math.min(2.2, (G.wave - 1) * 0.032);
    var gv = e.xp * waveK * (MODF.swift ? 1.6 : 1) * (MODF.famine ? 0.6 : 1) * (modOn('greedpact') ? 0.65 : 1);
    if (G.player.level >= LEVEL_CAP){
      /* 满级后晶体没意义（吃进去也升不了级），直接按 0.1 折成金币，
         既不生成满地吸不完的宝石，也不让收益白白蒸发 */
      G.coins += Math.round(gv * 1) / 10;
    } else if (gv > 0){
      addGem(e.x, e.y, gv, false);
    }
    if (e.elite) pushPickup({type:'chest', x:e.x, y:e.y, t:0});
  }

  var dropChance = 0.055 + (G.player.luck || 0);
  if (modOn('air')) dropChance *= 2;
  if (modOn('noheal')) dropChance *= 0.3;
  if (G.breathe) dropChance *= 2;
  /* 场上掉落越多，新掉落越少；满血时不掉补血包（吃了也是浪费） */
  dropChance *= Math.max(0.15, 1 - G.pickups.length / 18);
  if (!e.boss && Math.random() < dropChance){
    var maxed = G.player.level >= LEVEL_CAP;
    var ptype = Math.random() < 0.65 ? 'med' : 'magnet';
    /* 满级后没有晶体可吸，磁铁完全没用 → 改补血 */
    if (maxed && ptype === 'magnet') ptype = 'med';
    if (ptype === 'med' && G.player.hp >= G.player.hpMax * 0.92) ptype = maxed ? null : 'magnet';
    if (ptype) pushPickup({type: ptype, x:e.x, y:e.y, t:0});
  }
}

/* 掉落统一入口：后期 luck/异变叠加后每只怪都可能掉，不设上限会铺满屏幕，
   图标互相压成一坨既看不清也吃不到 */
var PICKUP_MAX = 14;
function pushPickup(o){
  if (!G || !G.pickups) return;
  if (G.pickups.length >= PICKUP_MAX){
    /* 满了先挤掉一件普通补给，精英/BOSS 的补给箱要留住 */
    var ri = -1;
    for (var pi=0; pi<G.pickups.length; pi++) if (G.pickups[pi].type !== 'chest'){ ri = pi; break; }
    if (ri >= 0) G.pickups.splice(ri,1);
    else G.pickups.shift();
  }
  G.pickups.push(o);
}

function armorTaken(armor){
  /* 减伤封顶 60%，避免堆满护甲后完全免疫 */
  return Math.max(0.4, 1 / (1 + Math.max(0, armor)));
}
function pdmg(){
  var p = G.player;
  var combo = 1 + Math.min(60, G.comboK || 0) * 0.008;
  return p.dmg * (1 + (p.dmgAdd || 0)) * combo;
}

/* 面板 DPS（老算法：单发 × 弹数 × 射速 × 暴击期望），飞剑伤害与 HUD 共用 */
function dpsEst(){
  var p = G.player;
  return pdmg() * (p.shots || 1) * p.rate * (1 + (p.crit || 0) * ((p.cmul || 1.9) - 1));
}

function damagePlayer(raw, src){
  var p = G.player;
  if (p.invul > 0) return false;
  /* 飞剑替挡：消耗一把、这一次伤害全额不算，并给极短无敌，
     否则同一帧里多段伤害会把三把剑连着吃掉 */
  if ((G.swords || 0) > 0){
    G.swords--;
    G.swordBlock = (G.swordBlock || 0) + 1;
    p.invul = Math.max(p.invul, 0.2);
    G.shake = Math.max(G.shake, 3);
    burst(p.x, p.y, P.amSoft, 16, 11);
    sfx('coin');
    var bt2 = PNow();
    if (!window.__blkT || bt2 - window.__blkT > 2000){ window.__blkT = bt2; toast('飞剑挡下这一击'); }
    return false;
  }
  var d = raw * armorTaken(p.armor) * (p.dmgTake || 1);
  G.wtaken = (G.wtaken || 0) + d;
  G.runTaken = (G.runTaken || 0) + d;
  p.hp -= d;
  if (src) G.lastSrc = src;
  p.hurtFlash = 0.28;
  G.shake = Math.max(G.shake, 4);
  addDmg(p.x, p.y-26, d, false);
  sfx('hurt');
  if (S.set.vib && navigator.vibrate) navigator.vibrate(28);
  if (p.hp <= 0 && G.wave <= 10 && !G.saveUsed){
    G.saveUsed = true;
    p.hp = Math.max(1, p.hpMax * 0.35);
    G.waveHeal = Math.min(G.waveHeal || 0, p.hpMax * 0.15); /* 放开本波治疗额度，保证能回血 */
    p.invul = 2.6;
    p.regenBoost = 8;
    G.shake = Math.max(G.shake, 12);
    toast('紧急护盾：前 10 波保你一命，回复至 35% 生命');
    sfx('revive');
    spawnGuard();
    return false;
  }
  if (p.hp <= 0){
    p.hp = 0;
    if (G.lastSrc === 'boss') G.deathCause = '首领「' + (G.bossDef ? G.bossDef.name : '未知') + '」' + (G.boss && G.boss.phase > 1 ? ' · ' + PHASE_NAME[G.boss.phase] : '');
    else G.deathCause = SRC_NAME[G.lastSrc] || '未知';
    gameOver(); return true;
  }
  return false;
}

function boundTarget(){
  var w = G ? G.wave : 1;
  var cyc = Math.max(0, ((G && G.cycle) || 1) - 1);
  var base = CFG.world * (1 - Math.min(0.22, 0.07*cyc)); /* 周目越高，活动区越小 */
  if (w <= 55) return Math.round(base);
  var t = Math.min(1, (w - 55) / 65);
  return Math.round(base * (1 - 0.6*t));
}

function waveStart(){
  G.waveHeal = 0;
  /* endModifiers 会把异变清空，先把本波用过的异变名字留下来，给结算图的「崩盘波」追因 */
  G.lastWaveMods = (G.mods && G.mods.length) ? G.mods.map(function(m){ return m.name; }) : [];
  G.bountyRef = null;   /* 上一波的悬赏没打完就作废，不跨波累积 */
  endModifiers();
  if (G.wdmg || G.wtaken){
    G.hist.push({w:Math.max(1, G.wave - 1), dps:Math.round((G.wdmg || 0) / G.waveLen), t:Math.round(G.wtaken || 0), mods:G.lastWaveMods});
    if (G.hist.length > 24) G.hist.shift();
  }
  G.wdmg = 0; G.wtaken = 0;
  G.wave++;
  G.breathe = (G.wave >= 20 && G.wave % 5 === 0);
  if (G.breathe) toast('喘息波：怪物变少，掉落翻倍');
  var thIdx = Math.floor((G.wave - 1) / 10) % THEME.length;
  if (thIdx !== (G.theme || 0)){
    G.theme = thIdx;
    buildVignette();   /* 地貌底色烘在底图里，换地貌要重烘一次 */
    toast('地貌变化 · ' + THEME[thIdx].name);
  }
  G.waveT = 0;
  G.player.hp = Math.min(G.player.hpMax, G.player.hp + G.player.hpMax*0.06);
  if (G.wave > 1 && G.wave % 5 === 1) { openShop(); return; }
  if (!S.tutorial && G.wave <= 3){
    if (G.wave === 2) hint('第 2 波：靠近青色晶体吸取经验，升级时选一张强化', 4600);
    if (G.wave === 3) hint('第 3 波：每 5 波有波间商店，金币可以换补给', 4600);
  } else if (!S.tutorial && G.wave > 3){
    S.tutorial = true; saveNow();
  }
  if (!G.resuming && G.wave >= 6) pickModifiers();
  if (!G.resuming) saveCheckpoint();
  if (G.wave === 56) toast('活动区开始收缩，边界逼近');
  spawnWaveContent();
  spawnBounty();
  if (!G.training){
    if (G.wave % 10 === 0) spawnGate();
    if (G.wave % 10 === 1) startQuest();
    if (G.wave % 10 === 1 && (G.cycle || 1) >= 2) toast('周目规则：活动区已收缩，务必注意走位');
  }
}

function deathAdvice(cause){
  if (!cause) return '';
  if (cause.indexOf('吐酸者') >= 0 || cause.indexOf('精英') >= 0) return '建议：远程弹道出现前先横移一步，或堆护甲/回血顶过消耗。';
  if (cause.indexOf('疾行虫') >= 0) return '建议：疾行虫速度快，留一条退路，别把自己压进角落。';
  if (cause.indexOf('重甲') >= 0) return '建议：重甲兽血厚，优先拿穿透与高倍伤害，别靠磨。';
  if (cause.indexOf('毒圈') >= 0) return '建议：毒圈收缩时提前回到中心，别在边缘捡东西。';
  if (cause.indexOf('首领') >= 0) return '建议：首领转阶段时先拉开距离，等它交完一轮技能再贴。';
  if (cause.indexOf('猎手') >= 0) return '建议：猎手会持续追击，别直线逃，绕圈拉开再反打。';
  return '建议：留意波次提示，提前规划下一波的站位。';
}

function saveCheckpoint(persist, force){
  if (!G) return;
  if (G.practice) return;
  if (G.state !== 'playing' && G.state !== 'paused' && G.state !== 'levelup' && G.state !== 'shop') return;
  if (G.daily){ S.checkpoint = null; return; }
  try{
    S.checkpoint = {
      wave: G.wave, waveT: G.waveT, time: G.time, kills: G.kills, coins: G.coins,
      coresBonus: G.coresBonus || 0, cycle: G.cycle || 1, swords: G.swords || 0,
      dmg: G.runDmg || 0, tkn: G.runTaken || 0,
      rerollExtra: G.rerollExtra || 0,
      swordDmg: !!G.swordDmg, swordBlock: G.swordBlock || 0,
      bountyDone: G.bountyDone || 0, expOver: G.expOver || 0,
      /* 一次性资源/累计价格必须入档，否则读档被刷新：saveUsed 护盾、shopBuys 单局涨价、comboCores 连杀星核、comboBest 最高连杀。 */
      saveUsed: !!G.saveUsed, shopBuys: G.shopBuys || 0, shopRolls: G.shopRolls || 0,
      comboCores: G.comboCores || 0, comboBest: G.comboBest || 0, waveHeal: G.waveHeal || 0,
      /* 这几项以前没存，刷新页面就能白拿一次复活、每日任务的"击杀首领"也会从 0 重新数 */
      revived: !!G.revived, canRevive: G.canRevive !== false,
      bossKills: G.bossKills || 0, comboK: G.comboK || 0,
      quest: (G.quest ? {
        type: G.quest.type === 'nohit' ? 'nohit' : 'kill',
        need: G.quest.need || 0, kills0: G.quest.kills0 || 0, taken0: G.quest.taken0 || 0,
        done: !!G.quest.done, wave0: G.quest.wave0
      } : null),
      diff: (G.diff && G.diff.key) || S.diff, char: S.char, hist: G.hist || [],
      player: JSON.parse(JSON.stringify(G.player)),
      stacks: JSON.parse(JSON.stringify(G.stacks || {})),
      evoDone: JSON.parse(JSON.stringify(G.evoDone || {})),
      school: JSON.parse(JSON.stringify(G.school || {})),
      schoolDone: JSON.parse(JSON.stringify(G.schoolDone || {})),
      mods: (G.mods || []).map(function(m){ return m ? {id:m.id, name:m.name, tip:m.tip, st:m.st} : null; }).filter(Boolean)
    };
    /* 每 6 秒的例行存档只更新内存快照；真正落盘放到换波/商店/暂停/退出，
       避免每 6 秒一次 localStorage 同步写卡掉一帧 */
    if (persist !== false) saveNow(force === true);
  }catch(err){}
}

function resumeRun(){
  var cp = S.checkpoint;
  if (!cp) return;
  /* ==== 存档消毒 ==== 存档可能来自分享/手改/断电截断，单个坏字段（"abc"/null/Infinity）就能把 time 拼成字符串、给 swords 塞 NaN，几帧内整局崩。下面每个字段过 cpNum：非有限数回落默认值，可转数字的字符串也接受。 */
  var cpNum = function(v, d, lo, hi){
    var n = v;
    if (typeof n === 'string' && n.trim() !== '') n = Number(n);
    if (typeof n !== 'number' || !isFinite(n)) n = d;
    if (lo !== undefined && n < lo) n = lo;
    if (hi !== undefined && n > hi) n = hi;
    return n;
  };
  var cpObj = function(v){ return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; };
  var prevChar = S.char, prevDiff = S.diff;
  S.char = (typeof cp.char === 'string' && S.chars && S.chars[cp.char]) ? cp.char : S.char;
  S.diff = (typeof cp.diff === 'string' && DIFF[cp.diff]) ? cp.diff : S.diff;
  startRun(false);
  S.char = prevChar; S.diff = prevDiff;
  G.wave = cpNum(cp.wave, 1, 1, 2000) - 1;
  G.time = cpNum(cp.time, 0, 0, 1e7);
  G.kills = cpNum(cp.kills, 0, 0, 1e9);
  G.coins = cpNum(cp.coins, 0, 0, 1e9);
  G.coresBonus = cpNum(cp.coresBonus, 0, 0, 1e9);
  /* 续局后统计不能从 0 起，否则结算页的"本局输出"只算最后一段 */
  G.runDmg = cpNum(cp.dmg, 0, 0);
  G.runTaken = cpNum(cp.tkn, 0, 0);
  G.bountyDone = cpNum(cp.bountyDone, 0, 0, 99); G.expOver = cpNum(cp.expOver, 0, 0, 1e9); G.bountyRef = null;
  G.cycle = cpNum(cp.cycle, 1, 1, 99);
  G.swords = cpNum(cp.swords, 0, 0, 3);
  G.rerollExtra = cpNum(cp.rerollExtra, 0, 0, 20);
  G.swordDmg = !!cp.swordDmg; G.swordCool = [0,0,0]; G.swordBlock = cpNum(cp.swordBlock, 0, 0, 9);
  G.saveUsed = !!cp.saveUsed;
  G.shopBuys = cpNum(cp.shopBuys, 0, 0, 60);
  /* 刷新次数也存：不存的话在商店里刷新页面，本轮刷新价就回到最低档 */
  G.shopRolls = cpNum(cp.shopRolls, 0, 0, 40);
  G.comboCores = cpNum(cp.comboCores, 0, 0, 1e6);
  G.comboBest = cpNum(cp.comboBest, 0, 0, 1e6);
  /* 复活机会只能给一次，读档必须还原这个状态，否则刷新页面等于白送一次复活 */
  G.revived = !!cp.revived;
  if (cp.canRevive === false) G.canRevive = false;
  G.bossKills = cpNum(cp.bossKills, 0, 0, 1e6);
  G.comboK = cpNum(cp.comboK, 0, 0, 1e6);
  G.quest = null;
  var cq = cpObj(cp.quest);
  if (cq && typeof cq.wave0 !== 'undefined'){
    var qWave0 = cpNum(cq.wave0, -1, 0, 2000);
    if (qWave0 > 0){
      G.quest = {
        type: cq.type === 'nohit' ? 'nohit' : 'kill',
        need: cpNum(cq.need, 0, 0, 1e4), kills0: cpNum(cq.kills0, 0, 0, 1e9),
        taken0: cpNum(cq.taken0, 0, 0, 1e9), done: !!cq.done, wave0: qWave0
      };
    }
  }
  G.hist = [];
  if (Array.isArray(cp.hist)){
    for (var hi2=0; hi2<cp.hist.length && hi2<40; hi2++){
      var hv = cpNum(cp.hist[hi2], null);
      if (hv !== null) G.hist.push(hv);
    }
  }
  G.enemies = []; G.ebullets = []; G.bullets = []; G.gems = []; G.pickups = [];
  if (cp.player){
    /* 读档必须深拷贝：直接接管 cp.player 会让存档与当前角色同一对象，之后的回血/掉血写回存档，下次恢复就不是那一刻的状态；缺字段/NaN 也会传染整局。 */
    var pp = JSON.parse(JSON.stringify(cp.player));
    /* 存档的 player 可能缺大半字段（老版本/手改）：缺 vx/smvx/cd/aim 会让镜头算出 NaN、地图索引踩 bins[NaN]。先用新角色默认值补齐，坏值再由 numF/numP 兜。 */
    var bpl = G.player || {};
    for (var bk in bpl){
      if (pp[bk] === undefined){
        var bv = bpl[bk];
        if (typeof bv === 'number' || typeof bv === 'boolean' || typeof bv === 'string') pp[bk] = bv;
      }
    }
    var numF = function(k, d){ if (typeof pp[k] !== 'number' || !isFinite(pp[k])) pp[k] = d; };
    numF('hpMax', 100); numF('hp', pp.hpMax); numF('exp', 0); numF('expNext', 8); numF('level', 1);
    /* 坐标缺失/NaN 会把相机、敌人网格的索引算成 NaN（bin 里 bins[NaN].push 直接抛异常整局卡死） */
    numF('x', 0); numF('y', 0);
    numF('rate', 1.6); numF('dmg', 12); numF('spd', 190); numF('rng', 420);
    numF('collect', 70); numF('crit', 0.05); numF('cmul', 1.9); numF('armor', 0); numF('regen', 0);
    /* 这几个为 0 或负数会直接算出 Infinity/NaN（rate=0 → 冷却 1/0），必须回落到默认正值 */
    var numP = function(k, d){ if (!(pp[k] > 0) || !isFinite(pp[k])) pp[k] = d; };
    numP('rate', 1.6); numP('dmg', 12); numP('rng', 420); numP('spd', 190); numP('cmul', 1.9);
    /* 这几个值为 0 或负会直接出事：expNext 为 0 → addExp 的 while 永远减不掉经验，
       hpMax 为 0 → 血条上限归零、hp 被钳成 0 却还活着 */
    if (!(pp.expNext > 0)) pp.expNext = 8;
    if (!(pp.hpMax > 0)) pp.hpMax = 100;
    if (!(pp.rate > 0)) pp.rate = 1.6;
    if (!(pp.dmg > 0)) pp.dmg = 12;
    if (!(pp.spd > 0)) pp.spd = 190;
    if (!(pp.rng > 0)) pp.rng = 420;
    pp.level = Math.max(1, Math.min(LEVEL_CAP, pp.level));
    pp.hp = Math.min(Math.max(1, pp.hp), pp.hpMax);
    G.player = pp;
  }
  if (G.player.level > LEVEL_CAP){ G.player.level = LEVEL_CAP; G.player.exp = 0; G.player.expNext = 1; }
  /* 这四个是"id → 次数/标记"的字典，被写坏成数组或字符串时直接当对象用会在严格模式下抛 TypeError */
  G.stacks = cpObj(cp.stacks) || {}; G.evoDone = cpObj(cp.evoDone) || {};
  G.school = cpObj(cp.school) || {}; G.schoolDone = cpObj(cp.schoolDone) || {};
  G.mods = (Array.isArray(cp.mods) ? cp.mods : []).map(function(m){
    /* 存档里的 mods 可能被写坏（null / 字符串 / 不存在的 id）：这里读 m.st 会直接抛，
       而整段在一个 try 里，抛出去等于整局异变信息全丢 */
    if (!m || typeof m !== 'object' || typeof m.id !== 'string') return null;
    var known = false;
    for (var mz=0; mz<MODS.length; mz++) if (MODS[mz].id === m.id){ known = true; break; }
    if (!known) return null;
    var st = cpObj(m.st) || {};
    /* 全部字段过一遍默认值（不只是计时器）：endModifiers 要拿乘数做除法，缺一项就是 NaN */
    ensureModSt(st);
    if (st._ok) delete st._ok;   /* 校验标记不进存档，读回来要重新校验一次 */
    return {id:m.id, name:m.name, tip:m.tip, st:st};
  }).filter(Boolean);
  G.escortT = 0; G.meteorT2 = 0;
  G.modState = {};
  refreshModFlags();   /* 读档恢复的异变也要立刻反映到预算标志 */
  G.resuming = true;
  waveStart();
  G.resuming = false;
  /* 读档保留本波异变：waveStart 的 endModifiers 会整体撤掉异变，撒手会让战力掉回基线、守点/毒圈/猎手消失。这里按存档值重放并重建实体。 */
  var rmods = Array.isArray(cp.mods) ? cp.mods : [];
  if (rmods.length){
    for (var rmi=0; rmi<rmods.length; rmi++){
      var rm0 = rmods[rmi];
      /* 存档里的 mods 可能被写坏（null / 字符串 / 不存在的 id）：直接读 .id 就会抛 */
      if (!rm0 || typeof rm0 !== 'object') continue;
      var rdef = null;
      for (var rmk=0; rmk<MODS.length; rmk++){ if (MODS[rmk].id === rm0.id){ rdef = MODS[rmk]; break; } }
      if (!rdef) continue;
      var rbefore = G.mods.length;
      applyModifier(rdef);
      if (G.mods.length > rbefore && rmods[rmi].st){
        /* 存档里的状态值优先（reso 的系别、计时器等），但只认有限数，NaN 不许进 */
        var rst = G.mods[G.mods.length-1].st, rsrc = rm0.st;
        if (!rsrc || typeof rsrc !== 'object') rsrc = {};
        for (var rk in rsrc){
          var rv = rsrc[rk];
          if (typeof rv === 'number'){ if (isFinite(rv)) rst[rk] = rv; }
          else if (typeof rv === 'string') rst[rk] = rv;
        }
      }
    }
    G.modState = {};
    refreshModFlags();
  }
  if (typeof cp.waveT === 'number') G.waveT = Math.min(G.waveLen - 1, Math.max(0, cp.waveT));
  /* 前面的 waveStart 与异变重放会顺手治一次血（waveStart 的波次治疗），
     读档应当是"精确回到存档那一刻"，所以最后再把生命拉回存档值 */
  if (cp.player && typeof cp.player.hp === 'number' && isFinite(cp.player.hp)){
    var rhp = Math.min(G.player.hpMax, Math.max(1, cp.player.hp));
    if (G.player.hp > rhp) G.player.hp = rhp;
  }
  /* 本波治疗额度必须在 waveStart 之后恢复：waveStart 每波都会把额度清零，
     早于它赋值等于白写（读档后又能蹭一次满额回血） */
  G.waveHeal = Math.max(0, typeof cp.waveHeal === 'number' ? cp.waveHeal : 0);
  /* waveStart 在 resuming 里跳过了存档，这里把"钉回存档值后的状态"补存一次，
     否则内存与存档不一致，下次继续又会从旧血值算起 */
  try { saveCheckpoint(); } catch(e){}
  toast('继续 · 第 ' + (cp.wave) + ' 波');
}

/* 悬赏精英：每波随机来一只强化精英，击杀给金币与星核；走丢/超时不给 */
function spawnBounty(){
  if (G.training || G.practice) return;
  if (G.wave < 3 || G.wave % 5 === 0) return;   /* 首领波已经有 boss，不再叠一只 */
  var e = spawnEnemy(G.wave >= 6 ? 'tank' : 'swarm');
  if (!e) return;
  e.elite = true;
  e.bounty = true;
  e.hp *= 4.5; e.hpMax *= 4.5;   /* 悬赏要比同波精英硬得多，不能一枪就没了 */
  e.spd *= 1.12;
  G.bountyRef = e;
  if (G.wave === 3) hint('悬赏精英出现了：击杀它额外拿金币与星核', 4200);
}

function spawnWaveContent(){
  var bossWave = (G.wave % 5 === 0);
  if (bossWave) spawnBoss();
  else {
    toast('第 ' + G.wave + ' 波');
    for (var wi=0; wi<3 && wi<G.wave; wi++) spawnEnemy('grunt');
    if (modOn('swarmlord')) for (var sl=0; sl<6; sl++) spawnEnemy('grunt');
  }
  /* 双生首领以前只写在 else 分支里，首领波永远遇不到这一条异变。
     现在首领波也叠一对，但血量/伤害再砍一档，别让一局同时吃三个首领 */
  if (modOn('twin')){
    spawnTwinBosses(bossWave);
    if (bossWave) comboToast('双生首领加入战场');
  }
  showModToast();
  tone(660, 0.12, 'sine', 0.05);
}

/* --- 倍速 --- */
var SPEEDS = [0.5,1,2,3,5,10];

function applySpeedLabel(){
  var b = document.getElementById('btnSpeed');
  if (b) b.textContent = '×' + ((G && G.speed) || (S && S.set.speed) || 1);
}

function setSpeed(v){
  if (!G) return;
  G.speed = v;
  S.set.speed = v;
  applySpeedLabel();
  saveNow();
  toast('速度 ×' + v);
}

function cycleSpeed(dir){
  if (!G) return;
  var cur = G.speed || 1;
  var idx = 0, bestGap = 1e9;
  for (var i=0;i<SPEEDS.length;i++){
    if (SPEEDS[i] === cur){ idx = i; bestGap = 0; break; }
    /* 自动降速后 G.speed 可能不在档位表里（例如 1.5），按最近的档位继续切 */
    var gap = Math.abs(SPEEDS[i] - cur);
    if (gap < bestGap){ bestGap = gap; idx = i; }
  }
  idx = (idx + dir + SPEEDS.length) % SPEEDS.length;
  if (SPEEDS[idx] === cur) return;
  setSpeed(SPEEDS[idx]);
  sfx('ui');
}

/* --- 波间异变（可叠加） --- */
/* 每帧要写两次（完整串 + 三条摘要），每次都新建数组 + 线性查重。
   异变只在开波变化，按"条数+末条 id"做一次缓存就够了 */
function modNames(limit){
  var cache = G._mnC;
  var key = G.mods.length + '|' + (G.mods.length ? G.mods[G.mods.length-1].id : '');
  if (!cache || cache[key] === undefined){
    var out0 = [], seen = {};
    for (var j=0;j<G.mods.length;j++){
      var nm = G.mods[j].name;
      if (!seen[nm]) { seen[nm] = 1; out0.push(nm); }
    }
    cache = G._mnC = {};
    cache[key] = {all: out0.join(' · '), arr: out0};
  }
  var e = cache[key], out = e.arr;
  if (limit && out.length > limit) return out.slice(0, limit).join(' · ') + ' 等' + out.length + '种';
  return e.all;
}

/* 最坑的一条：按削弱玩家的程度排序挑一条显示 */
var WORST_ORDER = ['noheal','armored','bossrage','rush','siege','swarmlord','famine',
                   'allin','pact','brittle','shadow','gravity','bloodmoon','barrage','sniper',
                   'frenzy','hunt','hunter','greedpact','greed','storm'];
function worstMod(){
  if (!G || !G.mods || !G.mods.length) return null;
  /* 每帧都要画「最坑」，异变只在开波变，按条数+末条 id 记住结果 */
  var wkey = G.mods.length + '|' + (G.mods[G.mods.length-1].id || '');
  var wc = G._wmC;
  if (wc && wc.k === wkey) return wc.v;
  var best = null, bestRank = 1e9;
  for (var i=0;i<G.mods.length;i++){
    var r = WORST_ORDER.indexOf(G.mods[i].id);
    if (r < 0) continue;
    if (r < bestRank){ bestRank = r; best = G.mods[i]; }
  }
  G._wmC = {k: wkey, v: best};
  return best;
}

function showModToast(){
  if (!G.mods.length) return;
  if (G.mods.length <= 2) toast('异变 · ' + modNames());
  else toast('异变 · ' + G.mods.length + ' 条同时生效');
}

/* 命中与击杀是每帧几十次的热路径，modOn 每次都要用字符串键查一遍缓存表；
   这里把常查的几项预算成布尔/倍率，异变集合变化时统一刷新 */
var MODF = {armored:false, swift:false, famine:false};
var COINMUL = 1;
function refreshModFlags(){
  MODF.armored = modOn('armored');
  MODF.swift = modOn('swift');
  MODF.famine = modOn('famine');
  var cm = 1;
  if (modOn('air')) cm *= 2;
  if (modOn('bloodmoon')) cm *= 3;
  if (modOn('greed')) cm *= 2;
  if (modOn('famine')) cm *= 1.4;
  if (modOn('greedpact')) cm *= 3;
  COINMUL = cm;
}

function modOn(id){
  var c = G.modCache;
  if (!c){ c = G.modCache = {}; }
  if (c[id] === undefined){
    var v = false;
    for (var i=0;i<G.mods.length;i++) if (G.mods[i].id === id){ v = true; break; }
    c[id] = v;
  }
  return c[id];
}

function modPickCount(wave){
  var base = wave < 10 ? 1 : (Math.floor(wave / 10) + 1);
  return base + Math.max(0, (G.cycle || 1) - 1);
}

function pickModifiers(){
  var n = modPickCount(G.wave);
  /* 同一条异变本轮不抽第二次：两个 armored 叠起来等于难度翻倍，
     而 HUD 的「异变 N 条」按名字去重，玩家看到条数和名字对不上 */
  var used = {};
  for (var u=0;u<G.mods.length;u++) used[G.mods[u].id] = 1;
  var guard = 0;
  while (n > 0 && guard++ < 400){
    var m = MODS[Math.floor(Math.random()*MODS.length)];
    if (used[m.id]) continue;
    used[m.id] = 1;
    applyModifier(m);
    n--;
  }
}

function applyModifier(m){
  G.modCache = null;
  refreshModFlags();
  var p = G.player;
  S.modSeen[m.id] = (S.modSeen[m.id] || 0) + 1;
  var inst = {id:m.id, name:m.name, tip:m.tip, st:{}};
  G.mods.push(inst);
  if (m.id === 'storm'){
    inst.st.rateMul = 1.4; inst.st.rngMul = 0.7;
    p.rate *= 1.4; p.rng *= 0.7;
  }
  if (m.id === 'reso'){
    var keys = ['ball','blast','field'];
    inst.st.school = keys[Math.floor(Math.random()*keys.length)];
    var pool = 1;
    for (var rp=0; rp<G.mods.length-1; rp++){
      if (G.mods[rp].id === 'reso' && G.mods[rp].st.school === inst.st.school) pool++;
    }
    if (pool > 1){
      // 重复共鸣：让该系权重继续累加，质变门槛再降 1
      inst.st.schoolBonus = pool;
    }
  }
  if (m.id === 'magnet'){
    p.collect *= 3;
    inst.st.collectMul = 3;
  }
  if (m.id === 'hunter' && !G.hunter){
    var ha = rnd(0, 6.28);
    G.hunter = {x:p.x+Math.cos(ha)*700, y:p.y+Math.sin(ha)*700, r:22, spd:205, tcd:0, grow:0};
  }
  if (m.id === 'zone' && !G.zone){
    var zr = Math.max(VW, VH)*0.9;
    G.zone = {x:p.x, y:p.y, r:zr, r0:zr, min:Math.min(210, Math.min(VW,VH)*0.3), t:0, speed:1};
  }
  if (m.id === 'hold' && !G.hold){
    G.hold = {x:p.x, y:p.y, r:Math.min(165, Math.min(VW,VH)*0.34), out:0, warn:0, done:false};
  }
  if (m.id === 'gravity'){
    p.spd *= 0.8; p.dmg *= 1.35;
    inst.st.spdMul = 0.8; inst.st.dmgMul = 1.35;
  }
  if (m.id === 'brittle'){
    p.armor *= 0.65; p.spd *= 1.15; p.rate *= 1.1;
    inst.st.armorMul = 0.65; inst.st.spdMul = 1.15; inst.st.rateMul = 1.1;
  }
  if (m.id === 'pact'){
    p.dmgAdd += 0.5; p.hpMax *= 0.8; p.hp = Math.min(p.hp, p.hpMax);
    inst.st.hpMul = 0.8; inst.st.dmgAdd = 0.5;   /* 记下来，换波要减回去 */
  }
  if (m.id === 'shadow'){
    p.spd *= 1.35; p.armor *= 0.5;
    inst.st.spdMul = 1.35; inst.st.armorMul = 0.5;
  }
  if (m.id === 'allin'){
    p.rate *= 1.6; p.dmgTake = (p.dmgTake || 1) * 1.3;
    inst.st.rateMul = 1.6; inst.st.dmgTakeMul = 1.3;   /* 同上：易伤是本波限定的 */
  }
  if (m.id === 'phantom') inst.st.phantomT = 6;
  if (m.id === 'thunder') inst.st.thunderT = 1.5;
  if (m.id === 'gem') inst.st.gemT = 0.2;
  if (m.id === 'meteor') inst.st.meteorT = 1.2;
  if (m.id === 'hunt') inst.st.huntT = 7;
}

function endModifiers(){
  G.modCache = null;
  refreshModFlags();
  for (var i=0;i<G.mods.length;i++){
    var m = G.mods[i];
    /* 坏存档里 st 缺字段时，除出来就是 NaN，属性一崩整局就废 */
    var st = ensureModSt(m.st);
    if (m.id === 'storm'){
      G.player.rate /= st.rateMul;
      G.player.rng /= st.rngMul;
    }
    if (m.id === 'magnet'){
      G.player.collect /= st.collectMul;
    }
    if (m.id === 'gravity'){
      G.player.spd /= st.spdMul;
      G.player.dmg /= st.dmgMul;
    }
    if (m.id === 'brittle'){
      G.player.armor /= st.armorMul;
      G.player.spd /= st.spdMul;
      G.player.rate /= st.rateMul;
    }
    if (m.id === 'pact'){
      G.player.hpMax /= st.hpMul;
      /* 伤害加成是异变给的，换波必须减回去，否则"血债"每波白送 +50% 永久伤害 */
      G.player.dmgAdd = Math.max(0, (G.player.dmgAdd || 0) - (st.dmgAdd || 0));
      G.player.hp = Math.min(G.player.hp, G.player.hpMax);
    }
    if (m.id === 'shadow'){
      G.player.spd /= st.spdMul;
      G.player.armor /= st.armorMul;
    }
    if (m.id === 'allin'){
      G.player.rate /= st.rateMul;
      /* 同理：易伤 ×1.3 不还原，几波后叠成秒杀 */
      if (G.player.dmgTake && st.dmgTakeMul) G.player.dmgTake = Math.max(1, G.player.dmgTake / st.dmgTakeMul);
    }
  }
  G.mods = []; G.modState = {};
  G.hunter = null; G.zone = null; G.hold = null; G.meteors = [];
}

/* 异变状态字段的默认值：任何一条 st 缺字段或被存档写坏，都会让 xxx -= dt 变成 NaN，
   之后这个异变就永久哑火（gemT 那种还会每帧都触发一次）。每个异变只校验一次。 */
var ST_DEF = {gemT:0.55, zoneSfx:0, thunderT:1.5, phantomT:6, meteorT:2.4, huntT:0,
              rateMul:1, rngMul:1, spdMul:1, dmgMul:1, armorMul:1, hpMul:1, collectMul:1,
              schoolBonus:1, dmgTakeMul:1, dmgAdd:0};
/* st 校验抽成函数：updateModifiers 与 endModifiers 都要用。
   原来只在 update 里校验，但换波时 endModifiers 先跑，坏字段会直接除出 NaN。 */
function ensureModSt(st){
  if (!st) st = {};
  if (st._ok !== true){
    st._ok = true;
    for (var sk in ST_DEF){
      if (typeof st[sk] !== 'number' || !isFinite(st[sk])) st[sk] = ST_DEF[sk];
    }
  }
  return st;
}

function updateModifiers(dt){
  var p = G.player;
  for (var mi=0; mi<G.mods.length; mi++){
    var m = G.mods[mi];
    var st = ensureModSt(m.st);

    if (m.id === 'gem'){
      st.gemT -= dt;
      if (st.gemT <= 0){
        st.gemT = 0.55;
        for (var gi=0; gi<3; gi++){
          addGem(p.x+rnd(-460,460), p.y+rnd(-420,420), 1, false);
        }
      }
    }

    if (m.id === 'hunter' && G.hunter){
      var h = G.hunter;
      h.grow += dt; h.spd = 205 + h.grow*4.2;
      var ha = Math.atan2(p.y-h.y, p.x-h.x);
      h.x += Math.cos(ha)*h.spd*dt; h.y += Math.sin(ha)*h.spd*dt;
      h.tcd -= dt;
      var hart = h.r + p.r + 4;
      if (dist2(h.x,h.y,p.x,p.y) < hart*hart && h.tcd <= 0){
        h.tcd = 0.9;
        G.shake = Math.max(G.shake, 8);
        if (damagePlayer(14, 'hunter')) return;
      }
    }

    if (m.id === 'zone' && G.zone){
      var z = G.zone;
      z.t += dt;
      z.r = Math.max(z.min, z.r0 - (z.r0 - z.min) * (G.waveT / G.waveLen));
      if (dist2(p.x,p.y,z.x,z.y) > z.r*z.r){
        /* 无敌帧（受击后/虚影异变）期间毒圈也不该扣血，否则"虚影"完全名不副实 */
        if (p.invul > 0) continue;
        p.hp -= 9*dt*armorTaken(p.armor);
        p.hurtFlash = Math.max(p.hurtFlash, 0.18);
        if (G.time > (st.zoneSfx || 0)){ st.zoneSfx = G.time + 0.9; sfx('hurt'); }
        if (p.hp <= 0){ p.hp = 0; G.deathCause = '毒圈'; gameOver(); return; }
      }
    }

    if (m.id === 'hold' && G.hold){
      var ho = G.hold;
      if (!ho.done){
        if (dist2(p.x,p.y,ho.x,ho.y) > ho.r*ho.r){
          ho.out += dt;
          if (ho.out >= 5){
            ho.done = true;
            toast('发生器失守');
            if (damagePlayer(p.hpMax*0.25, 'hold')) return;
          }
        } else ho.out = Math.max(0, ho.out - dt*1.6);
      }
    }

    if (m.id === 'meteor'){
      st.meteorT -= dt;
      if (st.meteorT <= 0){
        st.meteorT = 2.4;
        var mx = p.x + rnd(-VW*0.45, VW*0.45);
        var my = p.y + rnd(-VH*0.45, VH*0.45);
        G.meteors.push({x:mx, y:my, t:0.75, r:92, hit:false});
      }
      for (var md=G.meteors.length-1; md>=0; md--){
        var me = G.meteors[md];
        me.t -= dt;
        if (me.t <= 0 && !me.hit){
          me.hit = true;
          var mdmg = pdmg()*4.5;
          for (var ei=0; ei<G.enemies.length; ei++){
            var ee = G.enemies[ei];
            if (ee.dead) continue;
            if (dist2(ee.x, ee.y, me.x, me.y) < me.r*me.r) hitEnemy(ee, mdmg, true);
          }
          burst(me.x, me.y, '#b5563a', 300, 16);
          /* 陨石落点的范围环同样去掉，落点圈由 drawMeteors 的准星承担 */
          G.shake = Math.max(G.shake, 6);
          sfx('boss');
        }
        if (me.t < -0.5) G.meteors.splice(md,1);
      }
    }

    if (m.id === 'phantom'){
      st.phantomT -= dt;
      if (st.phantomT <= 0){ st.phantomT = 6; p.invul = Math.max(p.invul, 0.9); }
    }

    if (m.id === 'thunder'){
      st.thunderT -= dt;
      if (st.thunderT <= 0){
        st.thunderT = 2.2;
        var te = nearestEnemy(p.x, p.y, 560);
        if (te){
          var tdmg = pdmg()*2.5, chain = [te];
          hitEnemy(te, tdmg, false);
          G.zaps.push({x1:p.x, y1:p.y-20, x2:te.x, y2:te.y, t:0.32});
          for (var ch=0; ch<2; ch++){
            var last = chain[chain.length-1], best = null, bd = 110*110;
            for (var ci=0; ci<G.enemies.length; ci++){
              var ce = G.enemies[ci];
              if (ce.dead || chain.indexOf(ce) >= 0) continue;
              var cdd = dist2(ce.x, ce.y, last.x, last.y);
              if (cdd < bd){ bd = cdd; best = ce; }
            }
            if (!best) break;
            chain.push(best);
            hitEnemy(best, tdmg*0.8, false);
            G.zaps.push({x1:last.x, y1:last.y, x2:best.x, y2:best.y, t:0.32});
          }
          sfx('boss');
        }
      }
    }

    if (m.id === 'hunt'){
      st.huntT -= dt;
      if (st.huntT <= 0){
        st.huntT = 7;
        var he = spawnEnemy('elite');
        if (he){ he.elite = true; he.hp *= 1.5; he.hpMax *= 1.5; }
      }
    }
  }
  for (var zi=G.zaps.length-1; zi>=0; zi--){
    G.zaps[zi].t -= dt;
    if (G.zaps[zi].t <= 0) G.zaps.splice(zi,1);
  }
}

function spawnTwinBosses(withBoss){
  var p = G.player;
  var hpK = withBoss ? 0.2 : 0.34, dmgK = withBoss ? 0.42 : 0.55;
    /* 首领波叠双生只在普通/困难保持原系数，噩梦、地狱再各削一档 */
    if (withBoss){
      var dk2 = (G.diff && G.diff.key === 'inferno') ? 0.7 : ((G.diff && G.diff.key === 'nightmare') ? 0.82 : 1);
      hpK *= dk2; dmgK *= dk2;
    }
  for (var ti=0; ti<2; ti++){
    var b = BDEF[(G.wave + ti) % BDEF.length];
    var ang = rnd(0, 6.28);
    var rad = Math.max(340, Math.min(390, Math.min(VW,VH)*0.9));
    var e = {
      type:'elite', x:p.x+Math.cos(ang)*rad, y:p.y+Math.sin(ang)*rad, r:b.r*0.8,
      hp:b.hp*hpK*G.diff.hpMul, hpMax:b.hp*hpK*G.diff.hpMul,
      spd:b.spd*1.1, dmg:b.dmg*dmgK, col:b.col, xp:14,
      rot:0, tcd:0, timer:1.6, hurt:0, dead:false,
      boss:false, elite:true, mini:true, shoot:true, bossDef:b
    };
    G.enemies.push(e);
  }
}

/* --- 波间商店 --- */
var shopItems = [], shopWave = 0;

function openShop(){
  /* 重复调用会把「本波已刷 N 次」清零，等于白送一次低价重刷，也会重复掷异变 */
  if (!G || G.state === 'shop') return;
  shopWave = G.wave;
  G.shopRolls = 0;   /* 刷新加价按"本波"算，进新一波要清零，否则一局内永远封顶 12 */
  /* 淬锋的解锁门槛按"进店时手上的剑数"冻结：本店里现买满三把不能当场开锋，
     否则同一格先卖剑再卖升级，等于把两次决策压成一次 */
  G.shopSwordsAtOpen = G.swords || 0;
  if (G.wave >= 6) pickModifiers();
  if (G.wave === 56) toast('活动区开始收缩，边界逼近');
  G.state = 'shop';
  JOY.active = false; JOY.dx = 0; JOY.dy = 0;
  document.getElementById('shopKicker').textContent = '第 ' + G.wave + ' 波前 · 补给站'
    + (G.mods.length ? (' · 异变 ' + modNames(4)) : '');
  rollShop();
  showScreen('scrShop');
  sfx('coin');
}

function shopPrice(it){
  var buys = (G && G.shopBuys) || 0;
  var rolls = (G && G.shopRolls) || 0;
  var waveM = 1 + 0.10 * Math.max(0, (shopWave || 0) - 5);
  var cumM = 1 + 0.26 * buys + 0.12 * rolls;   /* 单局累计涨价收敛：买 10 件约 ×3.6，而不是原来的 ×5.2 */
  /* 急救包按缺血浮动：满血半价，越缺血越贵（补贴越多） */
  var hpM = 1;
  if (it.id === 'med' && G && G.player){
    var miss = Math.min(1, Math.max(0, 1 - G.player.hp / (G.player.hpMax || 1)));
    hpM = 0.5 + miss;
  }
  return Math.round(it.base * waveM * cumM * hpM);
}

function rollShop(){
  var pool = SHOP_POOL.slice();
  shopItems = [];
  while (shopItems.length < 3 && pool.length){
    var idx = Math.floor(Math.random()*pool.length);
    var it = pool.splice(idx,1)[0];
    shopItems.push({def:it, sold:false, price:shopPrice(it)});
  }
  renderShop();
}

function renderShop(){
  document.getElementById('shopCoins').textContent = fmt(coinNow());
  var html = '';
  for (var i=0;i<shopItems.length;i++){
    var s2 = shopItems[i], d = s2.def;
    var can = coinNow() >= s2.price && !s2.sold;
    var extra = s2.price - (d.base || 0);
    var priceNote = extra > 0
      ? '　<span style="color:#c8a24e;opacity:.8">基础 ' + d.base + ' · 现价 ' + s2.price + '</span>'
      : '';
    /* 原本文案写"已涨 +N"，但 N 里混了波次涨幅，读起来像"我买贵了 N" */
    html += '<div class="row"' + (s2.sold ? ' style="opacity:.45"' : '') + '><div class="info"><h4>' + (i+1) + '. ' + d.name + '</h4>'
      + '<p>' + d.desc + priceNote + '</p></div>'
      + (s2.sold ? '<button class="buy" disabled>已购 ✓</button>'
                 : '<button class="buy" data-shop="' + i + '"' + (can ? '' : ' disabled') + '>' + fmt(s2.price) + '</button>')
      + '</div>';
  }
  var ns = G.swords || 0;
  var bl = document.getElementById('buildList');
  if (bl) bl.innerHTML = '';
  if (ns < 3){
    var sprice = 70 + ns*80, needC = sprice - coinNow();
    html += '<div class="row"><div class="info"><h4>' + (shopItems.length+1) + '. 飞剑 · 护身</h4>'
      + '<p>第 ' + (ns+1) + ' 把 · 环绕周身替你挡下一次伤害（一把只能挡一次）；最多 3 把（已有 ' + ns + ' / 3）'
      + (needC > 0 ? '　<span style="color:#c8a24e;opacity:.8">还差 ' + fmt(needC) + ' 金币</span>' : '') + '</p></div>'
      + '<button class="buy" data-sword="1"' + (coinNow() >= sprice ? '' : ' disabled') + '>' + fmt(sprice) + '</button>'
      + '</div>';
  } else if (!G.swordDmg){
    if ((G.shopSwordsAtOpen || 0) < 3){
      /* 本店才把三把凑齐：这一格先锁上，等下个补给站再开锋 */
      html += '<div class="row" style="opacity:.55"><div class="info"><h4>' + (shopItems.length+1) + '. 飞剑 · 淬锋</h4>'
        + '<p>三把齐了（3 / 3）· 刃口淬锋要等<b>下一次补给站</b>——本店先收剑，下店才能开锋</p></div>'
        + '<button class="buy" disabled>下次补给站</button></div>';
    } else {
      /* 三把是上一站就凑满的，这一格给「淬锋」升级：飞剑开始带伤害 */
      var upPrice = 220;
      html += '<div class="row"><div class="info"><h4>' + (shopItems.length+1) + '. 飞剑 · 淬锋</h4>'
        + '<p>三把已满（3 / 3）· 刃口带上伤害：贴着敌人各削一次「当前 DPS 的一半」，每把 0.5 秒一次，且随波次成长</p></div>'
        + '<button class="buy" data-swordup="1"' + (coinNow() >= upPrice ? '' : ' disabled') + '>' + fmt(upPrice) + '</button>'
        + '</div>';
    }
  } else {
    html += '<div class="row"><div class="info"><h4>' + (shopItems.length+1) + '. 飞剑 · 已淬锋</h4>'
      + '<p>三把剑都已开锋，护身与杀伤并存</p></div>'
      + '<button class="buy" disabled>已满</button></div>';
  }
  document.getElementById('shopList').innerHTML = html;
  var sr = document.getElementById('btnShopReroll');
  var sc = shopRollCost();
  sr.disabled = coinNow() < sc;
  var srl = (G.shopRolls || 0);
  sr.textContent = '刷新商品 · ' + sc + ' 金币' + (srl ? '（本波已刷 ' + srl + ' 次）' : '') + '（快捷键 4）';
  /* 一键买：从便宜的买起，钱够全买就全买，钱不够就买到买不起为止 */
  var sa = document.getElementById('btnShopAll');
  if (sa){
    var cnt2 = 0, minP = Infinity;
    for (var bi2=0; bi2<shopItems.length; bi2++){
      var it2 = shopItems[bi2];
      if (it2 && !it2.sold){ cnt2++; if (it2.price < minP) minP = it2.price; }
    }
    var ns2 = G.swords || 0;
    if (ns2 < 3){ cnt2++; var sp2 = 70 + ns2*80; if (sp2 < minP) minP = sp2; }
    else if (!G.swordDmg && (G.shopSwordsAtOpen || 0) >= 3){ cnt2++; if (220 < minP) minP = 220; }
    if (!cnt2){ sa.disabled = true; sa.textContent = '本店已买完'; }
    else if (coinNow() < minP){ sa.disabled = true; sa.textContent = '金币不足'; }
    else { sa.disabled = false; sa.textContent = '一键买下能买的 · ' + cnt2 + ' 项（含飞剑）'; }
  }
}

function buyAllShop(){
  if (!G || G.state !== 'shop') return;
  /* 强化卡、飞剑、淬锋统一进候选，按现价从低到高，能买就买；飞剑每买一把价会涨，所以一轮一轮算 */
  var done = 0, spent = 0, rounds = 0;
  while (rounds++ < 10){
    var opts = [];
    for (var i=0; i<shopItems.length; i++){
      var s2 = shopItems[i];
      if (s2 && !s2.sold) opts.push({p: s2.price, k: 0, it: s2});
    }
    var ns = G.swords || 0;
    if (ns < 3) opts.push({p: 70 + ns*80, k: 1});
    else if (!G.swordDmg && (G.shopSwordsAtOpen || 0) >= 3) opts.push({p: 220, k: 2});
    if (!opts.length) break;
    opts.sort(function(a,b){ return a.p - b.p; });
    var pick = null;
    for (var j=0; j<opts.length; j++){ if (coinNow() >= opts[j].p){ pick = opts[j]; break; } }
    if (!pick) break;
    if (pick.k === 0){
      G.coins -= pick.p;
      pick.it.sold = true;
      G.shopBuys = (G.shopBuys || 0) + 1;
      pick.it.def.apply(G.player);
    } else {
      G.coins -= pick.p;
      if (pick.k === 1) addBlade(); else upgradeBlades();
    }
    done++; spent += pick.p;
  }
  renderShop();
  if (!done){ toast('金币不足'); return; }
  toast('已买 ' + done + ' 项 · 花费 ' + fmt(spent) + ' 金币');
  sfx('coin');
}

function buyShopItem(i){
  var s2 = shopItems[i];
  if (!s2 || s2.sold) return;
  if (coinNow() < s2.price){ toast('金币不足'); return; }
  G.coins -= s2.price;
  s2.sold = true;
  G.shopBuys = (G.shopBuys || 0) + 1;
  s2.def.apply(G.player);
  toast(s2.def.name);
  sfx('coin');
  renderShop();
}

function shopRollCost(){
  /* 同一波内越刷越贵，防无限刷经济 */
  return Math.min(12, 3 + 2 * (G.shopRolls || 0));
}
function rerollShop(){
  var c = shopRollCost();
  if (coinNow() < c){ toast('金币不足'); return; }
  G.coins -= c;
  G.shopRolls = (G.shopRolls || 0) + 1;
  rollShop();
  sfx('ui');
}

function closeShop(){
  /* 连点/双击时按钮还会被命中第二次：不拦就把同一波内容生成两遍，怪直接翻倍而波数不变 */
  if (!G || G.state !== 'shop') return;
  G.state = 'playing';
  showScreen(null);
  spawnWaveContent();
}

var LEVEL_CAP = 120;

/* 满级后磁铁彻底没用了：一次性把场上残留的磁铁清掉，别留着占画面 */
function purgeMagnetPickups(){
  if (!G || G.maxPurged) return;
  G.maxPurged = true;
  for (var mp = G.pickups.length - 1; mp >= 0; mp--) if (G.pickups[mp].type === 'magnet') G.pickups.splice(mp,1);
}

function addExp(v){
  var p = G.player;
  if (p.level >= LEVEL_CAP){
    /* 满级后晶体还在源源不断掉，留着只会被吞掉：按 0.2 折成金币，让后期仍有收益 */
    p.level = LEVEL_CAP; p.exp = 0;
    if (v > 0){ G.coins += Math.round(v * 2) / 10; G.expOver = (G.expOver || 0) + v; }
    if (!G.maxTip){ G.maxTip = true; toast('已满级：经验自动折成金币，磁铁不再掉落'); }
    purgeMagnetPickups();
    return;
  }
  p.exp += v;
  var guard = 0;
  while (p.exp >= p.expNext){
    if (++guard > 120){ p.exp = 0; break; }
    p.exp -= p.expNext;
    p.level++;
    p.expNext = Math.min(1e12, Math.round(8 * Math.pow(1.19, p.level-1)));
    if (p.level > S.stats.maxLevel) S.stats.maxLevel = p.level;
    if (p.level >= LEVEL_CAP){
      p.level = LEVEL_CAP; p.exp = 0; p.expNext = 1;
      purgeMagnetPickups();
      showUpgrade();
      return;
    }
    if (showUpgrade() === false) break;
    if (G.state !== 'playing') return;
  }
}

/* 敌方弹幕统一入口：异变叠多个首领时子弹会无上限堆积，几百颗就能把中端机拖到 30fps 以下。满了丢新弹，老弹正常飞完。 */
var EB_CAP = 260;
function pushEB(o){
  if (G.ebullets.length >= EB_CAP) return null;
  G.ebullets.push(o);
  return o;
}

/* ================= BOSS 行为 ================= */
function bossAct(e, dt, p){
  var adx = p.x-e.x, ady = p.y-e.y;   /* 只算一次差值与长度，bossAct 里到处要用 */
  var d = Math.sqrt(adx*adx + ady*ady) || 1;
  var ux = adx/d, uy = ady/d;
  var def = e.bossDef;

  if (e.dashT > 0){
    e.dashT -= dt;
    e.x += e.dashVX*dt;
    e.y += e.dashVY*dt;
    return;
  }

  /* 掉队太远时加速追赶，保证画面里始终有怪 */
  var targetSpd = e.spd;
  if (modOn('frenzy') && e.hp < e.hpMax*0.35) targetSpd *= 1.5;
  if (d > 300) targetSpd *= Math.min(2.4, 1 + (d - 300) / 300);
  if (d > e.r + p.r + 10){ e.x += ux*targetSpd*dt; e.y += uy*targetSpd*dt; }

  e.timer -= dt;
  if (e.timer > 0) return;
  e.timer = def.interval * (e.haste || 1);

  if (def.pattern === 'fan'){
    var base = Math.atan2(p.y-e.y, p.x-e.x);
    var n = 7;
    for (var i=0;i<n;i++){
      var a = base + (-0.6 + i*(1.2/(n-1)));
      pushEB({x:e.x+Math.cos(a)*e.r, y:e.y+Math.sin(a)*e.r,
        vx:Math.cos(a)*205, vy:Math.sin(a)*205, r:8, dmg:e.dmg, life:3.4});
    }
    tone(160, 0.2, 'sawtooth', 0.05);
  } else if (def.pattern === 'summon'){
    for (var k=0;k<4;k++){
      var aa = rnd(0, Math.PI*2);
      spawnEnemy('grunt', e.x + Math.cos(aa)*e.r*1.4, e.y + Math.sin(aa)*e.r*1.4);
    }
    burst(e.x, e.y, def.col, 220, 12);
  } else if (def.pattern === 'dash'){
    e.dashVX = ux*340; e.dashVY = uy*340; e.dashT = 0.42;
    burst(e.x, e.y, def.col, 260, 14);
    tone(140, 0.25, 'sawtooth', 0.06);
  }
}

/* ================= 主更新 ================= */

/* ================= 玩法扩展：飞剑 / 守关 / 周目规则 / 支线 / 练习场 ================= */
/* 飞剑：环绕玩家，一把替玩家挡下一次伤害后碎掉；每次商店都能买，最多 3 把 */
function addBlade(){
  if ((G.swords || 0) >= 3){ toast('飞剑已满 3 把'); return; }
  G.swords = (G.swords || 0) + 1;
  burst(G.player.x, G.player.y, P.amSoft, 12, 9);
  toast('请得飞剑 · 可替你挡下一次伤害');
}

function upgradeBlades(){
  if (G.swordDmg){ toast('飞剑已淬锋'); return; }
  if ((G.swords || 0) < 3){ toast('先凑齐 3 把飞剑再淬锋'); return; }
  /* 门槛看"进店时的剑数"：本店刚买满的这次不给开锋 */
  if ((G.shopSwordsAtOpen || 0) < 3){ toast('淬锋要等下一次补给站'); return; }
  G.swordDmg = true;
  G.swordCool = [0,0,0];
  burst(G.player.x, G.player.y, P.amSoft, 22, 13);
  toast('飞剑淬锋 · 擦到敌人即削掉 DPS 的一半');
}

/* 淬锋后的飞剑：贴着敌人就造成一次「当前 DPS 的一半」伤害，每把 0.5 秒一次 */
function updateSwords(dt){
  var n = Math.min(3, G.swords || 0);
  if (!n || !G.swordDmg) return;
  if (!G.swordCool) G.swordCool = [0,0,0];
  var p = G.player, step = 6.283 / n;
  /* 淬锋飞剑随波成长：每波 +1.5%、封顶 +60%（约第 40 波到顶），
     让它在后期不至于连精英的护甲都磨不动 */
  var grow = 1 + Math.min(0.6, Math.max(0, (G.wave || 1) - 1) * 0.015);
  var base = dpsEst() * 0.5 * grow;
  /* 飞剑只在离身 56px 内找人：原实现每把剑都扫一遍全场敌人（后期一帧几百次距离计算），
     改用子弹那套格子表，只看身边 3×3 格 */
  bgBuild();
  var sbins = BG.bins, sbc = BG.c, sbn = BG.n, sbox = BG.ox, sboy = BG.oy;
  for (var i=0;i<n;i++){
    if (G.swordCool[i] > 0){ G.swordCool[i] -= dt; continue; }
    var ang = G.time * 2.0 + i * step;
    var sx = p.x + Math.cos(ang) * 42, sy = p.y + Math.sin(ang) * 42;
    var best = null, bd = 1e9;
    var gx0 = Math.floor((sx - sbox)/sbc), gy0 = Math.floor((sy - sboy)/sbc);
    var cx0 = gx0 - 1, cx1 = gx0 + 1, cy0 = gy0 - 1, cy1 = gy0 + 1;
    if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0;
    if (cx1 >= sbn) cx1 = sbn - 1; if (cy1 >= sbn) cy1 = sbn - 1;
    for (var cyy=cy0; cyy<=cy1; cyy++){
      var srow = cyy*sbn;
      for (var cxx=cx0; cxx<=cx1; cxx++){
        var scell = sbins[srow + cxx];
        for (var si2=0; si2<scell.length; si2++){
          var e2x = scell[si2];
          if (e2x.dead || e2x.hp <= 0) continue;
          var edx = e2x.x - sx, edy = e2x.y - sy, err = e2x.r + 14;
          var ed2 = edx*edx + edy*edy;
          if (ed2 < err*err && ed2 < bd){ bd = ed2; best = e2x; }
        }
      }
    }
    if (!best) continue;
    G.swordCool[i] = 0.5;
    hitEnemy(best, base, false);
    burst(best.x, best.y, P.amSoft, 6, 6);
  }
}

/* 飞剑绕身：只画不更新，位置完全由 G.time 推导，不需要每帧存状态 */
function drawSwords(){
  if (!G || !G.swords) return;
  var p = G.player;
  var n = Math.min(3, G.swords);
  var step = 6.283 / n;
  for (var i=0;i<n;i++){
    var ang = G.time * 2.0 + i * step;
    var sx = p.x + Math.cos(ang) * 42;
    var sy = p.y + Math.sin(ang) * 42 + Math.sin(G.time*3.2 + i*1.7) * 2;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang + Math.PI * 0.5);
    /* 淬锋后加一圈刃光，看得出它现在带伤害 */
    if (G.swordDmg){
      ctx.fillStyle = 'rgba(255,242,200,0.26)';
      ctx.beginPath(); ctx.arc(0,0,9.5,0,6.28); ctx.fill();
    }
    /* 剑锋 */
    ctx.fillStyle = G.swordDmg ? 'rgba(255,248,220,0.98)' : P.rgba(P.amRGB, 0.95);
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(-1, 2.6); ctx.lineTo(-1, -2.6);
    ctx.closePath(); ctx.fill();
    /* 剑柄 */
    ctx.fillStyle = 'rgba(245,232,196,0.9)';
    ctx.fillRect(-7, -1.3, 5.5, 2.6);
    ctx.restore();
  }
}

function spawnGate(){
  var e = spawnEnemy('tank');
  if (!e) return;
  e.gate = true; e.r = 34;
  e.hpMax = 900 * (1 + 0.34*Math.max(0, G.wave-10)) * 1.9 * Math.sqrt(G.diff.hpMul);
  e.hp = e.hpMax;
  e.spd *= 0.62; e.dmg *= 1.35;
  G.gate = {e:e, t:50, max:50};
  toast('守关重甲出现 · 50 秒内击杀，超时全场狂暴');
  burst(e.x, e.y, P.red, 18, 22);
}

function updateGate(dt){
  if (!G.gate) return;
  var g = G.gate;
  if (g.e.dead || g.e.hp <= 0){
    G.gate = null; G.coresBonus += 2; G.coins += 60;
    toast('守关达成 · 星核 +2，金币 +60');
    return;
  }
  g.t -= dt;
  if (g.t <= 0){
    G.gate = null;
    for (var i=0;i<G.enemies.length;i++) G.enemies[i].spd *= 1.3;
    toast('守关超时 · 全场敌人狂暴');
  }
}

function cycleMeteor(){
  var p = G.player;
  var mx = p.x + rnd(-260,260), my = p.y + rnd(-240,240);
  for (var i=0;i<G.enemies.length;i++){
    var e = G.enemies[i];
    if (e.dead) continue;
    var ddxm = e.x-mx, ddym = e.y-my;
    if (ddxm*ddxm + ddym*ddym < 16900) hitEnemy(e, pdmg()*2.2, false);
  }
  burst(mx, my, P.red, 26, 26);
}

function updateCycleRules(dt){
  var cyc = G.cycle || 1;
  if (cyc >= 3){
    G.escortT += dt;
    if (G.escortT > 9){ G.escortT = 0; spawnEnemy('elite'); }
  }
  if (cyc >= 4){
    G.meteorT2 += dt;
    if (G.meteorT2 > 8){ G.meteorT2 = 0; cycleMeteor(); }
  }
}

function startQuest(){
  if (G.wave % 10 !== 1) return;
  var nohit = G.wave >= 11 && Math.random() < 0.4;
  G.quest = nohit
    ? {type:'nohit', need:0, taken0:G.wtaken, kills0:G.kills, done:false, wave0:G.wave}
    : {type:'kill', need:20 + G.wave*2, kills0:G.kills, taken0:G.wtaken, done:false, wave0:G.wave};
  toast(nohit ? '支线：本波不受伤' : ('支线：本波击杀 ' + G.quest.need + ' 只'));
}

function updateQuest(){
  var q = G.quest;
  if (!q || q.done) return;
  /* 支线只在本波有效：换波就作废。原来不清理，下一波 wtaken 被清零，
     "本波不受伤"会和 0 比出恒真，白送金币与增伤（真 bug，已复现） */
  if (typeof q.wave0 === 'number' && G.wave !== q.wave0){ G.quest = null; return; }
  var ok = (q.type === 'nohit') ? (G.wtaken - q.taken0 <= 0 && G.waveT > 12)
                               : (G.kills - q.kills0 >= q.need);
  if (!ok) return;
  q.done = true;
  G.player.dmgAdd += 0.12;
  G.coins += 40;
  toast('支线达成 · 增伤 +12%，金币 +40');
}

function spawnDummies(){
  for (var i=0;i<3;i++){
    var e = spawnEnemy('tank', (i-1)*150, -60);
    if (!e) continue;
    e.x = (i-1)*150; e.y = -60;
    e.training = true; e.spd = 0; e.dmg = 0; e.hp = e.hpMax = 1e7;
    e.r = 30; e.rot = 0;
  }
}

function startPractice(){
  tone(440, 0.16, 'sine', 0.05);
  startRun(false);
  G.practice = true;
  G.wave = 19;
  waveStart();
  if (G.state === 'shop') closeShop();
  spawnDummies();
  toast('练习场 · 20 波及之后再战，无限生命，中央假人测 DPS');
  hint('练习场不计星核与战绩；底部显示近 3 秒实测 DPS', 6500);
}

/* --- 敌人 --- */
function updateEnemies(dt){
  var p = G.player, e, i;
  var _mBarrage = modOn('barrage'), _mSniper = modOn('sniper');
  for (i=0;i<G.enemies.length;i++){
    e = G.enemies[i];
    if (e.dead) continue;
    if (e.hurt > 0) e.hurt -= dt;
    e.rot += dt * (e.boss ? 0.6 : 1.6);

    var ax = p.x-e.x, ay = p.y-e.y;
    var d = Math.sqrt(ax*ax + ay*ay) || 1;
    var ux = ax/d, uy = ay/d;

    /* 首领入场定格：先亮一圈再动手，给玩家反应时间 */
    if (e.introT > 0){
      e.introT -= dt;
      G.shake = Math.max(G.shake, e.introT > 0.25 ? 8 : 4);
      continue;
    }

    if (e.boss){
      bossAct(e, dt, p);
    } else if (e.type === 'shooter'){
      if (d > 330) { e.x += ux*e.spd*dt; e.y += uy*e.spd*dt; }
      else if (d < 240) { e.x -= ux*e.spd*dt; e.y -= uy*e.spd*dt; }
      else { e.x += -uy*e.spd*0.55*dt; e.y += ux*e.spd*0.55*dt; }
    } else {
      e.x += ux*e.spd*dt;
      e.y += uy*e.spd*dt;
    }

    /* 远程小怪与精英（开关在循环外取一次，别每只怪反复查缓存） */
    if (e.shoot && !e.boss){
      e.shootT -= dt;
      if (e.shootT <= 0 && d < 620){
        var bk = _mBarrage ? 0.58 : 1;
        e.shootT = (e.elite ? 2.4 : 2.8) * bk;
        var bv = _mBarrage ? 306 : 245;
        if (_mSniper) bv *= 1.6;
        var ba = aimLead(e, bv);
        pushEB({x:e.x+Math.cos(ba)*e.r, y:e.y+Math.sin(ba)*e.r,
          vx:Math.cos(ba)*bv, vy:Math.sin(ba)*bv, r:e.elite?9:6, dmg:e.dmg*(_mSniper?1.35:1), life:3.2});
      } else if (e.shootT <= 0.4 && d < 620){
        e.aimA = aimLead(e, _mBarrage ? 306 : 245);
        e.aimT = Math.max(0, e.shootT);
        e.aimMax = 0.4;
      }
    }

    /* 群体推挤统一交给 separateEnemies（网格加速） */

    /* 贴身伤害 */
    if (G.guard && dist2(G.guard.x,G.guard.y,e.x,e.y) < (e.r+G.guard.r+16)*(e.r+G.guard.r+16)){
      e.tcd -= dt;
      if (e.tcd <= 0){
        e.tcd = e.boss ? 1.1 : 1.0;
        var gg = G.guard;
        if (gg) burst(gg.x, gg.y, '#cf6a4e', 90, 5);
        guardHit(e.dmg * (e.boss ? 1.2 : 0.9));
      }
      continue;
    }
    if (dist2(p.x,p.y,e.x,e.y) < (e.r+p.r)*(e.r+p.r)){
      e.tcd -= dt;
      if (e.tcd <= 0){
        e.tcd = e.boss ? 1.1 : 1.0;
        burst(p.x, p.y, P.red, 110, 6);
        if (damagePlayer(e.dmg, e.boss ? 'boss' : e.type)) return;
      }
    }
  }

}

/* --- 玩家子弹 --- */
/* 子弹网格：每帧按 128px 把敌人索引一次（16×16 覆盖相机 2048 方区），子弹只扫周围 5×5 格；桶数组复用，清空用 length=0。 */
var BG = {c:128, n:16, bins:null, ox:0, oy:0, built:-1};
function bgBuild(){
  var b = BG;
  /* 同一帧内可能被飞剑、子弹各问一次：建一次就够。
     帧序号由 update() 维护，敌人一帧移动不到 3px，跨调用复用误差可忽略 */
  if (b.bins && b.built === G.frameSeq) return;
  b.built = G.frameSeq;
  var n = b.n, c = b.c;
  if (!b.bins){
    b.bins = [];
    for (var k=0;k<n*n;k++) b.bins.push([]);
  }
  for (var z=0;z<n*n;z++) if (b.bins[z].length) b.bins[z].length = 0;
  var half = c*n*0.5;
  b.ox = G.cam.x - half; b.oy = G.cam.y - half;
  var ens = G.enemies;
  for (var m2=0;m2<ens.length;m2++){
    var e = ens[m2];
    if (e.dead) continue;
    var ix = Math.floor((e.x - b.ox)/c), iy = Math.floor((e.y - b.oy)/c);
    /* 坐标被写坏时 Math.floor 会得到 NaN，而 NaN 和任何数比大小都是 false，
       "在范围内"的判断会漏过它，最后落到 bins[NaN].push 上抛异常 */
    if (!isFinite(ix) || !isFinite(iy)) continue;
    if (ix < 0 || ix >= n || iy < 0 || iy >= n) continue;   /* 远处敌人与子弹无关，直接丢 */
    b.bins[iy*n + ix].push(e);
  }
}
function updateBullets(dt){
  var p = G.player, i;
  bgBuild();
  var bins = BG.bins, bc = BG.c, bn = BG.n, box = BG.ox, boy = BG.oy;
  for (i=G.bullets.length-1;i>=0;i--){
    var b = G.bullets[i];
    var bx0 = b.x, by0 = b.y;
    b.x += b.vx*dt; b.y += b.vy*dt; b.life -= dt;
    var gone = b.life <= 0;
    /* 240 粗筛 ≈ 2 格，查 5×5 就够；子弹一直在相机附近，越界只可能是敌人桶，clamp 即可 */
    var gx = Math.floor((b.x - box)/bc), gy = Math.floor((b.y - boy)/bc);
    var x0 = gx - 2, x1 = gx + 2, y0 = gy - 2, y1 = gy + 2;
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 >= bn) x1 = bn - 1; if (y1 >= bn) y1 = bn - 1;
    for (var yy=y0; yy<=y1 && !gone; yy++){
      var rowOff = yy*bn;
      for (var xx=x0; xx<=x1 && !gone; xx++){
        var cell = bins[rowOff + xx];
        for (var ci=0; ci<cell.length; ci++){
          var en = cell[ci];
          if (en.dead) continue;
          if (b.hits.indexOf(en) >= 0) continue;
          if (Math.abs(en.x-b.x) > 240 || Math.abs(en.y-b.y) > 240) continue;
          var br = en.r + b.r;
          if (distSeg2(en.x, en.y, bx0, by0, b.x, b.y) < br*br){
            var crit = Math.random() < p.crit;
            hitEnemy(en, pdmg() * (crit ? p.cmul : 1), crit);
            burst(b.x, b.y, P.am, 150, crit ? 5 : 3);
            b.hits.push(en);
            if (b.pierce > 0) b.pierce--;
            else { gone = true; break; }
          }
        }
      }
    }
    if (gone || Math.abs(b.x-G.cam.x) > VW*0.9 || Math.abs(b.y-G.cam.y) > VH*0.9){
      G.bullets.splice(i,1);
    }
  }

}

/* --- 刷怪 --- */
function updateSpawn(dt){
  if (G.splitQ && G.splitQ.length){
    var capS = enemyCap(), q = G.splitQ;
    G.splitQ = [];
    for (var qi=0; qi<q.length; qi++){
      for (var qs=0; qs<2 && G.enemies.length < capS; qs++){
        var sm = spawnEnemy('swarm', q[qi].x+rnd(-16,16), q[qi].y+rnd(-16,16));
        if (!sm) break;
        sm.hp = sm.hpMax = Math.max(3, sm.hp*0.7);
      }
    }
  }
  G.spawnT -= dt;
  if (G.spawnT <= 0 && G.enemies.length < enemyCap()){
    var areaK = Math.min(1.5, Math.sqrt((VW*VH) / (414*860)));
    G.spawnT = Math.max(0.045, 0.50 - 0.020*G.wave) / G.diff.rateMul / areaK * rnd(0.8, 1.2);
    if (G.wave <= 3) G.spawnT *= 1.15;
    if (modOn('air')) G.spawnT *= 1.9;
    if (modOn('rush')) G.spawnT *= 1.4;
    if (modOn('siege')) G.spawnT *= 0.7;
    if (G.breathe) G.spawnT *= 1.9;
    if (modOn('elite')){
      var em = spawnEnemy(Math.random() < 0.72 ? 'elite' : 'tank');
      if (em){
        em.elite = true;
        if (em.type === 'elite'){ em.hp *= 1.6; em.hpMax *= 1.6; }
      }
    } else {
      var pool = ['grunt'];
      if (G.wave >= 2) pool.push('runner');
      if (G.wave >= 4) pool.push('swarm');
      if (G.wave >= 5) pool.push('tank');
      if (G.wave >= 7) pool.push('shooter');
      var type = pool[Math.floor(Math.random()*pool.length)];
      spawnEnemy(type);
      if (G.wave >= 6 && Math.random() < 0.62) spawnEnemy(type);
      if (G.wave >= 12 && Math.random() < 0.30) spawnEnemy(type);
      if (G.wave >= 6 && Math.random() < 0.1){
        var el = spawnEnemy('elite');
        if (el){ el.elite = true; el.hp *= 1.8; el.hpMax *= 1.8; }
      }
    }
  }

}

function update(dt){
  GRID.map = null;
  G.frameSeq = (G.frameSeq || 0) + 1;
  updateGuard(dt);
  if (G.bossWarn){
    G.bossWarn.t -= dt;
    if (G.bossWarn.t <= 0) spawnBossNow(G.bossWarn);
  }
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt*40);
  if (G.shakeCd > 0) G.shakeCd = Math.max(0, G.shakeCd - dt);
  if (G.state === 'playing' && G.comboT > 0){
    G.comboT -= dt;
    if (G.comboT <= 0){
      if (G.comboK >= 3) G.comboBreak = 0.45;
      G.comboK = 0;
    }
  }
  if (G.comboBreak > 0) G.comboBreak = Math.max(0, G.comboBreak - dt);
  if (G.state === 'playing' && G.player && G.player.hp < G.player.hpMax*0.3){
    G.heartT = (G.heartT || 0) - dt;
    if (G.heartT <= 0 && S.set.sfx){
      var hr = G.player.hp / G.player.hpMax;
      tone(64 + hr*26, 0.16, 'sine', 0.028);
      setTimeout(function(){
        /* 死亡/暂停/结算后不能再响第二声心跳 */
        if (G && G.state === 'playing' && G.player && G.player.hp > 0) tone(56 + hr*20, 0.2, 'sine', 0.022);
      }, 160);
      G.heartT = 0.85 - hr*0.4;
    }
  }
  if (G.state !== 'playing') return;

  var p = G.player, i, j, e;
  G.time += dt;
  G.waveT += dt;
  G.ckT = (G.ckT || 0) + dt;
  if (G.ckT > 6){ G.ckT = 0; saveCheckpoint(false); }
  if (p.invul > 0) p.invul -= dt;
  if (p.hurtFlash > 0) p.hurtFlash -= dt;
  if (G.training) G.waveT = 0;
  else if (G.waveT >= G.waveLen) waveStart();
  updateSwords(dt); updateGate(dt); updateQuest(); updateCycleRules(dt);
  G.dpsW = (G.dpsW || 0) + dt;
  if (G.dpsW > 0.4){
    G.dpsShow = Math.max(0, ((G.wdmg||0) - (G.dpsPrev||0)) / G.dpsW);
    G.dpsPrev = G.wdmg||0; G.dpsW = 0;
    if (G.dpsShow > (G.dpsPeak || 0)) G.dpsPeak = G.dpsShow;
  }
  if (G.practice || G.training){
    p.hp = p.hpMax;
    for (i = 0; i < G.enemies.length; i++){
      e = G.enemies[i];
      if (!e.training) continue;
      if (e.hp < e.hpMax) e.hp = e.hpMax;
      e.tT = (e.tT || 0) + dt;
      if (e.tT >= 1){
        e.tT = 0;
        var tdps = Math.round(e.tDmg || 0);
        if (tdps > 0) addDmg(e.x + (Math.random()-0.5)*18, e.y - e.r - 24, tdps, true, e);
        e.tDmg = 0;
      }
    }
  }

  /* --- 移动 --- */
  var dx = 0, dy = 0;
  if (keys['a'] || keys['arrowleft']) dx--;
  if (keys['d'] || keys['arrowright']) dx++;
  if (keys['w'] || keys['arrowup']) dy--;
  if (keys['s'] || keys['arrowdown']) dy++;
  var ratio = 1;
  if (JOY.active){
    var jk = Math.min(1, dt*20);
    JOY.dx += (JOY.tx - JOY.dx) * jk;
    JOY.dy += (JOY.ty - JOY.dy) * jk;
    dx = JOY.dx; dy = JOY.dy;
    var jm = Math.sqrt(dx*dx + dy*dy);
    ratio = Math.min(1, jm);
    if (jm > 0.001){ dx /= jm; dy /= jm; } else { dx = 0; dy = 0; ratio = 0; }
  }
  if (PAD.x || PAD.y){ dx += PAD.x * 1.2; dy += PAD.y * 1.2; }
  if (!JOY.active){
    var km = Math.sqrt(dx*dx + dy*dy);
    ratio = Math.min(1, km);
    if (km > 0.02){ dx /= km; dy /= km; } else { dx = 0; dy = 0; ratio = 0; }
  }
  /* 摇杆为模拟量：推得越远走得越快，键盘恒为满速 */
  if (ratio > 0.02){
    p.mvx = dx; p.mvy = dy;
    p.vx = dx*p.spd*ratio; p.vy = dy*p.spd*ratio;
    p.x += p.vx*dt; p.y += p.vy*dt;
  } else { p.vx = 0; p.vy = 0; }
  G.half += (boundTarget() - G.half) * Math.min(1, dt*0.55);
  var preX = p.x, preY = p.y, WB = G.half - 16;
  p.x = clamp(p.x, -WB, WB);
  p.y = clamp(p.y, -WB, WB);
  if ((p.x !== preX || p.y !== preY) && G.time > (G.edgeCool || 0)){
    toast('已抵达地图边界');
    G.edgeCool = G.time + 5;
  }
  if ((p.regen > 0 || p.regenBoost > 0) && p.hp < p.hpMax){
    var rAmt = (p.regen + (p.regenBoost > 0 ? 2.2 : 0))*dt*(modOn('noheal') ? 0.6 : 1);
    healPlayer(rAmt); /* healPlayer 返回的是本次回复量，不能拿来覆盖生命 */
    if (p.regenBoost > 0) p.regenBoost = Math.max(0, p.regenBoost - dt);
  }
  updateModifiers(dt);

  /* --- 镜头 --- */
  p.smvx += (p.vx - p.smvx) * Math.min(1, dt*12);
  p.smvy += (p.vy - p.smvy) * Math.min(1, dt*12);
  var tx = p.x + clamp(p.smvx*0.16, -56, 56);
  var ty = p.y + clamp(p.smvy*0.16, -56, 56);
  G.cam.x += (tx - G.cam.x) * Math.min(1, dt*5.5);
  G.cam.y += (ty - G.cam.y) * Math.min(1, dt*5.5);

  /* --- 自动开火 --- */
  var tgt = nearestEnemy(p.x, p.y, p.rng);
  if (tgt){
    p.aim = Math.atan2(tgt.y-p.y, tgt.x-p.x);
    p.cd -= dt;
    if (p.cd <= 0){ p.cd = 1/p.rate; fire(tgt); }
  } else {
    p.cd = Math.min(p.cd, 0.15);
  }

  updateSpawn(dt);

  updateEnemies(dt);
  updateBullets(dt);

  /* --- 敌方子弹 --- */
  for (i=G.ebullets.length-1;i>=0;i--){
    var eb = G.ebullets[i];
    eb.x += eb.vx*dt; eb.y += eb.vy*dt; eb.life -= dt;
    if (G.guard && dist2(eb.x,eb.y,G.guard.x,G.guard.y) < (G.guard.r+eb.r+6)*(G.guard.r+eb.r+6)){
      guardHit(eb.dmg * 0.85);
      burst(eb.x, eb.y, '#a8d0c2', 120, 5);
      G.ebullets.splice(i,1);
      continue;
    }
    if (dist2(eb.x,eb.y,p.x,p.y) < (p.r+eb.r)*(p.r+eb.r)){
      G.ebullets.splice(i,1);
      if (damagePlayer(eb.dmg, 'shooter')) return;
      continue;
    }
    if (eb.life <= 0) G.ebullets.splice(i,1);
  }

  /* --- 冲击波 --- */
  if (p.shock > 0){
    G.shockT -= dt;
    if (G.shockT <= 0){
      G.shockT = 3.5;
      var R = 118 + 26*p.shock;
      G.rings.push({x:p.x, y:p.y, r:10, mx:R, life:0.45, max:0.45, col:P.cyRGB});
      for (j=0;j<G.enemies.length;j++){
        var se = G.enemies[j];
        if (!se.dead && dist2(p.x,p.y,se.x,se.y) < R*R) hitEnemy(se, pdmg()*1.6*p.shock, false);
      }
      tone(300, 0.22, 'sine', 0.05);
    }
  }

  /* --- 灼烧领域 --- */
  if (p.aura > 0){
    G.auraT -= dt;
    if (G.auraT <= 0){
      G.auraT = 0.5;
      var AR = 96 + 14*p.aura;
      for (j=0;j<G.enemies.length;j++){
        var ae = G.enemies[j];
        if (!ae.dead && dist2(p.x,p.y,ae.x,ae.y) < AR*AR) hitEnemy(ae, pdmg()*0.55*p.aura, false);
      }
    }
  }

  /* --- 清理尸体 --- */
  /* 倒序 splice 每删一只都要把后面的元素整体前移，后期一帧死几十只时纯属白搬。
     改成写指针原地压缩：一趟 O(n)、零分配，顺序不变 */
  var aliveN = 0, ensArr = G.enemies, ensW = 0, ensLen = ensArr.length;
  for (i=0;i<ensLen;i++){
    var ensE = ensArr[i];
    if (ensE.dead) continue;
    ensArr[ensW++] = ensE; aliveN++;
  }
  if (ensW < ensLen) ensArr.length = ensW;
  /* 场上次显示真实存活数：直接读 length 会把本帧刚死的尸体算进去，高 DPS 时数字虚高 */
  G.aliveN = aliveN;
  separateEnemies();

  /* --- 经验晶体 --- */
  /* magnet 判定提到循环外：满屏几百颗晶体时，每颗每帧查一次异变表是白烧；距离也改平方比较，只在真要移动时开方 */
  var gMagT = modOn('magnet') ? 0.35 : 1.25;
  var gCol2 = p.collect * p.collect;
  for (i=G.gems.length-1;i>=0;i--){
    var g = G.gems[i];
    g.age = (g.age || 0) + dt;
    var gd2 = dist2(g.x,g.y,p.x,p.y);
    if (gd2 < gCol2 || g.age > gMagT) g.pull = true;
    var gd = 0;
    if (g.pull){
      gd = Math.sqrt(gd2);
      var gv = Math.max(340, p.spd*1.8) + Math.max(0, p.collect - gd) * 5;
      g.x += (p.x-g.x)/(gd||1)*gv*dt;
      g.y += (p.y-g.y)/(gd||1)*gv*dt;
    }
    if (gd2 < 676){
      G.gems.splice(i,1);
      addExp(g.v);
      if (G.state !== 'playing') return;
    }
  }

  /* --- 补给 --- */
  for (i=G.pickups.length-1;i>=0;i--){
    var pk = G.pickups[i];
    pk.t += dt;
    var pd = Math.sqrt(dist2(pk.x,pk.y,p.x,p.y));
    if (pk.t > 2.5 && pd > 26){
      var pkv = 300 + (pd - 26) * 2;
      pk.x += (p.x-pk.x)/(pd||1) * pkv * dt;
      pk.y += (p.y-pk.y)/(pd||1) * pkv * dt;
      pd = Math.sqrt(dist2(pk.x,pk.y,p.x,p.y));
    }
    if (pd < 30){
      if (pk.type === 'med'){
        p.hp = Math.min(p.hpMax, p.hp + p.hpMax*0.25);
        addDmg(p.x, p.y-30, p.hpMax*0.25, true);
      } else if (pk.type === 'magnet'){
        for (j=0;j<G.gems.length;j++) G.gems[j].pull = true;
        var mt2 = PNow();
        if (!window.__magT || mt2 - window.__magT > 4000){ window.__magT = mt2; toast('经验磁铁'); }
      } else if (pk.type === 'chest'){
        p.hp = Math.min(p.hpMax, p.hp + p.hpMax*0.15);
        if (p.level >= LEVEL_CAP){
          G.coins += 80;
          toast('补给箱 · +80 金币');
        } else {
          toast('补给箱');
          addExp(p.expNext);
        }
      }
      G.pickups.splice(i,1);
      sfx('coin');
      if (G.state !== 'playing') return;
      continue;
    }
    if (pk.t > 12) G.pickups.splice(i,1);
  }

  /* --- 粒子 / 数字 / 环 --- */
  /* 粒子寿命只有 0.2~0.55s，满屏 240 颗时每帧要死几十个。
     倒序 splice 每删一颗都要把后面的元素整体往前搬，这里改成写指针原地压缩：
     一趟遍历、零额外分配、顺序不变 */
  var pn = 0, pats = G.parts, plen = pats.length, pool = G.partPool;
  for (i=0;i<plen;i++){
    var pt = pats[i];
    pt.x += pt.vx*dt; pt.y += pt.vy*dt;
    pt.vx *= 0.92; pt.vy *= 0.92;
    pt.life -= dt;
    if (pt.life > 0){ pats[pn++] = pt; continue; }
    if (pool && pool.length < 400) pool.push(pt);
  }
  pats.length = pn;
  for (i=G.dmgs.length-1;i>=0;i--){
    var dn = G.dmgs[i];
    dn.t += dt; dn.y -= 34*dt;
    if (dn.t >= dn.life){
      dn.ent = null;   /* 断开与敌人的绑定，避免下次受伤写进这枚已消失的飘字 */
      G.dmgs.splice(i,1);
    }
  }
  for (i=G.rings.length-1;i>=0;i--){
    var rg = G.rings[i];
    /* 兜底：老格式（只有 t / max=半径）的环补上 life 与 mx，否则 NaN 会让它永不回收 */
    if (typeof rg.life !== 'number' || !isFinite(rg.life)) rg.life = (typeof rg.t === 'number' ? rg.t : 0.8);
    if (typeof rg.mx !== 'number' || !isFinite(rg.mx)) rg.mx = (rg.max > 8 ? rg.max : (rg.r || 0));
    if (typeof rg.max !== 'number' || !isFinite(rg.max) || rg.max > 8) rg.max = rg.life;
    rg.life -= dt;
    rg.r += (rg.mx-rg.r) * Math.min(1, dt*14);
    /* 视野外的环即使扩到最大半径也看不见：直接丢掉，省掉后续帧的扩张与描边 */
    var rhw = VW*0.5/VZ + 40, rhh = VH*0.5/VZ + 40;
    var rmax = (typeof rg.mx === 'number' && rg.mx > rg.r) ? rg.mx : rg.r;
    if (Math.abs(rg.x - G.cam.x) - rmax > rhw || Math.abs(rg.y - G.cam.y) - rmax > rhh){
      G.rings.splice(i,1);
      continue;
    }
    if (!isFinite(rg.r) || rg.life <= 0) G.rings.splice(i,1);
  }
}

/* ================= 绘制 ================= */
var SEP_OFFS = [[1,0],[0,1],[1,1],[-1,1]];
/* 分离计算每帧都要建一张格子表，这里把表和桶都留着复用，只清键与长度 */
var SEP_GRID = Object.create(null), SEP_KEYS = [], SEP_POOL = [];
var SEP_CELLS = [], SEP_CXS = [], SEP_CYS = [];
function separateEnemies(){
  var arr = G.enemies, n = arr.length;
  if (n < 2) return;
  var CS = 64;
  /* 整数键 + 预存坐标：原来每帧要拼 200 个 "x,y" 字符串再 split 回来，纯浪费。
     表、桶、坐标数组全部复用，每帧只做清空 */
  var grid = SEP_GRID, keys = SEP_KEYS, pool = SEP_POOL;
  var cells = SEP_CELLS, cxs = SEP_CXS, cys = SEP_CYS;
  /* 用赋值 null 代替 delete：delete 会让这个热点对象反复退回字典模式，
     而这里可能的格子键是有限的（世界坐标除以 64），留着键不会无限增长 */
  for (var kz=0; kz<keys.length; kz++) grid[keys[kz]] = null;
  keys.length = 0; cells.length = 0; cxs.length = 0; cys.length = 0;
  var np = 0;
  for (var i=0;i<n;i++){
    var a = arr[i];
    if (a.dead) continue;
    var kx = (Math.floor(a.x / CS) + 512), ky = (Math.floor(a.y / CS) + 512);
    var key = kx * 1024 + ky;
    var cell = grid[key];
    if (cell){ cell.push(a); }
    else {
      var bucket = pool[np] || (pool[np] = []);
      np++;
      bucket.length = 0;
      bucket.push(a);
      grid[key] = bucket; keys.push(key);
      cells.push(bucket); cxs.push(kx); cys.push(ky);
    }
  }
  for (var ci=0; ci<cells.length; ci++){
    var here = cells[ci], cx = cxs[ci], cy = cys[ci];
    for (var ai=0; ai<here.length; ai++){
      for (var bi=ai+1; bi<here.length; bi++) resolvePair(here[ai], here[bi]);
    }
    for (var oi=0; oi<4; oi++){
      var other = grid[(cx + SEP_OFFS[oi][0]) * 1024 + (cy + SEP_OFFS[oi][1])];
      if (!other) continue;
      for (var a2=0; a2<here.length; a2++){
        for (var b2=0; b2<other.length; b2++) resolvePair(here[a2], other[b2]);
      }
    }
  }
}

function resolvePair(A, B){
  if (A.dead || B.dead) return;
  var dx = B.x - A.x, dy = B.y - A.y;
  var rr = (A.r + B.r) * 0.9;
  var d2 = dx*dx + dy*dy;
  if (d2 > 0.01 && d2 < rr*rr){
    var d = Math.sqrt(d2), k = (rr - d) / d * 0.5;
    A.x -= dx*k; A.y -= dy*k;
    B.x += dx*k; B.y += dy*k;
  }
}

function drawGrid(camX, camY){
  var step = 96;
  if (SKIN === 'huaxia'){
    /* 斜方格席纹，比直网格更接近国风织物 */
    var gy0 = Math.floor((camY - VH/2 - step*2)/step)*step;
    var gy1 = camY + VH/2 + step;
    var gx0 = Math.floor((camX - VW/2 - step*2)/step)*step;
    var gx1 = camX + VW/2 + step;
    ctx.strokeStyle = P.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var d=gx0-step*2; d<=gx1+step*2; d+=step){
      ctx.moveTo(d, gy0); ctx.lineTo(d + (gy1-gy0), gy1);
      ctx.moveTo(d, gy0); ctx.lineTo(d - (gy1-gy0), gy1);
    }
    ctx.stroke();
    return;
  }
  var x0 = Math.floor((camX - VW/2)/step)*step;
  var y0 = Math.floor((camY - VH/2)/step)*step;
  var x1 = camX + VW/2, y1 = camY + VH/2;
  ctx.strokeStyle = P.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (var x=x0;x<=x1;x+=step){ ctx.moveTo(x,y0); ctx.lineTo(x,y1); }
  for (var y=y0;y<=y1;y+=step){ ctx.moveTo(x0,y); ctx.lineTo(x1,y); }
  ctx.stroke();
}

/* 装饰几何静态：局部顶点按 rot 旋转再平移到世界坐标，合并成一份 Path2D，每帧只 fill/stroke（原每装饰 7 条命令）。 */
function decoLocal(d, huaxia){
  if (d._p && d._pk === SKIN) return;
  var p2 = new Path2D();
  if (huaxia){
    for (var k2=0;k2<d.n;k2++){
      var a2 = k2*Math.PI*2/d.n;
      var rr2 = (k2 % 2 === 0) ? d.r : d.r*0.40;
      p2.lineTo(Math.cos(a2)*rr2, Math.sin(a2)*rr2*0.62);
    }
  } else {
    for (var k=0;k<d.n;k++){
      var a = k*Math.PI*2/d.n;
      p2.lineTo(Math.cos(a)*d.r, Math.sin(a)*d.r*0.72);
    }
  }
  p2.closePath();
  d._p = p2; d._pk = SKIN;
  if (huaxia){
    var pb = new Path2D();
    pb.moveTo(-d.r*0.45, d.r*0.1); pb.lineTo(0, -d.r*0.42); pb.lineTo(d.r*0.4, d.r*0.06);
    d._pb = pb;
  }
}
function buildDecoBake(){
  var huaxia = (SKIN === 'huaxia');
  var main = new Path2D(), extra = new Path2D();
  for (var i=0;i<G.deco.length;i++){
    var d = G.deco[i];
    decoLocal(d, huaxia);
    var co = Math.cos(d.rot), si = Math.sin(d.rot);
    var m = new DOMMatrix([co, si, -si, co, d.x, d.y]);
    main.addPath(d._p, m);
    if (huaxia && d._pb) extra.addPath(d._pb, m);
  }
  G._decoBk = {key: SKIN + '|' + (G.theme || 0), main: main, extra: extra, th: THEME[G.theme || 0]};
}
function drawDeco(camX, camY){
  var key = SKIN + '|' + (G.theme || 0);
  if (!G._decoBk || G._decoBk.key !== key) buildDecoBake();
  var b = G._decoBk;
  if (SKIN === 'huaxia'){
    /* 水墨山石：起伏棱角 + 皴笔，不作团状云块 */
    ctx.fillStyle = 'rgba(24,21,16,0.9)';
    ctx.fill(b.main);
    /* 两条大路径描边在低画质下省掉：山石轮廓还在，只是没有皴笔与金边 */
    if (S.set.quality !== 'low'){
      ctx.strokeStyle = P.rgba(P.dimRGB, 0.2);
      ctx.lineWidth = 1;
      ctx.stroke(b.main);
      ctx.strokeStyle = P.rgba(P.amRGB, 0.12);
      ctx.stroke(b.extra);
    }
  } else {
    ctx.fillStyle = b.th.fill;
    ctx.fill(b.main);
    ctx.strokeStyle = b.th.line;
    ctx.lineWidth = 1;
    ctx.stroke(b.main);
  }
}

function drawDust(camX, camY){
  /* 低画质下这层纯装饰最先砍：40 颗的合批与插值都不便宜，玩家几乎看不出少了 */
  if (S.set.quality === 'low') return;
  /* 尘埃同样合批：透明度量化到 5 档，40 颗只留几次 fill */
  dotReset();
  for (var i=0;i<G.dust.length;i++){
    var d = G.dust[i];
    if (Math.abs(d.x-camX) > VW/2+20 || Math.abs(d.y-camY) > VH/2+20) continue;
    dotAdd('#7ce8d4', d.x, d.y, d.r, Math.round((0.3 + Math.sin(G.time*1.6 + d.a)*0.18)*10)/10);
  }
  dotFlush();
}

var POLY = (function(){
  function ring(n, k, rot){
    var arr = [];
    for (var i=0;i<n;i++){ var a = i*Math.PI/rot; arr.push([Math.cos(a)*k, Math.sin(a)*k]); }
    return arr;
  }
  return {
    miniE: ring(12, 1, 6), miniI: ring(12, 0.7, 6),
    bossE: ring(16, 1, 8), bossI: ring(16, 0.72, 8),
    hex: ring(6, 1, 3)
  };
})();

/* 入场冲击波的径向渐变按「半径档 + 进度档」缓存：
   以前每个入场敌人每帧都 createRadialGradient + 两次字符串拼接，
   一波怪同时入场就是几百个渐变对象，全变成 GC 垃圾 */
var INTRO_GRAD = {}, INTRO_GRAD_N = 0;
function introSweep(r, ip){
  var key = Math.round(r) + '_' + Math.round(ip * 16);
  var o = INTRO_GRAD[key];
  if (o) return o;
  var swR = r + 6 + ip * r * 3.4;
  var sg = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, swR);
  sg.addColorStop(0, 'rgba(255,240,210,0)');
  sg.addColorStop(0.55, 'rgba(255,214,150,' + (0.16 * (1 - ip)).toFixed(2) + ')');
  sg.addColorStop(1, 'rgba(255,170,120,0)');
  o = { g: sg, swR: swR, sc: 'rgba(255,255,255,' + (0.55 * (1 - ip)).toFixed(2) + ')' };
  if (INTRO_GRAD_N < 240){ INTRO_GRAD[key] = o; INTRO_GRAD_N++; }
  return o;
}

/* 精英/吐酸/首领光环按三种颜色分三组 path 各描一次（原每只各一次 beginPath+arc+stroke，满屏精英上百次）。 */
var _ringB = [], _ringE = [], _ringS = [];
/* 相机矩阵（draw 内每帧算一次）：敌人逐个 setTransform 用，
   省掉每只一次 save/translate/rotate/restore 四次状态栈操作 */
var ENK = 1, ENTX = 0, ENTY = 0;
function camReset(){ ctx.setTransform(ENK, 0, 0, ENK, ENTX, ENTY); }

/* 圆点合批：同色/同透明度的圆合成一条 path，一次 fill。
   敌人中心高光、尘埃、粒子都走这里，减少大量 beginPath+fill 调用 */
var _dotMap = Object.create(null), _dotKeys = [];
var _gemBuckets = [[],[],[]];
var _ebBk = [[],[],[]];
function dotReset(){
  for (var i=0;i<_dotKeys.length;i++) _dotMap[_dotKeys[i]].length = 0;
}
function dotAdd(col, x, y, r, alpha){
  var key = (alpha === undefined) ? col : (col + '|' + alpha);
  var a = _dotMap[key];
  if (!a){ a = _dotMap[key] = []; _dotKeys.push(key); }
  a.push(x, y, r);
}
/* 冲击环合批：同来源色 + 同透明度档的环合成一条 path，一次描边；
   视野外的环在 update 里直接丢弃，不再扩张也不再描边 */
var _rngG = Object.create(null), _rngK = [];
function ringReset(){
  for (var i=0;i<_rngK.length;i++) _rngG[_rngK[i]].length = 0;
}
function ringAdd(x, y, r, col, alpha){
  var ab = Math.round(alpha*4)/4;
  if (ab <= 0) return;
  var key = col + '|' + ab;
  var a = _rngG[key];
  if (!a){ a = _rngG[key] = []; _rngK.push(key); }
  a.push(x, y, r);
}
function ringFlush(){
  for (var i=0;i<_rngK.length;i++){
    var key = _rngK[i], a = _rngG[key];
    if (!a.length) continue;
    var bar = key.indexOf('|');
    ctx.strokeStyle = P.rgba(key.slice(0, bar), Number(key.slice(bar + 1)));
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (var j=0;j<a.length;j+=3){
      ctx.moveTo(a[j] + a[j+2], a[j+1]);
      ctx.arc(a[j], a[j+1], a[j+2], 0, 6.28);
    }
    ctx.stroke();
  }
}

/* 血条合批：受伤的小怪每帧各画两次 fillRect + 一次 camReset，
   满屏残血时是几百次调用；改成先记账，最后按三种颜色各画一条 path */
var _barB = [], _barE = [], _barD = [];
function drawBars(){
  var groups = [_barB, _barE, _barD], cols = [P.red, P.am, P.dim];
  var gi, ar, j;
  ctx.beginPath();
  for (gi=0; gi<3; gi++){
    ar = groups[gi];
    for (j=0;j<ar.length;j+=4) ctx.rect(ar[j], ar[j+1], ar[j+2], 4);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
  for (gi=0; gi<3; gi++){
    ar = groups[gi];
    if (!ar.length) continue;
    ctx.beginPath();
    for (j=0;j<ar.length;j+=4){
      var ww = ar[j+2]*ar[j+3];
      if (ww > 0.5) ctx.rect(ar[j], ar[j+1], ww, 4);
    }
    ctx.fillStyle = cols[gi]; ctx.fill();
  }
  _barB.length = 0; _barE.length = 0; _barD.length = 0;
}

function dotFlush(){
  for (var i=0;i<_dotKeys.length;i++){
    var key = _dotKeys[i], a = _dotMap[key];
    if (!a.length) continue;
    var bar = key.indexOf('|');
    var col = bar < 0 ? key : key.slice(0, bar);
    ctx.globalAlpha = bar < 0 ? 1 : Number(key.slice(bar + 1));
    ctx.beginPath();
    for (var j=0;j<a.length;j+=3){ ctx.moveTo(a[j] + a[j+2], a[j+1]); ctx.arc(a[j], a[j+1], a[j+2], 0, 6.28); }
    ctx.fillStyle = col;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawEnemyRings(camX, camY){
  var b = _ringB, el = _ringE, sh = _ringS;
  b.length = 0; el.length = 0; sh.length = 0;
  for (var i=0;i<G.enemies.length;i++){
    var e = G.enemies[i];
    if (Math.abs(e.x-camX) > VW/2+96 || Math.abs(e.y-camY) > VH/2+96) continue;
    if (e.boss) b.push(e);
    else if (e.elite) el.push(e);
    else if (e.shoot || e.type === 'shooter') sh.push(e);
  }
  if (b.length){ ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2.5; ringStroke(b, 3.5); }
  if (el.length){ ctx.strokeStyle = 'rgba(255,209,102,0.85)'; ctx.lineWidth = 1.6; ringStroke(el, 3.5); }
  if (sh.length){ ctx.strokeStyle = 'rgba(255,92,122,0.9)'; ctx.lineWidth = 1.6; ringStroke(sh, 3.5); }
}
function ringStroke(list, pad){
  ctx.beginPath();
  for (var i=0;i<list.length;i++){
    var e = list[i], r = e.r + pad;
    ctx.moveTo(e.x + r, e.y);   /* 不先 moveTo，arc 会把上一个圆的终点连过来 */
    ctx.arc(e.x, e.y, r, 0, 6.28);
  }
  ctx.stroke();
}

/* 敌人形状画在给定 ctx（原点=中心，单位=世界坐标）；drawEnemy 按「形状+颜色+尺寸+DPR」预渲染精灵，之后每帧只剩 setTransform+drawImage。 */
function paintEnemy(c, e, col, eGlow){
  if (e.mini){
    c.beginPath();
    for (var mk=0;mk<12;mk++){
      var mv = (mk%2===0) ? POLY.miniE[mk] : POLY.miniI[mk];
      c.lineTo(mv[0]*e.r, mv[1]*e.r);
    }
    c.closePath();
    c.fillStyle = 'rgba(74,20,18,0.95)'; c.fill();
    c.strokeStyle = col; c.lineWidth = 3; c.stroke();
    if (eGlow){ c.beginPath(); c.arc(0, 0, e.r*0.24, 0, 6.28); c.fillStyle = col; c.fill(); }
  } else if (e.boss){
    c.beginPath();
    for (var k=0;k<16;k++){
      var kv = (k%2===0) ? POLY.bossE[k] : POLY.bossI[k];
      c.lineTo(kv[0]*e.r, kv[1]*e.r);
    }
    c.closePath();
    c.fillStyle = 'rgba(40,14,12,0.92)';
    c.fill();
    c.strokeStyle = col; c.lineWidth = 3; c.stroke();
    if (eGlow){ c.beginPath(); c.arc(0, 0, e.r*0.26, 0, 6.28); c.fillStyle = col; c.fill(); }
    c.beginPath(); c.arc(0,0,e.r*1.12,0,6.28);
    c.strokeStyle = 'rgba(255,255,255,0.1)'; c.lineWidth = 1.5; c.stroke();
  } else if (e.shape === 'hex'){
    c.beginPath();
    for (var h=0;h<6;h++){ var hv = POLY.hex[h]; c.lineTo(hv[0]*e.r, hv[1]*e.r); }
    c.closePath();
    c.fillStyle = 'rgba(18,38,28,0.85)'; c.fill();
    c.strokeStyle = col; c.lineWidth = 2; c.stroke();
    if (eGlow){ c.beginPath(); c.arc(0, 0, e.r*0.3, 0, 6.28); c.fillStyle = col; c.fill(); }
  } else if (e.shape === 'tri'){
    c.beginPath();
    c.moveTo(0,-e.r*1.5); c.lineTo(e.r,e.r); c.lineTo(-e.r,e.r);
    c.closePath();
    c.fillStyle = 'rgba(44,22,16,0.9)'; c.fill();
    c.strokeStyle = col; c.lineWidth = 2; c.stroke();
  } else if (e.shape === 'box'){
    c.fillStyle = e.elite ? 'rgba(48,36,10,0.92)' : 'rgba(28,34,38,0.9)';
    c.strokeStyle = col; c.lineWidth = 2.5;
    c.beginPath(); c.rect(-e.r,-e.r,e.r*2,e.r*2); c.fill(); c.stroke();
    c.beginPath(); c.rect(-e.r*0.45,-e.r*0.45,e.r*0.9,e.r*0.9);
    c.strokeStyle = P.rgba(P.inkRGB,0.35); c.lineWidth = 1.5; c.stroke();
  } else if (e.shape === 'dia'){
    c.beginPath();
    c.moveTo(0,-e.r*1.25); c.lineTo(e.r*1.25,0); c.lineTo(0,e.r*1.25); c.lineTo(-e.r*1.25,0);
    c.closePath();
    c.fillStyle = 'rgba(44,18,30,0.9)'; c.fill();
    c.strokeStyle = col; c.lineWidth = 2; c.stroke();
    if (eGlow){ c.beginPath(); c.arc(0, 0, e.r*0.28, 0, 6.28); c.fillStyle = col; c.fill(); }
  } else {
    c.beginPath(); c.arc(0,0,e.r,0,6.28);
    c.fillStyle = 'rgba(34,40,18,0.9)'; c.fill();
    c.strokeStyle = col; c.lineWidth = 1.6; c.stroke();
  }
}

/* 玩家子弹精灵：朝 +x 方向烘一张，绘制时按弹道角度旋转。
   尾焰画在中心左侧，跟着方向自然拖在后面 */
var _bSprC = Object.create(null), _bSprN = 0;
function bulletSprite(r, skin){
  var key = skin + '|' + (Math.round(r*20)/20).toFixed(2) + '|' + ENK.toFixed(2);
  var got = _bSprC[key];
  if (got) return got;
  var half = Math.ceil(r * ENK * 3.2), sz = half*2;
  if (sz > 256) return null;
  var cn = document.createElement('canvas');
  cn.width = cn.height = sz;
  var c2 = cn.getContext('2d');
  c2.translate(sz*0.5, sz*0.5);
  c2.scale(ENK, ENK);
  try{
    if (skin === 'huaxia'){
      c2.fillStyle = P.rgba(P.amRGB, 0.16);
      c2.beginPath(); c2.ellipse(-r*0.15, 0, r*0.85, r*1.7, 0, 0, 6.28); c2.fill();
      c2.beginPath();
      c2.moveTo(r*0.55, 0); c2.lineTo(-r*0.1, r*0.62);
      c2.lineTo(-r*0.55, 0); c2.lineTo(-r*0.1, -r*0.62);
      c2.closePath();
      c2.fillStyle = 'rgba(252,244,220,0.96)'; c2.fill();
      c2.strokeStyle = P.rgba(P.amRGB, 0.85); c2.lineWidth = 1; c2.stroke();
    } else {
      c2.fillStyle = P.rgba(P.amRGB, 0.3);
      c2.beginPath(); c2.arc(-r, 0, r*1.7, 0, 6.28); c2.fill();
      c2.fillStyle = 'rgba(255,224,160,0.96)';
      c2.beginPath(); c2.arc(0, 0, r, 0, 6.28); c2.fill();
    }
  }catch(err){ return null; }
  if (_bSprN > 24){ _bSprC = Object.create(null); _bSprN = 0; }
  got = _bSprC[key] = {c: cn, size: sz};
  _bSprN++;
  return got;
}

/* 精灵缓存：key 里带 ENK（DPR×缩放），窗口尺寸变了自然换一批，读到的永远是 1:1 像素，
   不会出现整屏被放大后糊掉的问题 */
var _sprC = new Map();   /* 精灵缓存：LRU，命中即移到队尾，超 96 张淘汰最久未用的一张 */
var SPR_PAD = 8;   /* 设备像素留白，给描边外扩 */
function enemySprite(e, col, eGlow){
  /* key 挂在怪身上复用：同屏几百只时，每帧每只拼 ~60 字符的 key 是全场景最大的字符串分配源，
     只有受击闪白（col 变白）、半径变化、换皮肤/改窗口时才需要重拼 */
  if (e._sk === undefined || e._skR !== e.r || e._skENK !== ENK || e._skCol !== col || e._skShape !== e.shape
      || e._skE !== (e.elite?1:0) + (e.boss?1:0) || e._skGlow !== eGlow){
    e._skR = e.r; e._skENK = ENK; e._skCol = col; e._skShape = e.shape; e._skE = (e.elite?1:0) + (e.boss?1:0); e._skGlow = eGlow;
    e._sk = e.shape + '|' + col + '|' + (e.elite ? 1 : 0) + '|' + (e.boss ? 1 : 0)
          + '|' + (eGlow ? 1 : 0) + '|' + Math.round(e.r) + '|' + ENK.toFixed(2);
  }
  var key = e._sk;
  var got = _sprC.get(key);
  if (got){ _sprC.delete(key); _sprC.set(key, got); return got; }
  var halfD = Math.ceil(e.r * ENK), szD = halfD*2 + SPR_PAD*2;
  if (szD > 512) return null;              /* 极端尺寸就别缓存了，直接走原路径 */
  var cn = document.createElement('canvas');
  cn.width = cn.height = szD;
  var c2 = cn.getContext('2d');
  c2.translate(szD*0.5, szD*0.5);
  c2.scale(ENK, ENK);
  try { paintEnemy(c2, e, col, eGlow); } catch(err){ return null; }
  if (_sprC.size >= 96){ _sprC.delete(_sprC.keys().next().value); }   /* 淘汰最久未用，避免整表清空后一轮重绘峰值 */
  got = {c: cn, size: szD};
  _sprC.set(key, got);
  return got;
}

function drawEnemy(e){
  /* 矩阵直接算到位：相机 × 平移 × 旋转，一次 setTransform 取代原本的
     save/translate/rotate/restore 四步 */
  var ang;
  if (e.mini) ang = e.rot*0.25;
  else if (e.boss) ang = e.rot*0.2;
  else if (e.shape === 'hex') ang = e.rot;
  else if (e.shape === 'tri') ang = Math.atan2(G.player.y-e.y, G.player.x-e.x) + Math.PI/2;
  else if (e.shape === 'box') ang = e.rot*0.35;
  else if (e.shape === 'dia') ang = e.rot*0.5;
  else ang = 0;
  /* 低画质/省电：普通怪不旋转。多数怪是圆形/多边形，静止角度几乎看不出，
     但每只每帧省一对三角函数 + 一个六参数矩阵 */
  if (ang && !e.boss && S && S.set && (S.set.quality === 'low' || S.set.eco)) ang = 0;
  var ca = Math.cos(ang), sa = Math.sin(ang);
  ctx.setTransform(ENK*ca, ENK*sa, -ENK*sa, ENK*ca, ENK*e.x + ENTX, ENK*e.y + ENTY);
  var col = e.hurt > 0 ? '#ffffff' : e.col;
  /* 普通怪的中心高光只有 2~4px，被描边色压住基本看不见，却要占一条 arc + moveTo；
     精英/首领/迷你体和受击闪白才保留 */
  var eGlow = !!(e.elite || e.boss || e.mini || e.hurt > 0);

  if (e.introT > 0){
    /* 入场定格：由内向外推开的冲击波 + 光环（渐变走缓存，见 introSweep） */
    var ip = 1 - Math.max(0, Math.min(1, e.introT / 0.6));
    var iv = introSweep(e.r, ip);
    ctx.fillStyle = iv.g;
    ctx.beginPath(); ctx.arc(0, 0, iv.swR, 0, 6.28); ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, e.r + 6 + ip * e.r * 2.2, 0, 6.28);
    ctx.strokeStyle = iv.sc;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  var spr = enemySprite(e, col, eGlow);
  if (spr){
    var wsz = spr.size / ENK;
    ctx.drawImage(spr.c, -wsz*0.5, -wsz*0.5, wsz, wsz);
  } else {
    paintEnemy(ctx, e, col, eGlow);   /* 尺寸超 512 或首帧绘制失败，退回直接画 */
  }

  /* 精英圈和假人文字要按世界坐标轴对齐（稀有，按需回相机矩阵）；
     血条只记账，循环结束统一合批，省掉每只两次 fillRect 与一次重置矩阵 */
  if (e.elite || e.training){
    camReset();
    if (e.elite){
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r*1.5, 0, 6.28);
      ctx.strokeStyle = P.rgba(P.amRGB,0.35);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (e.training){
      ctx.textAlign = 'center';
      ctx.font = '700 11px "Noto Serif SC","Songti SC",serif';
      ctx.fillStyle = P.rgba(P.amRGB,0.75);
      ctx.fillText('假人 · 无限血', e.x, e.y - e.r - 8);
      ctx.textAlign = 'left';
    }
  }
  if (e.boss || e.elite || e.gate || (e.hurt || 0) > 0){
    var bw = e.boss ? 90 : e.r*2.2;
    var grp = e.boss ? _barB : (e.elite ? _barE : _barD);
    grp.push(e.x - bw/2, e.y - e.r - 12, bw, Math.max(0, e.hp/e.hpMax));
  }
}

function drawPlayer(){
  var p = G.player;
  ctx.save();
  ctx.translate(p.x, p.y);

  if (!drawPlayer._glow){
    drawPlayer._glow = ctx.createRadialGradient(0,0,4,0,0,90);
    drawPlayer._glow.addColorStop(0,P.rgba(P.cyRGB,0.18));
    drawPlayer._glow.addColorStop(1,P.rgba(P.cyRGB,0));
  }
  ctx.fillStyle = drawPlayer._glow;
  ctx.beginPath(); ctx.arc(0,0,90,0,6.28); ctx.fill();

  if (p.aura > 0){
    var ar = 96 + 14*p.aura;
    ctx.beginPath(); ctx.arc(0,0,ar,0,6.28);
    ctx.strokeStyle = 'rgba(240,120,60,0.22)';
    ctx.fillStyle = 'rgba(240,110,40,0.028)';
    ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
  }

  ctx.globalAlpha = p.invul > 0 ? (0.6 + Math.sin(G.time*24)*0.35) : 1;
  ctx.rotate(p.aim + Math.PI/2);
  if (SKIN === 'huaxia'){
    /* 飞剑：剑尖、剑脊、剑格、剑柄、红缨 */
    ctx.beginPath();
    ctx.moveTo(0,-24); ctx.lineTo(3.8,-15); ctx.lineTo(3.4,-1);
    ctx.lineTo(-3.4,-1); ctx.lineTo(-3.8,-15);
    ctx.closePath();
    ctx.fillStyle = 'rgba(240,231,210,0.96)'; ctx.fill();
    ctx.strokeStyle = P.am; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = P.rgba(P.amRGB,0.55); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0,-19); ctx.lineTo(0,-2); ctx.stroke();
    ctx.fillStyle = P.am;
    ctx.fillRect(-8.5,-2.6,17,3);
    ctx.fillStyle = '#7d5a2f';
    ctx.fillRect(-2.2,0.4,4.4,8.5);
    ctx.fillStyle = P.am;
    ctx.beginPath(); ctx.arc(0,9.6,2.2,0,6.28); ctx.fill();
    ctx.strokeStyle = P.red; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(0,8); ctx.quadraticCurveTo(5,13,3,19); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(0,-20); ctx.lineTo(13,12); ctx.lineTo(0,6); ctx.lineTo(-13,12);
    ctx.closePath();
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.6; ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.beginPath();
  ctx.arc(p.x,p.y,p.collect,0,6.28);
  ctx.strokeStyle = P.rgba(P.scoutRGB,0.10);
  ctx.lineWidth = 1; ctx.stroke();
}

var _HFS = Object.create(null), _HFK = -1;
function drawHud(){
  var p = G.player;
  /* canvas 每帧重设同一串 font 也有解析成本，drawHud 内同一字体只设一次 */
  var _lf = '';
  function useF(f){ if (f !== _lf){ ctx.font = f; _lf = f; } }
  var k = clamp(0.86, Math.min(VW/414, VH/820), 1.95);
  function F(n){ return Math.round(n*k); }
  /* 字号字典跨帧复用：以前每帧新建一个对象再塞十来个 key，白送 GC 一点活 */
  if (_HFK !== k){ _HFS = Object.create(null); _HFK = k; }
  function FN(w, size){
    var key = w + '_' + size, v = _HFS[key];
    if (!v){ v = _HFS[key] = w + ' ' + F(size) + 'px "Noto Serif SC","Songti SC","STSong",serif'; }
    return v;
  }
  /* 可用宽度先扣掉左右安全区，横屏也能完整显示（竖屏 SAFE_L/R 为 0，行为与原来一致） */
  var aw = VW - SAFE_L - SAFE_R;
  var HWW = Math.min(aw, VWW || aw), HX = SAFE_L + (aw - HWW) / 2;
  var pad = HX + F(16);
  var top = F(10);
  /* 安全区：刘海/灵动岛机型上画布是全屏的，顶部 HUD 会被盖住，统一下移 SAFE_T */
  var SY = SAFE_T, SB = SAFE_B;

  /* 华夏风皮肤：四角回纹框（路径按尺寸预生成，避免每帧重算 8 段） */
  if (SKIN === 'huaxia'){
    var fkey = HX + '|' + HWW + '|' + VH + '|' + SY + '|' + SB + '|' + k.toFixed(2);
    var fc = G.framePath;
    if (!fc || G.frameKey !== fkey){
      var cL = F(26);
      var fOut = new Path2D(), fIn = new Path2D();
      var cs = [[HX+F(10),F(8)+SY,1,1],[HX+HWW-F(10),F(8)+SY,-1,1],[HX+F(10),VH-F(8)-SB,1,-1],[HX+HWW-F(10),VH-F(8)-SB,-1,-1]];
      for (var ci=0; ci<cs.length; ci++){
        var c = cs[ci];
        fOut.moveTo(c[0]+c[2]*cL, c[1]);
        fOut.lineTo(c[0], c[1]);
        fOut.lineTo(c[0], c[1]+c[3]*cL);
        fIn.moveTo(c[0]+c[2]*(cL-F(9)), c[1]+c[3]*F(4));
        fIn.lineTo(c[0]+c[2]*F(4), c[1]+c[3]*F(4));
        fIn.lineTo(c[0]+c[2]*F(4), c[1]+c[3]*(cL-F(9)));
      }
      fc = G.framePath = {outer: fOut, inner: fIn};
      G.frameKey = fkey;
    }
    ctx.strokeStyle = P.rgba(P.amRGB,0.34);
    ctx.lineWidth = Math.max(1, F(2));
    ctx.stroke(fc.outer);
    ctx.stroke(fc.inner);
  }

  ctx.save();
  ctx.translate(0, SY);

  var ew = HWW - F(32);
  ctx.fillStyle = P.rgba(P.cyRGB,0.12);
  ctx.fillRect(pad, top, ew, F(4));
  var maxed = p.level >= LEVEL_CAP;
  ctx.fillStyle = maxed ? P.am : P.cy;
  ctx.fillRect(pad, top, maxed ? ew : ew*Math.min(1, p.exp/p.expNext), F(4));

  ctx.textAlign = 'left';
  useF(FN(900,15));
  ctx.fillStyle = P.ink;
  ctx.fillText('Lv ' + p.level, pad, F(38));
  useF(FN(700,11));
  ctx.fillStyle = P.rgba(P.inkRGB,0.5);
  ctx.fillText(p.charName + (maxed ? ' · 满级' : ''), pad + F(46), F(38));

  var bx = pad, by = F(44);
  var bw = Math.round(Math.min(F(170), HWW * (VW < 400 ? 0.36 : 0.44))), bh = F(11);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(bx, by, bw, bh);
  var hr = Math.max(0, p.hp/p.hpMax);
  ctx.fillStyle = hr > 0.35 ? p.color : P.red;
  ctx.fillRect(bx, by, bw*hr, bh);
  ctx.strokeStyle = P.rgba(P.inkRGB,0.18); ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);
  useF(FN(700,11));
  ctx.fillStyle = P.rgba(P.inkRGB,0.75);
  ctx.fillText((G.practice || G.training) ? '练习场 · 无限生命' : (Math.max(0, Math.ceil(p.hp)) + ' / ' + Math.round(p.hpMax)), bx+F(6), by+F(10));

  /* 飞剑余量：血条右侧三枚小菱形，挡掉一次就暗一枚，淬锋后转亮金 —— 免伤是有限资源，得一眼看得见 */
  if (G.swords > 0 || G.swordDmg){
    var fqy = by + bh*0.5, fqs = Math.max(3.2, F(4.2)), fq0 = bx + bw + F(12);
    for (var fqi=0; fqi<3; fqi++){
      var fqOn = fqi < (G.swords || 0), fqx = fq0 + fqi*F(13);
      ctx.beginPath();
      ctx.moveTo(fqx, fqy-fqs); ctx.lineTo(fqx+fqs*0.62, fqy);
      ctx.lineTo(fqx, fqy+fqs); ctx.lineTo(fqx-fqs*0.62, fqy);
      ctx.closePath();
      ctx.fillStyle = fqOn ? (G.swordDmg ? '#ffe7a0' : P.cy) : P.rgba(P.inkRGB, 0.2);
      ctx.fill();
    }
  }

  ctx.textAlign = 'center';
  useF(FN(900,16));
  ctx.fillStyle = P.am;
  ctx.fillText('第 ' + G.wave + ' 波', VW/2, F(31));
  useF(FN(700,12));
  var pillW = Math.round(Math.min(F(190), HWW*0.66)), pillH = F(17);
  var pillX = VW/2 - pillW/2, pillY = F(58);
  var prog = G.waveLen > 0 ? Math.min(1, Math.max(0, G.waveT / G.waveLen)) : 0;
  var bossOn = G.boss && !G.boss.dead;
  if (bossOn) prog = Math.max(0, Math.min(1, G.boss.hp / G.boss.hpMax));
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.fillRect(pillX, pillY, pillW, pillH);
  /* Boss 血条进二阶段（≤50%）直接转红，并在半血处留刻度 */
  var bossPhase2 = bossOn && G.boss.hp / G.boss.hpMax <= 0.5;
  ctx.fillStyle = bossOn
    ? (bossPhase2 ? 'rgba(196,64,52,0.72)' : 'rgba(224,110,96,0.42)')
    : P.rgba(P.cyRGB, 0.24);
  ctx.fillRect(pillX, pillY, pillW*prog, pillH);
  if (bossOn){
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(pillX + pillW*0.5 - 1, pillY, 2, pillH);
  }
  ctx.strokeStyle = P.rgba(P.inkRGB, 0.16); ctx.lineWidth = 1;
  ctx.strokeRect(pillX + .5, pillY + .5, pillW - 1, pillH - 1);
  var sub = '下一波 ' + Math.max(0, Math.ceil(G.waveLen - G.waveT)) + 's · 场上 ' + (G.aliveN === undefined ? G.enemies.length : G.aliveN);
  if (G.breathe) sub = '喘息 · ' + sub;
  if ((G.cycle || 1) > 1) sub = '周' + G.cycle + ' · ' + sub;
  if (bossOn){
    /* 首领波只写名字与百分比，场内数量挤不下就省掉 */
    var bd0 = G.boss.bossDef || {};
    sub = (bd0.name || '首领') + ' · ' + Math.max(0, Math.round(G.boss.hp / G.boss.hpMax * 100)) + '%';
  }
  useF(FN(700,11));
  ctx.fillStyle = P.rgba(P.inkRGB,0.82);
  ctx.fillText(sub, VW/2, pillY + pillH*0.5 + F(3.5));
  if (G.mods.length){
    var names = modNames();
    var wm = worstMod();
    ctx.fillStyle = P.scout;
    if (G.mods.length <= 2){
      useF(FN(700,11));
      ctx.fillText('异变 · ' + names, VW/2, F(90));
    } else {
      useF(FN(700,11));
      ctx.fillText('异变 ' + G.mods.length + ' 条', VW/2, F(88));
      useF(FN(700,9.5));
      ctx.fillText(modNames(3), VW/2, F(102));
    }
    if (wm){
      useF(FN(700,10));
      ctx.fillStyle = '#e0796a';
      ctx.fillText('最坑：' + wm.name, VW/2, F(118));
    }
  }

  if (S.set.hudInfo && G.player){
    var pp = G.player;
    var dps = Math.round(dpsEst());
    var arm = Math.round((1 - armorTaken(pp.armor))*100);
    ctx.textAlign = 'left';
    useF(FN(700,10.5));
    ctx.fillStyle = P.rgba(P.scoutRGB,0.72);
    var dLine = 'DPS≈' + fmt(dps);
    var dLine2 = '减伤 ' + arm + '% · 暴击 ' + Math.round((pp.crit||0)*100) + '%';
    /* 底部固定三行：DPS / 减伤暴击 / 首领名，各自占一行不互相压 */
    ctx.fillText(dLine, pad, VH - SB - SY - F(96));
    ctx.fillText(dLine2, pad, VH - SB - SY - F(82));
  }

  ctx.textAlign = 'right';
  useF(FN(700,12));
  ctx.fillStyle = P.rgba(P.inkRGB,0.66);
  /* 击杀/金币以前直接拼数字，五位数之后就糊成一片，跟商店、结算页的千分位也对不上 */
  ctx.fillText('击杀 ' + fmt(G.kills), HX + HWW - F(16), F(84));
  ctx.fillStyle = P.am;
  ctx.fillText('金币 ' + fmt(coinNow()), HX + HWW - F(16), F(104));
  /* 状态条：同一位置按优先级只显示最要紧的一条 */
  var stTxt = '', stCol = P.cy;
  if (G.gate){ stTxt = '守关 ' + Math.max(0, Math.ceil(G.gate.t)) + 's'; stCol = '#e0796a'; }
  else if (G.bountyRef && !G.bountyRef.dead && G.enemies.indexOf(G.bountyRef) >= 0){
    var bdx = G.bountyRef.x - G.player.x, bdy = G.bountyRef.y - G.player.y;
    stTxt = '悬赏 ' + Math.round(Math.sqrt(bdx*bdx + bdy*bdy)) + 'm'; stCol = P.am;
  }
  else if (G.quest && !G.quest.done){
    stTxt = G.quest.type === 'nohit' ? '支线 · 不受伤'
         : ('支线 ' + (G.kills - G.quest.kills0) + '/' + G.quest.need);
    stCol = P.scout;
  } else if ((G.cycle || 1) > 1){
    stTxt = '第' + G.cycle + '周目'; stCol = P.dim;
  }
  if (stTxt){
    ctx.fillStyle = stCol;
    ctx.fillText(stTxt, HX + HWW - F(16), F(124));
  }
  /* 连杀只用一条细色带表示，长度=倍率进度，不再占一行数字 */
  var cbw = Math.min(F(66), HWW*0.3), cbh = Math.max(2, F(3));
  var cbx = HX + HWW - F(16) - cbw, cby = stTxt ? F(131) : F(114);
  if (G.comboK >= 3){
    var cprog = Math.min(1, G.comboK / 60);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(cbx, cby, cbw, cbh);
    /* 渐变色带按宽度缓存，别每帧 new 一个 Gradient */
    if (!G.comboGrad || G.comboGradW !== cbw || G.comboGradX !== cbx){
      var cg = ctx.createLinearGradient(cbx, 0, cbx + cbw, 0);
      cg.addColorStop(0, P.cy);
      cg.addColorStop(0.6, P.am);
      cg.addColorStop(1, '#e0796a');
      G.comboGrad = cg; G.comboGradW = cbw; G.comboGradX = cbx;
    }
    ctx.fillStyle = G.comboGrad;
    ctx.fillRect(cbx, cby, cbw * cprog, cbh);
  } else if (G.comboBreak > 0){
    /* 断连瞬间闪一下，让人知道倍率没了 */
    var fl = Math.sin(G.comboBreak * 46) > 0;
    ctx.fillStyle = fl ? 'rgba(224,121,106,0.9)' : 'rgba(224,121,106,0.28)';
    ctx.fillRect(cbx, cby - F(1), cbw, cbh + F(2));
  }
  /* 自动降档的短期提示，避免玩家以为画质莫名变差 */
  if (G.qNoteUntil && Date.now() < G.qNoteUntil){
    ctx.textAlign = 'right';
    useF(FN(700,10.5));
    ctx.fillStyle = P.rgba(P.amRGB,0.82);
    ctx.fillText('画质↓ L' + AUTOQ.lv, HX + HWW - F(16), F(150));
  }

  if (G.boss && !G.boss.dead){
    var w2 = Math.min(F(430), HWW*0.68), x2 = (VW-w2)/2, y2 = VH - SB - SY - F(50);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x2, y2, w2, F(10));
    ctx.fillStyle = P.red;
    ctx.fillRect(x2, y2, w2*Math.max(0,G.boss.hp/G.boss.hpMax), F(10));
    /* 阶段刻度：40% 与 15% 两条断点 */
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(x2 + w2*0.40, y2 - F(2), Math.max(1, F(1.2)), F(14));
    ctx.fillRect(x2 + w2*0.15, y2 - F(2), Math.max(1, F(1.2)), F(14));
    ctx.textAlign = 'center';
    useF(FN(900,11));
    ctx.fillStyle = '#d98a78';
    var pn = (G.boss.phase || 1);
    /* 首领名单独占一行，夹在血条与底部状态行之间 */
    ctx.fillText((G.bossDef ? G.bossDef.name : '首领') + ' · ' + PHASE_NAME[pn], VW/2, y2-F(7));
  }

  if (G.bossWarn){
    var wt = G.bossWarn.t;
    var ww = Math.min(F(330), HWW*0.7), wx = (VW-ww)/2, wy = VH*0.34;
    ctx.textAlign = 'center';
    useF(FN(900,15));
    ctx.fillStyle = '#d98a78';
    ctx.fillText('首领 · ' + G.bossWarn.def.name + ' 即将抵达', VW/2, wy - F(16));
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(wx, wy, ww, F(6));
    ctx.fillStyle = P.red; ctx.fillRect(wx, wy, ww*(1 - wt/3), F(6));
    useF(FN(900,22));
    ctx.fillStyle = P.amSoft;
    ctx.fillText(Math.ceil(wt), VW/2, wy + F(42));
  }

  ctx.restore();

  if (JOY.active){
    var jr = F(46);
    ctx.beginPath(); ctx.arc(JOY.bx, JOY.by, jr, 0, 6.28);
    ctx.strokeStyle = P.rgba(P.cyRGB,0.35);
    ctx.fillStyle = P.rgba(P.cyRGB,0.05);
    ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.arc(JOY.bx + JOY.dx*jr*0.72, JOY.by + JOY.dy*jr*0.72, jr*0.42, 0, 6.28);
    ctx.fillStyle = P.rgba(P.cyRGB,0.45); ctx.fill();
  }
}

/* 地图边界：外侧禁区 + 发光警戒线（按视口裁剪，避免大面积填充） */
function drawBoundary(camX, camY){
  var W = (G && G.half) ? G.half : CFG.world;
  /* 玩家在场中央时四条边界都在视野外：这里每帧的 save/restore、8 次 fillRect、
     一条 path 加三次描边全是空跑（其中一次还是虚线描边）。先判可见性直接返回 */
  if (Math.abs(-W - camX) > VW/2 + 60 && Math.abs(W - camX) > VW/2 + 60 &&
      Math.abs(-W - camY) > VH/2 + 60 && Math.abs(W - camY) > VH/2 + 60) return;
  var vx0 = camX - VW/2 - 60, vx1 = camX + VW/2 + 60;
  var vy0 = camY - VH/2 - 60, vy1 = camY + VH/2 + 60;
  var px = G.player ? G.player.x : camX, py = G.player ? G.player.y : camY;
  var near = Math.max(0, 1 - Math.min(W-Math.abs(px), W-Math.abs(py)) / 120);

  ctx.save();
  // 外侧禁区
  ctx.fillStyle = 'rgba(255,106,74,0.06)';
  if (vy0 < -W) ctx.fillRect(vx0, vy0, vx1-vx0, -W-vy0);
  if (vy1 >  W) ctx.fillRect(vx0,  W,  vx1-vx0, vy1-W);
  var by0 = Math.max(vy0,-W), by1 = Math.min(vy1,W);
  if (vx0 < -W) ctx.fillRect(vx0, by0, -W-vx0, by1-by0);
  if (vx1 >  W) ctx.fillRect( W, by0, vx1-W,  by1-by0);

  // 紧贴边界的暗带
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  var D = 46;
  var iy0 = Math.max(vy0,-W), iy1 = Math.min(vy1,W), ix0 = Math.max(vx0,-W), ix1 = Math.min(vx1,W);
  if (iy0 <= -W+D) ctx.fillRect(ix0, -W, ix1-ix0, D);
  if (iy1 >=  W-D) ctx.fillRect(ix0,  W-D, ix1-ix0, D);
  if (ix0 <= -W+D) ctx.fillRect(-W, iy0, D, iy1-iy0);
  if (ix1 >=  W-D) ctx.fillRect( W-D, iy0, D, iy1-iy0);

  var glow = 0.28 + near*0.6 + Math.sin(G.time*4)*0.06;
  var segs = [
    [-W,-W, W,-W], [-W,W, W,W], [-W,-W, -W,W], [W,-W, W,W]
  ];
  /* 三层描边共用同一条 path：原来每层都重新 beginPath + 重建四条线，纯重复劳动 */
  ctx.beginPath();
  for (var gi=0; gi<segs.length; gi++){
    var g2 = segs[gi];
    // 水平边只看 x 区间相交，垂直边看 y 区间相交
    if (g2[1] === g2[3]){
      if (g2[1] < vy0 || g2[1] > vy1) continue;
      ctx.moveTo(Math.max(g2[0],vx0), g2[1]);
      ctx.lineTo(Math.min(g2[2],vx1), g2[1]);
    } else {
      if (g2[0] < vx0 || g2[0] > vx1) continue;
      ctx.moveTo(g2[0], Math.max(g2[1],vy0));
      ctx.lineTo(g2[0], Math.min(g2[3],vy1));
    }
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(216,180,92,' + (0.12 + near*0.5) + ')'; ctx.lineWidth = 20;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,214,120,' + glow + ')'; ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.setLineDash([18,14]);
  ctx.strokeStyle = 'rgba(255,236,190,' + (0.18 + near*0.55) + ')'; ctx.lineWidth = 6;
  ctx.stroke();
  ctx.setLineDash([]);

  // 四角标记（仅当附近可见）
  ctx.fillStyle = 'rgba(216,180,92,' + (0.35 + near*0.4) + ')';
  for (var cx=-1; cx<=1; cx+=2){
    if (Math.abs(cx*W - camX) > VW/2 + 40) continue;
    for (var cy=-1; cy<=1; cy+=2){
      if (Math.abs(cy*W - camY) > VH/2 + 40) continue;
      var hx = cx*W, hy = cy*W;
      ctx.fillRect(Math.min(hx, hx - cx*44), hy - 6, 44, 12);
      ctx.fillRect(hx - 6, Math.min(hy, hy - cy*44), 12, 44);
    }
  }
  ctx.restore();
}

function drawModGround(camX, camY){
  /* 收缩毒圈 */
  if (G.zone){
    var z = G.zone;
    /* 毒圈半径常常是几倍屏宽：整圈 2000+ px 的路径 + 整圆填充全都要光栅化。
       这里只画视野里能看到的那段弧，光晕改成整屏矩形填充（径向渐变的采样结果完全一样）。 */
    var zwh = VW*0.5/VZ, zhh = VH*0.5/VZ;
    var zcdx = camX - z.x, zcdy = camY - z.y, zcd = Math.sqrt(zcdx*zcdx + zcdy*zcdy);
    var zvr = Math.sqrt(zwh*zwh + zhh*zhh);
    var zb0 = 0, zb1 = 6.283;
    if (zcd - z.r > zvr + 24 || z.r - zcd > zvr + 24) zb1 = -1;   /* 圈边完全在屏外 */
    else {
      var zth = Math.atan2(zcdy, zcdx);
      var zal = Math.asin(Math.min(1, zvr / Math.max(1, zcd))) + 0.1;
      zb0 = zth - zal; zb1 = zth + zal;
    }
    if (zb1 > zb0){
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, zb0, zb1);
      ctx.strokeStyle = 'rgba(120,230,140,0.8)'; ctx.lineWidth = 4; ctx.stroke();
      ctx.save();
      ctx.setLineDash([10, 9]);
      ctx.lineDashOffset = -G.time * 14;
      ctx.strokeStyle = 'rgba(240,255,245,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r - 3, zb0, zb1); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(160,240,170,0.32)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r - 16, zb0, zb1); ctx.stroke();
    }
    /* 毒圈光晕的渐变按半径档位缓存：每帧重建渐变对象是纯浪费 */
    var gk = Math.round(z.r / 20);
    if (!z._zg || z._gk !== gk || z._gx !== z.x || z._gy !== z.y){
      var zg = ctx.createRadialGradient(z.x, z.y, z.r, z.x, z.y, z.r + 180);
      zg.addColorStop(0, 'rgba(90,220,120,0.12)');
      zg.addColorStop(1, 'rgba(90,220,120,0)');
      z._zg = zg; z._gk = gk; z._gx = z.x; z._gy = z.y;
    }
    ctx.fillStyle = z._zg;
    ctx.fillRect(camX - zwh - 8, camY - zhh - 8, zwh*2 + 16, zhh*2 + 16);
  }

  drawMeteors();
  drawZaps();

  /* 战线守护：中央发生器 */
  if (G.hold){
    var ho = G.hold;
    ctx.beginPath(); ctx.arc(ho.x, ho.y, ho.r, 0, 6.28);
    ctx.fillStyle = ho.out > 0 ? 'rgba(255,106,74,0.10)' : P.rgba(P.cyRGB,0.10);
    ctx.fill();
    ctx.strokeStyle = ho.out > 0 ? 'rgba(255,106,74,0.7)' : P.rgba(P.cyRGB,0.55);
    ctx.lineWidth = 3; ctx.stroke();
    ctx.save();
    ctx.translate(ho.x, ho.y);
    ctx.rotate(G.time*0.8);
    ctx.strokeStyle = P.rgba(P.cyRGB,0.9); ctx.lineWidth = 2.5;
    ctx.strokeRect(-16,-16,32,32);
    ctx.restore();
    ctx.font = '700 11px "Noto Serif SC","Songti SC","STSong",serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = ho.out > 0 ? '#cf6a4e' : P.rgba(P.scoutRGB,0.9);
    ctx.fillText(ho.out > 0 ? ('失守倒计时 ' + Math.ceil(5-ho.out) + 's') : '守住发生器', ho.x, ho.y - 30);
  }
}

function drawZaps(){
  for (var i=0;i<G.zaps.length;i++){
    var z = G.zaps[i], al = Math.max(0, z.t/0.32);
    ctx.strokeStyle = 'rgba(140,220,255,' + (al*0.9) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(z.x1, z.y1);
    var seg = 5;
    for (var sgi=1; sgi<seg; sgi++){
      var tt = sgi/seg;
      ctx.lineTo(z.x1 + (z.x2-z.x1)*tt + rnd(-9,9), z.y1 + (z.y2-z.y1)*tt + rnd(-9,9));
    }
    ctx.lineTo(z.x2, z.y2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,' + (al*0.5) + ')';
    ctx.lineWidth = 1.4; ctx.stroke();
  }
}

function drawMeteors(){
  for (var i=0;i<G.meteors.length;i++){
    var me = G.meteors[i];
    var k = Math.max(0, me.t/0.75);
    ctx.beginPath(); ctx.arc(me.x, me.y, me.r, 0, 6.28);
    ctx.strokeStyle = 'rgba(255,106,74,0.55)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(me.x, me.y, me.r*k, 0, 6.28);
    ctx.strokeStyle = 'rgba(255,154,74,0.85)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath();
    ctx.arc(me.x + me.r*0.55*k, me.y - me.r*0.55*k, 7, 0, 6.28);
    ctx.fillStyle = '#b5563a'; ctx.fill();
  }
}

function drawGuard(){
  var g = G.guard;
  if (!g) return;
  ctx.save();
  ctx.translate(g.x, g.y);
  var pulse = 0.55 + Math.sin(g.t*6)*0.15;
  ctx.globalAlpha = g.hurt > 0 ? 0.95 : pulse;
  ctx.beginPath();
  ctx.moveTo(0,-18); ctx.lineTo(12,11); ctx.lineTo(0,5); ctx.lineTo(-12,11);
  ctx.closePath();
  ctx.fillStyle = 'rgba(126,240,220,0.30)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(126,240,220,0.95)'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,g.r,0,6.28);
  ctx.strokeStyle = 'rgba(126,240,220,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
  var w2 = 46, hpr = Math.max(0, g.hp/g.hpMax);
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(g.x-w2/2, g.y-32, w2, 4);
  ctx.fillStyle = '#a8d0c2'; ctx.fillRect(g.x-w2/2, g.y-32, w2*hpr, 4);
  ctx.fillStyle = 'rgba(190,255,240,0.75)';
  ctx.font = '700 10px "Noto Serif SC","Songti SC","STSong",serif'; ctx.textAlign = 'center';
  ctx.fillText('援护', g.x, g.y+40);
  ctx.textAlign = 'left';
}

function drawHunter(){
  if (!G.hunter) return;
  var h = G.hunter;
  ctx.save();
  ctx.translate(h.x, h.y);
  var pl = 0.5 + Math.sin(G.time*6)*0.3;
  ctx.beginPath(); ctx.arc(0,0,h.r+16,0,6.28);
  ctx.strokeStyle = 'rgba(255,60,40,'+pl*0.5+')'; ctx.lineWidth = 3; ctx.stroke();
  ctx.rotate(G.time*3);
  ctx.beginPath();
  for (var i=0;i<3;i++){
    var a = i*2.094;
    ctx.moveTo(Math.cos(a)*h.r, Math.sin(a)*h.r);
    ctx.lineTo(Math.cos(a+0.6)*h.r*0.5, Math.sin(a+0.6)*h.r*0.5);
  }
  ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = 5; ctx.stroke();
  ctx.restore();
  ctx.font = '900 10px "Noto Serif SC","Songti SC","STSong",serif';
  ctx.textAlign = 'center'; ctx.fillStyle = P.red;
  ctx.fillText('追猎者', h.x, h.y - h.r - 10);
}

var _fogCv = null, _fogW = 0, _fogH = 0, _fogR = 0;
/* 迷雾层缓存：每帧 createRadialGradient + 全屏 fillRect 太贵，
   改成一张按屏幕尺寸预渲染的遮罩，按玩家偏移贴图，边缘用纯色补齐 */
function fogLayer(W, H, R){
  if (_fogCv && _fogW === W && _fogH === H && Math.abs(_fogR - R) < 0.5) return _fogCv;
  var cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(W/2)); cv.height = Math.max(1, Math.round(H/2));
  var c2 = cv.getContext('2d');
  var sx = cv.width/2, sy = cv.height/2, r = R*0.5;
  var g = c2.createRadialGradient(sx, sy, r*0.45, sx, sy, r*1.3);
  g.addColorStop(0, 'rgba(3,10,11,0.02)');
  g.addColorStop(0.6, 'rgba(3,10,11,0.5)');
  g.addColorStop(1, 'rgba(3,10,11,0.72)');
  c2.fillStyle = g;
  c2.fillRect(0, 0, cv.width, cv.height);
  _fogCv = cv; _fogW = W; _fogH = H; _fogR = R;
  return cv;
}

function drawFog(){
  var p = G.player;
  var sx = p.x - G.cam.x + VW/2, sy = p.y - G.cam.y + VH/2;
  var R = Math.min(VW, VH)*0.40;
  var layer = fogLayer(VW, VH, R);
  var ox = sx - VW/2, oy = sy - VH/2;   /* 遮罩相对屏幕的偏移 */
  ctx.fillStyle = 'rgba(3,10,11,0.72)';
  if (oy > 0) ctx.fillRect(0, 0, VW, Math.min(oy, VH));
  if (oy < 0) ctx.fillRect(0, Math.min(VH, oy + VH), VW, VH - Math.min(VH, oy + VH));
  var top = Math.max(0, oy), hh = Math.min(VH, oy + VH) - top;
  if (hh > 0){
    if (ox > 0) ctx.fillRect(0, top, Math.min(ox, VW), hh);
    else if (ox < 0) ctx.fillRect(Math.min(VW, ox + VW), top, VW - Math.min(VW, ox + VW), hh);
  }
  ctx.drawImage(layer, ox, oy, VW, VH);
}

/* 徽记直接按世界坐标画：满屏掉落物时这里省掉每枚一次的 save/translate/restore */
function draw(){
  var camX = G.cam.x, camY = G.cam.y;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  /* bgLayer 是不透明的径向渐变，铺满即遮住底色；只有它不存在时才需要先填底，
     省掉每帧一次全屏 fillRect（DPR=2 时是 4 倍像素量） */
  if (bgLayer){
    ctx.drawImage(bgLayer, 0, 0, VW, VH);
  } else {
    ctx.fillStyle = P.bg0;
    ctx.fillRect(0,0,VW,VH);
    var th0 = THEME[G.theme || 0];
    if (th0){ ctx.fillStyle = th0.tint; ctx.fillRect(0, 0, VW, VH); }
  }

  var sh = (G.shake > 0 && !(S.set && S.set.shakeOff)) ? G.shake * 0.5 : 0;
  var ox = -camX + VW/2 + (sh ? (Math.random()-0.5)*sh : 0);
  var oy = -camY + VH/2 + (sh ? (Math.random()-0.5)*sh : 0);

  ctx.save();
  ctx.translate(VW/2, VH/2);
  ctx.scale(VZ, VZ);
  ctx.translate(-VW/2, -VH/2);
  ctx.translate(ox, oy);
  drawGrid(camX, camY);
  drawBoundary(camX, camY);
  drawModGround(camX, camY);
  drawDust(camX, camY);
  drawDeco(camX, camY);

  var i;
  /* 宝石合批：整屏同色宝石按 3 档亮度合成三条 path，内方孔再合一条，
     单枚原来 5~7 次调用，现在整屏十几次 */
  var GB = _gemBuckets;
  GB[0].length = 0; GB[1].length = 0; GB[2].length = 0;
  for (i=0;i<G.gems.length;i++){
    var g = G.gems[i];
    if (Math.abs(g.x-camX) > VW/2+30 || Math.abs(g.y-camY) > VH/2+30) continue;
    var gsz = Math.min(10, 3 + Math.sqrt(g.v) * 0.55);
    var pulse = 0.85 + Math.sin(G.time*6 + g.x*0.05)*0.15;
    var bk = pulse < 0.8 ? 0 : (pulse < 0.92 ? 1 : 2);
    GB[bk].push(g.x, g.y, gsz);
  }
  var gemCols = ['rgba(240,180,41,0.74)','rgba(240,180,41,0.86)','rgba(240,180,41,0.97)'];
  if (SKIN === 'huaxia'){
    for (var gbi=0; gbi<3; gbi++){
      var garr = GB[gbi];
      if (!garr.length) continue;
      ctx.beginPath();
      for (var gj=0; gj<garr.length; gj+=3){
        var gr = Math.max(4.2, garr[gj+2]*1.15);
        ctx.moveTo(garr[gj]+gr, garr[gj+1]);
        ctx.arc(garr[gj], garr[gj+1], gr, 0, 6.28);
      }
      ctx.fillStyle = gemCols[gbi]; ctx.fill();
    }
    /* 描边只画一次，粗细统一 */
    ctx.beginPath();
    for (var gs0=0; gs0<3; gs0++){
      var ga0 = GB[gs0];
      for (var gj0=0; gj0<ga0.length; gj0+=3){
        var gr0 = Math.max(4.2, ga0[gj0+2]*1.15);
        ctx.moveTo(ga0[gj0]+gr0, ga0[gj0+1]);
        ctx.arc(ga0[gj0], ga0[gj0+1], gr0, 0, 6.28);
      }
    }
    ctx.strokeStyle = 'rgba(255,240,200,0.8)'; ctx.lineWidth = 1.6; ctx.stroke();
    /* 内方孔合成一条 path */
    ctx.beginPath();
    for (var gs1=0; gs1<3; gs1++){
      var ga1 = GB[gs1];
      for (var gj1=0; gj1<ga1.length; gj1+=3){
        var gr1 = Math.max(4.2, ga1[gj1+2]*1.15), gh1 = Math.max(2.6, gr1*0.46);
        ctx.rect(ga1[gj1]-gh1/2, ga1[gj1+1]-gh1/2, gh1, gh1);
      }
    }
    ctx.fillStyle = 'rgba(24,16,6,0.92)'; ctx.fill();
  } else {
    for (var gbi2=0; gbi2<3; gbi2++){
      var garr2 = GB[gbi2];
      if (!garr2.length) continue;
      ctx.beginPath();
      for (var gj2=0; gj2<garr2.length; gj2+=3){
        var ghd = garr2[gj2+2]*0.7071, gx2 = garr2[gj2], gy2 = garr2[gj2+1];
        ctx.moveTo(gx2, gy2-ghd); ctx.lineTo(gx2+ghd, gy2);
        ctx.lineTo(gx2, gy2+ghd); ctx.lineTo(gx2-ghd, gy2);
      }
      ctx.fillStyle = gemCols[gbi2]; ctx.fill();
    }
  }

  /* 掉落图标原来是 22–24px 再加一个角标徽记，满地掉落时会糊成一片；
     缩到 16px、去掉角标，并做视口裁剪 */
  /* 掉落图标：同样按世界坐标直画，每件省掉一次 save/translate/restore */
  var pkM = 46;
  for (i=0;i<G.pickups.length;i++){
    var pk = G.pickups[i];
    if (Math.abs(pk.x-camX) > VW/2+pkM || Math.abs(pk.y-camY) > VH/2+pkM) continue;
    var pby = pk.y + Math.sin(G.time*3 + pk.x)*1.5;
    if (pk.type === 'med'){
      ctx.fillStyle = 'rgba(20,50,45,0.9)';
      ctx.fillRect(pk.x-8, pby-8, 16, 16);
      ctx.strokeStyle = '#c9b382'; ctx.lineWidth = 1.6; ctx.strokeRect(pk.x-8, pby-8, 16, 16);
      ctx.fillStyle = '#c9b382';
      ctx.fillRect(pk.x-2, pby-5.2, 4, 10.4); ctx.fillRect(pk.x-5.2, pby-2, 10.4, 4);
    } else if (pk.type === 'magnet'){
      ctx.beginPath(); ctx.arc(pk.x, pby, 8, 0, 6.28);
      ctx.fillStyle = 'rgba(50,40,16,0.9)'; ctx.fill();
      ctx.strokeStyle = P.am; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = P.am;
      ctx.fillRect(pk.x-3.6, pby-5, 2.2, 7.4);
      ctx.fillRect(pk.x+1.4, pby-5, 2.2, 7.4);
      ctx.fillRect(pk.x-3.6, pby+1.4, 7.2, 2.2);
    } else {
      ctx.fillStyle = 'rgba(52,38,12,0.95)';
      ctx.fillRect(pk.x-9, pby-7.5, 18, 15);
      ctx.strokeStyle = P.am; ctx.lineWidth = 1.6; ctx.strokeRect(pk.x-9, pby-7.5, 18, 15);
      ctx.beginPath(); ctx.moveTo(pk.x-9, pby-7.5); ctx.lineTo(pk.x, pby-15); ctx.lineTo(pk.x+9, pby-7.5);
      ctx.strokeStyle = P.am; ctx.stroke();
    }
  }

  ringReset();
  for (i=0;i<G.rings.length;i++){
    var rg = G.rings[i];
    if (Math.abs(rg.x-camX) > VW/2+rg.r+40 || Math.abs(rg.y-camY) > VH/2+rg.r+40) continue;
    ringAdd(rg.x, rg.y, rg.r, rg.col || P.cyRGB, rg.life/rg.max*0.8);
  }
  ringFlush();

  drawEnemyRings(camX, camY);
  ENK = DPR*VZ; ENTX = DPR*(VZ*(ox-VW/2) + VW/2); ENTY = DPR*(VZ*(oy-VH/2) + VH/2);
  _barB.length = 0; _barE.length = 0; _barD.length = 0;
  dotReset();
  for (i=0;i<G.enemies.length;i++){
    var en = G.enemies[i];
    if (Math.abs(en.x-camX) > VW/2+96 || Math.abs(en.y-camY) > VH/2+96) continue;
    drawEnemy(en);
  }
  camReset();
  dotFlush();
  drawBars();

  /* 敌弹合批：按半径三档各合成一条 path，50 颗弹从 200 条命令压到 12 条 */
  var EBK = _ebBk;
  EBK[0].length = 0; EBK[1].length = 0; EBK[2].length = 0;
  for (i=0;i<G.ebullets.length;i++){
    var eb = G.ebullets[i];
    if (Math.abs(eb.x-camX) > VW/2+40 || Math.abs(eb.y-camY) > VH/2+40) continue;
    EBK[eb.r >= 8.5 ? 2 : (eb.r >= 7 ? 1 : 0)].push(eb.x, eb.y, eb.r);
  }
  for (var ebi=0; ebi<3; ebi++){
    var eba = EBK[ebi];
    if (!eba.length) continue;
    ctx.beginPath();
    for (var ebj=0; ebj<eba.length; ebj+=3){
      ctx.moveTo(eba[ebj]+eba[ebj+2], eba[ebj+1]);   /* 不先 moveTo，arc 会把上一个圆连过来 */
      ctx.arc(eba[ebj], eba[ebj+1], eba[ebj+2], 0, 6.28);
    }
    ctx.fillStyle = 'rgba(217,107,138,0.9)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,190,206,0.7)'; ctx.lineWidth = ebi === 2 ? 1.7 : 1.5; ctx.stroke();
  }

  /* 玩家子弹预渲染朝右弹体，每颗只剩 setTransform+drawImage（原华夏皮肤每颗约 9 条命令，射速拉满是最大命令源）。 */
  for (i=0;i<G.bullets.length;i++){
    var b = G.bullets[i];
    if (Math.abs(b.x-camX) > VW/2+60 || Math.abs(b.y-camY) > VH/2+60) continue;
    var bspr = bulletSprite(b.r, SKIN);
    if (bspr){
      var ban = Math.atan2(b.vy, b.vx), bc = Math.cos(ban), bsn = Math.sin(ban);
      var bws = bspr.size / ENK;
      ctx.setTransform(ENK*bc, ENK*bsn, -ENK*bsn, ENK*bc, ENK*b.x + ENTX, ENK*b.y + ENTY);
      ctx.drawImage(bspr.c, -bws*0.5, -bws*0.5, bws, bws);
      continue;
    }
    if (SKIN === 'huaxia'){
      /* 剑气：一段细长光刃，随飞行方向拉出尾芒 */
      var bAng = Math.atan2(b.vy, b.vx);
      var bLen = Math.max(8, b.r*3), bW = Math.max(1.3, b.r*0.62);
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(bAng);
      ctx.fillStyle = P.rgba(P.amRGB, 0.16);
      ctx.beginPath(); ctx.ellipse(-bLen*0.15, 0, bLen*0.85, bW*1.7, 0, 0, 6.28); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bLen*0.55, 0);
      ctx.lineTo(-bLen*0.1, bW);
      ctx.lineTo(-bLen*0.55, 0);
      ctx.lineTo(-bLen*0.1, -bW);
      ctx.closePath();
      ctx.fillStyle = 'rgba(252,244,220,0.96)'; ctx.fill();
      ctx.strokeStyle = P.rgba(P.amRGB, 0.85); ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = P.rgba(P.amRGB,0.3);
      ctx.beginPath(); ctx.arc(b.x-b.vx*0.012, b.y-b.vy*0.012, b.r*1.7, 0, 6.28); ctx.fill();
      ctx.fillStyle = 'rgba(255,224,160,0.96)';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.28); ctx.fill();
    }
  }
  camReset();   /* 子弹逐颗改过矩阵，画角色前必须还原成世界变换 */

  drawPlayer();
  drawSwords();
  drawGuard();
  drawHunter();

  /* 粒子：透明度量化到 4 档后按颜色合批，整屏只剩几次 fill */
  dotReset();
  for (i=0;i<G.parts.length;i++){
    var pt = G.parts[i];
    if (Math.abs(pt.x-camX) > VW/2+40 || Math.abs(pt.y-camY) > VH/2+40) continue;
    var pfa = pt.life/pt.max;
    if (pfa <= 0.02) continue;
    dotAdd(pt.col, pt.x, pt.y, pt.r, Math.round(pfa*4)/4);
  }
  dotFlush();

  ctx.textAlign = 'center';
  for (i=0;i<G.dmgs.length;i++){
    var dn = G.dmgs[i];
    if (Math.abs(dn.x-camX) > VW/2+60 || Math.abs(dn.y-camY) > VH/2+60) continue;
    ctx.globalAlpha = Math.max(0, 1 - dn.t/dn.life);
    /* 字号固定、不用 shadowBlur：这两个在移动端每帧都最贵 */
    if (dn.big){
      ctx.font = FONT_DMG_BIG;
      ctx.fillStyle = '#ff9c3d';
    } else {
      ctx.font = FONT_DMG;
      ctx.fillStyle = P.rgba(P.inkRGB,0.85);
    }
    ctx.fillText(dn.v, dn.x, dn.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (vig){
    /* 暗角是一整屏的 alpha 混合：逐层关闭实测占单帧约 18%（比雾、网格都贵）。
       手动选了低画质，或自动降档已经到第 2 级，就一并跳过它 */
    if (S.set.quality !== 'low' && AUTOQ.lv < 2) ctx.drawImage(vig, 0, 0, VW, VH);
  }

  if (modOn('fog')) drawFog();

  var p = G.player;
  if (p.hurtFlash > 0){
    ctx.fillStyle = 'rgba(255,60,40,'+(p.hurtFlash*0.55)+')';
    ctx.fillRect(0,0,VW,VH);
  }
  if (G.state === 'playing' && p.hp/p.hpMax < 0.3) drawHurtEdge();

  drawBountyMark(camX, camY);
  drawHud();
}

/* 低血红晕只画四边渐变（全屏 alpha 混合在移动端最贵）；渐变按尺寸缓存，尺寸/DPR 变了才重建，否则交界线露馅。 */
var _edgeC = null;
function drawHurtEdge(){
  var eh = Math.round(Math.min(92, VH*0.115));
  var lw = Math.round(Math.max(22, VW*0.10));
  var c = _edgeC;
  if (!c || c.w !== VW || c.h !== VH || c.eh !== eh || c.lw !== lw){
    var R = 'rgba(255,40,30,';
    var gTop = ctx.createLinearGradient(0, 0, 0, eh);
    gTop.addColorStop(0, R+'1)'); gTop.addColorStop(1, R+'0)');
    var gBot = ctx.createLinearGradient(0, VH, 0, VH-eh);
    gBot.addColorStop(0, R+'1)'); gBot.addColorStop(1, R+'0)');
    var gLef = ctx.createLinearGradient(0, 0, lw, 0);
    gLef.addColorStop(0, R+'1)'); gLef.addColorStop(1, R+'0)');
    var gRig = ctx.createLinearGradient(VW, 0, VW-lw, 0);
    gRig.addColorStop(0, R+'1)'); gRig.addColorStop(1, R+'0)');
    c = _edgeC = {w:VW, h:VH, eh:eh, lw:lw, top:gTop, bot:gBot, lef:gLef, rig:gRig};
  }
  var pulse2 = 0.15 + Math.sin(G.time*5)*0.08;
  ctx.globalAlpha = Math.min(0.62, pulse2*1.35);
  ctx.fillStyle = c.top; ctx.fillRect(0, 0, VW, c.eh);
  ctx.fillStyle = c.bot; ctx.fillRect(0, VH-c.eh, VW, c.eh);
  ctx.fillStyle = c.lef; ctx.fillRect(0, 0, c.lw, VH);
  ctx.fillStyle = c.rig; ctx.fillRect(VW-c.lw, 0, c.lw, VH);
  ctx.globalAlpha = 1;
}

/* 悬赏精英不在视野内时，在屏幕边缘给一个指向箭头（世界→屏幕要乘 VZ） */
function drawBountyMark(camX, camY){
  var e = G.bountyRef;
  if (!e || e.dead) return;
  if (G.enemies.indexOf(e) < 0){ G.bountyRef = null; return; }
  var vz = VZ || 1;
  var sx = (e.x - camX) * vz + VW/2, sy = (e.y - camY) * vz + VH/2;
  var m = 26;
  if (sx > m && sx < VW - m && sy > SAFE_T + m && sy < VH - m) return;
  var cx = VW/2, cy = VH/2, dx = sx - cx, dy = sy - cy;
  var tx = (cx - m) / Math.max(1e-4, Math.abs(dx));
  var ty = (cy - SAFE_T - m) / Math.max(1e-4, Math.abs(dy));
  var t = Math.min(tx, ty, 1);
  var px = cx + dx*t, py = cy + dy*t;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.globalAlpha = 0.62 + Math.sin(G.time*7)*0.22;
  ctx.fillStyle = P.am;
  ctx.beginPath();
  ctx.moveTo(12, 0); ctx.lineTo(-6, 6.5); ctx.lineTo(-6, -6.5);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* ================= UI ================= */
var SCREENS = ['scrMenu','scrMeta','scrChars','scrCodex','scrStats','scrSet','scrLevel','scrShop','scrPause','scrOver'];
var elToast = document.getElementById('toast');
var elComboToast = document.getElementById('comboToast');
var toastTimer = null;
var hintTimer = null;

function toast(text){
  elToast.textContent = text;
  elToast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ elToast.classList.remove('on'); }, 1500);
}

var comboToastTimer = null;
function comboToast(text){
  if (!elComboToast) return;
  elComboToast.textContent = text;
  elComboToast.classList.add('on');
  clearTimeout(comboToastTimer);
  comboToastTimer = setTimeout(function(){ elComboToast.classList.remove('on'); }, 1200);
}

function hint(text, ms){
  var el = document.getElementById('hint');
  el.textContent = text;
  el.classList.remove('off', 'hide');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(function(){ el.classList.add('off'); }, ms || 6000);
}

function showScreen(id){
  /* 切页面时把连杀播报收掉，别在菜单/结算页上还飘着一行 */
  if (elComboToast){ elComboToast.classList.remove('on'); clearTimeout(comboToastTimer); }
  for (var i=0;i<SCREENS.length;i++){
    var s = document.getElementById(SCREENS[i]);
    if (s) s.classList.add('hide');
  }
  if (id){
    var t = document.getElementById(id);
    if (t) t.classList.remove('hide');
  }
}

function metaCycle(){ return Math.max(1, S.set.cycle || 1); }

function metaCap(m){ return m.max + (metaCycle() - 1) * 2; }

function metaCost(m, lv){
  var cyc = metaCycle();
  return Math.round(m.cost * Math.pow(1.7, lv) * Math.pow(1.7, cyc - 1));
}

function renderMenu(){
  document.getElementById('menCore').textContent = fmt(S.core);
  var bdCur = (S.bestByDiff || {})[S.diff] || null;
  document.getElementById('menBest').textContent = 
    (bdCur && bdCur.wave > 0 ? ('本档最佳：第 ' + bdCur.wave + ' 波　') : '')
    + (S.best.wave > 0
      ? ('总纪录：第 ' + S.best.wave + ' 波 / 击杀 ' + fmt(S.best.kills))
      : '最佳：尚未出战');
  var seg = document.getElementById('segDiff').children;
  for (var i=0;i<seg.length;i++){
    seg[i].classList.toggle('on', seg[i].getAttribute('data-d') === S.diff);
  }
  var mc = document.getElementById('menCycle');
  if (mc){
    mc.style.fontSize = '12px';
    mc.title = EN_LANG ? 'Reward per cycle: Mutations +1, enemy speed +8%, Base cap +2'
                       : '每进一个周目：异变 +1 条 · 怪速 +8% · 基地上限 +2';
    var left = Math.max(0, 50 - (S.best.wave||0));
    if (EN_LANG){
      mc.textContent = (S.set.cycle > 1)
        ? ('Cycle ' + S.set.cycle + ' · Mutations +' + (S.set.cycle-1))
        : (left + ' waves to Cycle 2');
    } else {
      mc.textContent = (S.set.cycle > 1)
        ? ('第 ' + S.set.cycle + ' 周目 · 异变 +' + (S.set.cycle-1) + ' 条')
        : ('第 1 周目 · 还差 ' + left + ' 波进第 2 周目');
    }
    mc.style.cursor = 'help';
  }
  var dd = DIFF[S.diff] || DIFF.normal;
  var rsv = document.getElementById('btnContinueRun');
  if (rsv){
    if (S.checkpoint && S.checkpoint.wave > 1){
      rsv.style.display = '';
      rsv.textContent = (EN_LANG ? 'Continue · W' : '继续 · 第 ') + S.checkpoint.wave + (EN_LANG ? '' : ' 波');
    } else rsv.style.display = 'none';
  }
  var qb = document.getElementById('questBox');
  if (qb) qb.innerHTML = questBar();
  var tag = document.getElementById('menTodayTag');
  if (tag){
    var dn = (window._questDone || 0);
    var ddone = (S.daily && S.daily.date === todayKey() && S.daily.best > 0);
    tag.textContent = (EN_LANG ? '' : '') + dn + '/' + QUESTS.length
      + (ddone ? ((EN_LANG ? ' · best ' : ' · 最佳 ') + S.daily.best + (EN_LANG ? '' : ' 波')) : '');
  }
  var ds = document.getElementById('btnDailyStart');
  if (ds) ds.onclick = function(){ sfx('ui'); startDaily(); };
  var el = document.getElementById('diffDesc');
  if (el){
    var line = EN_LANG
      ? ('Enemy HP ×' + dd.hpMul.toFixed(2) + ' · Spawn ×' + dd.rateMul.toFixed(2) + ' · Cores ×' + dd.reward.toFixed(1))
      : ('敌人血量 ×' + dd.hpMul.toFixed(2) + '　刷怪密度 ×' + dd.rateMul.toFixed(2) + '　星核收益 ×' + dd.reward.toFixed(1));
    var tip = diffSuggest();
    if (tip) line += '<br><span style="color:#c8a24e">' + tip + '</span>';
    el.innerHTML = line;
  }
}

function diffSuggest(){
  if (!S.runs || S.runs.length < 3) return '';
  var recent = S.runs.slice(0, 5), sum = 0;
  for (var i=0;i<recent.length;i++) sum += recent[i].w;
  var avg = sum / recent.length;
  var base = {easy:10, normal:18, inferno:48}[S.diff] || 18;
  var keys = ['easy','normal','inferno'];
  var idx = keys.indexOf(S.diff);
  if (idx < 0) idx = 1;
  var LBL = {easy:'休闲',normal:'普通',inferno:'地狱'};
  if (avg < base*0.62 && idx > 0) return '最近 ' + recent.length + ' 局平均 ' + Math.round(avg) + ' 波，可以考虑降到「' + LBL[keys[idx-1]] + '」';
  if (avg > base*1.35 && idx < keys.length-1) return '最近 ' + recent.length + ' 局平均 ' + Math.round(avg) + ' 波，已经偏轻松，可以试试「' + LBL[keys[idx+1]] + '」';
  return '';
}

function renderMeta(){
  document.getElementById('metaCore').textContent = fmt(S.core);
  var GROUPS = {power:'基础', vigor:'基础', swift:'基础', magnet:'资源', focus:'资源', fortune:'资源'};
  var html = '', lastG = '';
  for (var i=0;i<META.length;i++){
    var m = META[i];
    var grp = GROUPS[m.id] || '其他';
    if (grp !== lastG){
      lastG = grp;
      html += '<div class="qrow" style="margin-top:6px;opacity:.6">' + grp + '</div>';
    }
    var lv = S.up[m.id] || 0;
    var cap = metaCap(m);
    var maxed = lv >= cap;
    html += '<div class="row">'
      + '<div class="info"><h4>' + m.name + '</h4><p>' + m.desc + '</p>'
      + '<div class="lv">等级 ' + lv + ' / ' + cap + '　第' + metaCycle() + '周目上限</div></div>'
      + (maxed ? '<button class="buy" disabled>已满级</button>'
               : '<button class="buy" data-buy="' + m.id + '">' + fmt(metaCost(m, lv)) + '</button>')
      + '</div>';
  }
  document.getElementById('metaList').innerHTML = html;
}

function renderChars(){
  document.getElementById('charCore').textContent = fmt(S.core);
  var html = '';
  var keys = Object.keys(CHARS);
  for (var i=0;i<keys.length;i++){
    var c = CHARS[keys[i]];
    var owned = !!S.chars[c.key];
    var sel = S.char === c.key;
    html += '<div class="charrow' + (sel ? ' on' : '') + '">'
      + '<span class="chart" style="color:' + c.color + '"></span>'
      + '<div class="info"><h4>' + c.name + (sel ? ' <span style="font-size:10px;color:#7fb3a0">出战中</span>' : '') + '</h4>'
      + '<p>' + c.desc + '</p>'
      + '<details class="numfold"><summary>数值</summary><p>生命 ' + c.hp + ' · 伤害 ' + c.dmg
      + ' · 射速 ' + c.rate.toFixed(2) + '/s · 移速 ' + c.spd + ' · 拾取 ' + c.collect
      + '</p></details></div>';
    if (!owned) html += '<button class="buy" data-unlock="' + c.key + '">' + fmt(c.cost) + '</button>';
    else if (!sel) html += '<button class="buy" data-char="' + c.key + '">选择</button>';
    html += '</div>';
  }
  document.getElementById('charList').innerHTML = html;
}

function renderBuild(){
  var el = document.getElementById('buildPanel');
  if (!el || !G || !G.player) return;
  var p = G.player;
  var ups = [], evos = [], schs = [];
  for (var id in G.stacks){ if (G.stacks[id] > 0){ for (var i=0;i<UPG.length;i++) if (UPG[i].id === id) ups.push(UPG[i].name + ' ×' + G.stacks[id]); } }
  for (var eid in G.evoDone){ if (G.evoDone[eid]){ for (var j=0;j<EVO.length;j++) if (EVO[j].id === eid) evos.push(EVO[j].name); } }
  for (var sk in G.schoolDone){ if (G.schoolDone[sk] && SCHOOLS[sk]) schs.push(SCHOOLS[sk].title); }
  var mods = [];
  for (var k=0;k<G.mods.length;k++) mods.push(G.mods[k].name);
  function row(title, arr, col){
    if (!arr.length) return '';
    return '<div class="row"><div class="info"><h4 style="color:' + col + '">' + title + '</h4><p>' + arr.join(' · ') + '</p></div></div>';
  }
  var goals = [];
  if (G.gate) goals.push('守关 · 剩余 ' + Math.max(0, Math.ceil(G.gate.t)) + 's');
  if (G.quest && !G.quest.done){
    goals.push(G.quest.type === 'nohit' ? '支线 · 不受伤'
      : ('支线 · ' + (G.kills - G.quest.kills0) + '/' + G.quest.need));
  }
  if (!goals.length) goals.push('暂无目标，安心刷怪');
  if ((G.cycle || 1) > 1) goals.push('第' + G.cycle + '周目');
  /* 下一波构成预览：Boss 波提前知道，好决定要不要先买装备 */
  var nw = G.wave + 1;
  if (!G.practice && !G.training){
    goals.push(nw % 5 === 0
      ? ('下一波 · 第 ' + nw + ' 波 Boss 战')
      : ('下一波 · 第 ' + nw + ' 波小怪'));
  }
  el.innerHTML =
      '<div class="meta-line"><span class="lbl">生命</span><b>' + Math.ceil(p.hp) + ' / ' + Math.round(p.hpMax) + '</b>'
    + '<span class="best">伤害 ' + Math.round(p.dmg) + ' · 射速 ' + p.rate.toFixed(2) + '/s · 移速 ' + Math.round(p.spd) + '</span></div>'
    + '<div class="list" style="margin-top:10px">'
    + row('本局目标', goals, '#c8a24e')
    + row('强化', ups, P.am)
    + row('进化', evos, P.amSoft)
    + row('质变', schs, '#b5563a')
    + row('异变', mods, '#a83b52')
    + ((G.swords || G.swordDmg) ? row('飞剑', [(G.swords || 0) + ' / 3' + (G.swordDmg ? ' · 已淬锋' : ' · 未淬锋') + (G.swordBlock ? ' · 已挡下 ' + G.swordBlock + ' 次' : '')], P.cy) : '')
    + '</div>';
}

function renderStats(){
  var gd = document.getElementById('statsGrid');
  if (gd){
    var bestW = 0, bestCy = 1, kills = 0;
    for (var b0=0;b0<S.runs.length;b0++){
      var r0 = S.runs[b0];
      if ((r0.w||0) > bestW){ bestW = r0.w; }
      if ((r0.cy||1) > bestCy) bestCy = r0.cy;
      kills += (r0.k || 0);
    }
    if (S.best && S.best.wave > bestW) bestW = S.best.wave;
    gd.innerHTML =
        '<div class="stat"><div class="k">' + (EN_LANG?'Best Wave':'最佳波次') + '</div><div class="v">' + bestW + '<span class="u">' + (EN_LANG?'w':'波') + '</span></div></div>'
      + '<div class="stat"><div class="k">' + (EN_LANG?'Total Kills':'总击杀') + '</div><div class="v">' + fmt(S.stats && S.stats.kills || kills) + '<span class="u">' + (EN_LANG?'':'只') + '</span></div></div>'
      + '<div class="stat"><div class="k">' + (EN_LANG?'Runs':'出战局数') + '</div><div class="v">' + S.runs.length + '<span class="u">' + (EN_LANG?'':'局') + '</span></div></div>'
      + '<div class="stat"><div class="k">' + (EN_LANG?'Best Cycle':'最高周目') + '</div><div class="v">' + bestCy + '<span class="u">' + (EN_LANG?'':'周目') + '</span></div></div>';
  }
  var total = document.getElementById('statsTotal');
  if (total){
    var avg = 0;
    for (var a=0;a<S.runs.length;a++) avg += S.runs[a].w;
    avg = S.runs.length ? Math.round(avg/S.runs.length) : 0;
    total.textContent = '共 ' + S.runs.length + ' 局 · 平均 ' + avg + ' 波';
  }
  var html = '';
  if (!S.runs.length){
    html = '<div class="row"><div class="info"><h4>还没有记录</h4><p>打一局，这里就会出现你的波次、等级和死因。</p></div></div>';
  } else {
    for (var i=0;i<S.runs.length;i++){
      var r = S.runs[i];
      var t = new Date(r.ts || 0);
      var mm = ('0'+(t.getMonth()+1)).slice(-2), dd = ('0'+t.getDate()).slice(-2);
      var hh = ('0'+t.getHours()).slice(-2), mi = ('0'+t.getMinutes()).slice(-2);
      html += '<div class="row"><div class="info"><h4>第 ' + r.w + ' 波 · Lv ' + r.lv + '</h4>'
        + '<p>' + r.d + (r.cy > 1 ? ' · ' + r.cy + ' 周目' : '') + ' · 击杀 ' + r.k
        + (r.mu ? ' · 异变 ' + r.mu : '') + ' · ' + (r.c || '—')
        + '　' + (mm+'/'+dd+' '+hh+':'+mi) + '</p></div>'
        + '<div class="price">+' + r.core + '</div></div>';
    }
  }
  document.getElementById('statsList').innerHTML = html;
}

function renderCodex(){
  var achN = 0;
  for (var ai=0; ai<ACH.length; ai++){ if (S.ach && S.ach[ACH[ai].id]) achN++; }
  document.getElementById('codexTotal').textContent = '局数 ' + S.stats.runs + ' / 累计击杀 ' + fmt(S.stats.kills)
    + ' / 成就 ' + achN + '/' + ACH.length;
  var html = '<div class="codexGrid">';
  var ekeys = Object.keys(EDEF);
  for (var i=0;i<ekeys.length;i++){
    var d = EDEF[ekeys[i]];
    var nm = {grunt:'爬行者', runner:'疾行虫', tank:'重甲兽', shooter:'吐酸者', swarm:'虫群', elite:'精英重甲'}[ekeys[i]] || ekeys[i];
    var mkv = (S.monKills || {})[ekeys[i]] || 0;
    html += '<div class="codexCard" data-mon="' + ekeys[i] + '" style="cursor:pointer"><h4 style="color:' + d.col + '">' + nm + '</h4>'
      + '<p>生命 ' + d.hp + ' · 伤害 ' + d.dmg + ' · 移速 ' + d.spd + (d.shoot ? ' · 远程' : '')
      + '<br>已击杀 ' + (mkv ? fmt(mkv) : '0') + ' 只</p></div>';
  }
  for (var k=0;k<BDEF.length;k++){
    var b = BDEF[k];
    html += '<div class="codexCard"><h4 style="color:' + b.col + '">首领·' + b.name + '</h4>'
      + '<p>' + b.desc + '</p></div>';
  }
  html += '</div>';
  document.getElementById('codexList').innerHTML = html;
  var cx = document.getElementById('codexList');
  if (cx && !cx._bound){
    cx._bound = true;
    cx.addEventListener('click', function(ev){
      var t = ev.target.closest ? ev.target.closest('[data-mon],[data-boss]') : null;
      if (!t) return;
      var key = t.getAttribute('data-mon');
      if (key){
        var d = EDEF[key], at = {grunt:1, runner:3, tank:6, shooter:8, swarm:10, elite:4}[key] || 1;
        toast('第 ' + at + ' 波起出现 · 生命 ' + d.hp + ' · 伤害 ' + d.dmg + ' · 移速 ' + d.spd);
      }
    });
  }

  var mh = '';
  var modA = [], modB = [];
  for (var mi=0; mi<MODS.length; mi++){
    var md = MODS[mi], seen = S.modSeen[md.id] || 0;
    var card = '<div class="codexCard"><h4 style="color:' + (seen ? P.ink : 'rgba(234,255,248,.5)') + '">' + md.name + '</h4>'
      + '<p>' + md.tip + (seen ? ('　遭遇 ' + seen + ' 次 · 最高第 ' + (S.modBest[md.id] || 0) + ' 波') : '') + '</p></div>';
    if (seen) modA.push(card); else modB.push(card);
  }
  mh += '<p class="sub" style="font-size:11px;margin:8px 0 0">已遭遇 ' + modA.length + ' / ' + MODS.length + '　·　第 6 波起出现</p>';
  if (modA.length) mh += '<div class="codexGrid">' + modA.join('') + '</div>';
  if (modB.length){
    mh += '<p class="sub" style="font-size:11px;margin:10px 0 0;opacity:.6">未遭遇 ' + modB.length + ' 种</p>'
      + '<div class="codexGrid">' + modB.join('') + '</div>';
  }
  var mbox = document.getElementById('modList');
  if (mbox) mbox.innerHTML = mh;

  var bh = '<div class="row"><div class="info"><h4 style="color:#e8c87c">首领图鉴</h4><p>击杀次数与最快击杀时间</p></div></div>';
  for (var bi=0; bi<BDEF.length; bi++){
    var bd = BDEF[bi], rec = S.bossBook[bd.key];
    bh += '<div class="row"><div class="info"><h4 style="color:' + (rec ? P.ink : 'rgba(234,255,248,.5)') + '">' + bd.name + '</h4>'
      + '<p>' + (rec ? ('击杀 ' + rec.kills + ' 次 · 最快 ' + rec.best + ' 秒') : '尚未击杀') + '</p></div></div>';
  }
  var bbox = document.getElementById('bossList');
  if (bbox) bbox.innerHTML = bh;

  var ps = S.pickStats || {};
  var locks = S.set.lockUpg || {};
  var ph = '<p class="sub" style="font-size:11px;margin:8px 0 0">点卡片可锁定：锁定的卡不再出现在升级选项里</p><div class="codexGrid">';
  for (var ui=0; ui<UPG.length; ui++){
    var u = UPG[ui], un = ps[u.id] || 0, lk = !!locks[u.id];
    ph += '<div class="codexCard" data-lockupg="' + u.id + '" style="cursor:pointer' + (lk ? ';opacity:.55' : '') + '">'
      + '<h4>' + u.name + (lk ? ' <span style="color:#c8a24e;font-size:10.5px;font-weight:400">已锁</span>' : '') + '</h4>'
      + '<p>' + (un ? ('选取 ' + un + ' 次') : '未选过') + (u.max ? (' · 上限 ' + u.max) : '') + '</p></div>';
  }
  for (var ej=0; ej<EVO.length; ej++){
    var ev2 = EVO[ej], done2 = (G && G.evoDone) ? !!G.evoDone[ev2.id] : false;
    var needTxt = [];
    for (var ni2=0; ni2<ev2.need.length; ni2++){
      var nmn = ev2.need[ni2];
      for (var un2=0; un2<UPG.length; un2++) if (UPG[un2].id === nmn) nmn = UPG[un2].name;
      needTxt.push(nmn + '×' + ev2.req);
    }
    ph += '<div class="codexCard"' + (done2 ? '' : ' style="opacity:.55"') + '><h4 style="color:#e8c87c">进化 · ' + ev2.name + '</h4>'
      + '<p>' + needTxt.join(' + ') + '</p></div>';
  }
  ph += '</div>';
  var pbox = document.getElementById('pickList');
  if (pbox) pbox.innerHTML = ph;

  var ah = '';
  for (var j=0;j<ACH.length;j++){
    var a = ACH[j], done = !!S.ach[a.id];
    ah += '<div class="ach' + (done ? ' done' : '') + '"><span class="dot"></span>'
      + '<div><h4>' + a.name + '</h4><p>' + a.desc + (done ? '　已达成' : '') + '</p></div></div>';
  }
  document.getElementById('achList').innerHTML = ah;
}

function setVolume(v){
  S.set.vol = Math.max(0, Math.min(1, parseInt(v,10)/100));
  saveNow();
}

function setVolumeBgm(v){
  S.set.volBgm = Math.max(0, Math.min(1, parseInt(v,10)/100));
  saveNow();
}

function setPadSens(v){
  S.set.padSens = Math.max(0.6, Math.min(2, parseInt(v,10)/100));
  saveNow();
}

function renderSettings(){
  var EN = EN_LANG;
  function rowSwitch(id, name, desc, on){
    return '<div class="toggle-row"><div class="info"><h4>' + name + '</h4><p>' + desc + '</p></div>'
      + '<button class="switch' + (on ? ' on' : '') + '" data-set="' + id + '"><i></i></button></div>';
  }
  function rowRange(attr, name, desc, val){
    return '<div class="toggle-row"><div class="info"><h4>' + name + '</h4><p>' + desc + '</p></div>'
      + '<input type="range" min="0" max="100" value="' + val + '" style="width:110px" ' + attr + '></div>';
  }
  var langRow = '<div class="toggle-row"><div class="info"><h4>' + (EN?'Language / 语言':'语言 / Language') + '</h4><p>'
    + (EN ? 'Interface language; reloads after switching' : '界面语言，切换后自动刷新') + '</p></div>'
    + '<div style="display:flex;gap:6px">'
    + '<button class="btn ghost" style="padding:6px 10px;font-size:12px;' + (!EN ? 'border-color:#c8a24e;color:#c8a24e' : 'opacity:.6') + '" data-lang="zh">中文</button>'
    + '<button class="btn ghost" style="padding:6px 10px;font-size:12px;' + (EN ? 'border-color:#c8a24e;color:#c8a24e' : 'opacity:.6') + '" data-lang="en">English</button>'
    + '</div></div>';
  var skinRow = '<div class="toggle-row"><div class="info"><h4>' + (EN?'Skin':'皮肤') + '</h4><p>'
    + (EN?'Switch the whole art style; applies instantly':'华夏 / 青瓷两套画风，切换即刻生效并记住') + '</p></div>'
    + '<div style="display:flex;gap:6px">'
    + '<button class="btn ghost" style="padding:6px 10px;font-size:12px;' + (SKIN!=='huaxia' ? 'border-color:var(--am);color:var(--am)' : 'opacity:.6') + '" data-skin-choice="classic">' + (EN?'Classic':'青瓷') + '</button>'
    + '<button class="btn ghost" style="padding:6px 10px;font-size:12px;' + (SKIN==='huaxia' ? 'border-color:var(--am);color:var(--am)' : 'opacity:.6') + '" data-skin-choice="huaxia">' + (EN?'Huaxia':'华夏') + '</button>'
    + '</div></div>';
  var km = S.set.keys || 'both';
  var kmName = {both:'WASD + 方向键', wasd:'仅 WASD', arrow:'仅方向键', numpad:'仅小键盘 8/2/4/6'}[km] || km;
  if (EN) kmName = {both:'WASD + Arrows', wasd:'WASD only', arrow:'Arrows only', numpad:'Numpad 8/2/4/6'}[km] || kmName;
  var volB = Math.round((S.set.volBgm === undefined ? 0.8 : S.set.volBgm)*100);
  var volS = Math.round((S.set.vol === undefined ? 0.8 : S.set.vol)*100);
  var volH = Math.round((S.set.volHit === undefined ? 0.8 : S.set.volHit)*100);

  var gView = '<details class="setgrp" open><summary>画面</summary>'
    + skinRow
    + '<div class="toggle-row"><div class="info"><h4>' + (EN?'Particles':'粒子质量') + '</h4><p>'
      + (EN?'Low quality reduces explosions':'低画质会减少爆炸粒子，提升低端机流畅度') + '</p></div>'
      + '<button class="switch' + (S.set.quality === 'high' ? ' on' : '') + '" data-quality="1"><i></i></button></div>'
    + rowSwitch('shakeOff', EN?'No Screen Shake':'关闭屏幕震动', '镜头不再抖动（晕动症更友好）', !!S.set.shakeOff)
    + rowSwitch('eco', EN?'Power Saver':'省电模式', '限 30fps、减少粒子', !!S.set.eco)
    + rowSwitch('hudInfo', EN?'Build HUD':'实时构筑面板', '显示 DPS、护甲与暴击', !!S.set.hudInfo)
    + rowSwitch('perf', EN?'Perf Panel':'性能面板', '设置页底部显示帧数与敌人量', !!S.set.perf)
    + '</details>';

  var gAudio = '<details class="setgrp" open><summary>音频</summary>'
    + '<div class="toggle-row"><div class="info"><h4>音效</h4><p>射击、受击、升级提示音</p></div>'
      + '<div style="display:flex;align-items:center;gap:8px">'
      + '<input type="range" min="0" max="100" value="' + volS + '" style="width:90px" data-vol="1">'
      + '<button class="switch' + (S.set.sfx ? ' on' : '') + '" data-set="sfx"><i></i></button></div></div>'
    + '<div class="toggle-row"><div class="info"><h4>背景音乐</h4><p>低频环境音</p></div>'
      + '<div style="display:flex;align-items:center;gap:8px">'
      + '<input type="range" min="0" max="100" value="' + volB + '" style="width:90px" data-volbgm="1">'
      + '<button class="switch' + (S.set.bgm ? ' on' : '') + '" data-set="bgm"><i></i></button></div></div>'
    + rowRange('data-volhit="1"', '打击音', '击杀与暴击提示音', volH)
    + '</details>';

  var gOp = '<details class="setgrp"><summary>' + (EN?'Controls':'操作') + '</summary>'
    + '<div class="toggle-row"><div class="info"><h4>摇杆模式</h4><p>' + (S.set.stick === 'fixed' ? '固定：以触点为中心' : '浮动：任意处落点') + '</p></div>'
      + '<button class="switch' + (S.set.stick === 'fixed' ? ' on' : '') + '" data-stick="1"><i></i></button></div>'
    + rowRange('data-pad="1"', '手柄灵敏度', '左摇杆死区与响应幅度', Math.round((S.set.padSens||1)*100).toString())
    + rowSwitch('vib', '震动反馈', '受伤时震动（仅部分设备支持）', !!S.set.vib)
    + '<div class="toggle-row"><div class="info"><h4>' + (EN?'Movement Keys':'移动键') + '</h4><p>'
      + (EN ? ('Current: ' + kmName) : ('当前：' + kmName + '（按键冲突时换一套）')) + '</p></div>'
      + '<button class="btn ghost" style="padding:6px 10px;font-size:12px" data-keys="1">' + (EN?'Switch':'切换') + '</button></div>'
    + '</details>';

  var gOther = '<details class="setgrp" open><summary>' + (EN?'其他':'其他') + '</summary>'
    + rowSwitch('autoPause', EN?'Auto Pause':'自动暂停',
        EN ? 'Pause when the window loses focus or goes background' : '切到别的窗口或切后台时自动暂停',
        S.set.autoPause !== false)
    + '<div class="toggle-row"><div class="info"><h4>' + (EN?'Save Data':'存档转移') + '</h4><p>'
      + (EN ? 'Copy the code to another device to keep progress' : '导出成一段文本，换设备或清缓存后可原地恢复') + '</p></div>'
      + '<div style="display:flex;gap:6px">'
      + '<button class="btn ghost" style="padding:6px 10px;font-size:12px" data-save-exp="1">' + (EN?'Export':'导出') + '</button>'
      + '<button class="btn ghost" style="padding:6px 10px;font-size:12px" data-save-imp="1">' + (EN?'Import':'导入') + '</button>'
      + '<button class="btn ghost" style="padding:6px 10px;font-size:12px;opacity:.75" data-save-wipe="1">' + (EN?'Clear':'清除') + '</button>'
      + '</div></div>'
    + langRow + '</details>';

  document.getElementById('setList').innerHTML = gView + gAudio + gOp + gOther;
}
var fpsTick = setInterval(function(){
  var el = document.getElementById('setFpsLine');
  if (!el || !el.parentNode || el.parentNode.parentNode.parentNode.style.display === 'none') return;
  var q = AUTOQ && AUTOQ.lv > 0 ? ('自动降档 L' + AUTOQ.lv) : '满档';
  if (S.set.perf){
    el.textContent = 'FPS ' + Math.round(G && G.fps ? G.fps : 0)
      + ' · 粒子 ' + (G && G.parts ? G.parts.length : 0)
      + ' · 敌人 ' + (G && G.enemies ? G.enemies.length : 0)
      + ' · 弹幕 ' + (G && G.ebullets ? G.ebullets.length : 0)
      + ' · ' + q + (G && G.slowNote ? (' · ' + G.slowNote) : '');
  } else {
    el.textContent = 'FPS ' + Math.round(G && G.fps ? G.fps : 0) + ' · 画质 ' + q;
  }
}, 700);

/* --- 升级卡 --- */
var pendingPicks = [];

function evoReady(ev){
  if (G.evoDone[ev.id]) return false;
  for (var i=0;i<ev.need.length;i++){
    if ((G.stacks[ev.need[i]] || 0) < ev.req) return false;
  }
  return true;
}

function resoSchools(){
  var out = [];
  for (var i=0;i<G.mods.length;i++) if (G.mods[i].id === 'reso') out.push(G.mods[i].st.school);
  return out;
}

function schoolNeed(key){
  var hit = 0, list = resoSchools();
  for (var i=0;i<list.length;i++) if (list[i] === key) hit++;
  if (!hit) return SCHOOLS[key].need;
  return Math.max(1, SCHOOLS[key].need - hit);
}

function readyEvos(){
  var out = [];
  for (var k=0;k<EVO.length;k++) if (evoReady(EVO[k])) out.push({kind:'evo', def:EVO[k]});
  return out;
}

function upgPool(){
  var p = G.player, pool = [];
  for (var i=0;i<UPG.length;i++){
    var u = UPG[i], lv = G.stacks[u.id] || 0;
    if (u.max > 0 && lv >= u.max) continue;
    if (S.set.lockUpg && S.set.lockUpg[u.id]) continue;
    if (u.id === 'heal' && p.hp >= p.hpMax*0.98) continue;
    /* 稀有卡不早期出现：池子脏会挤掉基础强化，前 8 波也很难吃下代价 */
    if (u.rare && (G.wave < 8 || p.level < 12)) continue;
    pool.push({kind:'upg', def:u});
  }
  return pool;
}

function showUpgrade(){
  var p = G.player;
  var pool = upgPool();
  var evos = readyEvos();

  var picks = [];
  if (evos.length) picks.push(evos[Math.floor(Math.random()*evos.length)]);

  var copy = pool.slice();
  while (picks.length < 3 && copy.length){
    var idx = Math.floor(Math.random()*copy.length);
    picks.push(copy.splice(idx,1)[0]);
  }
  if (!picks.length){
    /* 返回 false：调用方（addExp）要据此跳出升级循环，
       否则同一批经验会在 while 里连升数级、每次都回 35% 血 +20 金币 */
    p.hp = Math.min(p.hpMax, p.hp + p.hpMax*0.35);
    G.coins += 20;
    toast('强化已全满：回复 35% 生命，+20 金币');
    return false;
  }

  /* 每级固定 2 次，加上商店「战术重抽」买到的累计次数——
     原来直接写 2，等于把花钱买的次数在下一级悄悄没收 */
  G.rerolls = 2 + (G.rerollExtra || 0);
  G.state = 'levelup';
  JOY.active = false; JOY.dx = 0; JOY.dy = 0;
  sfx('level');
  renderPicks(picks);
  showScreen('scrLevel');
  return true;
}

/* 生成一批强化卡（重抽复用） */
function buildPicks(avoidNames){
  var pool = upgPool();
  var rl = resoSchools();
  /* 先把命中的卡收集到临时数组再追加：
     原来边遍历边 push，pool.length 会随着 push 一起变长，条件永远成立 → 重抽时死循环卡死 */
  for (var ri=0; ri<rl.length; ri++){
    var sz = [];
    for (var rp=0; rp<pool.length; rp++) if (pool[rp].def.school === rl[ri]) sz.push(pool[rp]);
    for (var rz=0; rz<sz.length; rz++) pool.push(sz[rz]);
  }
  var evos = readyEvos();
  var picks = [];
  if (evos.length) picks.push(evos[Math.floor(Math.random()*evos.length)]);
  if (rl.length && picks.length){
    var hasSchool = false;
    for (var hs=0; hs<picks.length; hs++) if (rl.indexOf(picks[hs].def.school) >= 0) hasSchool = true;
    if (!hasSchool){
      for (var rs=0; rs<pool.length; rs++){
        if (rl.indexOf(pool[rs].def.school) >= 0){
          picks[picks.length-1] = pool[rs];
          break;
        }
      }
    }
  }
  var copy = pool.slice(), guard = 0;
  while (picks.length < 3 && copy.length && guard++ < 200){
    var idx = Math.floor(Math.random()*copy.length);
    var item = copy[idx];
    if (avoidNames && avoidNames.indexOf(item.def.name) >= 0 && copy.length > 3) continue;
    copy.splice(idx,1);
    picks.push(item);
  }
  return picks;
}

function pickScore(pk){
  var sc = 0;
  if (pk.kind === 'evo') return 999;
  var need = null;
  for (var e2=0; e2<EVO.length; e2++){
    if (EVO[e2].need.indexOf(pk.def.id) >= 0 && !G.evoDone[EVO[e2].id]){
      var mxgap = 0;
      for (var n2=0; n2<EVO[e2].need.length; n2++) mxgap = Math.max(mxgap, EVO[e2].req - (G.stacks[EVO[e2].need[n2]] || 0));
      sc = Math.max(sc, 80 - mxgap*15);
    }
  }
  if (pk.def.school){
    var need2 = schoolNeed(pk.def.school);
    sc = Math.max(sc, 50 + (G.school[pk.def.school] || 0) / need2 * 30);
  }
  sc += (G.stacks[pk.def.id] || 0) * 2;
  return sc;
}

/* 推荐标签的一句话说清理由 */
function pickReason(pk){
  if (!pk || pk.kind === 'evo') return '直接进化';
  var bestGap = 99, bestName = '';
  for (var e3=0; e3<EVO.length; e3++){
    var evd3 = EVO[e3];
    if (evd3.need.indexOf(pk.def.id) < 0 || G.evoDone[evd3.id]) continue;
    var mx = 0;
    for (var n3=0; n3<evd3.need.length; n3++){
      mx = Math.max(mx, evd3.req - (G.stacks[evd3.need[n3]] || 0));
    }
    if (mx < bestGap){ bestGap = mx; bestName = evd3.name; }
  }
  if (bestGap <= 1) return '进化差1级';
  if (bestGap <= 2) return '进化差' + bestGap + '级';
  if (pk.def.school) return '同系质变';
  return '补短板';
}

function renderPicks(picks){
  pendingPicks = picks;
  var bestIdx = 0, bestSc = -1;
  for (var bj=0; bj<picks.length; bj++){ var scj = pickScore(picks[bj]); if (scj > bestSc){ bestSc = scj; bestIdx = bj; } }
  var recTxt = pickReason(picks[bestIdx]);
  var html = '';
  for (var c=0;c<picks.length;c++){
    var pk = picks[c], def = pk.def;
    var isEvo = pk.kind === 'evo';
    var stackTxt;
    if (isEvo){
      var pair = [];
      for (var q=0;q<def.need.length;q++){
        for (var qq=0;qq<UPG.length;qq++) if (UPG[qq].id === def.need[q]) pair.push(UPG[qq].name);
      }
      stackTxt = '进化 · 合成';
    } else {
      var sch = def.school && SCHOOLS[def.school];
      stackTxt = (sch ? '质变 ' : '强化 ') + ((G.stacks[def.id]||0)+1) + (def.max ? ('/' + def.max) : '')
        + (sch ? ('<br>' + sch.name + '系 ' + Math.min(schoolNeed(def.school), (G.school[def.school]||0)+1) + '/' + schoolNeed(def.school)) : '');
      for (var ev=0; ev<EVO.length; ev++){
        var evd = EVO[ev];
        if (evd.need.indexOf(def.id) < 0 || G.evoDone[evd.id]) continue;
        var gaps = [];
        for (var ni=0; ni<evd.need.length; ni++){
          var need = evd.need[ni];
          var gn = evd.req - (G.stacks[need] || 0);
          if (gn > 0){
            var nm = need;
            for (var nu=0; nu<UPG.length; nu++) if (UPG[nu].id === need) nm = UPG[nu].name;
            gaps.push({ nm: nm, g: gn });
          }
        }
        if (gaps.length){
          stackTxt += '<span class="evoHint"><b>进化「' + evd.name + '」</b>';
          for (var gi=0; gi<gaps.length; gi++){
            stackTxt += '<span class="evoLine"><em>' + gaps[gi].nm + '</em><s>差' + gaps[gi].g + '级</s></span>';
          }
          stackTxt += '</span>';
        }
      }
    }
    html += '<button class="card' + (isEvo ? ' evo' : '') + (def.rare ? ' rare' : '') + '" data-i="' + c + '">'
      + '<span class="idx">' + (c+1) + '</span>'
      + (c === bestIdx ? '<span class="rec">推荐</span>' : '')
      + '<div class="stack">' + stackTxt + '</div>'
      + '<h3>' + (def.rare ? '<span class="rTag">稀有</span>' : '') + def.name + (c === bestIdx ? ' <span class="recTag">' + recTxt + '</span>' : '') + '</h3>'
      + '<p>' + def.desc + '</p>'
      + '</button>';
  }
  document.getElementById('cards').innerHTML = html;
  var chip = document.getElementById('lockChip');
  if (chip){
    var lkNames = [], lkMap = S.set.lockUpg || {};
    for (var li=0; li<UPG.length; li++) if (lkMap[UPG[li].id]) lkNames.push(UPG[li].name);
    chip.textContent = lkNames.length
      ? ('已锁 ' + lkNames.length + ' 张 · ' + lkNames.slice(0,2).join(' / ') + (lkNames.length > 2 ? ' …' : '') + '（点此调整）')
      : '未锁定技能 · 点此挑几张不再出现';
  }
  var rbtn = document.getElementById('btnReroll');
  /* 390 宽就换行了：原来"重抽强化 · 快捷键 4（剩 2 次）"太长，压成"重抽(键4) · 剩2" */
  rbtn.textContent = '重抽(键4) · 剩 ' + G.rerolls;
  rbtn.disabled = G.rerolls <= 0;
  var sbtn = document.getElementById('btnSkipPick');
  if (sbtn) sbtn.textContent = '跳过 · +' + skipCoins() + ' 金币';
}

/* 跳过补偿随波次涨：早期少跳，后期卡池脏了跳一次不亏 */
function skipCoins(){
  return 6 + Math.min(14, Math.floor(((G && G.wave) || 1) / 3) * 2);
}

/* 跳过本次三选一，换金币 */
function skipPicks(){
  if (G.state !== 'levelup') return;
  var c = skipCoins();
  G.coins += c;
  pendingPicks = [];
  G.state = 'playing';
  showScreen(null);
  toast('跳过强化 · +' + c + ' 金币');
  sfx('coin');
}

function rerollPicks(){  if (G.state !== 'levelup' || G.rerolls <= 0) return;
  var names = [];
  for (var i=0;i<pendingPicks.length;i++) names.push(pendingPicks[i].def.name);
  var picks = buildPicks(names);
  if (!picks.length) return;
  G.rerolls--;
  sfx('coin');
  renderPicks(picks);
}

function chooseUpgrade(i){
  if (G.state !== 'levelup') return;
  var pk = pendingPicks[i];
  if (!pk) return;
  if (!S.pickStats) S.pickStats = {};
  var pkId = pk.kind === 'evo' ? ('evo:' + pk.def.id) : pk.def.id;
  S.pickStats[pkId] = (S.pickStats[pkId] || 0) + 1;
  if (pk.kind === 'evo'){
    G.evoDone[pk.def.id] = true;
    pk.def.apply(G.player);
    toast('进化：' + pk.def.name);
  } else {
    G.stacks[pk.def.id] = (G.stacks[pk.def.id] || 0) + 1;
    pk.def.apply(G.player);
    var schKey = pk.def.school;
    if (schKey){
      G.school[schKey] = (G.school[schKey] || 0) + 1;
      var sd = SCHOOLS[schKey];
      if (G.school[schKey] >= schoolNeed(schKey) && !G.schoolDone[schKey]){
        G.schoolDone[schKey] = true;
        sd.apply(G.player);
        toast('质变 · ' + sd.title + '：' + sd.desc);
        G.shake = Math.max(G.shake, 10);
        sfx('coin');
      }
    }
  }
  sfx('ui');
  pendingPicks = [];
  G.state = 'playing';
  showScreen(null);
}

/* --- 结算 --- */
function checkAch(){
  var got = [];
  for (var i=0;i<ACH.length;i++){
    var a = ACH[i];
    if (!S.ach[a.id] && a.check(S)){ S.ach[a.id] = true; got.push(a.name); }
  }
  if (!got.length) return;
  /* 一次解锁好几个不刷屏，合并成一条 */
  toast('成就达成 · ' + (got.length > 2 ? (got.slice(0,2).join(' / ') + ' 等 ' + got.length + ' 项') : got.join(' / ')));
  try { sfx('level'); } catch(e){}
}

function settleRun(){
  if (G.practice){ G.settled = true; return 0; }
  if (G.settled) return G.lastCore || 0;
  G.settled = true;
  var p = G.player;
  var core = Math.floor((G.kills*1.2 + G.wave*40 + G.time*1.0) * G.diff.reward * p.coreGain) + (G.coresBonus || 0) + (G.comboCores || 0);
  /* 地狱档本周目首通奖励 */
  var cyc0 = S.set.cycle || 1;
  G.hellBonus = 0;
  if (G.diff && G.diff.key === 'inferno' && G.wave >= 10 && (S.set.hellClear || 0) < cyc0){
    S.set.hellClear = cyc0;
    G.hellBonus = 300 + 150 * (cyc0 - 1);
    core += G.hellBonus;
  }
  G.lastCore = core;
  S.core += core;
  if (!Array.isArray(S.runs)) S.runs = [];
  S.runs.unshift({w:G.wave, lv:p.level, k:G.kills, t:Math.floor(G.time), d:(G.diff && G.diff.name) || '普通',
                  cy:(G.cycle||1), mu:(G.mods? G.mods.length : 0),
                  c:(G.deathCause || '—'), core:core, ts:Date.now()});
  if (S.runs.length > 30) S.runs.length = 30;
  for (var mbi=0; mbi<G.mods.length; mbi++){
    var mid2 = G.mods[mbi].id;
    S.modBest[mid2] = Math.max(S.modBest[mid2] || 0, G.wave);
  }
  S.stats.runs++;
  S.checkpoint = null;
  try { sessionStorage.removeItem('gz_live'); } catch(e){}
  S.stats.kills += G.kills;
  if (G.wave >= 50){
    S.set.cycle = (S.set.cycle || 1) + 1;
    G.cycleUp = S.set.cycle;
  }
  if (G.daily){
    if (!S.daily || S.daily.date !== G.dailyKey) S.daily = {date:G.dailyKey, best:0};
    if (G.wave > S.daily.best) S.daily.best = G.wave;
  }
  var q = questToday();
  q.runs += 1;
  q.boss += (G.bossKills || 0);
  if (G.wave > q.best) q.best = G.wave;
  for (var qi=0; qi<QUESTS.length; qi++){
    var qd = QUESTS[qi];
    if (!q.paid[qd.id] && questVal(qd.id) >= qd.goal){
      q.paid[qd.id] = true;
      S.core += 30;
      core += 30;
    }
  }
  if (G.wave > S.best.wave) S.best.wave = G.wave;
  if (G.time > S.best.time) S.best.time = G.time;
  if (G.kills > S.best.kills) S.best.kills = G.kills;
  /* 分难度纪录：让每档都有自己的目标线 */
  var dk = (G.diff && G.diff.key) || 'normal';
  S.bestByDiff = S.bestByDiff || {};
  var bdd = S.bestByDiff[dk] || {wave:0, kills:0};
  if (G.wave > bdd.wave) bdd.wave = G.wave;
  if (G.kills > bdd.kills) bdd.kills = G.kills;
  S.bestByDiff[dk] = bdd;
  checkAch();
  saveNow(true);
  return core;
}

/* 结算四格趋势：与最近几局均值比，只给方向不啰嗦 */
function trendMark(id, cur, list, key){
  var el = document.getElementById(id);
  if (!el) return;
  var sum = 0, n = 0;
  for (var i=0;i<list.length;i++){
    var v = list[i][key];
    if (typeof v === 'number' && isFinite(v)){ sum += v; n++; }
  }
  if (n < 2){ el.textContent = ''; el.title = ''; return; }
  var avg = sum / n, d = cur - avg, pct = avg > 0 ? d / avg : 0;
  el.textContent = Math.abs(pct) < 0.06 ? '≈' : (d > 0 ? '▲' : '▼');
  el.style.color = Math.abs(pct) < 0.06 ? 'rgba(234,255,248,.42)' : (d > 0 ? '#7fb3a0' : '#e0796a');
  el.title = '近 ' + n + ' 局均值 ' + Math.round(avg) + '　本局 ' + (pct > 0 ? '+' : '') + Math.round(pct*100) + '%';
}

function gameOver(){
  G.state = 'over';
  releaseAwake();
  G.shake = 20;
  var p = G.player;

  var core = settleRun();
  restoreRnd();
  G.deathMods = G.mods ? G.mods.map(function(m){ return m.name; }) : [];

  document.getElementById('overKicker').textContent = (G.practice ? '练习局 · 不结算星核与战绩'
    : ('本局结算　+' + fmt(core) + ' 星核' + (G.hellBonus ? ('（含地狱首通 +' + fmt(G.hellBonus) + '）') : '')))
    + (G.bountyDone ? ('　· 悬赏清除 ' + G.bountyDone + ' 只') : '')
    + (G.swordBlock ? ('　· 飞剑挡伤 ' + G.swordBlock + ' 次') : '')
    + (G.deathMods && G.deathMods.length ? ('\n异变 · ' + G.deathMods.slice(0,5).join(' / ') + (G.deathMods.length > 5 ? ' 等' + G.deathMods.length + ' 条' : '')) : '');
  document.getElementById('overTitle').textContent = '你被怪潮淹没了';
  /* 死因与建议节点必须复用：原来每死一次都新建一个建议段落，
     连死几局后结算页会堆满重复文字；死因不更新时还会残留上一局的死因 */
  var dc = document.getElementById('overCause');
  var adv = document.getElementById('overAdv');
  if (G.deathCause){
    if (!dc){
      dc = document.createElement('p');
      dc.id = 'overCause';
      dc.className = 'sub';
      dc.style.margin = '4px 0 0';
      var dv = document.getElementById('overDetail');
      dv.insertBefore(dc, dv.firstChild);
    }
    dc.textContent = '死因 · ' + G.deathCause;
    if (!adv){
      adv = document.createElement('p');
      adv.id = 'overAdv';
      adv.className = 'sub';
      adv.style.margin = '2px 0 0';
      adv.style.fontSize = '12px';
    }
    adv.textContent = deathAdvice(G.deathCause || '');
    if (adv.previousSibling !== dc) dc.parentNode.insertBefore(adv, dc.nextSibling);
  } else {
    if (dc) dc.textContent = '';
    if (adv) adv.textContent = '';
  }
  if (G.cycleUp){
    document.getElementById('overTitle').textContent = '已解锁第 ' + G.cycleUp + ' 周目';
  }
  document.getElementById('stTime').textContent = Math.floor(G.time);
  document.getElementById('stWave').textContent = G.wave;
  document.getElementById('stKill').textContent = fmt(G.kills);
  document.getElementById('stLv').textContent = p.level;
  var histT = (S.runs || []).slice(G.practice ? 0 : 1, 6);
  trendMark('stTimeTr', Math.floor(G.time), histT, 't');
  trendMark('stWaveTr', G.wave, histT, 'w');
  trendMark('stKillTr', G.kills, histT, 'k');
  trendMark('stLvTr', p.level, histT, 'lv');

  var cmp = document.getElementById('overCompare');
  if (!cmp){
    cmp = document.createElement('p');
    cmp.id = 'overCompare'; cmp.className = 'sub';
    cmp.style.margin = '3px 0 0'; cmp.style.fontSize = '11px';
    var anchor = document.getElementById('overCause');
    (anchor ? anchor.parentNode : document.getElementById('overTitle').parentNode).insertBefore(cmp, (anchor || document.getElementById('overTitle')).nextSibling);
  }
  var curDiffName = (G.diff && G.diff.name) || '普通';
  var others = (S.runs || []).slice(1).filter(function(r){ return r.d === curDiffName; });
  if (others.length >= 3){
    var ws = others.map(function(r){ return r.w; }).sort(function(a,b){ return a-b; });
    var ks = others.map(function(r){ return r.k; }).sort(function(a,b){ return a-b; });
    var wMed = ws[Math.floor(ws.length/2)], kMed = ks[Math.floor(ks.length/2)];
    cmp.textContent = curDiffName + ' 同难度中位：第 ' + wMed + ' 波 · 击杀 ' + fmt(kMed) + '（' + others.length + ' 局）';
  } else cmp.textContent = '';

  /* 本局输出 / 承伤：单独一行小字。挂在 kicker 上会挤成三行，所以放这里 */
  var sumEl = document.getElementById('overSum');
  if (G.runDmg || G.runTaken){
    if (!sumEl){
      sumEl = document.createElement('p');
      sumEl.id = 'overSum'; sumEl.className = 'sub';
      sumEl.style.margin = '3px 0 0'; sumEl.style.fontSize = '11px';
      /* 死因存在时 cmp 会被挪进折叠详情里，所以固定挂在详情容器之前，四格正下方 */
      var _dv = document.getElementById('overDetail');
      (_dv ? _dv.parentNode : cmp.parentNode).insertBefore(sumEl, _dv || cmp.nextSibling);
    }
    var rRatio = (G.runDmg > 0) ? (G.runTaken / G.runDmg * 100) : 0;
    sumEl.textContent = '本局输出 ' + kfmt(G.runDmg) + ' · 承伤 ' + kfmt(G.runTaken)
      + (G.runTaken ? ('（占输出 ' + (rRatio >= 999 ? '999+' : Math.round(rRatio)) + '%）') : '（零承伤）');
  } else if (sumEl) sumEl.textContent = '';

  /* 结算页直接给今日任务进度：以前只有回菜单/暂停才看得到，打完一局不知道还差什么 */
  var qEl = document.getElementById('overQuest');
  if (!G.practice){
    var qn = questToday(), qDone = 0;
    for (var qi3=0; qi3<QUESTS.length; qi3++){ if (qn.paid[QUESTS[qi3].id]) qDone++; }
    if (!qEl){
      qEl = document.createElement('p');
      qEl.id = 'overQuest'; qEl.className = 'sub';
      qEl.style.margin = '3px 0 0'; qEl.style.fontSize = '11px';
      var _dv3 = document.getElementById('overDetail');
      (_dv3 ? _dv3.parentNode : cmp.parentNode).insertBefore(qEl, _dv3 || cmp.nextSibling);
    }
    qEl.textContent = qDone >= QUESTS.length
      ? '今日任务 ' + qDone + '/' + QUESTS.length + ' · 已全部完成'
      : '今日任务 ' + qDone + '/' + QUESTS.length + ' · 每项 +30 星核（次日刷新）';
  } else if (qEl) qEl.textContent = '';

  var chart = document.getElementById('overChart');
  if (chart){
    if (G.hist && G.hist.length > 1){
      var mx = 1;
      for (var hi=0; hi<G.hist.length; hi++) mx = Math.max(mx, G.hist[hi].dps);
      var bars = '';
      for (var hj=0; hj<G.hist.length; hj++){
        var hd2 = G.hist[hj];
        bars += '<i title="第 ' + hd2.w + ' 波 · DPS ' + fmt(hd2.dps) + (hd2.mods && hd2.mods.length ? ' · ' + hd2.mods.join('/') : '') + '"'
             + ' style="flex:1;min-width:0;height:' + Math.max(6, Math.round(hd2.dps/mx*40)) + 'px;background:rgba(200,162,78,.55);border-radius:2px"></i>';
      }
      chart.innerHTML = '<div style="font-size:11px;opacity:.6;margin-bottom:3px">每波 DPS</div>'
        + '<div style="display:flex;align-items:flex-end;gap:2px;height:40px">' + bars + '</div>';
    } else {
      chart.innerHTML = '';
    }
  }

  var tl = document.getElementById('overTimeline');
  if (tl){
    var hh = G.hist || [];
    if (hh.length > 2){
      var peak = 1, peakW = hh[0].w, crashW = 0;
      for (var ti=0; ti<hh.length; ti++){ if (hh[ti].dps > peak){ peak = hh[ti].dps; peakW = hh[ti].w; } }
      for (var tj=0; tj<hh.length; tj++){
        if (hh[tj].w > peakW && !crashW && hh[tj].dps < peak*0.5){ crashW = hh[tj].w; break; }
      }
      var segs2 = '', runMax = 1;
      for (var tk=0; tk<hh.length; tk++){
        runMax = Math.max(runMax, hh[tk].dps);
        var d3 = hh[tk].dps / runMax;
        var col2 = d3 >= 0.6 ? P.am : (d3 >= 0.4 ? P.am : P.red);
        segs2 += '<i style="flex:1;min-width:0;height:10px;background:' + col2 + ';opacity:.85"></i>';
      }
      var cap2 = '第 1 → ' + G.wave + ' 波';
      if (crashW){
        var cmn = '';
        for (var tc=0; tc<hh.length; tc++){
          if (hh[tc].w === crashW && hh[tc].mods && hh[tc].mods.length){ cmn = hh[tc].mods.slice(0,2).join('/'); break; }
        }
        cap2 += ' · 第 ' + crashW + ' 波开始崩盘' + (cmn ? '（异变 ' + cmn + '）' : '');
      }
      else cap2 += ' · 全程输出稳定';
      tl.innerHTML = '<div style="font-size:11px;opacity:.6;margin-bottom:3px">战况 · ' + cap2 + '</div>'
        + '<div style="display:flex;align-items:flex-end;gap:1px;height:10px">' + segs2 + '</div>';
    } else tl.innerHTML = '';
  }

  /* 本局构筑速览：进化、质变、锁定卡 */
  var bld = document.getElementById('overBuild');
  if (!bld){
    bld = document.createElement('p');
    bld.id = 'overBuild';
    bld.className = 'sub';
    bld.style.cssText = 'margin:6px 0 0;font-size:11px;line-height:1.5;opacity:.85';
    var dvb = document.getElementById('overDetail');
    dvb.insertBefore(bld, dvb.firstChild ? dvb.firstChild.nextSibling : null);
  }
  var evoN = [], schN = [];
  var evoD = G.evoDone || {}, schD = G.schoolDone || {};
  for (var ei in evoD){ if (evoD[ei]){ for (var ej=0; ej<EVO.length; ej++) if (EVO[ej].id === ei) evoN.push(EVO[ej].name); } }
  for (var si in schD){ if (schD[si] && SCHOOLS[si]) schN.push(SCHOOLS[si].title); }
  var locksN = S.set.lockUpg ? Object.keys(S.set.lockUpg).filter(function(k){ return S.set.lockUpg[k]; }) : [];
  var btxt = '构筑 · 进化 ' + (evoN.length ? evoN.join(' / ') : '无')
    + (schN.length ? ('　质变 ' + schN.join(' / ')) : '')
    + (locksN.length ? ('　锁 ' + locksN.length + ' 张') : '')
    + '　最高连杀 ' + (G.comboBest || G.comboK || 0)
    + (G.dpsPeak ? ('　峰值 DPS ' + fmt(Math.round(G.dpsPeak))) : '');
  bld.textContent = btxt;

  var box = document.getElementById('reviveBox');
  if (G.canRevive && !G.revived){
    box.classList.remove('used');
    document.getElementById('reviveDesc').textContent = '本局还有 1 次复活机会：恢复一半生命，清空身边怪物并短暂无敌。';
  } else {
    box.classList.add('used');
  }
  showScreen('scrOver');
  hint('本轮已结束，星核已存入基地', 4200);
}

function reviveRun(){
  if (!G.canRevive || G.revived) return;
  G.revived = true;
  G.canRevive = false;
  var p = G.player;
  p.hp = p.hpMax * 0.5;
  p.invul = 3;

  for (var i=G.enemies.length-1;i>=0;i--){
    var e = G.enemies[i];
    if (!e.boss && dist2(e.x,e.y,p.x,p.y) < 340*340){
      burst(e.x, e.y, e.col, 200, 8);
      G.enemies.splice(i,1);
    }
  }
  /* 网格里还留着刚被清掉的敌人，不置空同一帧的武器还会朝它们开火 */
  GRID.map = null;
  if (G.boss){
    var bx2 = G.boss;
    var a = Math.atan2(bx2.y-p.y, bx2.x-p.x);
    bx2.x = p.x + Math.cos(a)*700;
    bx2.y = p.y + Math.sin(a)*700;
  }
  G.state = 'playing';
  showScreen(null);
  toast('复活');
  sfx('revive');
  G.shake = 10;
}

/* 原始随机函数固定在这里。种子随机一旦被当成"原始"存进备份，
   就会在每日挑战结束后仍替换着 Math.random，整局甚至整盘都变成可复现序列 */
var REAL_RND = Math.random;
function seedRnd(seed){
  var a = seed >>> 0;
  var f = function(){
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.__gzSeed = true;
  return f;
}

var QUESTS = [
  {id:'runs', txt:'今日完成 3 局', goal:3},
  {id:'boss', txt:'今日击杀 2 个首领', goal:2},
  {id:'best', txt:'单局到达第 15 波', goal:15}
];

function questToday(){
  if (!S.quests || S.quests.date !== todayKey()){
    S.quests = {date: todayKey(), runs:0, boss:0, best:0, paid:{}};
    saveNow();
  }
  /* 同一天但字段缺失（老版本存档/被改坏的存档）：paid 缺了结算里 q.paid[id] 会直接抛，
     数值缺了 += 一路把 NaN 传下去，这里补一次 */
  var q = S.quests;
  if (!q.paid || typeof q.paid !== 'object' || Array.isArray(q.paid)) q.paid = {};
  if (typeof q.runs !== 'number' || !isFinite(q.runs)) q.runs = 0;
  if (typeof q.boss !== 'number' || !isFinite(q.boss)) q.boss = 0;
  if (typeof q.best !== 'number' || !isFinite(q.best)) q.best = 0;
  return q;
}

function questVal(id){
  var q = questToday();
  return id === 'runs' ? q.runs : id === 'boss' ? q.boss : q.best;
}

function questBar(){
  var q = questToday(), html = '<div class="qrow" style="opacity:.55">每天刷新 · 每项 +30 星核</div>';
  var doneN = 0;
  html += '<div class="qgrid">';
  for (var i=0;i<QUESTS.length;i++){
    var it = QUESTS[i], val = Math.min(it.goal, questVal(it.id)), done = val >= it.goal;
    if (done) doneN++;
    html += '<div class="qrow"><span style="color:' + (done ? P.am : P.ink) + '">' + it.txt + '</span>'
      + '<span style="opacity:.62">' + val + '/' + it.goal + (done ? ' ✓' : '') + '</span></div>';
  }
  html += '</div>';
  window._questDone = doneN;
  html += '<button class="btn" id="btnDailyStart" style="margin-top:9px;min-height:44px;width:100%">开始每日挑战 · 同一起点</button>';
  return html;
}

function todayKey(){
  var d = new Date();
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2);
}

function restoreRnd(){
  /* 无条件回到真正的 Math.random：只认备份的话，备份本身可能就是种子函数 */
  Math.random = REAL_RND;
  if (G) G._rndBackup = null;
}

function startDaily(){
  var key = todayKey();
  var seed = 0;
  for (var i=0;i<key.length;i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;
  startRun(true, key, seed);
}

var _wakeLock = null;

function keepAwake(){
  if (!navigator.wakeLock || _wakeLock) return;
  try{
    navigator.wakeLock.request('screen').then(function(l){ _wakeLock = l; }).catch(function(){});
  }catch(e){}
}

function releaseAwake(){
  if (!_wakeLock) return;
  try{ _wakeLock.release(); }catch(e){}
  _wakeLock = null;
}

function startRun(isDaily, dayKey, seed){
  /* 备份必须是真随机，不能是上一次留下的种子函数 */
  var prevRnd = REAL_RND;
  tone(440, 0.16, 'sine', 0.05);
  if (isDaily){
    Math.random = seedRnd(seed || 1);
  }
  G = newGame();
  G.speed = 1;
  applySpeedLabel();
  G.daily = !!isDaily;
  G.dailyKey = dayKey || '';
  G._rndBackup = isDaily ? prevRnd : null;
  if (isDaily){ G.diff = DIFF["normal"]; }
  G.state = 'playing';
  try { sessionStorage.setItem('gz_live', '1'); } catch(e){}
  keepAwake();
  JOY.active = false; JOY.dx = 0; JOY.dy = 0;
  showScreen(null);
  toast(isDaily ? '每日挑战 ' + dayKey : '第 1 波');
  for (var sb=0; sb<6; sb++) spawnEnemy('grunt');
  if (!S.tutorial){
    hint('第 1 波：拖动屏幕或用 WASD 移动，武器会自动瞄准最近目标', 5600);
  }
}

function goHome(){
  restoreRnd();
  releaseAwake();
  if (G && G.state !== 'menu' && (G.kills > 0 || G.time > 10)){
    var wasSettled = G.settled;
    var gained = settleRun();
    if (!wasSettled) toast('已结算 +' + fmt(gained) + ' 星核');
  }
  G = newGame();
  G.speed = 1;
  G.state = 'menu';
  applySpeedLabel();
  JOY.active = false; JOY.dx = 0; JOY.dy = 0;
  var h = document.getElementById('hint');
  h.classList.add('off');
  renderMenu();
  showScreen('scrMenu');
}

function togglePause(){
  if (!G) return;
  if (G.state === 'playing'){
    G.state = 'paused';
    renderBuild();
    showScreen('scrPause');
  } else if (G.state === 'paused'){
    G.state = 'playing';
    showScreen(null);
  }
}

/* ================= 输入 ================= */
function onKeyDown(ev){
  if (ev.__gz) return; ev.__gz = 1;
  if (!G) return;   /* 首帧 boot 完成前按键，G 还是 null，后面 G.state 会直接抛 */
  var KC = {KeyW:'w', KeyA:'a', KeyS:'s', KeyD:'d', Numpad8:'w', Numpad2:'s', Numpad4:'a', Numpad6:'d'};
  var KC2 = {87:'w', 65:'a', 83:'s', 68:'d', 104:'w', 98:'s', 100:'a', 102:'d'};
  var code = ev.code || '';
  var kc = ev.keyCode || ev.which || 0;
  var k = KC[code] || KC2[kc] || (ev.key ? ev.key.toLowerCase() : '');
  if (!k) return;
  var mvSrc = (code.indexOf('Arrow') === 0 || kc >= 37 && kc <= 40) ? 'arrow'
    : (code.indexOf('Numpad') === 0 || (kc >= 98 && kc <= 104)) ? 'numpad' : 'wasd';
  var mvMode = (S && S.set && S.set.keys) || 'both';
  if (['w','a','s','d'].indexOf(k) >= 0 && mvMode !== 'both' && mvMode !== mvSrc){
    if (mvSrc === 'arrow') ev.preventDefault();
    return;
  }
  if (KC[code] || KC2[kc]) { ev.preventDefault(); ev.stopPropagation(); }
  keys[k] = true;
  /* 系统长按重复（ev.repeat）只对"按住持续生效"的移动键有意义；
     放在开关类按键上会出事：按住 + 一路切到 ×10、按住 1 连选两张卡、按住 4 连刷商店把钱刷光 */
  if (!ev.repeat){
    if (k === 'p' && (G.state === 'playing' || G.state === 'paused')) togglePause();
    /* 桌面习惯：Esc 就是暂停。以前 playing 时按 Esc 完全没反应，只能去点右上角 */
    if (k === 'escape' && (G.state === 'playing' || G.state === 'paused')){ ev.preventDefault(); togglePause(); }
    if (k === '+' || k === '=' ) { ev.preventDefault(); cycleSpeed(1); }
    if (k === '-' ) { ev.preventDefault(); cycleSpeed(-1); }
    if (G.state === 'levelup'){
      if (k === '1') chooseUpgrade(0);
      if (k === '2') chooseUpgrade(1);
      if (k === '3') chooseUpgrade(2);
      if (k === '4' || k === 'r') rerollPicks();
    }
    /* 结算页也给键盘：R/回车再来一局，Esc 回主菜单。手机上没键盘，桌面上省一次挪鼠标 */
    if (G.state === 'over'){
      if (k === 'r' || k === 'enter'){ ev.preventDefault(); restartRun(); }
      if (k === 'escape'){ ev.preventDefault(); goHome(); }
    }
    if (G.state === 'shop'){
      if (k === '1') buyShopItem(0);
      if (k === '2') buyShopItem(1);
      if (k === '3') buyShopItem(2);
      if (k === '4' || k === 'r') rerollShop();
      if (k === 'enter' || k === ' ' || k === 'escape' || k === 'n') closeShop();
    }
  }
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].indexOf(k) >= 0) ev.preventDefault();
  if (['w','a','s','d'].indexOf(k) >= 0) ev.preventDefault();
}
function onKeyUp(ev){
  if (ev.__gzu) return; ev.__gzu = 1;
  var KC = {KeyW:'w', KeyA:'a', KeyS:'s', KeyD:'d', Numpad8:'w', Numpad2:'s', Numpad4:'a', Numpad6:'d'};
  var KC2 = {87:'w', 65:'a', 83:'s', 68:'d', 104:'w', 98:'s', 100:'a', 102:'d'};
  var k = KC[ev.code || ''] || KC2[ev.keyCode || ev.which || 0] || (ev.key ? ev.key.toLowerCase() : '');
  if (k) keys[k] = false;
}
/* 捕获阶段优先拿到键盘，避免被页面/浏览器插件先吃掉 */
document.addEventListener('keydown', onKeyDown, true);
document.addEventListener('keyup', onKeyUp, true);
window.addEventListener('keydown', onKeyDown, false);
window.addEventListener('keyup', onKeyUp, false);
/* 中文输入法激活时字母键会被输入法吃掉，给一次提示 */
var imeHinted = false;
window.addEventListener('compositionstart', function(){
  if (imeHinted) return;
  if (G && G.state === 'playing'){
    imeHinted = true;
    toast('检测到中文输入法：WASD 可能无效，请切到英文输入再移动');
  }
}, true);

/* 触摸兼容层：没有 PointerEvent 的 iOS 12 / 老 WebView 直接绑 pointerdown 会让摇杆失灵。pBind()：有指针就用指针，没有退回 touch 并补 pointerId/clientX。 */
var HAS_PE = !!window.PointerEvent;
var _PE_MAP = { pointerdown:'touchstart', pointermove:'touchmove', pointerup:'touchend', pointercancel:'touchcancel' };
function pBind(el, type, fn){
  if (HAS_PE){ el.addEventListener(type, fn, {passive: type === 'pointermove'}); return; }
  var tt = _PE_MAP[type];
  if (!tt) return;
  /* touchstart/touchend 必须非 passive 才能 preventDefault，否则部分浏览器会连带触发滚动/合成点击 */
  el.addEventListener(tt, function(e){
    var t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    if (!t) return;
    fn({ pointerId: (t.identifier === undefined ? 0 : t.identifier) + 1,
         clientX: t.clientX, clientY: t.clientY, target: el });
    if (type !== 'pointermove' && e.cancelable){ try{ e.preventDefault(); }catch(_){} }
  }, {passive: type === 'pointermove'});
}

/* 部分浏览器（如 QQ 浏览器多标签）焦点停在地址栏，点击画面后把焦点拉回画布 */
pBind(cvs, 'pointerdown', function(){
  try{ cvs.focus(); }catch(e){}
});

pBind(cvs, 'pointerdown', function(ev){
  if (G.state !== 'playing') return;
  if (G.bossWarn){ G.bossWarn.t = 0.01; return; }
  /* 已经有一根手指在推摇杆了：第二根手指（另一只手点暂停/点画面）不能把摇杆抢走，
     否则先按下的那根抬起来时 id 对不上，角色会一直往一个方向跑 */
  if (JOY.active && JOY.id !== ev.pointerId) return;
  JOY.active = true; JOY.id = ev.pointerId;
  JOY.bx = ev.clientX; JOY.by = ev.clientY;
  JOY.dx = 0; JOY.dy = 0; JOY.tx = 0; JOY.ty = 0;
  try{ cvs.setPointerCapture(ev.pointerId); }catch(e){}
});
pBind(cvs, 'pointermove', function(ev){
  if (!JOY.active || ev.pointerId !== JOY.id) return;
  var dx = ev.clientX - JOY.bx, dy = ev.clientY - JOY.by;
  var m = Math.sqrt(dx*dx + dy*dy);
  /* 浮动模式：手指走得比半径远就让底座跟上来，才不会"够不到"某个方向；
     固定模式底座不动，手指回到中心即可停住 */
  if (S.set.stick !== 'fixed' && m > 64){
    JOY.bx += dx * (1 - 64/m);
    JOY.by += dy * (1 - 64/m);
    dx = ev.clientX - JOY.bx; dy = ev.clientY - JOY.by;
    m = 64;
  }
  var gain = Math.min(1, Math.max(0, (m - 14)/46));
  if (m < 6){ JOY.tx = 0; JOY.ty = 0; return; }
  JOY.tx = dx/m*gain; JOY.ty = dy/m*gain;
});
function endJoy(ev){
  if (ev.pointerId !== JOY.id) return;
  JOY.active = false; JOY.dx = 0; JOY.dy = 0; JOY.tx = 0; JOY.ty = 0;
}
pBind(cvs, 'pointerup', endJoy);
pBind(cvs, 'pointercancel', endJoy);

document.addEventListener('visibilitychange', function(){
  if (document.hidden && G){
    /* 切后台拿不到 pointerup / keyup，摇杆和键盘方向键都不清干净，回来就等于一直按着 */
    JOY.active = false; JOY.dx = 0; JOY.dy = 0; JOY.tx = 0; JOY.ty = 0;
    keys = {};
    if (G.state === 'playing') saveCheckpoint(true, true);
    if (G.state === 'playing' && S.set.autoPause !== false) togglePause();
    /* 关掉"自动暂停"的人后台还在跑，BGM 会一直响；把整个音频图挂起更彻底 */
    if (AU.ctx && AU.ctx.state === 'running'){ try{ AU.ctx.suspend(); }catch(e){} }
  } else if (!document.hidden && AU.ctx && AU.ctx.state === 'suspended'){
    try{ AU.ctx.resume(); }catch(e){}
  }
});
window.addEventListener('blur', function(){
  JOY.active = false; JOY.dx = 0; JOY.dy = 0; JOY.tx = 0; JOY.ty = 0;
  /* 失焦时浏览器不会再补发 keyup：按住 D 切到别的窗口，回来角色会一直往右跑 */
  keys = {};
  /* 练习场也走同一套自动暂停：否则切出去一会儿回来已经被怪打死，和切后台的行为不一致 */
  if (G && G.state === 'playing' && S.set.autoPause !== false) togglePause();
});
/* 页面要走了必须立刻落盘：延迟合并的定时器不会再有机会执行 */
window.addEventListener('pagehide', function(){ if (G && G.state === 'playing') saveCheckpoint(true, true); });
window.addEventListener('beforeunload', function(){ if (G && G.state === 'playing') saveCheckpoint(true, true); });

/* ================= 按钮绑定 ================= */
function bind(id, fn){
  var el = document.getElementById(id);
  if (el) el.addEventListener('click', function(){ sfx('ui'); fn(); });
}

bind('btnStart', function(){ startRun(false); });
bind('btnPractice', function(){ startPractice(); });
bind('lockChip', function(){
  if (!G || G.state !== 'levelup') return;
  renderCodex();
  showScreen('scrCodex');
  var tabs = document.querySelectorAll('#codexTabs button');
  for (var i=0; i<tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === 'pick');
  var panes = document.querySelectorAll('#scrCodex .tabpane');
  for (var j=0; j<panes.length; j++) panes[j].style.display = panes[j].getAttribute('data-pane') === 'pick' ? 'block' : 'none';
});
bind('btnToday', function(){
  var qb = document.getElementById('questBox');
  if (!qb) return;
  var show = qb.style.display === 'none';
  qb.style.display = show ? 'block' : 'none';
  if (show) renderMenu();
});
bind('btnContinueRun', resumeRun);
bind('btnOverDetail', function(){
  var d = document.getElementById('overDetail');
  var b = document.getElementById('btnOverDetail');
  if (!d) return;
  var show = d.classList.contains('hide');
  d.classList.toggle('hide', !show);
  if (b) b.textContent = show ? '收起详情' : '查看详情';
});

function restartRun(){
  /* 结算页的"再来一局"按钮双击会在同一帧被命中两次：第二次把刚建好的局又重置一遍 */
  if (Date.now() - (restartRun._t || 0) < 600) return;
  restartRun._t = Date.now();
  var wasP = !!(G && G.practice);
  startRun(false);
  if (wasP){ G.practice = true; G.wave = 19; waveStart(); toast('练习模式：不计星核与战绩'); }
}
bind('btnRestart', restartRun);
bind('btnCopyRun', function(){
  var g = G; if (!g || !g.player) return;
  var dl = (DIFF[g.diff && g.diff.key] || DIFF.normal);
  var txt = '怪潮幸存者 · ' + (dl.name || '普通')
    + ' · 第 ' + g.wave + ' 波'
    + ' · Lv ' + g.player.level
    + ' · 击杀 ' + g.kills
    + ' · 存活 ' + Math.floor(g.time) + ' 秒'
    + (g.comboBest ? ' · 最高连杀 ' + g.comboBest : '')
    + ((g.cycle || 1) > 1 ? ' · 第 ' + g.cycle + ' 周目' : '')
    + (g.mods && g.mods.length ? ' · 异变 ' + g.mods.length + ' 条' : '');
  try{
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(function(){ toast('战绩已复制，可直接粘贴分享'); },
        function(){ window.prompt('复制下面这段战绩', txt); });
    } else window.prompt('复制下面这段战绩', txt);
  }catch(e){ try{ window.prompt('复制下面这段战绩', txt); }catch(_){} }
});
bind('btnResume', togglePause);
var _homeArm = 0;
bind('btnHome', function(){
  /* 手滑碰到就会当场结算、这局的连杀星核与进度直接落定，改成两下确认 */
  var risky = !!(G && G.state !== 'menu' && G.state !== 'over' && (G.kills > 0 || G.time > 10));
  if (risky && Date.now() - _homeArm > 2000){
    _homeArm = Date.now();
    toast('再点一次「返回主菜单」＝结算并放弃本局');
    return;
  }
  _homeArm = 0;
  goHome();
});
bind('btnRevive', reviveRun);
bind('btnPause', togglePause);
bind('btnSpeed', function(){ cycleSpeed(1); });
applySpeedLabel();
bind('btnQuit', function(){ goHome(); });


bind('btnWipe', function(){
  if (window.confirm('确定清除全部存档？星核、强化、角色解锁都会丢失。')){
    try{ localStorage.removeItem(SAVE_KEY); }catch(e){}
    loadSave(); saveNow(); renderMenu(); renderSettings(); toast('存档已清除');
  }
});

document.getElementById('segDiff').addEventListener('click', function(ev){
  var d = ev.target.getAttribute('data-d');
  if (!d) return;
  S.diff = d; saveNow(); renderMenu(); sfx('ui');
});

document.getElementById('navHost') && document.getElementById('navHost').addEventListener('click', function(){});

var screenRoot = document.getElementById('ui');
screenRoot.addEventListener('click', function(ev){
  var tb = ev.target.closest ? ev.target.closest('[data-tab]') : null;
  if (!tb) return;
  var tab = tb.getAttribute('data-tab');
  var tabs = document.querySelectorAll('#codexTabs button');
  for (var ti=0; ti<tabs.length; ti++) tabs[ti].classList.toggle('on', tabs[ti] === tb);
  var panes = document.querySelectorAll('#scrCodex .tabpane');
  for (var pi=0; pi<panes.length; pi++) panes[pi].style.display = (panes[pi].getAttribute('data-pane') === tab) ? 'block' : 'none';
}, true);


screenRoot.addEventListener('input', function(ev){
  var t = ev.target;
  if (t && t.getAttribute && t.getAttribute('data-vol')) setVolume(t.value);
  if (t && t.getAttribute && t.getAttribute('data-volbgm')) setVolumeBgm(t.value);
  if (t && t.getAttribute && t.getAttribute('data-pad')) setPadSens(t.value);
});

screenRoot.addEventListener('click', function(ev){
  var t = ev.target;
  var scr = t.getAttribute && t.getAttribute('data-scr');
  if (scr){
    sfx('ui');
    if (scr === 'scrMeta') renderMeta();
    if (scr === 'scrChars') renderChars();
    if (scr === 'scrCodex') renderCodex();
    if (scr === 'scrStats') renderStats();
    if (scr === 'scrSet') renderSettings();
    showScreen(scr);
    return;
  }
  var back = t.getAttribute && t.getAttribute('data-back');
  if (back){
    sfx('ui');
    /* 从升级界面进图鉴调整锁定后，返回要回到选卡而不是主菜单 */
    if (back === 'scrMenu' && G && G.state === 'levelup'){
      renderPicks(pendingPicks);
      showScreen('scrLevel');
      return;
    }
    if (back === 'scrMenu') renderMenu();
    showScreen(back);
    return;
  }
  var buy = t.getAttribute && t.getAttribute('data-buy');
  if (buy){
    var m = null;
    for (var i=0;i<META.length;i++) if (META[i].id === buy) m = META[i];
    var lv = S.up[buy] || 0;
    var cost = metaCost(m, lv);
    if (S.core >= cost && lv < metaCap(m)){
      S.core -= cost; S.up[buy] = lv + 1; saveNow(); renderMeta(); sfx('coin');
    } else {
      toast('星核不足');
    }
    return;
  }
  var unlock = t.getAttribute && t.getAttribute('data-unlock');
  if (unlock){
    var ch = CHARS[unlock];
    if (S.core >= ch.cost){
      S.core -= ch.cost; S.chars[unlock] = true; S.char = unlock; saveNow(); renderChars(); sfx('coin');
    } else toast('星核不足');
    return;
  }
  var pick = t.getAttribute && t.getAttribute('data-char');
  if (pick){ S.char = pick; saveNow(); renderChars(); sfx('ui'); return; }

  var sk = t.getAttribute && t.getAttribute('data-skin-choice');
  if (sk){
    SKIN = sk;
    try { localStorage.setItem(SKIN_STORE, sk); } catch(e){}
    applySkin(); renderSettings(); renderMenu(); sfx('ui');
    return;
  }
  var lang = t.getAttribute && t.getAttribute('data-lang');
  if (lang){
    try { localStorage.setItem('gz_lang', lang); } catch(e){}
    try { if (G && G.state === 'playing') saveCheckpoint(); } catch(e){}
    location.reload();
    return;
  }
  if (t.getAttribute && t.getAttribute('data-save-exp')){
    try {
      var expTxt = btoa(unescape(encodeURIComponent(JSON.stringify(S))));
      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(expTxt).then(function(){ toast('存档已复制到剪贴板'); },
          function(){ window.prompt('复制下面这段存档', expTxt); });
      } else window.prompt('复制下面这段存档', expTxt);
    } catch(e){ toast('导出失败'); }
    return;
  }
  if (t.getAttribute && t.getAttribute('data-save-imp')){
    var inp = window.prompt('粘贴存档文本（会覆盖当前进度）');
    if (!inp) return;
    try {
      var obj = JSON.parse(decodeURIComponent(escape(atob(inp.trim()))));
      if (!obj || typeof obj !== 'object') throw 0;
      /* 旧档可能缺字段：先塞进本地，再走 loadSave 的补默认流程 */
      if (obj.v === undefined) obj.v = 2;
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); } catch(e){ throw 0; }
      loadSave();
      saveNow(); applySkin(); renderMenu(); renderSettings(); renderCodex();
      toast('存档已导入 · 缺失字段已补默认');
    } catch(e){ toast('存档格式不对或版本过旧'); }
    return;
  }
  if (t.getAttribute && t.getAttribute('data-save-wipe')){
    if (window.confirm('确定清除全部存档？星核、强化、角色解锁都会丢失。')){
      try{ localStorage.removeItem(SAVE_KEY); }catch(e){}
      loadSave(); saveNow(); applySkin(); renderMenu(); renderSettings(); toast('存档已清除');
    }
    return;
  }
  var lku = t.getAttribute && t.getAttribute('data-lockupg');
  if (lku){
    S.set.lockUpg = S.set.lockUpg || {};
    S.set.lockUpg[lku] = !S.set.lockUpg[lku];
    saveNow();
    sfx('ui');
    renderCodex();
    return;
  }
  var setk = t.getAttribute && t.getAttribute('data-set');
  if (setk){
    S.set[setk] = !S.set[setk];
    saveNow();
    /* 省电模式改的是渲染分辨率，必须立刻重排画布，否则要等下一次转屏才生效 */
    if (setk === 'eco') resize();
    /* 用户自己拨过震动开关：之后系统级"减少动态效果"变化不再覆盖他的选择 */
    if (setk === 'shakeOff') S.set.shakeManual = true;
    if (setk === 'bgm') if (S && S.set && !S.set.bgmSet){ S.set.bgm = true; S.set.bgmSet = true; saveNow(); }
bgmApply();
    if (setk === 'sfx' && S.set.sfx) sfx('ui');
    renderSettings();
    return;
  }
  if (t.getAttribute && t.getAttribute('data-vol')){
    setVolume(t.value);
    return;
  }
  if (t.getAttribute && t.getAttribute('data-volbgm')){
    setVolumeBgm(t.value);
    return;
  }
  if (t.getAttribute && t.getAttribute('data-hud')){
    S.set.hudInfo = !S.set.hudInfo; saveNow(); renderSettings(); return;
  }
  if (t.getAttribute && t.getAttribute('data-eco')){
    S.set.eco = !S.set.eco; saveNow(); resize(); renderSettings(); return;
  }
  if (t.getAttribute && t.getAttribute('data-stick')){
    S.set.stick = (S.set.stick === 'fixed') ? 'float' : 'fixed';
    saveNow(); renderSettings(); return;
  }
  if (t.getAttribute && t.getAttribute('data-pad')){
    setPadSens(t.value);
    return;
  }
  if (t.getAttribute && t.getAttribute('data-volhit')){
    S.set.volHit = Math.max(0, Math.min(1, parseInt(t.value,10)/100));
    saveNow();
    return;
  }
  if (t.getAttribute && t.getAttribute('data-keys')){
    var order = ['both','wasd','arrow','numpad'];
    var ci = order.indexOf(S.set.keys || 'both');
    S.set.keys = order[(ci + 1) % order.length];
    saveNow(); renderSettings(); sfx('ui');
    return;
  }
  if (t.getAttribute && t.getAttribute('data-quality')){
    S.set.quality = S.set.quality === 'high' ? 'low' : 'high';
    resize();
    saveNow(); renderSettings(); sfx('ui');
    return;
  }
});

document.getElementById('btnReroll').addEventListener('click', function(){
  rerollPicks();
});
document.getElementById('btnSkipPick').addEventListener('click', function(){
  skipPicks();
});

document.getElementById('buildList').addEventListener('click', function(ev){
  var t = ev.target.closest ? ev.target.closest('[data-sword]') : null;
  if (!t) return;
  var sp = 70 + (G.swords || 0)*80;
  if (coinNow() < sp){ toast('金币不足'); return; }
  G.coins -= sp; addBlade(); renderShop();
});
document.getElementById('shopList').addEventListener('click', function(ev){
  var t = ev.target.closest ? ev.target.closest('[data-shop],[data-sword],[data-swordup]') : null;
  if (!t) return;
  if (t.hasAttribute('data-sword')){
    var sp = 70 + (G.swords || 0)*80;
    if (coinNow() < sp){ toast('金币不足'); return; }
    G.coins -= sp; addBlade(); renderShop(); return;
  }
  if (t.hasAttribute('data-swordup')){
    if (G.swordDmg){ toast('飞剑已淬锋'); return; }
    if (coinNow() < 220){ toast('金币不足'); return; }
    G.coins -= 220; upgradeBlades(); renderShop(); return;
  }
  buyShopItem(parseInt(t.getAttribute('data-shop'), 10));
});
bind('btnShopGo', function(){ closeShop(); });
bind('btnShopReroll', function(){ rerollShop(); });
bind('btnShopAll', function(){ buyAllShop(); });

document.getElementById('cards').addEventListener('click', function(ev){
  var btn = ev.target.closest ? ev.target.closest('.card') : null;
  if (!btn) return;
  chooseUpgrade(parseInt(btn.getAttribute('data-i'), 10));
});

/* ================= 启动 ================= */

applySkin();
resize();
/* resize 节流：手机地址栏伸缩会连续触发，重建背景层很贵 */
var _rzT = 0;
window.addEventListener('resize', function(){
  clearTimeout(_rzT);
  _rzT = setTimeout(resize, 160);
});
/* iOS：旋转后 innerWidth/innerHeight 会比 orientationchange 晚几百毫秒才更新，
   只靠 resize 会拿到旧尺寸；这里补两次 */
window.addEventListener('orientationchange', function(){
  setTimeout(resize, 60);
  setTimeout(resize, 320);
});
/* 地址栏收起、软键盘弹出这类只改 visualViewport 的场合，resize 不一定触发 */
(function(){
  var vv = window.visualViewport;
  if (!vv || !vv.addEventListener) return;
  var lw = Math.round(vv.width), lh = Math.round(vv.height), vt = 0;
  vv.addEventListener('resize', function(){
    var w = Math.round(vv.width), h = Math.round(vv.height);
    if (Math.abs(w-lw) < 2 && Math.abs(h-lh) < 2) return;
    lw = w; lh = h;
    clearTimeout(vt); vt = setTimeout(resize, 220);
  });
})();
loadSave();
/* 系统级的"减少动态效果"开着时把屏幕震动关掉；用户自己动过开关就不再覆盖 */
try {
  var _rmq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (_rmq && _rmq.addEventListener){
    _rmq.addEventListener('change', function(ev){
      if (S.set.shakeManual) return;
      S.set.shakeOff = !!ev.matches;
      saveNow();
    });
  }
} catch(e){}
bgmApply();
G = newGame();
G.state = 'menu';
renderMenu();
showScreen('scrMenu');
var LIVE = false;
try { LIVE = sessionStorage.getItem('gz_live') === '1'; } catch(e){}
if ((S.autoResume || LIVE) && S.checkpoint){
  S.autoResume = false; saveNow();
  setTimeout(function(){ resumeRun(); }, 260);
}

var last = 0;
/* 非 playing 状态下画面是静止的，节流用 */
var _lastDk = '', _idleDr = 0, _needDraw = 1;
var PAD = {x:0, y:0, pausePrev:false};

/* 没有手柄时每帧调 getGamepads() 是白花的（部分机型还要做一次内部枚举），
   用连接事件维护开关，只有真插过手柄才每帧轮询 */
var PAD_ON = false;
/* 另一个窗口/标签页也在玩时，两边都会写同一份存档（后写的覆盖先写的）。提示一次就好，不去抢 */
window.addEventListener('storage', function(e){
  if (!e || e.key !== SAVE_KEY) return;
  if (!G || (G.state !== 'playing' && G.state !== 'paused' && G.state !== 'shop' && G.state !== 'levelup')) return;
  if (window.__multiTold) return;
  window.__multiTold = 1;
  toast('另一个窗口也在玩 · 存档会互相覆盖，建议只留一个');
});
window.addEventListener('gamepadconnected', function(){ PAD_ON = true; });
window.addEventListener('gamepaddisconnected', function(){
  PAD_ON = false; PAD.x = 0; PAD.y = 0; PAD.pausePrev = false;
});

function pollPad(){
  PAD.x = 0; PAD.y = 0;
  if (!PAD_ON || !navigator.getGamepads) return;
  var gps = navigator.getGamepads();
  for (var i=0;i<gps.length;i++){
    var gp = gps[i];
    if (!gp) continue;
    var ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    var dz = 0.18 / (S.set.padSens || 1);
    var sens = S.set.padSens || 1;
    if (ax*ax + ay*ay > dz*dz){ PAD.x = ax * sens; PAD.y = ay * sens; }
    var b9 = gp.buttons && gp.buttons[9] && gp.buttons[9].pressed;
    if (b9 && !PAD.pausePrev && G && (G.state === 'playing' || G.state === 'paused')) togglePause();
    PAD.pausePrev = b9;
    break;
  }
}

var _ecoLast = 0;

/* 高精度计时器提到模块级：high-speed 补帧循环里每步都要用，别再逐次查 window.performance */
var PNow = (window.performance && window.performance.now)
  ? function(){ return window.performance.now(); }
  : function(){ return Date.now(); };

function frame(ts){
  if (S && S.set && S.set.eco){
    if (ts - _ecoLast < 32){ requestAnimationFrame(frame); return; }
    _ecoLast = ts;
  }
  if (!last) last = ts;
  var rawDt = Math.min((ts-last)/1000, 2);
  var dt = Math.min((ts-last)/1000, 0.05);
  last = ts;
  if (G && G.slowmo > 0){ dt *= 0.35; G.slowmo -= Math.min(rawDt, 0.1); }
  if (G && rawDt > 0.002){
    var f = 1/rawDt;
    G.fps = G.fps ? (G.fps*0.62 + f*0.38) : f;
  }

  if (G && G.hitstop > 0){
    G.hitstop -= dt;
    if (G.hitstop < 0) G.hitstop = 0;
    /* 顿帧时画面完全静止，继续每帧全屏重绘等于白烧像素（首领入场 0.6s ≈ 36 帧）。
       只在进入顿帧的第一帧画一次，其余帧把上一帧留在画布上走 */
    if (!G._hsDrawn){ G._hsDrawn = 1; try { draw(); } catch(err){ if (!window.__drErr){ window.__drErr = 1; console.error(err); } } }
    if (G.hitstop <= 0) G._hsDrawn = 0;
    requestAnimationFrame(frame);
    return;
  }

  pollPad();
  /* 外接屏、页面缩放、系统"更大字号"会改变 devicePixelRatio，但不会触发 resize 事件，
     不查的话画面会一直是旧的像素密度（发虚或过锐） */
  if ((++G._dprTick & 63) === 0){
    var rdp = window.devicePixelRatio || 1;
    if (rdp !== _lastRawDPR){ resize(); }
  }
  /* 阈值取 40ms：30fps 的机器本身就是 33ms，不该被判定为掉帧一路降到最低画质 */
  if (dt > 0.040){ AUTOQ.slow += dt; AUTOQ.fast = 0; } else { AUTOQ.fast += dt; AUTOQ.slow = 0; }
  if (AUTOQ.slow > 2.5){
    AUTOQ.slow = 0;
    if (AUTOQ.lv < 3){
      AUTOQ.lv++; AUTOQ.on = AUTOQ.lv > 0; AUTOQ.fast = 0; AUTOQ.cool = Date.now() + 90000; resize();
      G.qNoteUntil = Date.now() + 8000;
      toast(AUTOQ.lv === 1 ? '检测到掉帧 · 已自动降低渲染精度'
         : (AUTOQ.lv === 2 ? '仍偏卡 · 已切到最低画质' : '非常卡 · 已开到极低画质'));
    }
  } else if (AUTOQ.fast > 25 && AUTOQ.lv > 0 && Date.now() > (AUTOQ.cool || 0)){
    /* 恢复档位要比降档谨慎得多：稳定 25 秒才升一档，且降档后 90 秒内不许升。
       否则刚降档画面变轻、立刻又快起来、升回去又卡，玩家会看到画质反复跳 */
    AUTOQ.fast = 0; AUTOQ.cool = Date.now() + 90000; AUTOQ.lv--; AUTOQ.on = AUTOQ.lv > 0; resize();
  }
  var fpsNow = (G && G.fps) ? G.fps : 60;
  if (G && G.state === 'playing' && !G.daily){
    /* 用真实帧间隔累计“慢帧时长”，不依赖平滑值，避免阈值永远达不到 */
    if (rawDt > 0.08){ G.lowFpsT = (G.lowFpsT || 0) + rawDt; }
    else G.lowFpsT = 0;
    var nowR = Date.now();
    if ((G.lowFpsT || 0) > 3.5 && !G.rescuing && (!S.lastRescue || nowR - S.lastRescue > 30000)){
      G.rescuing = true;
      G.lowFpsT = 0;
      saveCheckpoint();
      S.lastRescue = Date.now();
      saveNow();
      AUTOQ.lv = 2; AUTOQ.on = true; resize();
      if (G.speed > 1) setSpeed(1);
      toast('帧率偏低 · 已自动降画质并降到 ×1，不打断本局');
      setTimeout(function(){ if (G) G.rescuing = false; }, 12000);
    }
  }
  var sp = (G && G.speed) ? G.speed : 1;
  var maxSp = 10;
  if (fpsNow < 45) maxSp = 5;
  if (fpsNow < 40) maxSp = 3;
  if (fpsNow < 30) maxSp = 1;
  if (sp > maxSp){
    sp = maxSp;
    if (G) G.slowNote = '已降速 ×' + sp;
    var nowMs = PNow();
    /* 只提示一次，之后靠 HUD 的慢速标记；否则卡顿时会反复弹 */
    if (!window.__autoSpT || nowMs - window.__autoSpT > 20000){
      window.__autoSpT = nowMs;
      toast('帧率偏低 · 本段已自动降到 ×' + sp);
    }
  } else if (G && G.slowNote && sp === (G.speed || 1)){
    G.slowNote = '';  /* 帧率回来了就把"已降速"标记擦掉 */
  }
  if (sp === 1){
    try { update(dt); } catch(err){ if (!window.__upErr){ window.__upErr = 1; toast('运行异常：' + (err && err.message || err)); console.error(err); } }
  } else {
    /* 高倍速步长要粗：10x 时 0.05 步长要 10 次 update，14ms 预算只够 7 次→实际只有 7 倍。倍速越高步长越大，总步数封顶 16。 */
    var stepMax = sp >= 8 ? 0.1 : (sp >= 5 ? 0.08 : 0.05);
    var total = Math.min(dt * sp, 0.6), guard = 0;
    var step = Math.min(stepMax, total);
    var t0 = PNow();
    var budget = sp >= 5 ? 20 : 14;
    while (total > 0.0005 && guard++ < 16){
      if (t0 && (PNow() - t0) > budget) break;
      try { update(step); } catch(err){ if (!window.__upErr){ window.__upErr = 1; toast('运行异常：' + (err && err.message || err)); console.error(err); } }
      total -= step;
      if (G.state !== 'playing') break;
      step = Math.min(stepMax, total);
    }
  }
  /* 面板打开时游戏静止，全屏重绘白烧像素（低端机还连带重算 backdrop-filter）。状态切换/重排/每 8 帧兜底各画一次，其余帧留上一帧。 */
  var dk = G.state + '|' + (G.paused ? 1 : 0) + '|' + VW + 'x' + VH + '|' + DPR + '|' + (S.set.hudInfo ? 1 : 0) + '|' + (S.set.quality || '') + '|' + (AUTOQ.lv || 0);
  if (G.state === 'playing' || _needDraw || dk !== _lastDk || (++_idleDr & 7) === 0){
    _lastDk = dk; _needDraw = 0; _idleDr = 0;
    try { draw(); } catch(err){ if (!window.__drErr){ window.__drErr = 1; console.error(err); } }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
