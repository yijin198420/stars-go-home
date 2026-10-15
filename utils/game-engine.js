// utils/game-engine.js —— 星光互动核心引擎（纯 JS，不依赖微信 API）
// 同一份逻辑被两处使用：
//   1. 小程序游戏页 pages/game/game.js（微信 Canvas 2D）
//   2. 独立网页游戏（浏览器 Canvas）
//
// 引擎只负责「画面 + 物理 + 状态」，文字提示、跳转等界面逻辑由外部通过
// onEvent 回调处理，这样引擎在任何平台都能原样运行。

var specialStars = require('./specialStars.js');
var lightBrush = require('./lightBrush.js');

// ---------- 星星的种类（颜色来自设计方案） ----------
var STAR_TYPES = [
  { type: 'tired',   color: '#9BB7FF', label: '疲惫', weight: 24 },
  { type: 'anxious', color: '#C8A2FF', label: '焦虑', weight: 20 },
  { type: 'sad',     color: '#8EA7E9', label: '难过', weight: 20 },
  { type: 'hope',    color: '#FFD66B', label: '希望', weight: 18 },
  { type: 'calm',    color: '#FFFFFF', label: '平静', weight: 18 }
];

// ---------- 心情如何影响游戏节奏和方式 ----------
// speed  下落速度倍率 / spawn 出星频率倍率 / breath 呼吸星概率
// tint   地平线色调 / tintAlpha 色调浓度（难过与被安慰时夜空更柔和）
// weights 星星种类权重微调（被安慰时暖金色希望星更多、累时平静星更多……）
// forceBreath 焦虑时保底出现一颗呼吸星（跟随文档「焦虑=加入呼吸练习」）
var MOOD_CONFIG = {
  tired:   { speed: 0.80, spawn: 0.90, breath: 0.10, tint: '#8FA8E8', tintAlpha: 0.14, weights: { calm: 1.8 }, forceBreath: false, breathPattern: 'light' },
  anxious: { speed: 1.22, spawn: 1.10, breath: 0.18, tint: '#C8A2FF', tintAlpha: 0.14, weights: { anxious: 1.3 }, forceBreath: true, breathPattern: 'slow' },
  sad:     { speed: 0.90, spawn: 1.00, breath: 0.12, tint: '#8EA7E9', tintAlpha: 0.22, weights: { hope: 1.6, sad: 1.2 }, forceBreath: false, breathPattern: 'gentle' },
  quiet:   { speed: 0.72, spawn: 0.72, breath: 0.08, tint: '#BFD8FF', tintAlpha: 0.10, weights: {}, forceBreath: false, breathPattern: 'light' },
  comfort: { speed: 0.85, spawn: 1.00, breath: 0.12, tint: '#FFD9C9', tintAlpha: 0.20, weights: { hope: 2.2, calm: 1.3 }, forceBreath: false, breathPattern: 'gentle' },
  unknown: { speed: 0.95, spawn: 1.00, breath: 0.12, tint: '#D9D4FF', tintAlpha: 0.12, weights: { tired: 1.15, anxious: 1.15, sad: 1.15, hope: 1.15, calm: 1.15 }, forceBreath: false, breathPattern: 'gentle' }
};

// ---------- 呼吸引导的节奏（秒），不同心情不同节奏 ----------
// gentle 星星呼吸：匀速放松 / slow 缓落呼吸：呼气比吸气长，帮焦虑慢下来
// light 轻柔呼吸：更轻更短，适合疲惫时
var BREATH_PATTERNS = {
  gentle: { name: '星星呼吸', inhale: 3.5, hold: 1.2, exhale: 3.5 },
  slow:   { name: '缓落呼吸', inhale: 4.0, hold: 2.0, exhale: 6.0 },
  light:  { name: '轻柔呼吸', inhale: 3.0, hold: 1.0, exhale: 3.0 }
};
var BREATH_ROUNDS = 3;   // 一共三轮

function rand(min, max) {
  return min + Math.random() * (max - min);
}

// 按心情微调后的权重随机挑一种星星（StarGame 的实例方法）
StarGame.prototype.pickStarType = function () {
  var total = 0, i;
  for (i = 0; i < this.starWeights.length; i++) total += this.starWeights[i];
  var r = Math.random() * total;
  for (i = 0; i < STAR_TYPES.length; i++) {
    r -= this.starWeights[i];
    if (r <= 0) return STAR_TYPES[i];
  }
  return STAR_TYPES[STAR_TYPES.length - 1];
};

function StarGame(options) {
  this.width = options.width;
  this.height = options.height;
  this.mood = options.mood || 'calm';
  this.duration = options.duration || 60; // 游戏时长（秒）
  // mode: 'path' 牵星创作 / 'catch' 旧版接星 / 'breathe' 纯呼吸模式
  this.mode = options.mode || 'catch';
  this.targetCatches = options.targetCatches || 0; // 渐静模式：接到指定数量后交给页面进入选择仪式
  this.specialStar = options.specialStar || null; // { id, line, isRepeat }
  this.onEvent = options.onEvent || function () {};
  this.reducedMotion = !!options.reducedMotion;

  this.moodConf = MOOD_CONFIG[this.mood] || MOOD_CONFIG.unknown;
  // 按心情微调星星种类权重（希望星更多 / 平静星更多……）
  var conf = this.moodConf;
  this.starWeights = STAR_TYPES.map(function (t) {
    return t.weight * ((conf.weights && conf.weights[t.type]) || 1);
  });
  this.basket = { x: this.width / 2, y: this.height - 96, w: 110, h: 30 };
  this.reset();
  this.makeBackgroundStars();
}

StarGame.prototype.setReducedMotion = function (reduced) {
  this.reducedMotion = !!reduced;
};

// ---------- 对外方法 ----------

// 开始 / 重新开始一局
StarGame.prototype.reset = function () {
  this.stars = [];        // 正在下落的星星
  this.sparkles = [];     // 接住时的光点特效
  this.groundGlows = [];  // 没接住的星星落在地上化成的光
  this.elapsed = 0;       // 已进行时间（呼吸时暂停）
  this.spawnTimer = 0.8;  // 多久后出下一颗星
  this.firstStarPending = this.mode !== 'breathe' && this.mode !== 'path'; // 首颗星走一条更容易接住的引导轨迹
  this.lastBreathAt = -99;
  this.phase = 'play';    // play 正常游戏 / breathing 呼吸引导
  this.breath = null;
  this.breathPattern = BREATH_PATTERNS.gentle;
  this.breathParticles = [];  // 呼吸时环绕的小光点
  this.breathRipples = [];    // 吸气时荡开的涟漪
  this.breathFade = 0;        // 呼吸幕布的淡入淡出程度 0~1
  this.afterglow = null;      // 呼吸结束后留下的余光
  this.clock = 0;             // 一直走动的时钟（呼吸暂停计时时，微光仍然流动）
  this.finished = false;
  this.lastTickRemaining = -1;
  this.forcedBreathDone = false; // 焦虑心情的保底呼吸星是否已经出过
  // 特殊星会在接住 2–3 颗普通星后出现；错过时会再回来，不制造稀缺压力。
  this.specialAtCatch = 2 + Math.floor(Math.random() * 2);
  this.specialSpawned = false;
  this.specialCaught = false;
  // 无名星：今晚只属于用户的一颗星，接住后可以为它命名（给情绪命名）
  this.nameStarAt = rand(12, 22); // 出现时间（秒）
  this.nameStarSpawned = false;
  // 「停一下」低语：不常驻界面，只在错过变多 / 一直没歇时由夜空轻轻提出
  this.missTimes = [];
  this.lastPauseOfferAt = -99;
  // 纯呼吸模式的计时
  this.modeClock = 0;
  this.restTimer = 0;
  this.breathSessions = 0;
  // 渴望回路：连击（决定和弦阶梯）、飞进船的光点、船体累积的亮光
  this.catchStreak = 0;
  this.lastCatchAt = -99;
  this.motes = [];        // 接住后飞进月亮船的小光点
  this.boatPulse = 0;     // 刚接住时船体的一次亮起（会慢慢退掉）
  this.artworkFinale = null; // 呼吸结束后：月亮船把收藏的光送回天空
  this.artworkFinaleBloomSent = false;
  this.stats = {
    caught: 0,
    breathCount: 0,
    pauseCount: 0,
    missed: 0,
    namedStar: null,
    specialStar: null,
    byType: {},
    mood: this.mood,
    pathArtwork: { version: 4, brush: 'guided-starlight', paths: [] }
  };
  if (this.mode === 'path') this.setupLightPathNight();
};

// ---------- 画星路：把一次游戏变成一幅可保存的个人作品 ----------

StarGame.prototype.setupLightPathNight = function () {
  var count = Math.max(4, Math.min(6, this.targetCatches || 5));
  var layout = [
    [0.20, 0.27], [0.76, 0.23], [0.42, 0.38],
    [0.70, 0.48], [0.27, 0.55], [0.55, 0.19]
  ];
  this.pathStars = [];
  this.pathIndex = 0;
  this.currentPath = null;
  this.guidedPointer = null;
  this.guidedHead = null;
  this.guidedVelocity = { x: 0, y: 0 };
  this.guidedDistance = 0;
  this.softAttempts = [];
  this.pathNextDelay = 0;
  this.pathIdle = 0;
  this.pathHintSent = false;
  var specialIndex = Math.min(count - 2, 2);
  for (var i = 0; i < count; i++) {
    var conf = this.pickStarType();
    var specialId = this.specialStar && i === specialIndex ? this.specialStar.id : '';
    var specialDef = specialId ? specialStars.getSpecialStar(specialId) : null;
    this.pathStars.push({
      type: conf.type,
      label: specialDef ? specialDef.name : conf.label,
      color: specialDef ? specialDef.color : conf.color,
      specialId: specialId,
      x: this.width * layout[i][0],
      y: this.height * layout[i][1],
      nx: layout[i][0],
      ny: layout[i][1],
      r: specialId ? 17 : 14,
      t: Math.random() * Math.PI * 2,
      rotation: Math.random() * Math.PI,
      state: i === 0 ? 'active' : 'waiting',
      route: null,
      travel: 0,
      travelFrom: 0,
      travelT: 0,
      travelDuration: specialId === 'slow' ? 1.9 : 1.25,
      drawX: 0,
      drawY: 0
    });
  }
  this.onEvent('pathReady', { index: 0, total: count });
};

StarGame.prototype.getActivePathStar = function () {
  return this.pathStars && this.pathStars[this.pathIndex] || null;
};

StarGame.prototype.beginLightPath = function (x, y) {
  if (this.finished || this.mode !== 'path' || this.phase !== 'play') return false;
  var star = this.getActivePathStar();
  if (!star || star.state !== 'active') return false;
  var distance = Math.sqrt(Math.pow(x - star.x, 2) + Math.pow(y - star.y, 2));
  if (distance > 58) {
    this.onEvent('pathStartHint', { x: star.x, y: star.y });
    return false;
  }
  this.pathIdle = 0;
  this.pathHintSent = false;
  this.currentPath = [{ x: star.x, y: star.y, t: this.clock, w: 1.12 }];
  this.guidedPointer = {
    x: Math.max(8, Math.min(this.width - 8, x)),
    y: Math.max(8, Math.min(this.height - 8, y))
  };
  this.guidedHead = { x: star.x, y: star.y };
  this.guidedVelocity = { x: 0, y: 0 };
  this.guidedDistance = 0;
  star.state = 'guided';
  star.drawX = star.x;
  star.drawY = star.y;
  this.onEvent('pathGuideStart', { index: this.pathIndex, total: this.pathStars.length });
  return true;
};

StarGame.prototype.extendLightPath = function (x, y) {
  if (!this.currentPath || this.mode !== 'path' || this.phase !== 'play') return;
  this.guidedPointer = {
    x: Math.max(8, Math.min(this.width - 8, x)),
    y: Math.max(8, Math.min(this.height - 8, y))
  };
};

StarGame.prototype.endLightPath = function () {
  if (!this.currentPath || this.mode !== 'path') return false;
  var path = this.currentPath;
  var star = this.getActivePathStar();
  if (!star) return false;
  // 抬手前把星星再向指尖轻轻靠近一次，避免快速划动时最后一小段被截断。
  if (this.guidedHead && this.guidedPointer) {
    this.guidedHead.x += (this.guidedPointer.x - this.guidedHead.x) * 0.34;
    this.guidedHead.y += (this.guidedPointer.y - this.guidedHead.y) * 0.34;
    var lastGuided = path[path.length - 1];
    var lastGap = Math.sqrt(Math.pow(this.guidedHead.x - lastGuided.x, 2) + Math.pow(this.guidedHead.y - lastGuided.y, 2));
    if (lastGap > 1.5) path.push({ x: this.guidedHead.x, y: this.guidedHead.y, t: this.clock, w: lastGuided.w || 1 });
  }
  this.currentPath = null;
  var last = path[path.length - 1];
  var boat = this.basket;
  var displacement = last ? Math.sqrt(Math.pow(last.x - star.x, 2) + Math.pow(last.y - star.y, 2)) : 0;
  if (path.length < 2 || Math.max(this.guidedDistance, displacement) < 18 || displacement < 14) {
    this.softAttempts.push({ points: path, t: 0, life: 1.5 });
    star.state = 'active';
    star.drawX = star.x;
    star.drawY = star.y;
    this.guidedPointer = null;
    this.guidedHead = null;
    this.guidedVelocity = { x: 0, y: 0 };
    this.onEvent('pathRetry', {});
    return false;
  }

  // 用户只需要给出情绪和方向；松手后星星沿当前惯性完成最后一段回家路。
  var destination = { x: boat.x, y: boat.y + 5 };
  var toBoatX = destination.x - last.x;
  var toBoatY = destination.y - last.y;
  var toBoatDistance = Math.sqrt(toBoatX * toBoatX + toBoatY * toBoatY) || 1;
  var velocityLength = Math.sqrt(this.guidedVelocity.x * this.guidedVelocity.x + this.guidedVelocity.y * this.guidedVelocity.y);
  var tangentX = velocityLength > 8 ? this.guidedVelocity.x / velocityLength : toBoatX / toBoatDistance;
  var tangentY = velocityLength > 8 ? this.guidedVelocity.y / velocityLength : toBoatY / toBoatDistance;
  var handLength = Math.min(toBoatDistance * 0.48, Math.max(46, velocityLength * 0.09));
  var sideSign = this.pathIndex % 2 === 0 ? 1 : -1;
  var controlX = last.x + tangentX * handLength - tangentY * sideSign * Math.min(54, toBoatDistance * 0.12);
  var controlY = last.y + tangentY * handLength + tangentX * sideSign * Math.min(54, toBoatDistance * 0.12);
  controlX = Math.max(16, Math.min(this.width - 16, controlX));
  controlY = Math.max(16, Math.min(this.height - 16, controlY));
  var previousWeight = last.w || 1;
  var continuationCount = Math.max(12, Math.min(24, Math.ceil(toBoatDistance / 22)));
  for (var step = 1; step <= continuationCount; step++) {
    var u = step / continuationCount;
    var inv = 1 - u;
    path.push({
      x: inv * inv * last.x + 2 * inv * u * controlX + u * u * destination.x,
      y: inv * inv * last.y + 2 * inv * u * controlY + u * u * destination.y,
      t: this.clock + u * 0.72,
      w: previousWeight * (1 - u * 0.24)
    });
  }
  star.route = this.simplifyPath(path, 5);
  star.state = 'travelling';
  star.travelFrom = Math.max(0.04, Math.min(0.86, this.routeProgressAtPoint(star.route, last)));
  star.travel = star.travelFrom;
  star.travelT = 0;
  star.travelDuration = Math.max(0.58, Math.min(1.08, toBoatDistance / 480 + 0.46));
  star.drawX = last.x;
  star.drawY = last.y;
  this.guidedPointer = null;
  this.guidedHead = null;
  this.guidedVelocity = { x: 0, y: 0 };
  this.onEvent('pathTravel', { index: this.pathIndex, total: this.pathStars.length });
  return true;
};

StarGame.prototype.routeLength = function (points) {
  var total = 0;
  for (var i = 1; i < (points || []).length; i++) {
    total += Math.sqrt(Math.pow(points[i].x - points[i - 1].x, 2) + Math.pow(points[i].y - points[i - 1].y, 2));
  }
  return total;
};

StarGame.prototype.routeProgressAtPoint = function (points, point) {
  if (!points || points.length < 2 || !point) return 0;
  var nearestIndex = 0;
  var nearestDistance = Infinity;
  for (var i = 0; i < points.length; i++) {
    var distance = Math.sqrt(Math.pow(points[i].x - point.x, 2) + Math.pow(points[i].y - point.y, 2));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  }
  var walked = 0;
  for (i = 1; i <= nearestIndex; i++) {
    walked += Math.sqrt(Math.pow(points[i].x - points[i - 1].x, 2) + Math.pow(points[i].y - points[i - 1].y, 2));
  }
  return walked / Math.max(1, this.routeLength(points));
};

StarGame.prototype.simplifyPath = function (points, minDistance) {
  var result = [];
  for (var i = 0; i < points.length; i++) {
    var last = result[result.length - 1];
    if (!last || i === points.length - 1 || Math.sqrt(Math.pow(points[i].x - last.x, 2) + Math.pow(points[i].y - last.y, 2)) >= minDistance) {
      result.push({ x: points[i].x, y: points[i].y, t: points[i].t, w: points[i].w === undefined ? 1 : points[i].w });
    }
  }
  return result;
};

StarGame.prototype.updateLightPath = function (dt) {
  var i;
  for (i = this.softAttempts.length - 1; i >= 0; i--) {
    this.softAttempts[i].t += dt;
    if (this.softAttempts[i].t >= this.softAttempts[i].life) this.softAttempts.splice(i, 1);
  }
  var star = this.getActivePathStar();
  if (!star) return;
  star.t += dt;
  if (star.state === 'active') {
    this.pathIdle += dt;
    if (this.pathIdle > 7 && !this.pathHintSent) {
      this.pathHintSent = true;
      this.onEvent('pathIdleHint', {});
    }
    return;
  }
  if (star.state === 'guided') {
    this.pathIdle = 0;
    if (!this.guidedHead || !this.guidedPointer || !this.currentPath) return;
    var dx = this.guidedPointer.x - this.guidedHead.x;
    var dy = this.guidedPointer.y - this.guidedHead.y;
    if (this.reducedMotion) {
      this.guidedVelocity.x = 0;
      this.guidedVelocity.y = 0;
      this.guidedHead.x = this.guidedPointer.x;
      this.guidedHead.y = this.guidedPointer.y;
    } else {
      // 阻尼弹簧：星星略晚于手指抵达，快速转弯时会保留一小段惯性，而不会抖成折线。
      this.guidedVelocity.x += dx * 34 * dt;
      this.guidedVelocity.y += dy * 34 * dt;
      var damping = Math.exp(-7.8 * dt);
      this.guidedVelocity.x *= damping;
      this.guidedVelocity.y *= damping;
      this.guidedHead.x += this.guidedVelocity.x * dt;
      this.guidedHead.y += this.guidedVelocity.y * dt;
    }
    this.guidedHead.x = Math.max(8, Math.min(this.width - 8, this.guidedHead.x));
    this.guidedHead.y = Math.max(8, Math.min(this.height - 8, this.guidedHead.y));
    star.drawX = this.guidedHead.x;
    star.drawY = this.guidedHead.y;
    var currentLast = this.currentPath[this.currentPath.length - 1];
    var sampleDistance = Math.sqrt(Math.pow(this.guidedHead.x - currentLast.x, 2) + Math.pow(this.guidedHead.y - currentLast.y, 2));
    if (sampleDistance >= 3 && this.currentPath.length < 180) {
      var guideSpeed = Math.sqrt(this.guidedVelocity.x * this.guidedVelocity.x + this.guidedVelocity.y * this.guidedVelocity.y);
      var speedMix = Math.max(0, Math.min(1, guideSpeed / 720));
      var targetWeight = 1.34 - speedMix * 0.46;
      var lastWeight = currentLast.w === undefined ? 1 : currentLast.w;
      this.currentPath.push({
        x: this.guidedHead.x,
        y: this.guidedHead.y,
        t: this.clock,
        w: lastWeight * 0.62 + targetWeight * 0.38
      });
      this.guidedDistance += sampleDistance;
    }
    return;
  }
  if (star.state === 'travelling') {
    star.travelT = Math.min(1, (star.travelT || 0) + dt / star.travelDuration);
    star.travel = star.travelFrom + (1 - star.travelFrom) * this.easeInOut(star.travelT);
    var pos = this.pointOnRoute(star.route, star.travel);
    star.drawX = pos.x;
    star.drawY = pos.y;
    if (star.travelT >= 1) this.completeLightPath(star);
    return;
  }
  if (star.state === 'complete' && this.pathNextDelay > 0) {
    this.pathNextDelay -= dt;
    if (this.pathNextDelay <= 0 && this.pathIndex < this.pathStars.length - 1) {
      this.pathIndex += 1;
      this.pathStars[this.pathIndex].state = 'active';
      this.pathIdle = 0;
      this.pathHintSent = false;
      this.onEvent('pathReady', { index: this.pathIndex, total: this.pathStars.length });
    }
  }
};

StarGame.prototype.pointOnRoute = function (points, progress) {
  if (!points || points.length < 2) return points && points[0] || { x: 0, y: 0 };
  var lengths = [], total = 0, i;
  for (i = 1; i < points.length; i++) {
    var len = Math.sqrt(Math.pow(points[i].x - points[i - 1].x, 2) + Math.pow(points[i].y - points[i - 1].y, 2));
    lengths.push(len);
    total += len;
  }
  var wanted = total * progress;
  for (i = 0; i < lengths.length; i++) {
    if (wanted <= lengths[i] || i === lengths.length - 1) {
      var p = lengths[i] ? wanted / lengths[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * p,
        y: points[i].y + (points[i + 1].y - points[i].y) * p
      };
    }
    wanted -= lengths[i];
  }
  return points[points.length - 1];
};

StarGame.prototype.completeLightPath = function (star) {
  if (!star || star.state === 'complete') return;
  star.state = 'complete';
  this.stats.caught += 1;
  this.stats.byType[star.type] = (this.stats.byType[star.type] || 0) + 1;
  this.lastCatch = { type: star.type, color: star.color, at: this.clock };
  this.boatPulse = 0.75;
  this.makeSparkles(this.basket.x, this.basket.y, star.color);
  var normalized = star.route.map(function (p) {
    var startTime = star.route[0] && typeof star.route[0].t === 'number' ? star.route[0].t : 0;
    return {
      x: +(p.x / this.width).toFixed(4),
      y: +(p.y / this.height).toFixed(4),
      w: +(p.w === undefined ? 1 : p.w).toFixed(3),
      t: +(Math.max(0, (p.t === undefined ? startTime : p.t) - startTime)).toFixed(3)
    };
  }, this);
  this.stats.pathArtwork.paths.push({
    color: star.color,
    type: star.type,
    specialId: star.specialId || '',
    points: normalized
  });
  var specialPayload = null;
  if (star.specialId) {
    var def = specialStars.getSpecialStar(star.specialId);
    specialPayload = {
      id: def.id,
      name: def.name,
      color: def.color,
      line: (this.specialStar && this.specialStar.line) || def.lines[0],
      isRepeat: !!(this.specialStar && this.specialStar.isRepeat)
    };
    this.specialCaught = true;
    this.stats.specialStar = specialPayload;
  }
  this.onEvent('catch', {
    type: star.type,
    label: star.label,
    color: star.color,
    streak: this.stats.caught,
    special: specialPayload,
    pathComplete: true
  });
  if (this.stats.caught >= this.pathStars.length) {
    this.onEvent('artworkComplete', { artwork: this.stats.pathArtwork });
  } else {
    this.pathNextDelay = 0.7;
  }
};

// 用户手指移动月亮船（x 为屏幕横坐标）
// 月亮船不瞬移，而是漂浮式地轻轻追上手指（更符合夜空的气质）
StarGame.prototype.setBasketX = function (x) {
  var half = this.basket.w / 2;
  this.basketTargetX = Math.max(half + 6, Math.min(this.width - half - 6, x));
};

// 月亮船向目标位置漂浮（每帧缓动）
StarGame.prototype.easeBasket = function (dt) {
  if (this.basketTargetX === undefined) this.basketTargetX = this.basket.x;
  this.basket.x += (this.basketTargetX - this.basket.x) * Math.min(1, dt * 9);
};

// 玩家点「先到这里」时提前结束
StarGame.prototype.finishNow = function () {
  if (!this.finished) {
    this.finished = true;
    this.onEvent('finish', this.stats);
  }
};

// 三颗星渐静流程：暂停下落，把选择与安放交给页面层。
StarGame.prototype.pauseForStarChoice = function () {
  if (this.finished) return;
  this.phase = 'choosing';
  this.spawnTimer = 999;
};

// 接住特别星时，短暂停住夜空，让页面层完成相遇介绍。
StarGame.prototype.pauseForSpecial = function () {
  if (this.finished) return;
  this.phase = 'special';
};

StarGame.prototype.resumeFromSpecial = function () {
  if (this.finished || this.phase !== 'special') return;
  this.phase = 'play';
  this.spawnTimer = Math.max(this.spawnTimer, 0.55);
};

// 安放完成后，以三轮呼吸收束这一晚。
StarGame.prototype.startClosingBreath = function (rounds) {
  if (this.finished) return;
  this.closingBreath = true;
  // 这是流程本身的收尾，不算用户主动按下的「停一下」。
  this.startBreathSession(false, rounds || 3);
};

// 三轮呼吸完成后的作品揭幕：五颗光从月亮船沿真实笔迹依次回到天空，
// 前一颗已经开成花火时，后一颗仍在升空。它只播放一次，不参与计分。
StarGame.prototype.startArtworkFinale = function () {
  if (this.finished || this.mode !== 'path' || !this.stats.pathArtwork.paths.length) return false;
  // 正常流程会在自动命名后写入专属种子；这里再做一次纯引擎兜底，保证开发入口也能稳定重播。
  lightBrush.ensureFireworkIdentity(this.stats.pathArtwork, {
    timestamp: Date.now(),
    randomSalt: Date.now() + '-' + Math.random()
  }, []);
  this.phase = 'finale';
  // 让完整绽放仍有呼吸感，但去掉末尾近两秒“画面已经结束、流程还没走”的空等。
  this.artworkFinale = { t: 0, duration: 5.00, bloomStart: 0.90 };
  this.artworkFinaleBloomSent = false;
  this.onEvent('artworkFinaleStart', {});
  return true;
};

StarGame.prototype.updateArtworkFinale = function (dt) {
  var finale = this.artworkFinale;
  if (!finale) return;
  finale.t += dt;
  if (!this.artworkFinaleBloomSent && finale.t >= finale.bloomStart) {
    this.artworkFinaleBloomSent = true;
    this.onEvent('artworkFinaleBloom', {});
  }
  if (finale.t >= finale.duration) {
    finale.t = finale.duration;
    this.phase = 'finaleHold';
    this.onEvent('artworkFinaleEnd', {});
  }
};

// 画布尺寸变化时重算布局（例如转屏）
StarGame.prototype.resize = function (w, h) {
  this.width = w;
  this.height = h;
  this.basket.y = h - 96;
  this.basket.x = Math.max(this.basket.w / 2, Math.min(w - this.basket.w / 2, this.basket.x));
  this.basketTargetX = this.basket.x;
  if (this.mode === 'path' && this.pathStars) {
    for (var i = 0; i < this.pathStars.length; i++) {
      this.pathStars[i].x = w * this.pathStars[i].nx;
      this.pathStars[i].y = h * this.pathStars[i].ny;
    }
  }
  this.makeBackgroundStars();
};

// 每一帧推进游戏（dt 为距上一帧的秒数）
StarGame.prototype.update = function (dt) {
  if (this.finished) return;

  this.clock += dt;
  // 纯呼吸模式的总时长：连呼吸中也在走（这是"三分钟"的墙钟时间）
  if (this.mode === 'breathe') {
    this.modeClock = (this.modeClock || 0) + dt;
  }

  // 呼吸结束后的一小段余光，慢慢淡去（两种模式共用）
  if (this.afterglow) {
    this.afterglow.t += dt;
    if (this.afterglow.t > 1.8) this.afterglow = null;
  }

  if (this.phase === 'breathing') {
    this.updateBreathing(dt);
    return; // 呼吸时星星和时间都暂停，慢慢来
  }

  if (this.phase === 'naming') {
    this.updateNaming(dt);
    return; // 命名时同样暂停，等用户慢慢选
  }

  if (this.phase === 'finale') {
    this.updateEffects(dt);
    this.updateArtworkFinale(dt);
    return;
  }

  if (this.phase === 'finaleHold') {
    this.updateEffects(dt);
    return;
  }

  if (this.phase === 'choosing') {
    this.updateEffects(dt);
    return; // 挑选、安放星星时，夜空仍有微光，但不再落下新星
  }

  if (this.phase === 'special') {
    this.updateEffects(dt);
    return; // 相遇卡片出现时，其他星星也安静等一会儿
  }

  if (this.mode === 'path') {
    this.updateLightPath(dt);
    this.updateEffects(dt);
    return;
  }

  // ---------- 纯呼吸模式：没有星星，只有一组组连续的呼吸 ----------
  if (this.mode === 'breathe') {
    var remainingB = this.duration - this.modeClock;
    var pat = BREATH_PATTERNS[this.moodConf.breathPattern || 'gentle'];
    var cycle = pat.inhale + pat.hold + pat.exhale; // 一轮呼吸的时长
    var fadeTime = 2.1; // 入场 + 散场

    // 连一轮都来不及了，就安静地待一会儿，把这三分钟待满再结束
    if (remainingB <= 0) {
      this.finished = true;
      this.onEvent('tick', { remaining: 0 });
      this.onEvent('finish', this.stats);
      return;
    }

    var remB = Math.max(0, Math.ceil(remainingB));
    if (remB !== this.lastTickRemaining) {
      this.lastTickRemaining = remB;
      this.onEvent('tick', { remaining: remB });
    }

    // 两组之间歇一小口气；剩余时间还够一轮，才开始下一组
    this.restTimer = (this.restTimer || 0) + dt;
    if (this.restTimer >= 2.5) {
      var roundsLeft = Math.floor((remainingB - fadeTime) / cycle);
      if (roundsLeft >= 1) {
        this.restTimer = 0;
        // 最后一组按剩余时间自适应轮数：把三分钟填满
        var rounds = Math.min(BREATH_ROUNDS, roundsLeft);
        this.startBreathSession(false, rounds);
        this.breathSessions = (this.breathSessions || 0) + 1;
        this.breathRoundsTotal = (this.breathRoundsTotal || 0) + rounds;
      }
    }
    return;
  }

  this.elapsed += dt;
  this.easeBasket(dt); // 月亮船漂浮跟随手指

  // 剩余秒数变化时通知界面（用于顶部小字显示）
  var remaining = Math.max(0, Math.ceil(this.duration - this.elapsed));
  if (remaining !== this.lastTickRemaining) {
    this.lastTickRemaining = remaining;
    this.onEvent('tick', { remaining: remaining });
  }

    // 时间到，温柔地结束（最后接住的星会变成今晚的签星）
    if (this.elapsed >= this.duration) {
      this.finished = true;
      this.onEvent('finish', this.stats);
      return;
    }

  // 生成新的星星
  this.spawnTimer -= dt;
  if (this.spawnTimer <= 0) {
    this.spawnStar();
    this.spawnTimer = rand(1.1, 1.8) / this.moodConf.spawn;
  }

  // 焦虑心情保底：如果到 18 秒还没有出现过呼吸星，补一颗
  // （对应设计文档「焦虑 = 加入呼吸练习」）
  if (!this.targetCatches && this.moodConf.forceBreath && !this.forcedBreathDone &&
      this.elapsed > 18 && this.stats.breathCount === 0 && this.lastBreathAt < 0 &&
      this.duration - this.elapsed > 14) {
    this.forcedBreathDone = true;
    this.spawnBreathStar();
  }

  // 无名星：每局一次，接住后进入「给情绪命名」
  //（避开呼吸星同屏，也留足命名的从容时间）
  if (!this.targetCatches && !this.nameStarSpawned && this.elapsed >= this.nameStarAt &&
      this.duration - this.elapsed > 20 && !this.hasStarOfType('breath')) {
    this.spawnNameStar();
  }

  // 移动星星 + 判断接住 / 落地
  var i, star;
  for (i = this.stars.length - 1; i >= 0; i--) {
    star = this.stars[i];
    star.t += dt;
    // 回声星第一次碰船后会弹起，再自然落回来。
    if (star.specialId === 'echo' && star.echoed && star.speed < 64) {
      star.speed += 112 * dt;
    }
    star.y += star.speed * dt;
    star.x += Math.sin(star.t * star.swayFreq + star.swayPhase) * star.swayAmp * dt;
    star.rotation += star.spinSpeed * dt;

    // —— 接住判定：星星碰到月亮船（判定带放宽一些，手感更温柔） ——
    var b = this.basket;
    var nearBoat = star.y + star.r >= b.y - 12 && star.y - star.r <= b.y + b.h + 14;
    var guidePadding = star.guide ? 36 : 0;
    var overBoat = Math.abs(star.x - b.x) <= b.w / 2 + star.r * 0.5 + guidePadding;
    if (nearBoat && overBoat) {
      if (star.specialId === 'echo' && !star.echoed) {
        star.echoed = true;
        star.y = b.y - star.r - 28;
        star.speed = -72;
        this.makeSparkles(star.x, b.y - 8, star.color);
        this.onEvent('specialEcho', { id: 'echo' });
        continue;
      }
      this.stars.splice(i, 1);
      if (star.type === 'breath') {
        this.stats.breathCount += 1;
        this.startBreathing();
      } else if (star.type === 'name') {
        this.startNaming();
      } else {
        this.stats.caught += 1;
        this.stats.byType[star.type] = (this.stats.byType[star.type] || 0) + 1;
        // 连击：12 秒内接着接，和弦就往上爬一级
        this.catchStreak = (this.elapsed - this.lastCatchAt < 12) ? this.catchStreak + 1 : 1;
        this.lastCatchAt = this.elapsed;
        this.makeSparkles(star.x, star.y, star.color);
        // 一颗小光点从星星飞进船里，把光"存"进去
        this.motes.push({ x: star.x, y: star.y, t: 0, color: star.color });
        // 最后一颗被接住的星：它就是今晚的签星
        this.lastCatch = { type: star.type, color: star.color, at: this.elapsed };
        var specialPayload = null;
        if (star.specialId) {
          var specialDef = specialStars.getSpecialStar(star.specialId);
          specialPayload = {
            id: specialDef.id,
            name: specialDef.name,
            color: specialDef.color,
            line: (this.specialStar && this.specialStar.line) || specialDef.lines[0],
            isRepeat: !!(this.specialStar && this.specialStar.isRepeat)
          };
          this.specialCaught = true;
          this.stats.specialStar = specialPayload;
        }
        this.onEvent('catch', {
          type: star.type,
          label: star.label,
          color: star.color,
          streak: this.catchStreak,
          special: specialPayload
        });
        // 页面可能在第三颗星的 catch 回调里切入选择仪式。
        // 立即结束这一帧，避免同屏的其他星又被判定为第四颗。
        if (this.phase === 'choosing' || this.phase === 'special') {
          this.stars = [];
          this.updateEffects(dt);
          return;
        }
      }
      continue;
    }

    // —— 落到画面外：不算失败，化作地面上的一小团光 ——
    if (star.y - star.r > this.height + 8) {
      this.stars.splice(i, 1);
      if (star.type === 'name') {
        // 无名星溜走了：如果时间还够，稍后再给它一次机会
        this.groundGlows.push({ x: star.x, y: this.height - 16, t: 0, color: star.color });
        if (this.duration - this.elapsed > 20) {
          this.nameStarSpawned = false;
          this.nameStarAt = this.elapsed + rand(8, 14);
        }
      } else if (star.specialId) {
        // 特殊星不会因一次没接住而消失，过一会儿会从夜色里再回来。
        this.groundGlows.push({ x: star.x, y: this.height - 16, t: 0, color: star.color });
        this.specialSpawned = false;
        this.specialAtCatch = this.stats.caught;
        this.spawnTimer = Math.min(this.spawnTimer, 0.9);
        this.onEvent('specialReturn', { id: star.specialId });
      } else if (star.type !== 'breath') {
        this.stats.missed += 1;
        this.catchStreak = 0; // 星星落空了，和弦轻轻落回起点
        this.missTimes.push(this.elapsed);
        this.groundGlows.push({ x: star.x, y: this.height - 16, t: 0, color: star.color });
        this.onEvent('miss', { type: star.type, label: star.label });
      }
    }
  }

  // 夜空的低语：短时间内错过太多，或过了很久还一次呼吸都没有，
  // 就轻轻提出「可以停一下」。每次低语之间至少间隔 25 秒，绝不打扰。
  var recentMisses = 0, m;
  for (m = 0; m < this.missTimes.length; m++) {
    if (this.elapsed - this.missTimes[m] < 8) recentMisses++;
  }
  var neverRested = this.stats.breathCount === 0 && this.stats.pauseCount === 0;
  if (!this.targetCatches && this.elapsed - this.lastPauseOfferAt > 25 && this.duration - this.elapsed > 15 &&
      (recentMisses >= 3 || (this.elapsed > 32 && neverRested))) {
    this.lastPauseOfferAt = this.elapsed;
    this.onEvent('offerPause', {});
  }

  this.updateEffects(dt);
};

// ---------- 内部逻辑 ----------

StarGame.prototype.makeBackgroundStars = function () {
  // 夜空里一直安静眨眼的小星星（纯装饰）
  this.bgStars = [];
  var n = Math.max(9, Math.round(this.width * this.height / 15000));
  for (var i = 0; i < n; i++) {
    this.bgStars.push({
      x: Math.random() * this.width,
      y: Math.random() * this.height * 0.92,
      r: rand(0.5, 1.6),
      phase: Math.random() * Math.PI * 2,
      speed: rand(0.4, 1.2)
    });
  }
};

StarGame.prototype.spawnStar = function () {
  // 第一颗星从船的正上方缓缓落下，让第一次成功来自体验本身，而不是更多说明。
  if (this.firstStarPending) {
    this.firstStarPending = false;
    var guideConf = this.pickStarType();
    this.stars.push({
      type: guideConf.type,
      color: guideConf.color,
      label: guideConf.label,
      x: this.basket.x,
      y: this.height * 0.31,
      r: 13,
      speed: 118,
      t: 0,
      swayAmp: 2,
      swayFreq: 0.35,
      swayPhase: 0,
      rotation: 0,
      spinSpeed: 0.12,
      guide: true
    });
    return;
  }

  // 特别星在路上时，不再叠加普通星，避免它还没抵达就提前结束今晚。
  if (this.specialSpawned && !this.specialCaught) return;

  // 每晚一颗特别星：在玩家已经熟悉接星手感后再出现。
  if (this.specialStar && !this.specialSpawned && !this.specialCaught &&
      this.stats.caught >= this.specialAtCatch && !this.hasSpecialStar()) {
    this.spawnSpecialStar();
    return;
  }

  // 三颗星渐静流程：前三颗都靠近月亮船缓慢落下，减少追逐和挫败。
  if (this.targetCatches && this.stats.caught < this.targetCatches) {
    var calmConf = this.pickStarType();
    this.stars.push({
      type: calmConf.type,
      color: calmConf.color,
      label: calmConf.label,
      x: this.basket.x + rand(-28, 28),
      y: -24,
      r: rand(11, 14),
      speed: rand(58, 68),
      t: 0,
      swayAmp: rand(2, 5),
      swayFreq: rand(0.3, 0.55),
      swayPhase: Math.random() * Math.PI * 2,
      rotation: Math.random() * Math.PI,
      spinSpeed: rand(-0.22, 0.22),
      guide: true
    });
    return;
  }

  // 呼吸星：开局 10 秒后、离上一颗 18 秒以上、按心情概率小概率出现
  // 且游戏只剩 14 秒内不再出现，避免呼吸被打断
  if (this.elapsed > 10 && this.elapsed - this.lastBreathAt > 18 && this.duration - this.elapsed > 14) {
    if (Math.random() < this.moodConf.breath) {
      this.spawnBreathStar();
      return;
    }
  }

  var conf = this.pickStarType();
  this.stars.push({
    type: conf.type,
    color: conf.color,
    label: conf.label,
    x: rand(24, this.width - 24),
    y: -24,
    r: rand(9, 13),
    speed: rand(48, 68) * this.moodConf.speed,
    t: 0,
    swayAmp: rand(8, 20),      // 左右轻轻飘
    swayFreq: rand(0.4, 0.9),
    swayPhase: Math.random() * Math.PI * 2,
    rotation: Math.random() * Math.PI,
    spinSpeed: rand(-0.5, 0.5)
  });
};

StarGame.prototype.hasSpecialStar = function () {
  for (var i = 0; i < this.stars.length; i++) {
    if (this.stars[i].specialId) return true;
  }
  return false;
};

StarGame.prototype.spawnSpecialStar = function () {
  var def = specialStars.getSpecialStar(this.specialStar.id);
  var base = this.pickStarType();
  this.specialSpawned = true;
  this.stars = [];
  this.stars.push({
    type: base.type,
    color: def.color,
    label: def.name,
    specialId: def.id,
    x: this.basket.x + rand(-18, 18),
    y: this.height * 0.18,
    r: def.id === 'whisper' ? 17 : 16,
    speed: def.id === 'slow' ? 38 : 60,
    t: 0,
    swayAmp: def.id === 'slow' ? 4 : 7,
    swayFreq: def.id === 'slow' ? 0.28 : 0.45,
    swayPhase: Math.random() * Math.PI * 2,
    rotation: Math.random() * Math.PI,
    spinSpeed: def.id === 'slow' ? 0.08 : 0.18,
    guide: true,
    echoed: false
  });
  this.onEvent('specialAppear', { id: def.id, name: def.name });
};

// 生成一颗特殊的呼吸星（金色大星星，接住后进入呼吸引导）
StarGame.prototype.spawnBreathStar = function () {
  this.lastBreathAt = this.elapsed;
  this.stars.push({
    type: 'breath',
    color: '#FFE9C4',
    label: '呼吸',
    x: rand(60, this.width - 60),
    y: -24,
    r: 20,
    speed: rand(48, 68) * this.moodConf.speed * 0.8,
    t: 0,
    swayAmp: rand(6, 14),
    swayFreq: rand(0.3, 0.6),
    swayPhase: Math.random() * Math.PI * 2,
    rotation: Math.random() * Math.PI,
    spinSpeed: 0.2
  });
};

StarGame.prototype.hasStarOfType = function (type) {
  for (var i = 0; i < this.stars.length; i++) {
    if (this.stars[i].type === type) return true;
  }
  return false;
};

// ---------- 给情绪命名（对应设计文档 §三.2） ----------

// 无名星：淡淡的银紫色，比普通星稍大，落下得从容一些
StarGame.prototype.spawnNameStar = function () {
  this.nameStarSpawned = true;
  this.stars.push({
    type: 'name',
    color: '#EDE9FF',
    label: '无名',
    x: rand(50, this.width - 50),
    y: -24,
    r: 15,
    speed: rand(48, 68) * this.moodConf.speed * 0.85,
    t: 0,
    swayAmp: rand(8, 16),
    swayFreq: rand(0.3, 0.6),
    swayPhase: Math.random() * Math.PI * 2,
    rotation: Math.random() * Math.PI,
    spinSpeed: 0.15
  });
};

// 接住无名星：暂停游戏，等用户为它选一个名字
StarGame.prototype.startNaming = function () {
  this.phase = 'naming';
  this.name = { fade: 0, answered: false };
  this.onEvent('nameStart', {});
};

// 用户选好名字后由页面调用（label 为中文感受词，如「孤单」）
StarGame.prototype.setNameAnswer = function (label) {
  if (this.phase !== 'naming' || !this.name || this.name.answered) return;
  this.name.answered = true;
  this.stats.namedStar = label;
  this.onEvent('nameDone', { name: label });
};

StarGame.prototype.updateNaming = function (dt) {
  var n = this.name;
  // 未回答：幕布淡入后停在那里，慢慢等
  if (!n.answered) {
    n.fade = Math.min(1, n.fade + dt / 0.7);
    return;
  }
  // 已回答：星星轻轻散去，回到游戏
  n.fade = Math.max(0, n.fade - dt / 1.8);
  if (n.fade <= 0) {
    this.phase = 'play';
    this.name = null;
    this.afterglow = { t: 0, x: this.width / 2, y: this.height * 0.40 };
    this.onEvent('nameEnd', {});
  }
};

StarGame.prototype.makeSparkles = function (x, y, color) {
  for (var i = 0; i < 14; i++) {
    this.sparkles.push({
      x: x, y: y, color: color,
      vx: rand(-70, 70), vy: rand(-110, -20),
      t: 0, life: rand(0.5, 0.9), r: rand(1, 2.6)
    });
  }
};

StarGame.prototype.updateEffects = function (dt) {
  var i;
  for (i = this.sparkles.length - 1; i >= 0; i--) {
    var s = this.sparkles[i];
    s.t += dt;
    if (s.t > s.life) { this.sparkles.splice(i, 1); continue; }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 60 * dt;
  }
  for (i = this.groundGlows.length - 1; i >= 0; i--) {
    var g = this.groundGlows[i];
    g.t += dt;
    if (g.t > 4.5) this.groundGlows.splice(i, 1);
  }
  // 小光点飞向月亮船；到达时船体亮一下
  for (i = this.motes.length - 1; i >= 0; i--) {
    var mo = this.motes[i];
    mo.t += dt / 0.6;
    if (mo.t >= 1) {
      this.motes.splice(i, 1);
      this.boatPulse = Math.min(1, this.boatPulse + 0.5);
      continue;
    }
    mo.x += (this.basket.x - mo.x) * Math.min(1, dt * 8);
    mo.y += (this.basket.y + 10 - mo.y) * Math.min(1, dt * 8);
  }
  // 船体的一次性亮起慢慢退去
  this.boatPulse *= Math.exp(-dt * 1.1);
};

// ---------- 呼吸引导 ----------

StarGame.prototype.startBreathing = function () {
  this.startBreathSession(false);
};

// 手动「停一下」：不等呼吸星，随时进入一轮呼吸
// （对应设计文档玩法 2：星星太多时，可以按下「暂停」）
StarGame.prototype.startBreathingPause = function () {
  if (this.finished || this.phase === 'breathing') return;
  this.startBreathSession(true);
};

StarGame.prototype.startBreathSession = function (manual, rounds) {
  this.phase = 'breathing';
  this.breathPattern = BREATH_PATTERNS[this.moodConf.breathPattern || 'gentle'];
  // settle：幕布慢慢亮起的入场 / dissolve：结束时慢慢散去的离场，避免生硬切换
  // rounds：这一组的轮数（纯呼吸模式的最后一组会按剩余时间自适应）
  this.breath = { round: 1, phase: 'settle', t: 0, manual: manual, rounds: rounds || BREATH_ROUNDS };
  this.breathFade = 0;

  // 生成环绕在星星周围的小光点：吸气时聚拢，呼气时散开
  this.breathParticles = [];
  for (var i = 0; i < 26; i++) {
    this.breathParticles.push({
      angle: Math.random() * Math.PI * 2,
      p: 0.2 + Math.random() * 0.6,   // 0 = 靠近星星, 1 = 散在远处
      size: 1 + Math.random() * 1.8,
      wobble: 0
    });
  }
  this.breathRipples = [{ t: 0 }];

  this.onEvent('breathStart', { manual: manual, pattern: this.breathPattern.name, rounds: this.breath.rounds });
};

StarGame.prototype.updateBreathing = function (dt) {
  var b = this.breath;
  var p = this.breathPattern;
  b.t += dt;
  var i;

  // 幕布淡入（settle）/ 淡出（dissolve），其余时候保持
  if (b.phase === 'settle') {
    this.breathFade = Math.min(1, this.breathFade + dt / 0.9);
  } else if (b.phase === 'dissolve') {
    this.breathFade = Math.max(0, this.breathFade - dt / 1.2);
  } else {
    this.breathFade = 1;
  }

  // 涟漪扩散、光点跟随呼吸收放
  for (i = 0; i < this.breathRipples.length; i++) this.breathRipples[i].t += dt;
  for (i = 0; i < this.breathParticles.length; i++) {
    var pt = this.breathParticles[i];
    if (b.phase === 'inhale') pt.p = Math.max(0, pt.p - dt / p.inhale);
    else if (b.phase === 'exhale') pt.p = Math.min(1, pt.p + dt / p.exhale);
    pt.wobble = Math.sin(this.clock * 1.5 + pt.angle * 3) * 4;
  }

  var dur;
  if (b.phase === 'settle') dur = 0.9;
  else if (b.phase === 'dissolve') dur = 1.2;
  else dur = b.phase === 'inhale' ? p.inhale : (b.phase === 'hold' ? p.hold : p.exhale);

  if (b.t >= dur) {
    b.t = 0;
    if (b.phase === 'settle') {
      b.phase = 'inhale';
      this.onEvent('breathPhase', { phase: 'inhale', round: b.round });
    } else if (b.phase === 'inhale') {
      b.phase = 'hold';
      this.onEvent('breathPhase', { phase: b.phase, round: b.round });
    } else if (b.phase === 'hold') {
      b.phase = 'exhale';
      this.onEvent('breathPhase', { phase: b.phase, round: b.round });
    } else if (b.phase === 'exhale') {
      // 一轮呼吸结束
      if (b.round >= (b.rounds || BREATH_ROUNDS)) {
        b.phase = 'dissolve'; // 这一组完成，温柔地散去
      } else {
        b.round += 1;
        b.phase = 'inhale';
        this.breathRipples.push({ t: 0 }); // 新一轮吸气，再荡开一圈涟漪
        this.onEvent('breathPhase', { phase: 'inhale', round: b.round });
      }
    } else if (b.phase === 'dissolve') {
      // 整段呼吸真正结束
      this.phase = 'play';
      if (this.closingBreath) {
        this.stats.breathCount += 1;
        this.closingBreath = false;
      }
      if (b.manual) this.stats.pauseCount += 1;
      this.breath = null;
      this.afterglow = { t: 0, x: this.width / 2, y: this.height * 0.40 };
      this.onEvent('breathEnd', {});
      return;
    }
  }
};

// ---------- 绘制 ----------

StarGame.prototype.draw = function (ctx) {
  this.drawBackground(ctx);
  if (this.mode === 'path') {
    this.drawLightArtwork(ctx);
    this.drawSparkles(ctx);
    this.drawBoat(ctx);
    if (this.phase === 'breathing') this.drawBreathing(ctx);
    if ((this.phase === 'finale' || this.phase === 'finaleHold') && this.artworkFinale) this.drawArtworkFinale(ctx);
    if (this.afterglow) this.drawAfterglow(ctx);
    return;
  }
  this.drawGroundGlows(ctx);
  this.drawStars(ctx);
  this.drawSparkles(ctx);
  this.drawMotes(ctx);
  if (this.mode !== 'breathe') {
    this.drawBoat(ctx); // 纯呼吸模式里没有船
  }

  if (this.phase === 'breathing') {
    this.drawBreathing(ctx);
  }
  if (this.phase === 'naming') {
    this.drawNaming(ctx);
  }
  if (this.afterglow) {
    this.drawAfterglow(ctx);
  }
};

StarGame.prototype.drawRouteStroke = function (ctx, points, color, alpha, width, offsetX) {
  lightBrush.strokeCurve(ctx, points, color, alpha, width, offsetX || 0, 0);
};

StarGame.prototype.drawLightArtwork = function (ctx) {
  var i, star, path;
  ctx.save();

  // 花火开始后，实时绘制笔刷退场，换成成品专用的细月光丝带。
  // 路径坐标不变，只柔化采样、收细光晕并在交叉处留出穿织暗缝。
  if ((this.phase === 'finale' || this.phase === 'finaleHold') && this.artworkFinale &&
      this.artworkFinale.t >= this.artworkFinale.bloomStart) {
    var finalLineProgress = Math.max(0, Math.min(1,
      (this.artworkFinale.t - this.artworkFinale.bloomStart) / 1.15));
    lightBrush.drawFinalArtworkPaths(ctx, this.stats.pathArtwork, 0, 0, this.width, this.height, {
      mapping: 'normalized',
      progress: finalLineProgress,
      startDust: false
    });
    ctx.restore();
    return;
  }

  // 已完成的每一道光都会永久留在今晚的画里。
  for (i = 0; i < this.pathStars.length; i++) {
    star = this.pathStars[i];
    if (!star.route) continue;
    path = star.route;
    lightBrush.drawMoonlightPath(ctx, path, {
      color: star.color,
      width: 2.25,
      glowWidth: 12,
      specialId: star.specialId,
      endDust: star.state === 'complete'
    });

    // 星星沿着路径前进时，只点亮它已经走过的部分。
    if (star.state === 'travelling') {
      var travelledCount = Math.max(2, Math.ceil((path.length - 1) * star.travel) + 1);
      this.drawRouteStroke(ctx, path.slice(0, travelledCount), '#FFF3CE', 0.78, 3, 0);
    }
  }

  // 没有抵达小船的线不会被判为失败，只会像粉笔灰一样淡去。
  for (i = 0; i < this.softAttempts.length; i++) {
    var attempt = this.softAttempts[i];
    lightBrush.drawMoonlightPath(ctx, attempt.points, {
      color: '#BFD8FF', alpha: 0.30 * (1 - attempt.t / attempt.life), width: 1.8,
      startGlow: false, endDust: false
    });
  }

  if (this.currentPath) {
    lightBrush.drawMoonlightPath(ctx, this.currentPath, {
      color: '#F4E8C9', alpha: 0.96, width: 2.5, glowWidth: 12,
      startGlow: false, endDust: false
    });
    // 指尖与星星之间只保留一根极淡的弹性牵引丝；真正留下的是星星经过的柔化轨迹。
    if (this.guidedHead && this.guidedPointer && !this.reducedMotion) {
      ctx.strokeStyle = 'rgba(244, 232, 201, 0.16)';
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(this.guidedHead.x, this.guidedHead.y);
      ctx.quadraticCurveTo(
        (this.guidedHead.x + this.guidedPointer.x) / 2,
        (this.guidedHead.y + this.guidedPointer.y) / 2 - 3,
        this.guidedPointer.x,
        this.guidedPointer.y
      );
      ctx.stroke();
    }
  }

  // 每条路的起点也是作品的一部分。
  for (i = 0; i < this.pathStars.length; i++) {
    star = this.pathStars[i];
    if (star.state === 'waiting') continue;
    var moving = star.state === 'travelling' || star.state === 'guided';
    var sx = moving ? star.drawX : star.x;
    var sy = moving ? star.drawY : star.y;
    if (star.state === 'complete') {
      // 完成后的起点星芒已由 lightBrush 随路径绘制；不再叠加实心圆点。
      continue;
    }
    var pulse = this.reducedMotion ? 1 : 1 + Math.sin(this.clock * 1.8 + star.t) * 0.08;
    var glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, star.r * 4);
    glow.addColorStop(0, this.hexToRgba(star.color, 0.36));
    glow.addColorStop(1, this.hexToRgba(star.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, star.r * 4, 0, Math.PI * 2);
    ctx.fill();
    this.drawStarShape(ctx, sx, sy, star.r * pulse, star.rotation + (this.reducedMotion ? 0 : this.clock * 0.06), star.color);
    if (star.state === 'active') {
      ctx.strokeStyle = this.hexToRgba(star.color, 0.25 + Math.sin(this.clock * 1.6) * 0.08);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, star.r * 2.2, 0, Math.PI * 2);
      ctx.stroke();
    } else if (star.state === 'guided') {
      ctx.strokeStyle = this.hexToRgba('#FFF4D8', 0.26);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, star.r * 1.72, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
};

StarGame.prototype.drawArtworkFinale = function (ctx) {
  var finale = this.artworkFinale;
  if (!finale) return;
  var t = finale.t;
  ctx.save();
  // 开场保留深暗，之后随每颗星的回归逐渐让夜幕透出暖光。
  var storyProgress = Math.max(0, Math.min(1, t / finale.duration));
  var veil = (1 - storyProgress) * 0.14;
  ctx.fillStyle = 'rgba(5, 7, 18, ' + veil.toFixed(3) + ')';
  ctx.fillRect(0, 0, this.width, this.height);
  lightBrush.drawArtworkFireworks(ctx, this.stats.pathArtwork, 0, 0, this.width, this.height, {
    progress: storyProgress,
    mapping: 'normalized',
    showRising: true,
    reducedMotion: !!this.reducedMotion,
    animalMaster: this.animalMaster || null
  });
  ctx.restore();
};

StarGame.prototype.drawBackground = function (ctx) {
  // 深靛蓝水粉夜空：保留克制的深色基底，再叠纸本笔触与颜料沉积。
  var grad = ctx.createLinearGradient(0, 0, 0, this.height);
  grad.addColorStop(0, '#061127');
  grad.addColorStop(0.48, '#0A1835');
  grad.addColorStop(1, '#171D3C');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, this.width, this.height);
  lightBrush.drawGouacheNightTexture(ctx, 0, 0, this.width, this.height, 0x51A7B00C, 0.82, 0.58);

  // 创作页也使用与最终作品相同的手绘夜空语言：几道宽而不齐的罩染横穿夜幕，
  // 下方是极淡的云海。它们只缓慢呼吸，不与正在被牵动的星争夺注意力。
  var drift = this.reducedMotion ? 0 : Math.sin(this.clock * 0.10) * this.height * 0.006;
  var washes = [
    { y: 0.18, width: 0.075, color: 'rgba(80, 101, 158, 0.045)', bend: -0.035 },
    { y: 0.34, width: 0.105, color: 'rgba(116, 94, 148, 0.030)', bend: 0.042 },
    { y: 0.57, width: 0.060, color: 'rgba(108, 128, 174, 0.026)', bend: -0.020 }
  ];
  ctx.save();
  ctx.lineCap = 'round';
  for (var washIndex = 0; washIndex < washes.length; washIndex++) {
    var wash = washes[washIndex];
    var washY = this.height * wash.y + drift * (washIndex + 1) * 0.35;
    ctx.strokeStyle = wash.color;
    ctx.lineWidth = Math.max(18, this.height * wash.width);
    ctx.beginPath();
    ctx.moveTo(-this.width * 0.18, washY);
    ctx.bezierCurveTo(
      this.width * 0.18, washY + this.height * wash.bend,
      this.width * 0.69, washY - this.height * wash.bend * 0.65,
      this.width * 1.16, washY + this.height * wash.bend * 0.35
    );
    ctx.stroke();
  }
  ctx.restore();

  // 远处云层由三条不完全重合的曲线组成，避免规则几何山形。
  var cloudColors = ['rgba(48, 65, 107, 0.14)', 'rgba(35, 48, 87, 0.20)', 'rgba(23, 31, 65, 0.36)'];
  for (var cloudLayer = 0; cloudLayer < 3; cloudLayer++) {
    var cloudY = this.height * (0.78 + cloudLayer * 0.065);
    ctx.fillStyle = cloudColors[cloudLayer];
    ctx.beginPath();
    ctx.moveTo(0, this.height);
    ctx.lineTo(0, cloudY);
    ctx.bezierCurveTo(this.width * 0.20, cloudY - this.height * 0.018, this.width * 0.34, cloudY + this.height * 0.018, this.width * 0.51, cloudY - this.height * 0.004);
    ctx.bezierCurveTo(this.width * 0.70, cloudY - this.height * 0.026, this.width * 0.83, cloudY + this.height * 0.015, this.width, cloudY - this.height * 0.006);
    ctx.lineTo(this.width, this.height);
    ctx.closePath();
    ctx.fill();
  }

  // 心情带来的微弱色调（地平线上的一层薄光，难过/被安慰时更柔）
  var t = this.moodConf.tint;
  var tintAlpha = (this.moodConf.tintAlpha !== undefined) ? this.moodConf.tintAlpha : 0.14;
  var horizon = ctx.createLinearGradient(0, this.height * 0.72, 0, this.height);
  horizon.addColorStop(0, 'rgba(0,0,0,0)');
  horizon.addColorStop(1, this.hexToRgba(t, tintAlpha));
  ctx.fillStyle = horizon;
  ctx.fillRect(0, this.height * 0.72, this.width, this.height * 0.28);

  // 安静眨眼的背景小星星（用 clock，呼吸时它们也轻轻闪）
  var now = this.reducedMotion ? 0 : this.clock;
  for (var i = 0; i < this.bgStars.length; i++) {
    var s = this.bgStars[i];
    var alpha = 0.18 + 0.5 * (0.5 + 0.5 * Math.sin(now * s.speed + s.phase));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = i % 7 === 0 ? '#F0C96F' : (i % 3 === 0 ? '#D8C697' : '#C9B982');
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

StarGame.prototype.drawStars = function (ctx) {
  for (var i = 0; i < this.stars.length; i++) {
    var star = this.stars[i];
    var pulse = 1 + 0.08 * Math.sin(star.t * 3);

    // 外圈光晕
    var glow = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.r * 3.2);
    glow.addColorStop(0, this.hexToRgba(star.color, 0.5));
    glow.addColorStop(1, this.hexToRgba(star.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r * 3.2, 0, Math.PI * 2);
    ctx.fill();

    // 五角星本体
    this.drawStarShape(ctx, star.x, star.y, star.r * pulse, star.rotation, star.color);

    // 呼吸星外面再套一圈呼吸光环，提示它很特别
    if (star.type === 'breath') {
      ctx.strokeStyle = this.hexToRgba(star.color, 0.5);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r * 2.1 + Math.sin(star.t * 2) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }


    // 特殊星各有一个安静但可辨认的动作符号。
    if (star.specialId === 'echo') {
      ctx.strokeStyle = this.hexToRgba(star.color, 0.32);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r * 1.65 + Math.sin(star.t * 2.2) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r * 2.15 + Math.sin(star.t * 2.2 + 0.8) * 4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (star.specialId === 'slow') {
      var orbit = star.t * 0.72;
      ctx.fillStyle = this.hexToRgba(star.color, 0.72);
      ctx.beginPath();
      ctx.arc(star.x + Math.cos(orbit) * star.r * 1.8, star.y + Math.sin(orbit) * star.r * 1.1, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (star.specialId === 'whisper') {
      ctx.strokeStyle = this.hexToRgba(star.color, 0.34);
      ctx.lineWidth = 1;
      for (var w = 0; w < 3; w++) {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r * (1.45 + w * 0.34) + Math.sin(star.t * 1.8 + w) * 2, -0.65, 0.65);
        ctx.stroke();
      }
    }
  }
};

// 画一颗五角星
StarGame.prototype.drawStarShape = function (ctx, cx, cy, r, rotation, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.beginPath();
  for (var i = 0; i < 5; i++) {
    // 外顶点
    var ang1 = -Math.PI / 2 + i * 2 * Math.PI / 5;
    ctx.lineTo(Math.cos(ang1) * r, Math.sin(ang1) * r);
    // 内凹点
    var ang2 = ang1 + Math.PI / 5;
    ctx.lineTo(Math.cos(ang2) * r * 0.45, Math.sin(ang2) * r * 0.45);
  }
  ctx.closePath();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
};

StarGame.prototype.drawSparkles = function (ctx) {
  for (var i = 0; i < this.sparkles.length; i++) {
    var s = this.sparkles[i];
    var alpha = 1 - s.t / s.life;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

StarGame.prototype.drawGroundGlows = function (ctx) {
  // 没接住的星星，在地上化成一小团温柔的光，慢慢淡去
  for (var i = 0; i < this.groundGlows.length; i++) {
    var g = this.groundGlows[i];
    var life = g.t / 4.5;
    var alpha = Math.max(0, 0.55 * (1 - life)) * (0.8 + 0.2 * Math.sin(g.t * 4));
    var r = 6 + life * 14;
    var grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, r);
    grad.addColorStop(0, this.hexToRgba(g.color, alpha));
    grad.addColorStop(1, this.hexToRgba(g.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
};

StarGame.prototype.drawBoat = function (ctx, foreground) {
  // 月亮船不再是一个规则图标：略不对称的月牙、两层手绘边缘和纸面颗粒，
  // 船舱会保存每一道星路的颜色；呼吸时漂浮，作品揭幕时把这些光送回天空。
  var b = this.basket;
  var x = b.x, y = b.y, w = b.w, h = b.h;
  var glow = 0.35 + Math.min(0.9, this.stats.caught * 0.06) + this.boatPulse;
  var breathing = this.phase === 'breathing';
  var finale = (this.phase === 'finale' || this.phase === 'finaleHold') && this.artworkFinale ? this.artworkFinale : null;
  var bob = this.reducedMotion ? 0 : (breathing ? Math.sin(this.clock * 1.08) * 3.0 : Math.sin(this.clock * 0.68) * 1.25);
  var tilt = this.reducedMotion ? 0 : (finale ? -0.055 * Math.sin(Math.PI * Math.min(1, finale.t / 1.5)) : Math.sin(this.clock * 0.42) * 0.009);
  var storedFade = finale ? Math.max(0, 1 - finale.t / 1.32) : 1;

  ctx.save();
  ctx.globalAlpha = foreground ? Math.max(0, Math.min(0.72, this.breathFade * 0.72)) : 1;
  ctx.translate(x, y + bob);
  ctx.rotate(tilt);

  // 船下的一圈月光涟漪，让它像漂在夜色里，而不是贴在画布上。
  ctx.strokeStyle = 'rgba(184, 194, 226, ' + (0.09 + glow * 0.025).toFixed(3) + ')';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-w * 0.47, h * 1.72);
  ctx.bezierCurveTo(-w * 0.18, h * 1.92, w * 0.19, h * 1.88, w * 0.48, h * 1.68);
  ctx.stroke();

  // 船的柔光（随今晚接住的星星变亮）
  ctx.shadowColor = 'rgba(255, 223, 148, ' + Math.min(1, 0.5 + glow * 0.4) + ')';
  ctx.shadowBlur = 14 + 26 * glow;

  // 用略不对称的两段弧线拼出月牙船，右侧稍高，保留手绘的不完美。
  ctx.beginPath();
  ctx.moveTo(-w / 2, 1);
  ctx.quadraticCurveTo(-w * 0.03, h * 2.14, w / 2, -1.5);   // 船底
  ctx.quadraticCurveTo(w * 0.03, h * 0.44, -w / 2, 1);      // 船内侧
  ctx.closePath();

  var grad = ctx.createLinearGradient(-w / 2, 0, w / 2, h);
  grad.addColorStop(0, '#EAD39A');
  grad.addColorStop(0.42, '#FFF0C3');
  grad.addColorStop(0.72, '#F7E4AE');
  grad.addColorStop(1, '#DDBF78');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.shadowBlur = 0;

  // 两道偏移极小的蜡笔边缘，比一条标准矢量描边更柔软。
  ctx.strokeStyle = 'rgba(255, 248, 226, 0.58)';
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 1, 1);
  ctx.quadraticCurveTo(-w * 0.03, h * 2.10, w / 2 - 1, -1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(196, 164, 101, 0.26)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 3, 3);
  ctx.quadraticCurveTo(w * 0.01, h * 1.96, w / 2 - 4, 1);
  ctx.stroke();

  // 船里淡淡的暖光（积累越多越暖）
  var inner = ctx.createRadialGradient(0, h * 0.48, 0, 0, h * 0.48, w * 0.42);
  inner.addColorStop(0, 'rgba(255, 240, 200, ' + Math.min(0.85, 0.35 + glow * 0.4) + ')');
  inner.addColorStop(1, 'rgba(255, 240, 200, 0)');
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(0, h * 0.48, w * 0.42, 0, Math.PI * 2);
  ctx.fill();

  // 五颗被接住的光真实留在船舱里；颜色来自对应星路。
  var storedPaths = this.stats.pathArtwork && this.stats.pathArtwork.paths || [];
  var lightCount = Math.min(5, this.mode === 'path' ? storedPaths.length : this.stats.caught);
  for (var i = 0; i < lightCount; i++) {
    var lightColor = storedPaths[i] && storedPaths[i].color || '#F4E8C9';
    var lx = (i - (lightCount - 1) / 2) * 13 + Math.sin(i * 2.1) * 1.5;
    var ly = h * 0.55 + Math.cos(i * 1.7) * 2.2;
    var twinkle = 0.72 + Math.sin(this.clock * 1.4 + i * 1.3) * 0.16;
    ctx.globalAlpha = (foreground ? Math.max(0, Math.min(0.72, this.breathFade * 0.72)) : 1) * storedFade;
    ctx.fillStyle = this.hexToRgba(lightColor, twinkle);
    ctx.shadowColor = lightColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(lx, ly, 1.7 + (i % 2) * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  // 星花散开后，船里只留一颗很小的晚安灯。
  if (finale && finale.t > 3.15) {
    var lampIn = Math.min(1, (finale.t - 3.15) / 0.8);
    ctx.globalAlpha = (foreground ? 0.72 : 1) * lampIn;
    ctx.fillStyle = '#FFF2C7';
    ctx.shadowColor = '#E5CF93';
    ctx.shadowBlur = 13;
    ctx.beginPath();
    ctx.arc(0, h * 0.55, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

// 画飞进船里的小光点
StarGame.prototype.drawMotes = function (ctx) {
  for (var i = 0; i < this.motes.length; i++) {
    var mo = this.motes[i];
    var alpha = Math.sin(Math.PI * Math.min(1, mo.t)); // 起飞与到达时淡一些
    ctx.fillStyle = this.hexToRgba(mo.color, 0.85 * alpha);
    ctx.shadowColor = mo.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(mo.x, mo.y, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
};

StarGame.prototype.drawBreathing = function (ctx) {
  var b = this.breath;
  var p = this.breathPattern;
  var cx = this.width / 2;
  var cy = this.height * 0.40;
  var baseR = Math.min(this.width, this.height) * 0.10;
  var fade = this.breathFade; // 0~1，幕布与星星的淡入淡出
  var i;

  // 半透明幕布（淡入淡出，而不是瞬间盖上）
  ctx.fillStyle = 'rgba(7, 10, 28, ' + (0.66 * fade).toFixed(3) + ')';
  ctx.fillRect(0, 0, this.width, this.height);

  // 每一轮吸气时荡开的涟漪
  for (i = 0; i < this.breathRipples.length; i++) {
    var rp = this.breathRipples[i];
    var life = rp.t / 3.0;
    if (life >= 1) continue;
    ctx.strokeStyle = this.hexToRgba('#FFE9C4', 0.28 * (1 - life) * fade);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, baseR * (1.1 + life * 2.2), 0, Math.PI * 2);
    ctx.stroke();
  }

  // 环绕的小光点：吸气聚拢，呼气散开，像一起呼吸
  for (i = 0; i < this.breathParticles.length; i++) {
    var pt = this.breathParticles[i];
    var d = baseR * (0.8 + pt.p * 2.2) + pt.wobble;
    ctx.fillStyle = this.hexToRgba('#FFE9C4', (0.22 + 0.4 * (1 - pt.p)) * fade);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(pt.angle) * d, cy + Math.sin(pt.angle) * d * 0.85, pt.size, 0, Math.PI * 2);
    ctx.fill();
  }

  // 计算当前应该缩放到多大
  var scale = 1;
  if (b.phase === 'settle') {
    scale = 0.7 + 0.3 * this.easeInOut(b.t / 0.9);       // 入场：星星轻轻出现
  } else if (b.phase === 'inhale') {
    scale = 1 + 0.8 * this.easeInOut(b.t / p.inhale);
  } else if (b.phase === 'hold') {
    scale = 1.8 + 0.03 * Math.sin(b.t * 5);
  } else if (b.phase === 'exhale') {
    scale = 1.8 - 0.8 * this.easeInOut(b.t / p.exhale);
  } else if (b.phase === 'dissolve') {
    scale = 1 - 0.45 * this.easeInOut(b.t / 1.2);        // 离场：星星慢慢变小
  }

  ctx.globalAlpha = fade;

  // 外层扩散的暖光
  var ringR = baseR * scale * 1.9;
  var ring = ctx.createRadialGradient(cx, cy, baseR * scale, cx, cy, ringR);
  ring.addColorStop(0, 'rgba(255, 233, 196, 0.32)');
  ring.addColorStop(1, 'rgba(255, 233, 196, 0)');
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.fill();

  // 呼吸星本体
  this.drawStarShape(ctx, cx, cy, baseR * scale, this.clock * 0.2, '#FFE9C4');

  // 圆圈指示线
  ctx.strokeStyle = 'rgba(255, 233, 196, 0.30)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR * 1.8, 0, Math.PI * 2);
  ctx.stroke();

  // 三轮进度的小圆点（画在星星下方）
  var dotsY = cy + baseR * 2.7;
  for (var k = 0; k < BREATH_ROUNDS; k++) {
    var done = k < b.round - 1;
    var current = k === b.round - 1;
    ctx.fillStyle = done ? 'rgba(255, 233, 196, 0.85)'
      : (current ? 'rgba(255, 233, 196, 0.45)' : 'rgba(255, 233, 196, 0.15)');
    ctx.beginPath();
    ctx.arc(cx + (k - 1) * 18, dotsY, current ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  // 收尾呼吸里，月亮船也跟着轻轻漂浮；它装着的五颗光始终可见。
  if (this.mode === 'path') this.drawBoat(ctx, true);
};

// 呼吸结束后的一小段余光
StarGame.prototype.drawAfterglow = function (ctx) {
  var a = this.afterglow;
  var life = a.t / 1.8;
  var r = 20 + life * 90;
  var grad = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, r);
  grad.addColorStop(0, this.hexToRgba('#FFE9C4', 0.30 * (1 - life)));
  grad.addColorStop(1, this.hexToRgba('#FFE9C4', 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
  ctx.fill();
};

// 给情绪命名的画面：无名星停在夜空中央，安静地等一个名字
StarGame.prototype.drawNaming = function (ctx) {
  var n = this.name;
  var fade = n ? n.fade : 0;
  var cx = this.width / 2;
  var cy = this.height * 0.40;
  var baseR = Math.min(this.width, this.height) * 0.095;

  // 幕布（同样淡入淡出，不生硬）
  ctx.fillStyle = 'rgba(7, 10, 28, ' + (0.55 * fade).toFixed(3) + ')';
  ctx.fillRect(0, 0, this.width, this.height);

  ctx.globalAlpha = fade;

  // 星星本体：轻轻地呼吸般起伏，好像在等
  var pulse = 1 + 0.08 * Math.sin(this.clock * 1.6);
  this.drawStarShape(ctx, cx, cy, baseR * pulse, this.clock * 0.12, '#EDE9FF');

  // 外圈柔光与提示环
  var halo = ctx.createRadialGradient(cx, cy, baseR * pulse, cx, cy, baseR * 2.6);
  halo.addColorStop(0, 'rgba(237, 233, 255, 0.28)');
  halo.addColorStop(1, 'rgba(237, 233, 255, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR * 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(237, 233, 255, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR * 1.8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 1;
};

StarGame.prototype.easeInOut = function (t) {
  var v = Math.max(0, Math.min(1, t));
  return v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2;
};

// '#RRGGBB' -> 'rgba(r,g,b,a)'
StarGame.prototype.hexToRgba = function (hex, alpha) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
};

module.exports = { StarGame: StarGame, STAR_TYPES: STAR_TYPES, MOOD_CONFIG: MOOD_CONFIG };
