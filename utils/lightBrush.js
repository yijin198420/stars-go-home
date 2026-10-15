// utils/lightBrush.js —— 「月光蜡笔」共享笔触
// 游戏、结果页、星空日记与分享海报都通过这里重画同一条线，
// 确保作品从落笔到保存都保持相同的柔软质感。

var animalSeal = require('./animalSeal.js');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function colorAlpha(hex, alpha) {
  var value = String(hex || '#FFFFFF').replace('#', '');
  if (value.length === 3) value = value.split('').map(function (c) { return c + c; }).join('');
  return 'rgba(' + parseInt(value.slice(0, 2), 16) + ',' +
    parseInt(value.slice(2, 4), 16) + ',' + parseInt(value.slice(4, 6), 16) + ',' + alpha + ')';
}

function mapNormalized(points, x, y, width, height) {
  return (points || []).map(function (point) {
    return {
      x: x + point.x * width,
      y: y + point.y * height,
      w: point.w === undefined ? 1 : point.w,
      t: point.t
    };
  });
}

function getArtworkBounds(artwork) {
  var minX = 1, minY = 1, maxX = 0, maxY = 0, found = false;
  (artwork && artwork.paths || []).forEach(function (path) {
    (path.points || []).forEach(function (point) {
      if (typeof point.x !== 'number' || typeof point.y !== 'number') return;
      found = true;
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    });
  });
  if (!found) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  if (maxX - minX < 0.2) { var cx = (minX + maxX) / 2; minX = cx - 0.1; maxX = cx + 0.1; }
  if (maxY - minY < 0.2) { var cy = (minY + maxY) / 2; minY = cy - 0.1; maxY = cy + 0.1; }
  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

// 成品展示专用：按整幅笔迹的真实边界等比居中。
// 旧版分别撑满宽高，会把窄而高的线条横向拉胖、把舒展的线条纵向拉长；
// 成品现在像装裱画作一样保留原始比例和留白，游戏中的坐标与手感不变。
function mapArtwork(points, artwork, x, y, width, height, padding) {
  var bounds = getArtworkBounds(artwork);
  var pad = padding === undefined ? 0.12 : padding;
  var innerX = x + width * pad;
  var innerY = y + height * pad;
  var innerW = width * (1 - pad * 2);
  var innerH = height * (1 - pad * 2);
  var spanX = bounds.maxX - bounds.minX || 1;
  var spanY = bounds.maxY - bounds.minY || 1;
  var scale = Math.min(innerW / spanX, innerH / spanY);
  var drawnW = spanX * scale;
  var drawnH = spanY * scale;
  var offsetX = innerX + (innerW - drawnW) / 2;
  var offsetY = innerY + (innerH - drawnH) / 2;
  return (points || []).map(function (point) {
    return {
      x: offsetX + (point.x - bounds.minX) * scale,
      y: offsetY + (point.y - bounds.minY) * scale,
      w: point.w === undefined ? 1 : point.w,
      t: point.t
    };
  });
}

function interpolatePoint(a, b, mix) {
  return {
    x: a.x + (b.x - a.x) * mix,
    y: a.y + (b.y - a.y) * mix,
    w: (a.w === undefined ? 1 : a.w) +
      ((b.w === undefined ? 1 : b.w) - (a.w === undefined ? 1 : a.w)) * mix,
    t: a.t === undefined || b.t === undefined ? undefined : a.t + (b.t - a.t) * mix
  };
}

// 取出一条笔迹“已经亮起”的部分。新版作品按真实绘制时间推进；
// 旧作品没有时间数据时自动退回到按路径长度推进。
function partialPath(points, progress) {
  if (!points || !points.length) return [];
  progress = clamp(progress, 0, 1);
  if (progress <= 0) return [points[0]];
  if (progress >= 1 || points.length === 1) return points.slice();

  var firstTime = points[0].t;
  var lastTime = points[points.length - 1].t;
  var useTime = typeof firstTime === 'number' && typeof lastTime === 'number' && lastTime > firstTime;
  var i;
  if (useTime) {
    var wantedTime = firstTime + (lastTime - firstTime) * progress;
    for (i = 1; i < points.length; i++) {
      if (points[i].t >= wantedTime) {
        var timeSpan = points[i].t - points[i - 1].t;
        var timeMix = timeSpan > 0 ? (wantedTime - points[i - 1].t) / timeSpan : 0;
        return points.slice(0, i).concat([interpolatePoint(points[i - 1], points[i], timeMix)]);
      }
    }
    return points.slice();
  }

  var lengths = [];
  var total = 0;
  for (i = 1; i < points.length; i++) {
    var dx = points[i].x - points[i - 1].x;
    var dy = points[i].y - points[i - 1].y;
    var length = Math.sqrt(dx * dx + dy * dy);
    lengths.push(length);
    total += length;
  }
  var wanted = total * progress;
  for (i = 0; i < lengths.length; i++) {
    if (wanted <= lengths[i]) {
      var mix = lengths[i] > 0 ? wanted / lengths[i] : 0;
      return points.slice(0, i + 1).concat([interpolatePoint(points[i], points[i + 1], mix)]);
    }
    wanted -= lengths[i];
  }
  return points.slice();
}

// Catmull-Rom 转三次贝塞尔：穿过每个采样点，但把折角变成自然弧线。
function curveSegment(ctx, points, index, offsetX, offsetY) {
  var p0 = points[Math.max(0, index - 1)];
  var p1 = points[index];
  var p2 = points[index + 1];
  var p3 = points[Math.min(points.length - 1, index + 2)];
  var tension = 0.16;
  ctx.moveTo(p1.x + offsetX, p1.y + offsetY);
  ctx.bezierCurveTo(
    p1.x + (p2.x - p0.x) * tension + offsetX,
    p1.y + (p2.y - p0.y) * tension + offsetY,
    p2.x - (p3.x - p1.x) * tension + offsetX,
    p2.y - (p3.y - p1.y) * tension + offsetY,
    p2.x + offsetX,
    p2.y + offsetY
  );
}

function traceCurve(ctx, points, offsetX, offsetY) {
  if (!points || points.length < 2) return;
  ctx.beginPath();
  for (var i = 0; i < points.length - 1; i++) curveSegment(ctx, points, i, offsetX || 0, offsetY || 0);
}

function strokeCurve(ctx, points, color, alpha, width, offsetX, offsetY, dash) {
  if (!points || points.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (dash && ctx.setLineDash) ctx.setLineDash(dash);
  traceCurve(ctx, points, offsetX || 0, offsetY || 0);
  ctx.strokeStyle = colorAlpha(color, alpha);
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

function taperAt(index, total) {
  if (total < 4) return 1;
  var start = clamp((index + 1) / 3, 0.55, 1);
  var remaining = total - 1 - index;
  var end = clamp((remaining + 1) / 4, 0.34, 1);
  return Math.min(start, end);
}

// 每个贝塞尔小段单独落笔，才可以让慢画稍厚、快画稍轻，并自然收尖。
function strokeVariableCore(ctx, points, color, alpha, baseWidth) {
  if (!points || points.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = colorAlpha(color, alpha);
  for (var i = 0; i < points.length - 1; i++) {
    var weightA = points[i].w === undefined ? 1 : points[i].w;
    var weightB = points[i + 1].w === undefined ? weightA : points[i + 1].w;
    ctx.beginPath();
    curveSegment(ctx, points, i, 0, 0);
    ctx.lineWidth = baseWidth * ((weightA + weightB) / 2) * taperAt(i, points.length);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCrayonGrain(ctx, points, color, alpha, baseWidth) {
  if (!points || points.length < 4) return;
  ctx.save();
  ctx.fillStyle = colorAlpha(color, alpha);
  for (var i = 2; i < points.length - 2; i += 3) {
    var p = points[i];
    var angle = i * 2.37;
    var side = Math.sin(angle) * baseWidth * 0.72;
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(angle) * side, p.y + Math.sin(angle) * side,
      Math.max(0.32, baseWidth * (0.16 + (i % 4) * 0.045)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEndDust(ctx, points, color, alpha, baseWidth) {
  if (!points || points.length < 3) return;
  var end = points[points.length - 1];
  var before = points[Math.max(0, points.length - 3)];
  var dx = end.x - before.x;
  var dy = end.y - before.y;
  var length = Math.sqrt(dx * dx + dy * dy) || 1;
  var nx = -dy / length;
  var ny = dx / length;
  ctx.save();
  ctx.fillStyle = colorAlpha(color, alpha * 0.72);
  for (var i = 0; i < 5; i++) {
    var back = 4 + i * 3.6;
    var side = Math.sin(i * 2.1) * (2 + i * 0.55);
    ctx.beginPath();
    ctx.arc(
      end.x - dx / length * back + nx * side,
      end.y - dy / length * back + ny * side,
      Math.max(0.45, baseWidth * (0.28 - i * 0.025)),
      0, Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawStartGlow(ctx, point, color, alpha, baseWidth) {
  if (!point) return;
  var radius = Math.max(3.4, baseWidth * 1.6);
  // 起点不是一个规则节点，而是一颗略有偏锋的手绘星芒。
  // 旋转由坐标稳定生成，同一幅作品每次重画都保持一致。
  var rotation = ((point.x * 0.017 + point.y * 0.013) % 0.46) - 0.23;
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(rotation);
  var halo = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 2.8);
  halo.addColorStop(0, colorAlpha(color, alpha * 0.32));
  halo.addColorStop(1, colorAlpha(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 2.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = colorAlpha(color, alpha * 0.94);
  ctx.strokeStyle = colorAlpha('#FFF7E2', alpha * 0.48);
  ctx.lineWidth = Math.max(0.45, baseWidth * 0.22);
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(6, baseWidth * 3.8);
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(radius * 0.16, -radius * 0.16);
  ctx.lineTo(radius * 0.72, -radius * 0.04);
  ctx.lineTo(radius * 0.17, radius * 0.15);
  ctx.lineTo(radius * 0.04, radius * 0.88);
  ctx.lineTo(-radius * 0.14, radius * 0.16);
  ctx.lineTo(-radius * 0.62, radius * 0.05);
  ctx.lineTo(-radius * 0.16, -radius * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();

  // 一粒偏心月白让星芒保留蜡笔的手工感，不再像标准 UI 圆点。
  ctx.fillStyle = colorAlpha('#FFF8E8', alpha * 0.82);
  ctx.beginPath();
  ctx.arc(-radius * 0.08, -radius * 0.1, Math.max(0.55, baseWidth * 0.27), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTravelStar(ctx, point, color, pulse, baseWidth) {
  if (!point) return;
  pulse = pulse === undefined ? 0 : pulse;
  baseWidth = baseWidth || 2;
  var radius = Math.max(2.5, baseWidth * (1.4 + pulse * 0.14));
  ctx.save();
  ctx.fillStyle = colorAlpha(color, 0.96);
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(10, baseWidth * 7);
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,248,226,0.92)';
  ctx.beginPath();
  ctx.arc(point.x - radius * 0.18, point.y - radius * 0.18, radius * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMoonlightPath(ctx, points, options) {
  options = options || {};
  if (!points || points.length < 2) return;
  var color = options.color || '#F4E8C9';
  var alpha = options.alpha === undefined ? 1 : options.alpha;
  var width = options.width || 2.2;
  var glowWidth = options.glowWidth || width * 5.2;

  // 一层呼吸般的柔光，两层轻微错开的蜡笔边缘，再落下明亮线芯。
  strokeCurve(ctx, points, color, alpha * 0.12, glowWidth, 0, 0);
  strokeCurve(ctx, points, color, alpha * 0.18, width * 1.65, 0.65, -0.35);
  strokeCurve(ctx, points, color, alpha * 0.13, width * 1.35, -0.55, 0.45);
  strokeVariableCore(ctx, points, color, alpha * 0.72, width);
  strokeCurve(ctx, points, '#FFF7E2', alpha * 0.34, Math.max(0.55, width * 0.36), 0, 0);
  drawCrayonGrain(ctx, points, color, alpha * 0.34, width);

  if (options.specialId === 'echo') {
    strokeCurve(ctx, points, color, alpha * 0.28, Math.max(0.8, width * 0.55), width * 2.2, 0);
  } else if (options.specialId === 'slow') {
    ctx.save();
    ctx.fillStyle = colorAlpha(color, alpha * 0.56);
    for (var sd = 3; sd < points.length - 2; sd += 7) {
      ctx.beginPath();
      ctx.arc(points[sd].x, points[sd].y, Math.max(1.1, width * (0.55 + (sd % 3) * 0.16)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (options.specialId === 'whisper') {
    strokeCurve(ctx, points, color, alpha * 0.38, Math.max(0.7, width * 0.55), -width * 1.9, 0, [2, 7]);
  }

  if (options.startGlow !== false) drawStartGlow(ctx, points[0], color, alpha * 0.86, width);
  if (options.endDust) drawEndDust(ctx, points, color, alpha, width);
}

// ---------- 作品完成后的“星路开花” ----------
// 所有装饰都由真实笔迹的位置、转折与汇聚点生成；同一幅作品每次重画一致。
var ARTWORK_STYLES = {
  tide: { id: 'tide', label: '月潮', accent: '#9EB8FF', haze: '#5368A6' },
  bloom: { id: 'bloom', label: '星花', accent: '#D7B9FF', haze: '#775D9B' },
  meteor: { id: 'meteor', label: '流星雨', accent: '#F3D38F', haze: '#927044' },
  still: { id: 'still', label: '静夜', accent: '#DCE8FF', haze: '#4E6388' }
};

function analyzeArtworkShape(artwork) {
  var paths = artwork && artwork.paths || [];
  var totalLength = 0, directLength = 0, totalDuration = 0, pauseCount = 0, timed = 0;
  paths.forEach(function (path) {
    var points = path.points || [];
    if (points.length < 2) return;
    var first = points[0], last = points[points.length - 1];
    directLength += Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));
    for (var i = 1; i < points.length; i++) {
      var dx = points[i].x - points[i - 1].x;
      var dy = points[i].y - points[i - 1].y;
      totalLength += Math.sqrt(dx * dx + dy * dy);
      if (typeof points[i].t === 'number' && typeof points[i - 1].t === 'number') {
        var dt = Math.max(0, points[i].t - points[i - 1].t);
        totalDuration += dt;
        timed += 1;
        if (dt >= 0.32) pauseCount += 1;
      }
    }
  });
  return {
    pathCount: paths.length,
    totalLength: totalLength,
    directness: directLength > 0 ? totalLength / directLength : 1,
    averageSpeed: timed && totalDuration > 0 ? totalLength / totalDuration : null,
    pauseCount: pauseCount
  };
}

function getArtworkStyle(artwork) {
  var shape = analyzeArtworkShape(artwork);
  if (shape.directness >= 1.42) return ARTWORK_STYLES.bloom;
  if (shape.averageSpeed !== null && shape.averageSpeed >= 0.72) return ARTWORK_STYLES.meteor;
  if (shape.pauseCount >= 2 || (shape.totalLength > 0 && shape.totalLength <= Math.max(1.55, shape.pathCount * 0.34))) {
    return ARTWORK_STYLES.still;
  }
  return ARTWORK_STYLES.tide;
}

function strokeFingerprint(artwork) {
  var seed = 2166136261;
  (artwork && artwork.paths || []).forEach(function (path, pathIndex) {
    (path.points || []).forEach(function (point, pointIndex) {
      var value = Math.round((point.x * 997 + point.y * 991 + pathIndex * 37 + pointIndex * 11) * 1000);
      seed ^= value;
      seed = Math.imul(seed, 16777619);
    });
  });
  return seed >>> 0;
}

function mixSeedText(seed, text) {
  var value = String(text === undefined || text === null ? '' : text);
  for (var i = 0; i < value.length; i++) {
    seed ^= value.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function normalizeSeed(value) {
  if (typeof value === 'number' && isFinite(value)) return (value >>> 0) || 1;
  if (typeof value === 'string' && value) return mixSeedText(2166136261, value) || 1;
  return 0;
}

var FIREWORK_LAYOUT_NAMES = ['crescent', 'diagonal', 'crown', 'spiral', 'islands', 'rainfall', 'twin', 'horizon'];
var FIREWORK_THEME_NAMES = ['moon', 'aurora', 'blush', 'pearl', 'lilac', 'champagne'];
var FIREWORK_KIND_NAMES = ['peony', 'willow', 'halo', 'comet', 'dandelion', 'fan'];

// 签名的每一位都对应真正会被画出来的构图基因，而不再只是无意义的数字桶。
// 这样近作避让比较的是“轮廓是否相似”，不是仅比较随机种子。
function fireworkGenesFromSeed(seed) {
  seed = normalizeSeed(seed) || 1;
  return {
    layoutIndex: seed % FIREWORK_LAYOUT_NAMES.length,
    focusIndex: (seed >>> 5) % 6,
    themeIndex: (seed >>> 10) % FIREWORK_THEME_NAMES.length,
    mainKindIndex: (seed >>> 15) % FIREWORK_KIND_NAMES.length,
    scaleIndex: (seed >>> 20) % 5,
    mirror: ((seed >>> 25) & 1) === 1
  };
}

// 烟花视觉签名用于避开“重心、主色、主花型和尺度关系都过于相似”的近作。
// 它不是用户画像，也不离开本机。
function fireworkSignature(seed) {
  var genes = fireworkGenesFromSeed(seed);
  return ['v2', genes.layoutIndex, genes.focusIndex, genes.themeIndex, genes.mainKindIndex, genes.scaleIndex].join('-');
}

function fireworkSignaturesTooClose(a, b) {
  if (!a || !b) return false;
  var aa = String(a).split('-');
  var bb = String(b).split('-');
  if (aa[0] !== 'v2' || bb[0] !== 'v2') return false;
  var same = 0;
  for (var i = 1; i < Math.min(aa.length, bb.length); i++) if (aa[i] === bb[i]) same += 1;
  // 同一构图骨架+同一视觉重心，或五项中至少三项相同，都视为过近。
  return (aa[1] === bb[1] && aa[2] === bb[2]) || same >= 3;
}

// 新作品只生成一次专属种子；之后重播、作品集和分享海报都读取同一个值。
// recentArtworks 只用于本机近作避让。传入 randomSalt 可令测试完全可复现。
function ensureFireworkIdentity(artwork, meta, recentArtworks) {
  if (!artwork || !Array.isArray(artwork.paths)) return artwork;
  var existing = normalizeSeed(artwork.fireworkSeed);
  if (existing) {
    artwork.fireworkSeed = existing;
    if (!artwork.fireworkSignature || Number(artwork.fireworkVersion || 0) < 2) {
      artwork.fireworkSignature = fireworkSignature(existing);
    }
    artwork.fireworkVersion = 2;
    return artwork;
  }
  meta = meta || {};
  var seed = strokeFingerprint(artwork);
  seed = mixSeedText(seed, meta.id || '');
  seed = mixSeedText(seed, meta.timestamp || '');
  seed = mixSeedText(seed, meta.title || '');
  seed = mixSeedText(seed, meta.animal || '');
  var randomSalt = meta.randomSalt;
  if (randomSalt === undefined) randomSalt = Date.now() + '-' + Math.random();
  seed = mixSeedText(seed, randomSalt) || 1;

  var allPrior = recentArtworks || [];
  var usedSeeds = allPrior.map(function (item) {
    var candidate = item && item.pathArtwork ? item.pathArtwork : item;
    return candidate && (normalizeSeed(candidate.fireworkSeed) || strokeFingerprint(candidate));
  }).filter(Boolean);
  var recent = allPrior.slice(0, 24).map(function (item) {
    var candidate = item && item.pathArtwork ? item.pathArtwork : item;
    var candidateSeed = candidate && (normalizeSeed(candidate.fireworkSeed) || strokeFingerprint(candidate));
    return candidate && (candidate.fireworkSignature || (candidateSeed ? fireworkSignature(candidateSeed) : ''));
  }).filter(Boolean);
  var signature = fireworkSignature(seed);
  for (var attempt = 0; attempt < 64 && (usedSeeds.indexOf(seed) >= 0 || recent.some(function (item) {
    return fireworkSignaturesTooClose(signature, item);
  })); attempt++) {
    seed = (Math.imul(seed ^ (attempt + 1) * 0x9E3779B1, 2246822519) + 3266489917) >>> 0;
    if (!seed) seed = attempt + 1;
    signature = fireworkSignature(seed);
  }
  // 相似度避让是审美规则；种子不重复则是硬约束，即使收藏很多年也不会复用旧编号。
  while (usedSeeds.indexOf(seed) >= 0) {
    seed = (seed + 0x9E3779B1) >>> 0;
    if (!seed) seed = 1;
  }
  signature = fireworkSignature(seed);
  artwork.fireworkSeed = seed;
  artwork.fireworkSignature = signature;
  artwork.fireworkVersion = 2;
  return artwork;
}

function artworkSeed(artwork) {
  var saved = artwork && normalizeSeed(artwork.fireworkSeed);
  return saved || strokeFingerprint(artwork);
}

function seededRandom(seed) {
  var state = seed || 1;
  return function () {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// 深靛蓝水粉纸夜空：用少量宽笔触、颜料沉积点与纸纤维建立“能摸到”的背景。
// 所有纹理由作品种子稳定生成，同一幅作品重播和分享时不会改变。
function drawGouacheNightTexture(ctx, x, y, width, height, seed, opacity, quality) {
  opacity = opacity === undefined ? 1 : opacity;
  quality = quality === undefined ? 1 : clamp(quality, 0.35, 1);
  if (opacity <= 0) return;
  var random = seededRandom(((seed || 1) ^ 0x8D12F3A7) >>> 0);
  var swatches = ['#17315E', '#234579', '#08162F', '#304F80', '#102348', '#1B2A5A'];
  var strokeCount = Math.max(7, Math.round(14 * quality));
  var scumbleCount = Math.max(10, Math.round(24 * quality));
  var grainCount = Math.max(24, Math.round(58 * quality));
  var fiberCount = Math.max(10, Math.round(26 * quality));
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 宽而不规则的横向罩染模拟水粉反复覆盖留下的笔腹，不做规则条纹。
  for (var wash = 0; wash < strokeCount; wash++) {
    var washY = y + height * (-0.04 + random() * 1.08);
    var washStart = x - width * (0.12 + random() * 0.10);
    var washEnd = x + width * (1.10 + random() * 0.12);
    var washLift = height * (random() - 0.5) * 0.13;
    var washColor = swatches[(wash + Math.floor(random() * swatches.length)) % swatches.length];
    var washAlpha = (0.025 + random() * 0.038) * opacity;
    ctx.strokeStyle = colorAlpha(washColor, washAlpha);
    ctx.lineWidth = Math.max(8, height * (0.045 + random() * 0.085));
    ctx.beginPath();
    ctx.moveTo(washStart, washY);
    ctx.bezierCurveTo(
      x + width * 0.24, washY + washLift,
      x + width * 0.67, washY - washLift * 0.62,
      washEnd, washY + washLift * 0.22
    );
    ctx.stroke();
  }

  // 半干的水粉在上一层颜料上拖过，会留下短而斑驳的“擦笔”。
  // 这些色块有方向却不铺满，避免退化成规则噪点或光滑渐变。
  for (var scumble = 0; scumble < scumbleCount; scumble++) {
    var scumbleX = x + width * (-0.04 + random() * 0.96);
    var scumbleY = y + height * (0.02 + random() * 0.94);
    var scumbleW = width * (0.07 + random() * 0.28);
    var scumbleH = Math.max(2, height * (0.004 + random() * 0.015));
    var scumbleColor = swatches[Math.floor(random() * swatches.length)];
    ctx.strokeStyle = colorAlpha(scumbleColor, (0.035 + random() * 0.045) * opacity);
    ctx.lineWidth = scumbleH;
    ctx.beginPath();
    ctx.moveTo(scumbleX, scumbleY);
    ctx.bezierCurveTo(
      scumbleX + scumbleW * 0.28, scumbleY + (random() - 0.5) * scumbleH * 2.4,
      scumbleX + scumbleW * 0.74, scumbleY + (random() - 0.5) * scumbleH * 1.8,
      scumbleX + scumbleW, scumbleY + (random() - 0.5) * scumbleH
    );
    if (ctx.setLineDash && scumble % 3 !== 0) {
      ctx.setLineDash([Math.max(2, width * (0.006 + random() * 0.009)), Math.max(1, width * (0.002 + random() * 0.006))]);
    }
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
  }

  // 颜料在粗纹纸凹处形成不均匀沉积；大小和透明度故意不一致。
  for (var grain = 0; grain < grainCount; grain++) {
    var grainX = x + random() * width;
    var grainY = y + random() * height;
    var grainR = Math.max(0.35, width * (0.00065 + random() * 0.0019));
    var grainColor = grain % 11 === 0 ? '#D8C58E' : (grain % 3 === 0 ? '#879AC1' : '#4E6895');
    ctx.fillStyle = colorAlpha(grainColor, (0.016 + random() * 0.034) * opacity);
    ctx.beginPath();
    ctx.arc(grainX, grainY, grainR, 0, Math.PI * 2);
    ctx.fill();
  }

  // 极细纸纤维只在近看时可见，避免把背景做成噪点滤镜。
  ctx.lineWidth = Math.max(0.28, width * 0.00045);
  for (var fiber = 0; fiber < fiberCount; fiber++) {
    var fiberX = x + random() * width;
    var fiberY = y + random() * height;
    var fiberLength = width * (0.018 + random() * 0.048);
    var fiberTilt = (random() - 0.5) * 0.42;
    ctx.strokeStyle = colorAlpha(fiber % 5 === 0 ? '#D2BD84' : '#8FA1C2', (0.015 + random() * 0.022) * opacity);
    ctx.beginPath();
    ctx.moveTo(fiberX, fiberY);
    ctx.lineTo(fiberX + Math.cos(fiberTilt) * fiberLength, fiberY + Math.sin(fiberTilt) * fiberLength);
    ctx.stroke();
  }
  ctx.restore();
}

function drawArtworkAtmosphere(ctx, artwork, x, y, width, height, options) {
  options = options || {};
  var style = options.style || getArtworkStyle(artwork);
  var random = seededRandom(artworkSeed(artwork));
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  var sky = ctx.createLinearGradient(x, y, x, y + height);
  sky.addColorStop(0, '#061127');
  sky.addColorStop(0.52, '#0A1835');
  sky.addColorStop(1, '#151C3D');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, width, height);

  drawGouacheNightTexture(ctx, x, y, width, height, artworkSeed(artwork), 1, 1);

  var haze = ctx.createRadialGradient(
    x + width * (0.34 + random() * 0.28), y + height * 0.60,
    width * 0.02,
    x + width * 0.5, y + height * 0.62,
    Math.max(width, height) * 0.62
  );
  haze.addColorStop(0, colorAlpha(style.haze, 0.18));
  haze.addColorStop(0.5, colorAlpha(style.haze, 0.055));
  haze.addColorStop(1, colorAlpha(style.haze, 0));
  ctx.fillStyle = haze;
  ctx.fillRect(x, y, width, height);

  // 星光克制且偏暖：像旧书页上的少量金箔，不再铺满白色科技粒子。
  for (var i = 0; i < 18; i++) {
    var sx = x + random() * width;
    var sy = y + random() * height * 0.82;
    var sr = Math.max(0.28, width * (0.00075 + random() * 0.00165));
    var starColor = i % 5 === 0 ? '#F2CE78' : (i % 3 === 0 ? '#DCC99A' : '#E7D8B0');
    if (i % 7 === 0) drawFourPointStar(ctx, sx, sy, sr * 2.5, starColor, 0.24 + random() * 0.22);
    else {
      ctx.fillStyle = colorAlpha(starColor, 0.14 + random() * 0.28);
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 一道很淡的夜潮，给作品增加前景层次，但不与真实笔迹争夺注意力。
  ctx.strokeStyle = colorAlpha(style.accent, 0.08);
  ctx.lineWidth = Math.max(0.6, width * 0.002);
  ctx.beginPath();
  ctx.moveTo(x + width * 0.12, y + height * 0.86);
  ctx.bezierCurveTo(x + width * 0.32, y + height * 0.80, x + width * 0.69, y + height * 0.93, x + width * 0.9, y + height * 0.84);
  ctx.stroke();
  ctx.restore();
  return style;
}

function drawFourPointStar(ctx, x, y, radius, color, alpha) {
  ctx.save();
  ctx.fillStyle = colorAlpha(color, alpha);
  ctx.shadowColor = color;
  ctx.shadowBlur = radius * 2.4;
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius * 0.22, y - radius * 0.22);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x + radius * 0.22, y + radius * 0.22);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius * 0.22, y + radius * 0.22);
  ctx.lineTo(x - radius, y);
  ctx.lineTo(x - radius * 0.22, y - radius * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function angleDifference(a, b) {
  var diff = a - b;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function analyseFireworkPath(points, baseSize) {
  var total = 0;
  var curvature = 0;
  var pauses = 0;
  var previousAngle = null;
  for (var i = 1; i < points.length; i++) {
    var dx = points[i].x - points[i - 1].x;
    var dy = points[i].y - points[i - 1].y;
    var segment = Math.sqrt(dx * dx + dy * dy);
    if (segment < 0.1) continue;
    total += segment;
    var angle = Math.atan2(dy, dx);
    if (previousAngle !== null) curvature += Math.abs(angleDifference(angle, previousAngle));
    previousAngle = angle;
    if (typeof points[i].t === 'number' && typeof points[i - 1].t === 'number' &&
        points[i].t - points[i - 1].t > 0.16) pauses++;
  }
  var directX = points[points.length - 1].x - points[0].x;
  var directY = points[points.length - 1].y - points[0].y;
  var direct = Math.sqrt(directX * directX + directY * directY);
  var firstTime = points[0].t;
  var lastTime = points[points.length - 1].t;
  var duration = typeof firstTime === 'number' && typeof lastTime === 'number'
    ? Math.max(0.12, lastTime - firstTime)
    : Math.max(0.4, total / Math.max(1, baseSize * 0.22));
  var guide = points[Math.min(points.length - 1, 4)];
  return {
    length: total,
    directness: total > 0 ? clamp(direct / total, 0, 1) : 1,
    curvature: curvature,
    pauseCount: pauses,
    speed: total / duration,
    angle: Math.atan2(points[0].y - guide.y, points[0].x - guide.x)
  };
}

function quadraticPoint(start, control, end, progress) {
  var inv = 1 - progress;
  return {
    x: inv * inv * start.x + 2 * inv * progress * control.x + progress * progress * end.x,
    y: inv * inv * start.y + 2 * inv * progress * control.y + progress * progress * end.y
  };
}

var FIREWORK_COLOR_WHEEL = [
  '#F5C86A', // 月金
  '#FFF4D8', // 暖白
  '#E8C58A', // 香槟
  '#D8C8E8', // 雾紫
  '#C7DDEA', // 冰蓝
  '#E8C8C9', // 淡粉
  '#FFF9EA'  // 星芯白
];

var STAR_FLOWER_PALETTES = {
  main: ['#FFD476', '#FFF9E8', '#F0B94F'],
  violet: ['#C9AEF2', '#FFF2DF', '#F3CC76'],
  ice: ['#A9DDF1', '#FFF8E8', '#EFC56C'],
  rose: ['#F0BBC4', '#FFF3E4', '#E5BE68'],
  champagne: ['#F2D294', '#FFF9EA', '#BBD9EA'],
  comet: ['#E9C68E', '#FFF0C4', '#FFF9EA'],
  aurora: ['#9DDDE1', '#D7C0F2', '#FFF5D6'],
  pearl: ['#E7ECF3', '#B8D9ED', '#F2D9A0'],
  lilac: ['#C5A9E8', '#F0C6D9', '#FFF1D0'],
  dawn: ['#F1B8B5', '#F4D7A4', '#FFF4DF'],
  moonblue: ['#AFCBF0', '#F5E9C9', '#D0B6E8']
};

// 每套构图都规定五朵花在缩略图里的视觉骨架。坐标按 rank（主花到远景）排列，
// 因此即便五颗星的初始位置固定，最终成品也不会继续复制同一张模板。
var FIREWORK_LAYOUTS = [
  // 月牙：主花偏左下，余光沿弧线向右上展开。
  [[0.31,0.58],[0.48,0.39],[0.66,0.27],[0.77,0.48],[0.58,0.66]],
  // 对角：从左下向右上递进，适合速度快、方向感强的笔迹。
  [[0.72,0.25],[0.55,0.39],[0.39,0.53],[0.24,0.67],[0.75,0.63]],
  // 星冠：主花居中偏上，其余形成不完全拱顶。
  [[0.50,0.28],[0.25,0.42],[0.75,0.44],[0.36,0.64],[0.64,0.66]],
  // 漩涡：花火围绕留白旋转，中心不放最大的光。
  [[0.67,0.53],[0.56,0.25],[0.29,0.34],[0.27,0.66],[0.51,0.70]],
  // 星岛：一大一小两组分离，保留大片深蓝负空间。
  [[0.27,0.34],[0.72,0.59],[0.61,0.31],[0.37,0.67],[0.79,0.27]],
  // 光雨：顶部开花，余烬向下错落。
  [[0.42,0.24],[0.68,0.29],[0.25,0.40],[0.55,0.56],[0.76,0.68]],
  // 双星：两朵较大的花隔空回应，小花在中间连接。
  [[0.28,0.48],[0.73,0.43],[0.50,0.27],[0.48,0.62],[0.67,0.70]],
  // 地平线：主花从低处升起，上方保持开阔。
  [[0.62,0.63],[0.30,0.58],[0.48,0.42],[0.76,0.34],[0.22,0.30]]
];

var FIREWORK_SCALE_PROFILES = [
  [1.56,1.02,0.82,0.58,0.47],
  [1.34,1.22,0.76,0.56,0.48],
  [1.44,0.96,0.91,0.67,0.43],
  [1.24,1.08,0.98,0.61,0.52],
  [1.62,0.82,0.73,0.64,0.55]
];

var FIREWORK_THEME_PALETTES = {
  moon: [STAR_FLOWER_PALETTES.main, STAR_FLOWER_PALETTES.champagne, STAR_FLOWER_PALETTES.violet, STAR_FLOWER_PALETTES.ice, STAR_FLOWER_PALETTES.rose],
  aurora: [STAR_FLOWER_PALETTES.aurora, STAR_FLOWER_PALETTES.ice, STAR_FLOWER_PALETTES.violet, STAR_FLOWER_PALETTES.champagne, STAR_FLOWER_PALETTES.main],
  blush: [STAR_FLOWER_PALETTES.dawn, STAR_FLOWER_PALETTES.rose, STAR_FLOWER_PALETTES.champagne, STAR_FLOWER_PALETTES.violet, STAR_FLOWER_PALETTES.main],
  pearl: [STAR_FLOWER_PALETTES.pearl, STAR_FLOWER_PALETTES.ice, STAR_FLOWER_PALETTES.champagne, STAR_FLOWER_PALETTES.moonblue, STAR_FLOWER_PALETTES.rose],
  lilac: [STAR_FLOWER_PALETTES.lilac, STAR_FLOWER_PALETTES.violet, STAR_FLOWER_PALETTES.rose, STAR_FLOWER_PALETTES.ice, STAR_FLOWER_PALETTES.champagne],
  champagne: [STAR_FLOWER_PALETTES.champagne, STAR_FLOWER_PALETTES.main, STAR_FLOWER_PALETTES.dawn, STAR_FLOWER_PALETTES.pearl, STAR_FLOWER_PALETTES.violet]
};

function chooseGestureKind(metrics, fallbackIndex) {
  if (metrics.pauseCount >= 2) return 'dandelion';
  if (metrics.curvature >= Math.PI * 1.65) return 'halo';
  if (metrics.directness >= 0.78 && metrics.speed > 0.1) return 'comet';
  if (metrics.directness <= 0.42) return 'willow';
  return FIREWORK_KIND_NAMES[fallbackIndex % FIREWORK_KIND_NAMES.length];
}

function getFireworkGenome(artwork) {
  var seed = artworkSeed(artwork);
  var genes = fireworkGenesFromSeed(seed);
  var random = seededRandom((seed ^ 0xA511E9B3) >>> 0);
  var layout = FIREWORK_LAYOUTS[genes.layoutIndex].map(function (point, rank) {
    var direction = genes.mirror ? -1 : 1;
    var x = genes.mirror ? 1 - point[0] : point[0];
    var focusX = ((genes.focusIndex % 3) - 1) * 0.035;
    var focusY = (Math.floor(genes.focusIndex / 3) - 0.5) * 0.035;
    return {
      x: clamp(x + focusX * direction + (random() - 0.5) * (rank === 0 ? 0.025 : 0.045), 0.18, 0.82),
      y: clamp(point[1] + focusY + (random() - 0.5) * 0.04, 0.18, 0.72)
    };
  });
  var themeName = FIREWORK_THEME_NAMES[genes.themeIndex];
  var mainKind = FIREWORK_KIND_NAMES[genes.mainKindIndex];
  return {
    version: 2,
    seed: seed,
    signature: fireworkSignature(seed),
    layout: FIREWORK_LAYOUT_NAMES[genes.layoutIndex],
    layoutIndex: genes.layoutIndex,
    focusIndex: genes.focusIndex,
    theme: themeName,
    mainKind: mainKind,
    mirror: genes.mirror,
    positions: layout,
    scaleProfile: FIREWORK_SCALE_PROFILES[genes.scaleIndex].slice(),
    paletteSet: FIREWORK_THEME_PALETTES[themeName]
  };
}

function arrangeFireworkEntries(ranked, genome, stage) {
  var random = seededRandom((genome.seed ^ 0x7F4A7C15) >>> 0);
  ranked.forEach(function (entry, rank) {
    var placement = genome.positions[rank % genome.positions.length];
    var source = entry.mapped[0];
    // 取用户真正牵动的前半段作为轻微偏移，让手势参与构图，但不再被固定起点绑死。
    var landmark = pointAlongPolyline(entry.mapped, 0.22 + rank * 0.035);
    var gestureX = clamp((landmark.x - source.x) / Math.max(1, stage.width), -0.16, 0.16);
    var gestureY = clamp((landmark.y - source.y) / Math.max(1, stage.height), -0.12, 0.12);
    entry.scaleMultiplier = genome.scaleProfile[rank] * (0.94 + random() * 0.12);
    // 根据这一朵的真实半径动态留边，避免主花在手机竖屏或作品集横图里被硬裁掉。
    var baseSize = Math.min(stage.width, stage.height);
    var bloomExtent = baseSize * 0.186 * entry.scaleMultiplier;
    var marginX = clamp(bloomExtent / Math.max(1, stage.width), rank === 0 ? 0.18 : 0.11, 0.31);
    var marginY = clamp(bloomExtent / Math.max(1, stage.height), rank === 0 ? 0.14 : 0.10, 0.28);
    entry.sourceCenter = { x: source.x, y: source.y };
    entry.center = {
      x: stage.x + stage.width * clamp(placement.x + gestureX * 0.28, marginX, 1 - marginX),
      y: stage.y + stage.height * clamp(placement.y + gestureY * 0.22, marginY, Math.min(0.78, 1 - marginY))
    };
    entry.palette = genome.paletteSet[rank % genome.paletteSet.length].slice();
    entry.burstKind = rank === 0
      ? genome.mainKind
      : chooseGestureKind(entry.metrics, genome.layoutIndex + rank + Math.floor(random() * 3));
  });
}

// 星芯仍是月金和暖白，只在花瓣边缘加入极少量雾紫、冰蓝与淡粉。
// 这样远看仍是一片温暖夜空，近看才发现每一朵有自己的色温。
function fireworkPalette(primary, pathIndex, seed, kind, rank) {
  var family = STAR_FLOWER_PALETTES[kind];
  if (!family && typeof rank === 'number') {
    family = STAR_FLOWER_PALETTES[['main', 'violet', 'ice', 'rose', 'champagne'][rank % 5]];
  }
  if (family) return family.slice();
  var offset = (seed + pathIndex) % FIREWORK_COLOR_WHEEL.length;
  return [
    FIREWORK_COLOR_WHEEL[offset],
    FIREWORK_COLOR_WHEEL[(offset + 1) % FIREWORK_COLOR_WHEEL.length],
    '#FFF7E2'
  ];
}

function pointAlongPolyline(points, progress) {
  if (!points || !points.length) return { x: 0, y: 0 };
  if (points.length === 1 || progress <= 0) return points[0];
  if (progress >= 1) return points[points.length - 1];
  var total = 0;
  var lengths = [];
  for (var i = 1; i < points.length; i++) {
    var dx = points[i].x - points[i - 1].x;
    var dy = points[i].y - points[i - 1].y;
    var length = Math.sqrt(dx * dx + dy * dy);
    lengths.push(length);
    total += length;
  }
  if (total <= 0.001) return points[0];
  var target = total * progress;
  var walked = 0;
  for (i = 0; i < lengths.length; i++) {
    if (walked + lengths[i] >= target) {
      var mix = lengths[i] > 0 ? (target - walked) / lengths[i] : 0;
      return interpolatePoint(points[i], points[i + 1], mix);
    }
    walked += lengths[i];
  }
  return points[points.length - 1];
}

function drawReturningStar(ctx, entry, progress, burstAt, baseSize, width, seed) {
  var riseStart = Math.max(0.015, burstAt - 0.22);
  var rise = clamp((progress - riseStart) / Math.max(0.01, burstAt - riseStart), 0, 1);
  if (rise <= 0 || rise >= 1) return;
  // 慢起、慢停，像被夜空轻轻接住；避免前半程一下跳到高处。
  var eased = rise * rise * (3 - 2 * rise);
  var routeProgress = 1 - eased;
  var position = pointAlongPolyline(entry.mapped, routeProgress);
  // 离开用户的牵星路径后，再轻轻滑向本夜专属构图的位置。
  // 这样既能看懂“星星从哪里来”，又不会被固定起点锁成千篇一律的烟花。
  var composeLift = clamp((eased - 0.66) / 0.34, 0, 1);
  composeLift = composeLift * composeLift * (3 - 2 * composeLift);
  position = interpolatePoint(position, entry.center, composeLift);
  var palette = entry.palette || fireworkPalette(null, entry.index, seed, 'comet');
  var starColor = palette[entry.index % 2];

  // 星河尾迹始终留在用户自己的笔迹上，让观众看懂烟花从哪里来。
  for (var trail = 6; trail >= 1; trail--) {
    var trailEase = Math.max(0, eased - trail * 0.043);
    var trailPosition = pointAlongPolyline(entry.mapped, 1 - trailEase);
    var trailLift = clamp((trailEase - 0.66) / 0.34, 0, 1);
    trailLift = trailLift * trailLift * (3 - 2 * trailLift);
    trailPosition = interpolatePoint(trailPosition, entry.center, trailLift);
    var trailRadius = Math.max(0.46, width * (0.0026 - trail * 0.00025));
    ctx.fillStyle = colorAlpha(trail % 3 === 0 ? '#FFF9EA' : starColor, (0.42 - trail * 0.045) * Math.sin(Math.PI * rise));
    ctx.beginPath();
    ctx.arc(trailPosition.x, trailPosition.y, trailRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  var glowRadius = Math.max(12, baseSize * 0.055);
  var glow = ctx.createRadialGradient(position.x, position.y, 0, position.x, position.y, glowRadius);
  glow.addColorStop(0, colorAlpha('#FFF9EA', 0.32));
  glow.addColorStop(0.32, colorAlpha(starColor, 0.15));
  glow.addColorStop(1, colorAlpha(starColor, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(position.x, position.y, glowRadius, 0, Math.PI * 2);
  ctx.fill();
  drawFourPointStar(ctx, position.x, position.y, Math.max(2.3, width * 0.0072), '#FFF9EA', 0.92);
}

// 用短段重画一根金箔光弧，使线宽和亮度从爆发中心向外自然收束。
// 宽而柔的底光负责水彩晕染，清晰内芯与断续金粉负责真正的烟花动势。
function drawStarFlowerFilament(ctx, center, angle, length, bend, droop, reveal, color, accent, alpha, lineWidth, grainCount, seed) {
  if (reveal <= 0.01) return null;
  var random = seededRandom(seed >>> 0);
  var nx = Math.cos(angle);
  var ny = Math.sin(angle);
  var px = -ny;
  var py = nx;
  var inner = length * 0.045 * reveal;
  var start = { x: center.x + nx * inner, y: center.y + ny * inner };
  var end = {
    x: center.x + nx * length * reveal,
    y: center.y + ny * length * reveal + droop * reveal * reveal
  };
  var control = {
    x: center.x + nx * length * 0.52 * reveal + px * bend * reveal,
    y: center.y + ny * length * 0.52 * reveal + py * bend * reveal + droop * 0.2 * reveal
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = colorAlpha(color, alpha * 0.20);
  ctx.lineWidth = lineWidth * 5.4;
  ctx.shadowColor = color;
  ctx.shadowBlur = lineWidth * 7.2;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
  ctx.stroke();
  ctx.shadowBlur = 0;

  var previous = start;
  var segments = 11;
  for (var segment = 1; segment <= segments; segment++) {
    var u = segment / segments;
    var point = quadraticPoint(start, control, end, u);
    var breathe = 0.76 + Math.sin(Math.PI * u) * 0.24;
    var brokenTip = u > 0.80 && segment % 3 === 0 ? 0.42 : 1;
    ctx.strokeStyle = colorAlpha(segment > 7 && segment % 2 === 0 ? accent : color, alpha * breathe * (1 - u * 0.28) * brokenTip);
    ctx.lineWidth = Math.max(0.32, lineWidth * (1.28 - u * 0.92));
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    previous = point;
  }

  for (var grain = 0; grain < grainCount; grain++) {
    var grainU = (grain + 1) / (grainCount + 1);
    var grainPoint = quadraticPoint(start, control, end, grainU);
    var grainSize = Math.max(0.48, lineWidth * (0.78 + random() * 0.52));
    ctx.fillStyle = colorAlpha(grain === grainCount - 1 ? accent : color, alpha * (0.52 + grainU * 0.34));
    ctx.beginPath();
    ctx.arc(
      grainPoint.x + px * (random() - 0.5) * lineWidth * 1.8,
      grainPoint.y + py * (random() - 0.5) * lineWidth * 1.8,
      grainSize,
      0, Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
  return end;
}

function softenFinalPath(points) {
  if (!points || points.length < 3) return (points || []).slice();
  var sampled = [];
  var step = Math.max(1, Math.ceil(points.length / 72));
  for (var i = 0; i < points.length; i += step) sampled.push(points[i]);
  if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]);
  for (var pass = 0; pass < 2; pass++) {
    var softened = [sampled[0]];
    for (var p = 1; p < sampled.length - 1; p++) {
      softened.push({
        x: sampled[p - 1].x * 0.18 + sampled[p].x * 0.64 + sampled[p + 1].x * 0.18,
        y: sampled[p - 1].y * 0.18 + sampled[p].y * 0.64 + sampled[p + 1].y * 0.18,
        w: sampled[p].w,
        t: sampled[p].t
      });
    }
    softened.push(sampled[sampled.length - 1]);
    sampled = softened;
  }
  return sampled;
}

// 按真实路程截取路径。成品不必把五道线都画到同一个船舱里；
// 留下抵达前的最后一小段想象空间，交汇处就不会变成发光线团。
function slicePathByLength(points, keepRatio) {
  if (!points || points.length < 2 || keepRatio >= 0.999) return (points || []).slice();
  keepRatio = clamp(keepRatio, 0.1, 1);
  var lengths = [];
  var total = 0;
  for (var i = 1; i < points.length; i++) {
    var dx = points[i].x - points[i - 1].x;
    var dy = points[i].y - points[i - 1].y;
    var length = Math.sqrt(dx * dx + dy * dy);
    lengths.push(length);
    total += length;
  }
  if (total <= 0.001) return points.slice();
  var wanted = total * keepRatio;
  var result = [points[0]];
  var walked = 0;
  for (i = 0; i < lengths.length; i++) {
    if (walked + lengths[i] >= wanted) {
      var mix = lengths[i] > 0 ? (wanted - walked) / lengths[i] : 0;
      result.push(interpolatePoint(points[i], points[i + 1], mix));
      break;
    }
    result.push(points[i + 1]);
    walked += lengths[i];
  }
  return result;
}

function drawDissolvingDust(ctx, points, color, alpha, baseWidth, seed, rank) {
  if (!points || points.length < 4) return;
  var random = seededRandom((seed ^ ((rank + 19) * 2654435761)) >>> 0);
  ctx.save();
  for (var i = 2; i < points.length - 1; i += 4 + rank) {
    var progress = i / (points.length - 1);
    if (progress < 0.32 && random() > 0.34) continue;
    var p = points[i];
    var before = points[i - 1];
    var dx = p.x - before.x;
    var dy = p.y - before.y;
    var length = Math.sqrt(dx * dx + dy * dy) || 1;
    var side = (random() - 0.5) * baseWidth * (4.8 + rank * 0.8);
    var px = p.x - dy / length * side;
    var py = p.y + dx / length * side;
    var radius = Math.max(0.36, baseWidth * (0.18 + random() * 0.22));
    ctx.fillStyle = colorAlpha(i % 3 === 0 ? '#FFF7E2' : color, alpha * (0.36 + progress * 0.42));
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function strokeRibbonSegment(ctx, points, index, color, alpha, width, separatorAlpha, glowScale) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 每一小段先铺一层夜色，再落下月光。后画的线会在交叉处自然从上方穿过，
  // 留出极细的暗缝，避免多条路线黏成一根粗亮管。
  ctx.beginPath();
  curveSegment(ctx, points, index, 0, 0);
  ctx.strokeStyle = colorAlpha('#080B18', separatorAlpha);
  ctx.lineWidth = width * 1.72;
  ctx.stroke();

  ctx.beginPath();
  curveSegment(ctx, points, index, 0, 0);
  ctx.strokeStyle = colorAlpha(color, alpha * 0.085);
  ctx.lineWidth = width * (glowScale || 2.45);
  ctx.stroke();

  ctx.beginPath();
  curveSegment(ctx, points, index, 0, 0);
  ctx.strokeStyle = colorAlpha(color, alpha * 0.58);
  ctx.lineWidth = width;
  ctx.stroke();

  ctx.beginPath();
  curveSegment(ctx, points, index, 0, 0);
  ctx.strokeStyle = colorAlpha('#FFF7E2', alpha * 0.28);
  ctx.lineWidth = Math.max(0.34, width * 0.19);
  ctx.stroke();
  ctx.restore();
}

// 成品专用“月光丝带”。实时绘制仍使用原笔刷；只有呼吸结束后的作品、
// 收藏与海报会使用这一层柔化重绘，原始坐标与路径方向完全保留。
function drawFinalArtworkPaths(ctx, artwork, x, y, width, height, options) {
  options = options || {};
  var paths = artwork && artwork.paths || [];
  if (!paths.length) return;
  var baseSize = Math.min(width, height);
  var seed = artworkSeed(artwork);
  var entries = [];
  paths.forEach(function (path, index) {
    var mapped = options.mapping === 'normalized'
      ? mapNormalized(path.points || [], x, y, width, height)
      : mapArtwork(path.points || [], artwork, x, y, width, height, options.padding);
    if (mapped.length < 2) return;
    var points = softenFinalPath(mapped);
    var metrics = analyseFireworkPath(points, baseSize);
    entries.push({
      path: path,
      index: index,
      points: points,
      metrics: metrics,
      score: metrics.length * (0.84 + Math.min(2.4, metrics.curvature) * 0.1)
    });
  });
  if (!entries.length) return;

  var ranked = entries.slice().sort(function (a, b) {
    return b.score === a.score ? a.index - b.index : b.score - a.score;
  });
  ranked.forEach(function (entry, rank) { entry.rank = rank; });
  // 陪衬线先画，最长且最有表现力的一条最后落笔，形成自然主次。
  var drawingOrder = entries.slice().sort(function (a, b) { return b.rank - a.rank; });
  // 一条主星河承担构图，其余线条逐级退成薄雾与星尘。
  // 这是“装裱”而非代画：形状、速度、转折和颜色仍全部来自用户笔迹。
  var rankAlpha = [0.76, 0.36, 0.27, 0.20, 0.15];
  var rankWidthScale = [1, 0.80, 0.72, 0.66, 0.60];
  var keepRatios = [0.93, 0.84, 0.78, 0.72, 0.68];
  var dissolveStarts = [1, 0.68, 0.50, 0.42, 0.34];
  var transition = options.progress === undefined ? 1 : clamp(options.progress, 0, 1);
  // 星星开始绽放后，路不再是作品主体：主线退成月雾，陪衬线只留下若隐若现的记忆。
  // progress=0 时仍能看清“从哪里升空”，最终定格时则把视觉中心完全交还给烟花。
  var fireworkPathFade = 1 - transition * 0.96;
  var baseWidth = Math.max(0.82, width * 0.0033);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  drawingOrder.forEach(function (entry) {
    var points = slicePathByLength(entry.points, keepRatios[Math.min(keepRatios.length - 1, entry.rank)]);
    var color = entry.path.color || '#F4E8C9';
    var alpha = rankAlpha[Math.min(rankAlpha.length - 1, entry.rank)] * fireworkPathFade;
    var rankWidth = baseWidth * rankWidthScale[Math.min(rankWidthScale.length - 1, entry.rank)] * (1 - transition * 0.14);
    for (var i = 0; i < points.length - 1; i++) {
      var position = (i + 0.5) / Math.max(1, points.length - 1);
      var dissolveStart = dissolveStarts[Math.min(dissolveStarts.length - 1, entry.rank)];
      var dissolving = entry.rank > 0 && position > dissolveStart;
      // 越靠后的陪衬线留白越多，空缺处由同色星尘接续，不再形成一整根光管。
      var gapCycle = Math.max(3, 8 - entry.rank);
      var gapSpan = Math.min(gapCycle - 1, entry.rank + 1);
      if (dissolving && ((i + entry.index * 3) % gapCycle) < gapSpan) continue;
      var startDissolve = 0.16 + 0.84 * clamp(position / 0.17, 0, 1);
      var endTaper = 0.72 + 0.28 * clamp((1 - position) / 0.13, 0, 1);
      var breathingWidth = 0.58 + Math.pow(Math.sin(Math.PI * position), 0.72) * 0.42;
      var segmentWidth = rankWidth * breathingWidth * (0.94 + transition * 0.06);
      var dissolveFade = dissolving
        ? 1 - 0.46 * clamp((position - dissolveStart) / Math.max(0.01, 1 - dissolveStart), 0, 1)
        : 1;
      var segmentAlpha = alpha * startDissolve * endTaper * dissolveFade;
      strokeRibbonSegment(ctx, points, i, color, segmentAlpha, segmentWidth, 0.075 + entry.rank * 0.008, entry.rank === 0 ? 2.65 : 2.1);
    }
    if (entry.rank > 0) drawDissolvingDust(ctx, points, color, alpha, rankWidth, seed + entry.index * 97, entry.rank);

    // 静态成品用少量微粒柔化起笔；回归动画中暂时隐藏，避免未抵达的星提前“开花”。
    if (options.startDust !== false) {
      var random = seededRandom((seed ^ ((entry.index + 11) * 2246822519)) >>> 0);
      var palette = fireworkPalette(color, entry.index, seed);
      var start = points[0];
      var toward = points[Math.min(points.length - 1, Math.max(2, Math.round(points.length * 0.12)))];
      var dx = toward.x - start.x;
      var dy = toward.y - start.y;
      var length = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / length;
      var ny = dx / length;
      var startDustCount = entry.rank === 0 ? 7 : Math.max(3, 6 - entry.rank);
      for (var dust = 0; dust < startDustCount; dust++) {
        var along = random() * Math.min(baseSize * 0.06, length * 0.72);
        var side = (random() - 0.5) * baseSize * 0.022;
        var dustX = start.x + dx / length * along + nx * side;
        var dustY = start.y + dy / length * along + ny * side;
        var dustColor = palette[(dust + entry.index) % palette.length];
        ctx.fillStyle = colorAlpha(dustColor, (0.24 + random() * 0.34) * transition);
        ctx.beginPath();
        ctx.arc(dustX, dustY, Math.max(0.42, width * (0.0009 + random() * 0.001)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  ctx.restore();
}

// 将五条笔迹编排成一场“金箔水彩烟花”：一朵主焰、两朵中景、两朵远景。
// 笔迹决定尺度、转向、弧度和碎金密度；烟花本身用成组分叉与断裂余烬呈现，不再像植物线稿。
function drawStarFlowerComposition(ctx, ranked, stage) {
  var roleAlpha = [1, 0.86, 0.76, 0.52, 0.44];

  // 先铺极淡的失焦光团，制造远、中、近三层夜空，而不是把所有粒子贴在同一平面。
  ranked.slice().reverse().forEach(function (entry) {
    var burstAt = 0.18 + entry.index * 0.10;
    var local = clamp((stage.progress - burstAt) / 0.36, 0, 1);
    if (local <= 0) return;
    var lengthNorm = stage.maxLength > stage.minLength
      ? (entry.metrics.length - stage.minLength) / (stage.maxLength - stage.minLength)
      : 0.5;
    var radius = stage.baseSize * (0.136 + lengthNorm * 0.036) * (entry.scaleMultiplier || stage.rankScale[Math.min(stage.rankScale.length - 1, entry.rank)]);
    var palette = entry.palette || fireworkPalette(null, entry.index, stage.seed, null, entry.rank);
    // 动物烟花成形时，所有花火都退成背景余光；不能让普通放射形压住最终头像。
    var remnantFloor = entry.rank === 0 ? 0.028 : (entry.rank <= 2 ? 0.012 : 0);
    var sealFade = remnantFloor + (1 - remnantFloor) * (1 - (stage.sealReveal || 0));
    var glow = ctx.createRadialGradient(entry.center.x, entry.center.y, 0, entry.center.x, entry.center.y, radius * 1.58 * local);
    glow.addColorStop(0, colorAlpha('#FFF9EA', roleAlpha[entry.rank] * 0.28 * local * sealFade));
    glow.addColorStop(0.20, colorAlpha(palette[0], roleAlpha[entry.rank] * 0.13 * local * sealFade));
    glow.addColorStop(0.52, colorAlpha(palette[0], roleAlpha[entry.rank] * 0.038 * local * sealFade));
    glow.addColorStop(1, colorAlpha(palette[0], 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(entry.center.x, entry.center.y, radius * 1.58 * local, 0, Math.PI * 2);
    ctx.fill();
  });

  ranked.forEach(function (entry) {
    var metrics = entry.metrics;
    var burstAt = 0.18 + entry.index * 0.10;
    var local = clamp((stage.progress - burstAt) / 0.36, 0, 1);
    if (local <= 0) return;
    var bloom = 1 - Math.pow(1 - local, 3);
    var settle = clamp((local - 0.68) / 0.32, 0, 1);
    var lengthNorm = stage.maxLength > stage.minLength
      ? (metrics.length - stage.minLength) / (stage.maxLength - stage.minLength)
      : 0.5;
    var speedNorm = stage.maxSpeed > stage.minSpeed
      ? (metrics.speed - stage.minSpeed) / (stage.maxSpeed - stage.minSpeed)
      : 0.5;
    var radius = stage.baseSize * (0.136 + lengthNorm * 0.036) * (entry.scaleMultiplier || stage.rankScale[Math.min(stage.rankScale.length - 1, entry.rank)]);
    var palette = entry.palette || fireworkPalette(null, entry.index, stage.seed, null, entry.rank);
    var kind = entry.burstKind || 'peony';
    var random = seededRandom((stage.seed ^ ((entry.index + 1) * 2654435761)) >>> 0);
    var baseAngle = metrics.angle + (random() - 0.5) * 0.18;
    var curveStrength = clamp(metrics.curvature / Math.PI, 0.08, 1);
    var flowerAlpha = roleAlpha[Math.min(roleAlpha.length - 1, entry.rank)];
    var remnantAlpha = entry.rank === 0 ? 0.028 : (entry.rank <= 2 ? 0.012 : 0);
    flowerAlpha *= remnantAlpha + (1 - remnantAlpha) * (1 - (stage.sealReveal || 0));

    // 主花拥有一束几乎不可见的体积光，把宏大感交给构图，而不是白色爆闪。
    if (entry.rank === 0) {
      var beamReveal = clamp((local - 0.12) / 0.58, 0, 1);
      var beamFade = 1 - (stage.sealReveal || 0);
      var beam = ctx.createLinearGradient(entry.center.x, entry.center.y, entry.center.x, stage.y + stage.height * 0.90);
      beam.addColorStop(0, colorAlpha('#FFF4D8', 0.045 * beamReveal * beamFade));
      beam.addColorStop(0.55, colorAlpha('#E8C58A', 0.014 * beamReveal * beamFade));
      beam.addColorStop(1, colorAlpha('#E8C58A', 0));
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(entry.center.x - radius * 0.08, entry.center.y);
      ctx.lineTo(entry.center.x + radius * 0.55, stage.y + stage.height * 0.90);
      ctx.lineTo(entry.center.x - radius * 0.55, stage.y + stage.height * 0.90);
      ctx.closePath();
      ctx.fill();
    }

    // 第一拍是紧凑而明亮的内爆，不靠大量细线营造“满”，而是明确告诉眼睛爆发中心在哪里。
    var ignitionReveal = clamp(local / 0.34, 0, 1);
    var ignitionCount = entry.rank === 0 ? 14 : (entry.rank <= 2 ? 10 : 7);
    if (kind === 'dandelion' || kind === 'halo') ignitionCount += 4;
    if (kind === 'comet' || kind === 'fan') ignitionCount = Math.max(7, ignitionCount - 3);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (var ignition = 0; ignition < ignitionCount; ignition++) {
      var ignitionAngle = baseAngle + ignition / ignitionCount * Math.PI * 2 + (random() - 0.5) * 0.11;
      var ignitionLength = radius * (0.22 + random() * 0.20) * bloom;
      var ignitionStart = radius * 0.035 * bloom;
      ctx.strokeStyle = colorAlpha(ignition % 4 === 0 ? palette[1] : palette[0], flowerAlpha * (0.42 + random() * 0.20) * ignitionReveal);
      ctx.lineWidth = Math.max(0.55, stage.width * (entry.rank === 0 ? 0.00175 : 0.00118));
      ctx.beginPath();
      ctx.moveTo(entry.center.x + Math.cos(ignitionAngle) * ignitionStart, entry.center.y + Math.sin(ignitionAngle) * ignitionStart);
      ctx.lineTo(entry.center.x + Math.cos(ignitionAngle) * ignitionLength, entry.center.y + Math.sin(ignitionAngle) * ignitionLength);
      ctx.stroke();
    }

    // 主体不再是一圈均匀“花瓣”，而是成组分叉的火雨：每束有一根主弧和一至两根近邻光弧。
    var branchCount = entry.rank === 0 ? 12 : (entry.rank <= 2 ? 9 : 7);
    if (kind === 'dandelion') branchCount += 7;
    else if (kind === 'halo') branchCount += 5;
    else if (kind === 'willow') branchCount -= 1;
    else if (kind === 'comet' || kind === 'fan') branchCount -= 2;
    branchCount = Math.max(6, branchCount - Math.round(speedNorm));
    for (var branch = 0; branch < branchCount; branch++) {
      var angleProgress = branchCount <= 1 ? 0.5 : branch / (branchCount - 1);
      var familyAngle;
      if (kind === 'fan') {
        familyAngle = baseAngle - Math.PI * 0.56 + angleProgress * Math.PI * 1.12;
      } else if (kind === 'comet') {
        familyAngle = baseAngle - Math.PI * 0.38 + angleProgress * Math.PI * 0.76;
      } else {
        familyAngle = baseAngle + branch / branchCount * Math.PI * 2;
      }
      familyAngle += Math.sin((branch + 1) * 1.61 + entry.index) * 0.055 + (random() - 0.5) * 0.065;
      var vertical = 0.88 + metrics.directness * 0.07;
      var ellipseLength = Math.sqrt(Math.cos(familyAngle) * Math.cos(familyAngle) + Math.sin(familyAngle) * Math.sin(familyAngle) * vertical * vertical);
      var kindLength = kind === 'willow' ? 1.12 : (kind === 'halo' ? 0.88 : (kind === 'dandelion' ? 0.92 : 1));
      var familyLength = radius * ellipseLength * (0.82 + random() * 0.22) * kindLength;
      var siblingCount = entry.rank === 0 ? 3 : (entry.rank <= 2 ? 2 : 1);
      if (kind === 'halo' || kind === 'dandelion') siblingCount = 1;
      if (kind === 'fan' && entry.rank <= 2) siblingCount = Math.max(2, siblingCount);
      var bendScale = kind === 'willow' ? 1.48 : (kind === 'halo' ? 0.28 : (kind === 'comet' ? 0.62 : 1));
      var familyBend = (branch % 2 === 0 ? 1 : -1) * radius * (0.055 + curveStrength * 0.085) * bendScale;
      var centralTip = null;
      var familyReveal = clamp((local - (branch % 4) * 0.018) / 0.58, 0, 1);
      familyReveal = 1 - Math.pow(1 - familyReveal, 3);

      for (var sibling = 0; sibling < siblingCount; sibling++) {
        var siblingOffset = siblingCount === 1 ? 0 : (sibling - (siblingCount - 1) / 2);
        var arcAngle = familyAngle + siblingOffset * (0.034 + curveStrength * 0.012);
        var arcLength = familyLength * (1 - Math.abs(siblingOffset) * 0.08 + (random() - 0.5) * 0.045);
        var downward = Math.max(0, Math.sin(arcAngle));
        var droopScale = kind === 'willow' ? 2.15 : (kind === 'dandelion' ? 0.55 : (kind === 'halo' ? 0.28 : 1));
        var droop = settle * radius * (0.045 + downward * 0.12 + random() * 0.035) * droopScale;
        var arcWidth = Math.max(0.72, stage.width * (entry.rank === 0 ? 0.00275 : (entry.rank <= 2 ? 0.00205 : 0.00145)));
        arcWidth *= siblingOffset === 0 ? 1 : 0.76;
        var arcColor = sibling === 0 && branch % 3 === 0 ? palette[1] : palette[0];
        var tip = drawStarFlowerFilament(
          ctx,
          entry.center,
          arcAngle,
          arcLength,
          familyBend + siblingOffset * radius * 0.045,
          droop,
          familyReveal * bloom,
          arcColor,
          palette[2],
          flowerAlpha * (siblingOffset === 0 ? 0.76 : 0.58) * (1 - settle * 0.08),
          arcWidth,
          entry.rank === 0 ? 4 : (entry.rank <= 2 ? 3 : 2),
          stage.seed + entry.index * 1009 + branch * 79 + sibling * 17
        );
        if (siblingOffset === 0 || !centralTip) centralTip = tip;
      }

      // 每束末端不是一个圆点，而是向外继续飞散的碎金；局部失焦光斑形成水彩纸上的湿边。
      if (centralTip && familyReveal > 0.64) {
        var sparkCount = entry.rank === 0 ? 5 : (entry.rank <= 2 ? 4 : 3);
        if (kind === 'dandelion') sparkCount += 2;
        if (kind === 'halo') sparkCount = Math.max(2, sparkCount - 1);
        for (var spark = 0; spark < sparkCount; spark++) {
          var tangentX = -Math.sin(familyAngle);
          var tangentY = Math.cos(familyAngle);
          var outward = radius * (0.025 + random() * 0.15) * familyReveal;
          var side = (random() - 0.5) * radius * 0.12;
          var sparkX = centralTip.x + Math.cos(familyAngle) * outward + tangentX * side;
          var sparkY = centralTip.y + Math.sin(familyAngle) * outward + tangentY * side + settle * radius * random() * 0.08;
          var sparkColor = spark % 3 === 0 ? palette[2] : (spark % 2 === 0 ? palette[1] : palette[0]);
          var sparkSize = Math.max(0.58, stage.width * (0.00105 + random() * (entry.rank === 0 ? 0.00135 : 0.0009)));
          ctx.shadowColor = sparkColor;
          ctx.shadowBlur = sparkSize * (spark === 0 ? 7 : 3.5);
          if (spark === 0 && branch % 3 === 0) {
            drawFourPointStar(ctx, sparkX, sparkY, sparkSize * 2.25, sparkColor, flowerAlpha * 0.72);
          } else {
            ctx.fillStyle = colorAlpha(sparkColor, flowerAlpha * (0.48 + random() * 0.34));
            ctx.beginPath();
            ctx.arc(sparkX, sparkY, sparkSize, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.shadowBlur = 0;
        }
        if (branch % 3 === 0) {
          var wetSize = Math.max(5, stage.width * (entry.rank === 0 ? 0.012 : 0.008));
          var wet = ctx.createRadialGradient(centralTip.x, centralTip.y, 0, centralTip.x, centralTip.y, wetSize);
          wet.addColorStop(0, colorAlpha(palette[0], flowerAlpha * 0.11));
          wet.addColorStop(1, colorAlpha(palette[0], 0));
          ctx.fillStyle = wet;
          ctx.beginPath();
          ctx.arc(centralTip.x, centralTip.y, wetSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // 外围不是完整圆环，而是一圈疏密不均的余烬。停顿越多，留下的亮点越多。
    var orbitCount = (entry.rank === 0 ? 17 : (entry.rank <= 2 ? 11 : 7)) + Math.min(3, metrics.pauseCount);
    if (kind === 'halo') orbitCount += 9;
    if (kind === 'dandelion') orbitCount += 5;
    if (kind === 'comet' || kind === 'fan') orbitCount = Math.max(6, orbitCount - 4);
    for (var orbit = 0; orbit < orbitCount; orbit++) {
      var orbitAngle = baseAngle + orbit / orbitCount * Math.PI * 2 + (random() - 0.5) * 0.24;
      var orbitReveal = clamp((local - 0.42 - (orbit % 5) * 0.012) / 0.36, 0, 1);
      var orbitRadius = radius * (0.88 + random() * 0.34) * bloom;
      var orbitX = entry.center.x + Math.cos(orbitAngle) * orbitRadius;
      var orbitY = entry.center.y + Math.sin(orbitAngle) * orbitRadius + settle * radius * (0.035 + random() * 0.08);
      if (orbit % 5 === 0) {
        drawFourPointStar(ctx, orbitX, orbitY, Math.max(0.75, stage.width * (entry.rank === 0 ? 0.00235 : 0.0018)), palette[2], flowerAlpha * 0.62 * orbitReveal);
      } else {
        var orbitColor = orbit % 4 === 0 ? palette[1] : palette[0];
        var orbitSize = Math.max(0.46, stage.width * (0.0009 + random() * 0.00105));
        ctx.shadowColor = orbitColor;
        ctx.shadowBlur = orbitSize * 3.4;
        ctx.fillStyle = colorAlpha(orbitColor, flowerAlpha * (0.42 + random() * 0.30) * orbitReveal);
        ctx.beginPath();
        ctx.arc(orbitX, orbitY, orbitSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    if (settle > 0 && entry.rank <= 2) {
      var fallCount = entry.rank === 0 ? 11 : 5;
      for (var fall = 0; fall < fallCount; fall++) {
        var fallAngle = Math.PI * (0.18 + random() * 0.64);
        var fallDistance = radius * (0.46 + random() * 0.58);
        var fallX = entry.center.x + Math.cos(fallAngle) * fallDistance;
        var fallY = entry.center.y + Math.sin(fallAngle) * fallDistance + settle * radius * (0.12 + random() * 0.26);
        ctx.fillStyle = colorAlpha(fall % 3 === 0 ? palette[2] : palette[0], flowerAlpha * (0.20 + random() * 0.22) * settle);
        ctx.beginPath();
        ctx.arc(fallX, fallY, Math.max(0.38, stage.width * (0.00075 + random() * 0.00042)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 最亮处不是火药，而是原本那颗星：暖白光核先照亮水彩晕圈，中心仍保留清晰星形。
    var coreReveal = clamp(local / 0.30, 0, 1);
    var coreGlowSize = Math.max(14, radius * (entry.rank === 0 ? 0.25 : 0.21));
    var coreGlow = ctx.createRadialGradient(entry.center.x, entry.center.y, 0, entry.center.x, entry.center.y, coreGlowSize);
    coreGlow.addColorStop(0, colorAlpha('#FFFDF3', flowerAlpha * 0.92 * coreReveal));
    coreGlow.addColorStop(0.12, colorAlpha('#FFF4C8', flowerAlpha * 0.50 * coreReveal));
    coreGlow.addColorStop(0.42, colorAlpha(palette[0], flowerAlpha * 0.16 * coreReveal));
    coreGlow.addColorStop(1, colorAlpha(palette[0], 0));
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(entry.center.x, entry.center.y, coreGlowSize, 0, Math.PI * 2);
    ctx.fill();
    var coreRadius = Math.max(2.8, stage.width * (entry.rank === 0 ? 0.0105 : (entry.rank <= 2 ? 0.0078 : 0.0058)));
    drawFourPointStar(ctx, entry.center.x, entry.center.y, coreRadius, '#FFF9EA', flowerAlpha * 0.96 * coreReveal);
    ctx.fillStyle = colorAlpha('#F5C86A', flowerAlpha * 0.70 * coreReveal);
    ctx.beginPath();
    ctx.arc(entry.center.x, entry.center.y, Math.max(0.65, stage.width * 0.00175), 0, Math.PI * 2);
    ctx.fill();
  });
}

var ANIMAL_WORLDS = {
  rabbit: { environment: 'garden', motif: 'petal', accent: '#DCC9F3', horizon: '#756D98', body: '#B8A9CF', shadow: '#756D98', prop: '#F1D58F' },
  deer: { environment: 'forest', motif: 'branch', accent: '#E5C990', horizon: '#657B75', body: '#B79067', shadow: '#6D5D58', prop: '#F2D88F' },
  bear: { environment: 'forest', motif: 'lantern', accent: '#F0CA86', horizon: '#6E665A', body: '#A9896F', shadow: '#625A60', prop: '#EBC679' },
  fox: { environment: 'forest', motif: 'ribbon', accent: '#E8B184', horizon: '#735E72', body: '#B87969', shadow: '#6F5669', prop: '#D8A7B9' },
  cat: { environment: 'rooftop', motif: 'yarn', accent: '#C6B9EE', horizon: '#66698A', body: '#8584AD', shadow: '#565A82', prop: '#E0D5ED' },
  squirrel: { environment: 'forest', motif: 'acorn', accent: '#E4BE82', horizon: '#667464', body: '#A97D5F', shadow: '#655D58', prop: '#D7B476' },
  otter: { environment: 'water', motif: 'bubble', accent: '#9FCBDD', horizon: '#517587', body: '#8A766B', shadow: '#4F6472', prop: '#D8D0B7' },
  seal: { environment: 'polar', motif: 'snow', accent: '#B9D7EC', horizon: '#657F9C', body: '#A8B6C8', shadow: '#66738D', prop: '#CBE4F0' },
  whale: { environment: 'water', motif: 'bubble', accent: '#99CDE1', horizon: '#4F708E', body: '#7195B1', shadow: '#415D7E', prop: '#BDE6E8' },
  penguin: { environment: 'polar', motif: 'snow', accent: '#BBD9F0', horizon: '#627A99', body: '#59647D', shadow: '#333D5C', prop: '#D9B1B9' },
  hedgehog: { environment: 'forest', motif: 'leaf', accent: '#E2BE82', horizon: '#6E725F', body: '#9A765D', shadow: '#5E554F', prop: '#D9A884' },
  elephant: { environment: 'meadow', motif: 'mist', accent: '#B7C8E4', horizon: '#6E7890', body: '#8797B3', shadow: '#5A6480', prop: '#F0D089' },
  swan: { environment: 'water', motif: 'ripple', accent: '#D8D7ED', horizon: '#5C708C', body: '#C0C1D5', shadow: '#70758E', prop: '#EBCF91' },
  hummingbird: { environment: 'garden', motif: 'flower', accent: '#A9D8D2', horizon: '#667D7D', body: '#6FA39D', shadow: '#4D6E75', prop: '#E3A7B4' },
  butterfly: { environment: 'garden', motif: 'petal', accent: '#E7B7D0', horizon: '#756986', body: '#B38BB7', shadow: '#6B5E82', prop: '#F0D28D' },
  sheep: { environment: 'meadow', motif: 'cloud', accent: '#D7D5E8', horizon: '#707993', body: '#C4BFCC', shadow: '#72738D', prop: '#E3D5BC' }
};

// 每种动物拥有独立的镜头比例与身体光团，不再被统一压成同一张横向圆脸。
// glow 使用角色坐标：x、y、宽半径、高半径、暖光权重。
var ANIMAL_CHARACTER_FITS = {
  rabbit: { scale: 0.97, width: 0.92, height: 1.04, y: 0.015, tilt: 0.007, star: [0,0.285], glow: [[0,-0.12,0.25,0.21,1],[0.01,0.20,0.25,0.18,0.72]] },
  deer: { scale: 0.98, width: 0.96, height: 1.02, y: 0.020, tilt: 0.006, star: [0,-0.30], glow: [[-0.01,-0.10,0.24,0.20,1],[0.04,0.21,0.27,0.16,0.62]] },
  bear: { scale: 0.97, width: 1.00, height: 1.00, y: 0.018, tilt: 0.007, star: [0.015,0.285], glow: [[0,-0.13,0.27,0.22,1],[0,0.20,0.28,0.20,0.82]] },
  fox: { scale: 0.96, width: 1.07, height: 0.96, y: 0.022, tilt: 0.010, star: [0.30,0.26], glow: [[-0.02,-0.13,0.25,0.20,1],[0.08,0.21,0.36,0.17,0.70]] },
  cat: { scale: 1.08, width: 1.02, height: 1.04, y: 0.012, tilt: 0.006, star: [0.005,0.245], glow: [[0,-0.12,0.27,0.22,1],[0.01,0.20,0.30,0.22,0.82],[0.245,0.20,0.18,0.22,0.54]] },
  squirrel: { scale: 0.95, width: 1.04, height: 0.98, y: 0.020, tilt: 0.010, star: [0,0.26], glow: [[-0.05,-0.11,0.23,0.19,1],[0.13,0.14,0.35,0.26,0.72]] },
  otter: { scale: 0.96, width: 0.94, height: 1.04, y: 0.018, tilt: 0.008, star: [0,0.22], glow: [[0,-0.16,0.25,0.20,1],[0,0.16,0.25,0.28,0.76]] },
  seal: { scale: 0.96, width: 1.13, height: 0.88, y: 0.025, tilt: 0.010, star: [0.05,0.27], glow: [[0.03,-0.02,0.39,0.22,1],[0.03,0.16,0.32,0.16,0.55]] },
  whale: { scale: 0.96, width: 1.18, height: 0.84, y: 0.015, tilt: 0.008, star: [0.31,-0.22], glow: [[0.03,-0.01,0.42,0.20,1],[-0.20,0.05,0.21,0.15,0.52]] },
  penguin: { scale: 0.98, width: 0.88, height: 1.06, y: 0.018, tilt: 0.006, star: [0.22,0.24], glow: [[0,-0.13,0.23,0.20,1],[0,0.18,0.24,0.26,0.74]] },
  hedgehog: { scale: 0.96, width: 1.13, height: 0.90, y: 0.025, tilt: 0.008, star: [-0.03,0.28], glow: [[0.08,0.01,0.34,0.20,1],[-0.15,0.04,0.24,0.22,0.56]] },
  elephant: { scale: 0.98, width: 1.00, height: 1.00, y: 0.020, tilt: 0.006, star: [0.12,0.31], glow: [[0,-0.10,0.29,0.23,1],[0,0.20,0.29,0.17,0.56]] },
  swan: { scale: 0.98, width: 1.12, height: 0.96, y: 0.020, tilt: 0.006, star: [0.08,0.30], glow: [[0.12,0.13,0.34,0.17,0.78],[0.16,-0.18,0.16,0.25,1]] },
  hummingbird: { scale: 0.96, width: 1.16, height: 0.96, y: 0.010, tilt: 0.012, star: [0.40,-0.08], glow: [[0.12,0.02,0.24,0.17,1],[-0.14,-0.01,0.32,0.27,0.62]] },
  butterfly: { scale: 0.95, width: 1.08, height: 1.00, y: 0.012, tilt: 0.010, star: [0,0.38], glow: [[-0.18,0,0.24,0.29,0.62],[0.18,0,0.24,0.29,0.62],[0,0,0.11,0.25,1]] },
  sheep: { scale: 0.97, width: 1.02, height: 0.99, y: 0.022, tilt: 0.007, star: [0,0.30], glow: [[0,-0.10,0.27,0.21,1],[0,0.20,0.30,0.18,0.72]] }
};

function animalWorld(icon) {
  return ANIMAL_WORLDS[icon] || { environment: 'meadow', motif: 'mist', accent: '#D7C5E5', horizon: '#6B718C' };
}

// 四套绘本母场景。角色不再悬在同一张通用背景上；同类场景共享美术语言，
// 具体月相、地平线和光斑仍由作品种子决定。
function animalSceneKind(icon) {
  if (['rabbit', 'cat', 'elephant', 'sheep'].indexOf(icon) >= 0) return 'cloud';
  if (['deer', 'bear', 'fox', 'squirrel', 'hedgehog'].indexOf(icon) >= 0) return 'forest';
  if (['otter', 'seal', 'whale', 'swan'].indexOf(icon) >= 0) return 'lake';
  return 'starfield';
}

var ANIMAL_SCENE_META = {
  cloud: {
    key: 'cloud',
    name: '云上夜',
    line: '柔软的云层替今晚托住一点光。'
  },
  forest: {
    key: 'forest',
    name: '森林夜',
    line: '树影把喧闹留在远处，夜色慢慢安静。'
  },
  lake: {
    key: 'lake',
    name: '月湖夜',
    line: '月光落成碎碎的水纹，陪星星慢慢漂远。'
  },
  starfield: {
    key: 'starfield',
    name: '星原夜',
    line: '草坡留出一大片天空，让呼吸也变得开阔。'
  }
};

function animalSceneMeta(icon) {
  return ANIMAL_SCENE_META[animalSceneKind(icon)] || ANIMAL_SCENE_META.starfield;
}

function animalCharacterFit(icon) {
  return ANIMAL_CHARACTER_FITS[icon] || ANIMAL_CHARACTER_FITS.bear;
}

function animalSceneCenter(stage) {
  var horizontal = (((stage.seed >>> 5) % 9) - 4) * 0.012;
  var vertical = (((stage.seed >>> 11) % 5) - 2) * 0.006;
  return {
    x: stage.x + stage.width * (0.5 + horizontal),
    // 角色停在夜空上部，底部留给近景树梢与仰望距离，而不是站在舞台中央。
    y: stage.y + stage.height * (0.325 + vertical)
  };
}

function fillSoftEllipse(ctx, cx, cy, rx, ry, color, alpha) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / Math.max(1, rx));
  var glow = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  glow.addColorStop(0, colorAlpha(color, alpha));
  glow.addColorStop(0.55, colorAlpha(color, alpha * 0.35));
  glow.addColorStop(1, colorAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 半干水粉色块：边缘略微不对称，没有数字渐变的圆滑边界。
// wobble 由作品种子决定，同一幅画每次打开保持一致。
function fillPainterlyDaub(ctx, cx, cy, rx, ry, color, alpha, wobble) {
  wobble = wobble || 0;
  ctx.fillStyle = colorAlpha(color, alpha);
  ctx.beginPath();
  ctx.moveTo(cx - rx * (1 + wobble * 0.18), cy + ry * wobble * 0.12);
  ctx.bezierCurveTo(
    cx - rx * 0.92, cy - ry * (0.72 + wobble * 0.10),
    cx - rx * 0.38, cy - ry * (1.04 - wobble * 0.08),
    cx + rx * wobble * 0.10, cy - ry
  );
  ctx.bezierCurveTo(
    cx + rx * (0.70 + wobble * 0.08), cy - ry * 0.92,
    cx + rx * (1.04 - wobble * 0.06), cy - ry * 0.34,
    cx + rx, cy + ry * wobble * 0.08
  );
  ctx.bezierCurveTo(
    cx + rx * 0.90, cy + ry * (0.74 - wobble * 0.12),
    cx + rx * 0.34, cy + ry * (1.04 + wobble * 0.07),
    cx - rx * wobble * 0.10, cy + ry
  );
  ctx.bezierCurveTo(
    cx - rx * (0.70 - wobble * 0.10), cy + ry * 0.94,
    cx - rx * (1.02 + wobble * 0.06), cy + ry * 0.36,
    cx - rx * (1 + wobble * 0.18), cy + ry * wobble * 0.12
  );
  ctx.closePath();
  ctx.fill();
}

// 印象派夜色不是一块平滑渐变，而是由方向不同、浓淡不同的颜料叠出来。
// 这里全部使用确定性随机数：同一幅作品每次打开仍然完全一致。
function drawImpressionistNightStrokes(ctx, stage, world, eased) {
  var random = seededRandom((stage.seed ^ 0x5D91A7C3) >>> 0);
  var colors = ['#0B2145', '#153565', '#234777', '#354A79', '#4F4D78', world.accent];
  ctx.save();
  ctx.lineCap = 'round';

  // 只留少量不贯穿画框的宽笔腹。每一笔长度、方向和收尾都不同，
  // 避免横向整齐条带把夜空画成舞台幕布或数字渐变。
  for (var band = 0; band < 7; band++) {
    var bandY = stage.y + stage.height * (0.055 + random() * 0.72);
    var bandLift = stage.height * ((random() - 0.5) * 0.16);
    var bandStartRatio = -0.10 + random() * 0.48;
    var bandLengthRatio = 0.34 + random() * 0.58;
    var bandStart = stage.x + stage.width * bandStartRatio;
    var bandEnd = Math.min(stage.x + stage.width * 1.10, bandStart + stage.width * bandLengthRatio);
    var bandThickness = Math.max(6, stage.baseSize * (0.026 + random() * 0.052));
    var controlA = bandStart + (bandEnd - bandStart) * (0.24 + random() * 0.12);
    var controlB = bandStart + (bandEnd - bandStart) * (0.66 + random() * 0.13);
    ctx.fillStyle = colorAlpha(colors[band % colors.length], (0.030 + random() * 0.052) * eased);
    ctx.beginPath();
    ctx.moveTo(bandStart, bandY);
    ctx.bezierCurveTo(
      controlA, bandY + bandLift,
      controlB, bandY - bandLift * 0.55,
      bandEnd, bandY + bandLift * 0.18
    );
    ctx.quadraticCurveTo(bandEnd - bandThickness * 0.42, bandY + bandLift * 0.18 + bandThickness * 0.58, bandEnd - bandThickness * 1.10, bandY + bandLift * 0.18 + bandThickness * 0.72);
    ctx.bezierCurveTo(
      controlB, bandY - bandLift * 0.55 + bandThickness,
      controlA, bandY + bandLift + bandThickness,
      bandStart + bandThickness * 0.85, bandY + bandThickness * 0.74
    );
    ctx.quadraticCurveTo(bandStart + bandThickness * 0.22, bandY + bandThickness * 0.42, bandStart, bandY);
    ctx.closePath();
    ctx.fill();
  }

  // 短蜡笔擦痕只负责近看质感，不抢夺动物的视觉中心。
  for (var dash = 0; dash < 26; dash++) {
    var dashX = stage.x + stage.width * (0.02 + random() * 0.96);
    var dashY = stage.y + stage.height * (0.03 + random() * 0.76);
    var dashW = stage.width * (0.018 + random() * 0.075);
    var dashTilt = (random() - 0.5) * 0.24;
    ctx.strokeStyle = colorAlpha(colors[(dash + 2) % colors.length], (0.025 + random() * 0.052) * eased);
    ctx.lineWidth = Math.max(0.55, stage.width * (0.0010 + random() * 0.0021));
    ctx.beginPath();
    ctx.moveTo(dashX, dashY);
    ctx.quadraticCurveTo(dashX + dashW * 0.48, dashY + Math.sin(dashTilt) * dashW * 0.22, dashX + dashW, dashY + Math.sin(dashTilt) * dashW * 0.46);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHandPaintedCrescent(ctx, stage, eased) {
  var moonLeft = ((stage.seed >>> 4) & 1) === 1;
  var cx = stage.x + stage.width * (moonLeft ? 0.14 : 0.86);
  var cy = stage.y + stage.height * (0.095 + ((stage.seed >>> 9) % 7) * 0.009);
  var radius = Math.max(8, stage.baseSize * (0.042 + ((stage.seed >>> 13) % 4) * 0.003));
  var halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 3.2);
  halo.addColorStop(0, colorAlpha('#F4D797', 0.16 * eased));
  halo.addColorStop(0.45, colorAlpha('#E8C58A', 0.045 * eased));
  halo.addColorStop(1, colorAlpha('#E8C58A', 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 3.2, 0, Math.PI * 2);
  ctx.fill();

  // 不用两个圆相减，直接画一枚边缘略不规则的金箔月牙，避免数字图标感。
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(moonLeft ? -1 : 1, 1);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = colorAlpha('#F0D08A', 0.78 * eased);
  ctx.beginPath();
  ctx.moveTo(cx - radius * 0.08, cy - radius);
  ctx.bezierCurveTo(cx - radius * 1.18, cy - radius * 0.46, cx - radius * 1.02, cy + radius * 0.70, cx + radius * 0.20, cy + radius);
  ctx.quadraticCurveTo(cx - radius * 0.46, cy + radius * 0.08, cx - radius * 0.08, cy - radius);
  ctx.fill();
  ctx.restore();
}

function drawAnimalHorizon(ctx, stage, world, eased, random) {
  // 地平线压到画框底部，只作为“观看者站在下面”的提示，不再托住动物脚底。
  var horizonY = stage.y + stage.height * 0.86;
  ctx.save();

  // 三层山影先建立空气透视。远层偏蓝且柔，中层带动物世界的综合色，
  // 近层才接近墨色；即使缩成作品集小卡片，也能一眼看出空间深度。
  var ridgeColors = ['#29466F', '#1D355D', '#0B1832'];
  var ridgeAlpha = [0.14, 0.24, 0.42];
  for (var ridge = 0; ridge < 3; ridge++) {
    var ridgeY = stage.y + stage.height * (0.70 + ridge * 0.072);
    var ridgeAmp = stage.height * (0.025 + ridge * 0.014);
    ctx.fillStyle = colorAlpha(ridgeColors[ridge], ridgeAlpha[ridge] * eased);
    ctx.beginPath();
    ctx.moveTo(stage.x, stage.y + stage.height);
    ctx.lineTo(stage.x, ridgeY);
    ctx.bezierCurveTo(
      stage.x + stage.width * 0.18, ridgeY - ridgeAmp,
      stage.x + stage.width * 0.34, ridgeY + ridgeAmp * 0.65,
      stage.x + stage.width * 0.50, ridgeY - ridgeAmp * 0.20
    );
    ctx.bezierCurveTo(
      stage.x + stage.width * 0.68, ridgeY - ridgeAmp * 1.10,
      stage.x + stage.width * 0.84, ridgeY + ridgeAmp * 0.72,
      stage.x + stage.width, ridgeY - ridgeAmp * 0.18
    );
    ctx.lineTo(stage.x + stage.width, stage.y + stage.height);
    ctx.closePath();
    ctx.fill();
  }

  if (world.environment === 'forest') {
    var forest = ctx.createLinearGradient(stage.x, horizonY - stage.height * 0.16, stage.x, horizonY + stage.height * 0.08);
    forest.addColorStop(0, colorAlpha(world.horizon, 0));
    forest.addColorStop(1, colorAlpha(world.horizon, 0.26 * eased));
    ctx.fillStyle = forest;
    ctx.beginPath();
    ctx.moveTo(stage.x, horizonY + stage.height * 0.08);
    for (var tree = 0; tree <= 16; tree++) {
      var treeX = stage.x + stage.width * tree / 16;
      var treeHeight = stage.height * (0.040 + random() * 0.10);
      ctx.lineTo(treeX, horizonY - treeHeight);
      ctx.lineTo(treeX + stage.width * 0.035, horizonY + stage.height * 0.018);
    }
    ctx.lineTo(stage.x + stage.width, horizonY + stage.height * 0.12);
    ctx.lineTo(stage.x, horizonY + stage.height * 0.12);
    ctx.closePath();
    ctx.fill();
  } else if (world.environment === 'water' || world.environment === 'polar') {
    var water = ctx.createLinearGradient(stage.x, horizonY, stage.x, stage.y + stage.height);
    water.addColorStop(0, colorAlpha(world.horizon, 0.08 * eased));
    water.addColorStop(1, colorAlpha('#1A2443', 0.015 * eased));
    ctx.fillStyle = water;
    ctx.fillRect(stage.x, horizonY, stage.width, stage.height * 0.28);
    for (var wave = 0; wave < 4; wave++) {
      var waveY = horizonY + stage.height * (0.028 + wave * 0.038);
      ctx.strokeStyle = colorAlpha(world.accent, (0.055 - wave * 0.008) * eased);
      ctx.lineWidth = Math.max(0.5, stage.width * 0.0011);
      ctx.beginPath();
      ctx.moveTo(stage.x + stage.width * (0.05 + wave * 0.02), waveY);
      ctx.bezierCurveTo(
        stage.x + stage.width * 0.28, waveY - stage.height * 0.012,
        stage.x + stage.width * 0.66, waveY + stage.height * 0.012,
        stage.x + stage.width * (0.95 - wave * 0.025), waveY - stage.height * 0.004
      );
      ctx.stroke();
    }
  } else if (world.environment === 'rooftop') {
    ctx.fillStyle = colorAlpha(world.horizon, 0.10 * eased);
    ctx.beginPath();
    ctx.moveTo(stage.x, horizonY + stage.height * 0.07);
    ctx.lineTo(stage.x + stage.width * 0.16, horizonY + stage.height * 0.015);
    ctx.lineTo(stage.x + stage.width * 0.31, horizonY + stage.height * 0.07);
    ctx.lineTo(stage.x + stage.width * 0.53, horizonY - stage.height * 0.02);
    ctx.lineTo(stage.x + stage.width * 0.74, horizonY + stage.height * 0.065);
    ctx.lineTo(stage.x + stage.width, horizonY + stage.height * 0.01);
    ctx.lineTo(stage.x + stage.width, stage.y + stage.height);
    ctx.lineTo(stage.x, stage.y + stage.height);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = colorAlpha(world.horizon, 0.085 * eased);
    ctx.beginPath();
    ctx.moveTo(stage.x, stage.y + stage.height);
    ctx.lineTo(stage.x, horizonY + stage.height * 0.04);
    ctx.bezierCurveTo(
      stage.x + stage.width * 0.25, horizonY - stage.height * 0.045,
      stage.x + stage.width * 0.48, horizonY + stage.height * 0.055,
      stage.x + stage.width * 0.68, horizonY - stage.height * 0.012
    );
    ctx.bezierCurveTo(
      stage.x + stage.width * 0.82, horizonY - stage.height * 0.052,
      stage.x + stage.width * 0.93, horizonY + stage.height * 0.03,
      stage.x + stage.width, horizonY
    );
    ctx.lineTo(stage.x + stage.width, stage.y + stage.height);
    ctx.closePath();
    ctx.fill();
  }

  // 无论动物来自森林、云层还是水域，远方都留一小段月光河面。
  // 它把概念图里的“深夜有远处可去”带进每幅作品，也在竖屏底部制造纵深。
  var waterY = stage.y + stage.height * 0.885;
  var waterGlow = ctx.createLinearGradient(stage.x, waterY, stage.x, stage.y + stage.height);
  waterGlow.addColorStop(0, colorAlpha('#8EA6CA', 0));
  waterGlow.addColorStop(0.38, colorAlpha('#7187AE', 0.055 * eased));
  waterGlow.addColorStop(1, colorAlpha('#203459', 0.025 * eased));
  ctx.fillStyle = waterGlow;
  ctx.fillRect(stage.x, waterY, stage.width, stage.height * 0.12);
  for (var reflection = 0; reflection < 7; reflection++) {
    var reflectionY = waterY + stage.height * (0.014 + reflection * 0.011);
    var reflectionW = stage.width * (0.055 + random() * 0.17) * (1 - reflection * 0.055);
    var reflectionX = stage.x + stage.width * (0.50 + (random() - 0.5) * 0.20);
    ctx.strokeStyle = colorAlpha(reflection % 3 === 0 ? '#E8C98E' : '#A7B8D2', (0.045 + random() * 0.045) * eased);
    ctx.lineWidth = Math.max(0.55, stage.width * (0.0011 + random() * 0.0013));
    ctx.beginPath();
    ctx.moveTo(reflectionX - reflectionW * 0.5, reflectionY);
    ctx.quadraticCurveTo(reflectionX, reflectionY + stage.height * (random() - 0.5) * 0.004, reflectionX + reflectionW * 0.5, reflectionY);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAnimalStoryMotifs(ctx, stage, icon, world, eased, random) {
  var base = stage.baseSize;
  var anchorY = stage.y + stage.height * 0.77;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (var i = 0; i < 5; i++) {
    var side = i % 2 === 0 ? -1 : 1;
    var px = stage.x + stage.width * (side < 0 ? 0.13 + random() * 0.16 : 0.71 + random() * 0.16);
    var py = anchorY + (random() - 0.5) * stage.height * 0.16;
    var size = base * (0.007 + random() * 0.009);
    var alpha = (0.10 + random() * 0.09) * eased;
    ctx.strokeStyle = colorAlpha(world.accent, alpha);
    ctx.fillStyle = colorAlpha(world.accent, alpha * 0.72);
    ctx.lineWidth = Math.max(0.5, stage.width * 0.001);
    if (world.motif === 'bubble') {
      ctx.beginPath(); ctx.arc(px, py, size * 1.8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(px - size * 0.45, py - size * 0.55, size * 0.22, 0, Math.PI * 2); ctx.fill();
    } else if (world.motif === 'snow') {
      drawFourPointStar(ctx, px, py, size * 1.2, world.accent, alpha * 1.4);
    } else if (world.motif === 'ripple') {
      ctx.beginPath();
      ctx.moveTo(px - size * 3, py);
      ctx.bezierCurveTo(px - size, py - size * 0.6, px + size, py + size * 0.6, px + size * 3, py);
      ctx.stroke();
    } else if (world.motif === 'ribbon' || world.motif === 'yarn') {
      ctx.beginPath();
      ctx.moveTo(px - size * 2.4, py + size);
      ctx.bezierCurveTo(px - size, py - size * 2, px + size, py + size * 2, px + size * 2.6, py - size);
      ctx.stroke();
    } else if (world.motif === 'branch') {
      ctx.beginPath();
      ctx.moveTo(px, py + size * 2.5); ctx.lineTo(px, py - size * 1.8);
      ctx.moveTo(px, py - size * 0.3); ctx.lineTo(px - size * 1.5, py - size * 1.7);
      ctx.moveTo(px, py + size * 0.5); ctx.lineTo(px + size * 1.6, py - size * 0.8);
      ctx.stroke();
    } else if (world.motif === 'lantern') {
      fillSoftEllipse(ctx, px, py, size * 2.8, size * 2.2, '#F3C77B', alpha * 0.65);
      drawFourPointStar(ctx, px, py, size * 0.72, '#FFE9B2', alpha * 2.2);
    } else if (world.motif === 'cloud' || world.motif === 'mist') {
      fillSoftEllipse(ctx, px, py, size * 3.2, size * 1.45, world.accent, alpha * 0.50);
    } else if (world.motif === 'acorn') {
      ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px, py - size); ctx.quadraticCurveTo(px + size * 0.4, py - size * 2, px + size, py - size * 2.1); ctx.stroke();
    } else {
      // 花瓣与树叶使用不闭合的两段弧，避免变成贴纸图案。
      ctx.beginPath();
      ctx.moveTo(px - size * 1.5, py);
      ctx.quadraticCurveTo(px, py - size * 1.4, px + size * 1.5, py);
      ctx.quadraticCurveTo(px, py + size * 0.9, px - size * 1.5, py);
      ctx.stroke();
      if (world.motif === 'flower' && i % 2 === 0) drawFourPointStar(ctx, px, py, size * 0.55, world.accent, alpha * 1.8);
    }
  }
  ctx.restore();
}

function drawSceneRidge(ctx, stage, yRatio, color, alpha, lift) {
  var y = stage.y + stage.height * yRatio;
  var amp = stage.height * lift;
  ctx.fillStyle = colorAlpha(color, alpha);
  ctx.beginPath();
  ctx.moveTo(stage.x, stage.y + stage.height);
  ctx.lineTo(stage.x, y);
  ctx.bezierCurveTo(
    stage.x + stage.width * 0.16, y - amp * 0.72,
    stage.x + stage.width * 0.34, y + amp * 0.50,
    stage.x + stage.width * 0.51, y - amp * 0.10
  );
  ctx.bezierCurveTo(
    stage.x + stage.width * 0.69, y - amp,
    stage.x + stage.width * 0.84, y + amp * 0.60,
    stage.x + stage.width, y - amp * 0.22
  );
  ctx.lineTo(stage.x + stage.width, stage.y + stage.height);
  ctx.closePath();
  ctx.fill();
}

function drawCloudScene(ctx, stage, world, eased, random) {
  drawSceneRidge(ctx, stage, 0.83, '#33466E', 0.14 * eased, 0.028);
  var layers = [
    { y: 0.76, color: '#98A2C2', alpha: 0.050, size: 0.13 },
    { y: 0.85, color: world.accent, alpha: 0.068, size: 0.17 },
    { y: 0.94, color: '#D7CBD8', alpha: 0.082, size: 0.21 }
  ];
  layers.forEach(function (layer, layerIndex) {
    for (var cloud = 0; cloud < 6; cloud++) {
      var x = stage.x + stage.width * (-0.04 + cloud * 0.21 + (random() - 0.5) * 0.08);
      var y = stage.y + stage.height * layer.y + stage.height * (random() - 0.5) * 0.035;
      var rx = stage.baseSize * layer.size * (0.68 + random() * 0.72);
      fillPainterlyDaub(ctx, x, y, rx, rx * (0.24 + random() * 0.13), layer.color, layer.alpha * eased, random() - 0.5);
    }
    if (layerIndex < 2) {
      ctx.strokeStyle = colorAlpha('#EEE1C5', (0.018 + layerIndex * 0.006) * eased);
      ctx.lineWidth = Math.max(0.6, stage.width * 0.0012);
      ctx.beginPath();
      ctx.moveTo(stage.x + stage.width * 0.08, stage.y + stage.height * (layer.y + 0.025));
      ctx.bezierCurveTo(
        stage.x + stage.width * 0.34, stage.y + stage.height * (layer.y - 0.015),
        stage.x + stage.width * 0.70, stage.y + stage.height * (layer.y + 0.032),
        stage.x + stage.width * 0.94, stage.y + stage.height * layer.y
      );
      ctx.stroke();
    }
  });
}

function drawForestScene(ctx, stage, world, eased, random) {
  drawSceneRidge(ctx, stage, 0.72, '#294467', 0.18 * eased, 0.040);
  drawSceneRidge(ctx, stage, 0.80, '#152D4D', 0.32 * eased, 0.052);
  drawSceneRidge(ctx, stage, 0.90, '#0A1931', 0.56 * eased, 0.036);

  // 远处树冠用半干色团而非规则三角树，中央留出仰望通道。
  for (var tree = 0; tree < 11; tree++) {
    var onLeft = tree % 2 === 0;
    var treeX = stage.x + stage.width * (onLeft ? 0.015 + random() * 0.28 : 0.70 + random() * 0.28);
    var treeY = stage.y + stage.height * (0.73 + random() * 0.18);
    var treeRX = stage.baseSize * (0.025 + random() * 0.045);
    var treeRY = treeRX * (0.72 + random() * 0.60);
    var treeColor = tree % 4 === 0 ? world.horizon : (tree % 3 === 0 ? '#314A54' : '#17304B');
    fillPainterlyDaub(ctx, treeX, treeY, treeRX, treeRY, treeColor, (0.12 + random() * 0.10) * eased, random() - 0.5);
  }

  // 林间只放两三处蜂蜜金微光，像远处窗灯或萤火，不撒满装饰亮点。
  for (var ember = 0; ember < 5; ember++) {
    var emberX = stage.x + stage.width * (0.09 + random() * 0.82);
    var emberY = stage.y + stage.height * (0.72 + random() * 0.16);
    fillSoftEllipse(ctx, emberX, emberY, stage.baseSize * 0.010, stage.baseSize * 0.008, '#E7BE72', (0.055 + random() * 0.050) * eased);
  }
}

function drawLakeScene(ctx, stage, world, eased, random) {
  var horizonY = stage.y + stage.height * (0.70 + (((stage.seed >>> 8) % 5) - 2) * 0.007);
  drawSceneRidge(ctx, stage, 0.68, '#263F61', 0.13 * eased, 0.026);
  var water = ctx.createLinearGradient(stage.x, horizonY, stage.x, stage.y + stage.height);
  water.addColorStop(0, colorAlpha('#3B5377', 0.17 * eased));
  water.addColorStop(0.48, colorAlpha(world.horizon, 0.11 * eased));
  water.addColorStop(1, colorAlpha('#101A36', 0.38 * eased));
  ctx.fillStyle = water;
  ctx.fillRect(stage.x, horizonY, stage.width, stage.y + stage.height - horizonY);

  var reflectionX = stage.x + stage.width * ((((stage.seed >>> 3) & 1) ? 0.76 : 0.24) + (random() - 0.5) * 0.07);
  // 月光不再用几何三角光束，而是碎成逐渐展开的横向水粉擦痕。
  // 断续边缘和轻微错位会自然形成水面深度，不像舞台聚光灯。
  for (var glimmer = 0; glimmer < 8; glimmer++) {
    var glimmerY = horizonY + stage.height * (0.022 + glimmer * 0.034);
    var glimmerW = stage.width * (0.018 + glimmer * 0.010 + random() * 0.018);
    var glimmerX = reflectionX + stage.width * (random() - 0.5) * (0.018 + glimmer * 0.006);
    fillPainterlyDaub(
      ctx,
      glimmerX,
      glimmerY,
      glimmerW,
      stage.height * (0.0028 + random() * 0.0038),
      glimmer % 3 === 0 ? '#E8C982' : '#9FB4D1',
      (0.030 + random() * 0.040) * eased * (1 - glimmer * 0.045),
      (random() - 0.5) * 0.18
    );
  }

  for (var wave = 0; wave < 9; wave++) {
    var waveY = horizonY + stage.height * (0.025 + wave * 0.030);
    var waveW = stage.width * (0.10 + random() * 0.25) * (1 + wave * 0.045);
    var waveX = reflectionX + stage.width * (random() - 0.5) * 0.10;
    ctx.strokeStyle = colorAlpha(wave % 4 === 0 ? '#E5C98F' : '#9DB2D2', (0.038 + random() * 0.050) * eased);
    ctx.lineWidth = Math.max(0.5, stage.width * (0.0008 + random() * 0.0007));
    ctx.beginPath();
    ctx.moveTo(waveX - waveW * 0.5, waveY);
    ctx.bezierCurveTo(waveX - waveW * 0.16, waveY - stage.height * 0.004, waveX + waveW * 0.15, waveY + stage.height * 0.004, waveX + waveW * 0.5, waveY);
    ctx.stroke();
  }
}

function drawStarfieldScene(ctx, stage, world, eased, random) {
  // 星原保留最多的负空间，只用两道很淡的粉彩天光和低矮草坡。
  ctx.save();
  ctx.lineCap = 'round';
  for (var veil = 0; veil < 2; veil++) {
    ctx.strokeStyle = colorAlpha(veil ? world.accent : '#778CC4', (0.040 + veil * 0.014) * eased);
    ctx.lineWidth = stage.baseSize * (0.10 + veil * 0.055);
    ctx.beginPath();
    ctx.moveTo(stage.x - stage.width * 0.12, stage.y + stage.height * (0.30 + veil * 0.08));
    ctx.bezierCurveTo(
      stage.x + stage.width * 0.18, stage.y + stage.height * (0.17 + veil * 0.04),
      stage.x + stage.width * 0.70, stage.y + stage.height * (0.26 + veil * 0.02),
      stage.x + stage.width * 1.10, stage.y + stage.height * (0.12 + veil * 0.05)
    );
    ctx.stroke();
  }
  ctx.restore();
  drawSceneRidge(ctx, stage, 0.87, '#263A5E', 0.18 * eased, 0.022);
  drawSceneRidge(ctx, stage, 0.93, '#111F3B', 0.41 * eased, 0.030);

  for (var flower = 0; flower < 7; flower++) {
    var side = flower % 2 === 0 ? 0.05 + random() * 0.22 : 0.73 + random() * 0.22;
    var fx = stage.x + stage.width * side;
    var fy = stage.y + stage.height * (0.84 + random() * 0.10);
    var fr = stage.baseSize * (0.0035 + random() * 0.0045);
    ctx.strokeStyle = colorAlpha('#6F7E9E', 0.10 * eased);
    ctx.lineWidth = Math.max(0.45, stage.width * 0.0008);
    ctx.beginPath(); ctx.moveTo(fx, stage.y + stage.height); ctx.quadraticCurveTo(fx - fr * 2, fy + fr * 4, fx, fy); ctx.stroke();
    drawFourPointStar(ctx, fx, fy, fr, flower % 3 === 0 ? '#F1CE86' : world.accent, (0.18 + random() * 0.12) * eased);
  }
}

function drawAnimalSceneMidground(ctx, stage, icon, world, eased, random) {
  var scene = animalSceneKind(icon);
  if (scene === 'cloud') drawCloudScene(ctx, stage, world, eased, random);
  else if (scene === 'forest') drawForestScene(ctx, stage, world, eased, random);
  else if (scene === 'lake') drawLakeScene(ctx, stage, world, eased, random);
  else drawStarfieldScene(ctx, stage, world, eased, random);
}

// 最后一拍是一张拥有远、中、近景的星光绘本夜空。
// 远星与星云建立尺度，中景地平线承接动物，前景云雾和失焦星尘制造镜头距离。
function drawAnimalNightBackdrop(ctx, stage, icon) {
  var reveal = clamp(stage.sealReveal || 0, 0, 1);
  if (reveal <= 0) return;
  var eased = reveal * reveal * (3 - 2 * reveal);
  var center = animalSceneCenter(stage);
  var centerX = center.x;
  var centerY = center.y;
  var world = animalWorld(icon);
  var random = seededRandom((stage.seed ^ 0x91E10DA5) >>> 0);

  ctx.save();

  // 冷暖分区的深夜幕：顶端接近墨蓝，地平线保留可读细节。
  var veil = ctx.createLinearGradient(stage.x, stage.y, stage.x, stage.y + stage.height);
  veil.addColorStop(0, colorAlpha('#050919', 0.91 * eased));
  veil.addColorStop(0.48, colorAlpha('#101733', 0.88 * eased));
  veil.addColorStop(0.72, colorAlpha(world.horizon, 0.18 * eased));
  veil.addColorStop(1, colorAlpha('#171A38', 0.90 * eased));
  ctx.fillStyle = veil;
  ctx.fillRect(stage.x, stage.y, stage.width, stage.height);

  // 终章夜幕会覆盖前一层作品背景，因此在这里重新铺一遍与本作种子绑定的水粉纸纹。
  // 纹理始终留在动物之后，不进入脸部和轮廓粒子层。
  drawGouacheNightTexture(
    ctx,
    stage.x,
    stage.y,
    stage.width,
    stage.height,
    (stage.seed ^ 0x27D4EB2D) >>> 0,
    0.88 * eased,
    1
  );
  drawImpressionistNightStrokes(ctx, stage, world, eased);
  drawHandPaintedCrescent(ctx, stage, eased);

  // 远银河从低处向高空收拢，建立抬头时看到的穹顶纵深，线条永远不穿过动物面部。
  ctx.save();
  ctx.strokeStyle = colorAlpha(world.accent, 0.028 * eased);
  ctx.lineWidth = Math.max(8, stage.baseSize * 0.10);
  ctx.beginPath();
  ctx.moveTo(stage.x - stage.width * 0.08, stage.y + stage.height * 0.60);
  ctx.bezierCurveTo(
    stage.x + stage.width * 0.18, stage.y + stage.height * 0.34,
    stage.x + stage.width * 0.66, stage.y + stage.height * 0.10,
    stage.x + stage.width * 1.08, stage.y + stage.height * 0.20
  );
  ctx.stroke();
  ctx.strokeStyle = colorAlpha('#DDE5F7', 0.025 * eased);
  ctx.lineWidth = Math.max(0.7, stage.width * 0.0014);
  ctx.stroke();
  ctx.restore();

  // 只留一束贴近左侧的远光，不再让中央聚光灯把动物洗成白色图标。
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (var beam = 0; beam < 1; beam++) {
    var beamBottomX = stage.x - stage.width * 0.08;
    var beamTopX = centerX - stage.width * 0.18;
    var beamGradient = ctx.createLinearGradient(beamBottomX, stage.y + stage.height, beamTopX, centerY - stage.height * 0.10);
    beamGradient.addColorStop(0, colorAlpha(beam === 1 ? '#E7C98B' : '#8EA3D0', 0));
    beamGradient.addColorStop(0.42, colorAlpha('#8EA3D0', 0.003 * eased));
    beamGradient.addColorStop(1, colorAlpha('#DDE4F4', 0));
    ctx.fillStyle = beamGradient;
    ctx.beginPath();
    ctx.moveTo(beamBottomX - stage.width * 0.15, stage.y + stage.height);
    ctx.lineTo(beamBottomX + stage.width * 0.15, stage.y + stage.height);
    ctx.lineTo(beamTopX + stage.width * 0.035, centerY - stage.height * 0.12);
    ctx.lineTo(beamTopX - stage.width * 0.035, centerY - stage.height * 0.12);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 动物背后不是舞台聚光灯，而是一团没有硬边的月雾。
  var moonMist = ctx.createRadialGradient(
    centerX - stage.baseSize * 0.07, centerY - stage.baseSize * 0.08, stage.baseSize * 0.02,
    centerX, centerY, stage.baseSize * 0.48
  );
  moonMist.addColorStop(0, colorAlpha('#FFE4A8', 0.070 * eased));
  moonMist.addColorStop(0.30, colorAlpha('#D8B985', 0.034 * eased));
  moonMist.addColorStop(0.68, colorAlpha(world.accent, 0.016 * eased));
  moonMist.addColorStop(1, colorAlpha('#776F8F', 0));
  ctx.fillStyle = moonMist;
  ctx.beginPath();
  ctx.arc(centerX, centerY, stage.baseSize * 0.48, 0, Math.PI * 2);
  ctx.fill();

  fillSoftEllipse(
    ctx,
    centerX - stage.baseSize * 0.025,
    centerY - stage.baseSize * 0.055,
    stage.baseSize * 0.31,
    stage.baseSize * 0.43,
    '#FFF0C6',
    0.014 * eased
  );
  fillSoftEllipse(
    ctx,
    centerX + stage.baseSize * 0.08,
    centerY + stage.baseSize * 0.13,
    stage.baseSize * 0.25,
    stage.baseSize * 0.18,
    world.accent,
    0.012 * eased
  );

  // 稀疏的暖金星点明确区分远、中景；大失焦光只停留在画面边缘。
  // 不再用密集白点填空，让动物烟花与蜂蜜金局部光真正成为视觉中心。
  for (var starIndex = 0; starIndex < 22; starIndex++) {
    var starX = stage.x + stage.width * (0.055 + random() * 0.89);
    var starY = stage.y + stage.height * (0.045 + random() * 0.66);
    if (Math.abs(starX - centerX) < stage.baseSize * 0.30 && Math.abs(starY - centerY) < stage.baseSize * 0.24) {
      starX = starX < centerX ? stage.x + stage.width * (0.06 + random() * 0.16) : stage.x + stage.width * (0.78 + random() * 0.16);
    }
    var starColor = starIndex % 7 === 0 ? '#F2C86F' : (starIndex % 4 === 0 ? world.accent : '#DCC99A');
    var depth = starIndex < 13 ? 0 : (starIndex < 19 ? 1 : 2);
    var starSize = Math.max(0.28, stage.width * (0.00045 + depth * 0.00042 + random() * 0.00042));
    if (starIndex % 11 === 0) drawFourPointStar(ctx, starX, starY, starSize * 2.2, starColor, (0.18 + depth * 0.09 + random() * 0.13) * eased);
    else {
      ctx.fillStyle = colorAlpha(starColor, (0.08 + depth * 0.07 + random() * 0.12) * eased);
      ctx.beginPath();
      ctx.arc(starX, starY, starSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (var bokeh = 0; bokeh < 5; bokeh++) {
    var bokehSide = bokeh % 2 === 0 ? 0.03 + random() * 0.12 : 0.84 + random() * 0.13;
    var bokehX = stage.x + stage.width * bokehSide;
    var bokehY = stage.y + stage.height * (0.12 + random() * 0.56);
    fillSoftEllipse(ctx, bokehX, bokehY, stage.baseSize * (0.018 + random() * 0.022), stage.baseSize * (0.018 + random() * 0.022), bokeh % 3 === 0 ? '#F2CFA0' : world.accent, (0.035 + random() * 0.035) * eased);
  }

  drawAnimalSceneMidground(ctx, stage, icon, world, eased, random);
  drawAnimalStoryMotifs(ctx, stage, icon, world, eased * 0.78, random);

  // 四周的深色镜头渐晕让中心光有明确距离，而不是一块均匀蓝色平面。
  var leftShade = ctx.createLinearGradient(stage.x, stage.y, stage.x + stage.width * 0.24, stage.y);
  leftShade.addColorStop(0, colorAlpha('#020511', 0.36 * eased));
  leftShade.addColorStop(1, colorAlpha('#020511', 0));
  ctx.fillStyle = leftShade;
  ctx.fillRect(stage.x, stage.y, stage.width * 0.25, stage.height);
  var rightShade = ctx.createLinearGradient(stage.x + stage.width, stage.y, stage.x + stage.width * 0.76, stage.y);
  rightShade.addColorStop(0, colorAlpha('#020511', 0.32 * eased));
  rightShade.addColorStop(1, colorAlpha('#020511', 0));
  ctx.fillStyle = rightShade;
  ctx.fillRect(stage.x + stage.width * 0.75, stage.y, stage.width * 0.25, stage.height);

  ctx.restore();
}

function drawAnimalForeground(ctx, stage, icon) {
  var reveal = clamp(stage.sealReveal || 0, 0, 1);
  if (reveal <= 0.42) return;
  var eased = clamp((reveal - 0.42) / 0.58, 0, 1);
  var world = animalWorld(icon);
  var scene = animalSceneKind(icon);
  var random = seededRandom((stage.seed ^ 0x7F4A7C15) >>> 0);
  ctx.save();

  // 统一的镜头语言：只让少量失焦星尘从画框边缘靠近观看者，
  // 中央始终保持安静，动物不会像贴在装饰粒子墙上。
  for (var dust = 0; dust < 8; dust++) {
    var dustLeft = dust % 2 === 0;
    var dustX = stage.x + stage.width * (dustLeft ? random() * 0.18 : 0.82 + random() * 0.18);
    var dustY = stage.y + stage.height * (0.18 + random() * 0.65);
    var dustR = stage.baseSize * (0.004 + random() * 0.009);
    fillSoftEllipse(ctx, dustX, dustY, dustR * 2.2, dustR * 2.2, dust % 4 === 0 ? '#F4D29A' : world.accent, (0.045 + random() * 0.045) * eased);
  }

  if (scene === 'cloud') {
    // 云上：近景只保留几团带纸纹的柔云，像从云层间仰望。
    for (var cloud = 0; cloud < 9; cloud++) {
      var cloudLeft = cloud % 2 === 0;
      var cloudX = stage.x + stage.width * (cloudLeft ? -0.07 + random() * 0.29 : 0.78 + random() * 0.29);
      var cloudY = stage.y + stage.height * (0.83 + random() * 0.17);
      var cloudRX = stage.baseSize * (0.07 + random() * 0.10);
      fillPainterlyDaub(ctx, cloudX, cloudY, cloudRX, cloudRX * (0.32 + random() * 0.22), cloud % 3 === 0 ? world.accent : '#B8B9CE', (0.045 + random() * 0.055) * eased, (random() - 0.5) * 0.7);
    }
  } else if (scene === 'forest') {
    // 森林：以不规则树冠和弯曲枝条构成近景，不再出现复制粘贴般的三角松树。
    for (var crown = 0; crown < 11; crown++) {
      var crownLeft = crown % 2 === 0;
      var crownX = stage.x + stage.width * (crownLeft ? -0.07 + random() * 0.28 : 0.79 + random() * 0.28);
      var crownY = stage.y + stage.height * (0.84 + random() * 0.18);
      var crownR = stage.baseSize * (0.035 + random() * 0.068);
      var crownColor = crown % 3 === 0 ? '#07162B' : (crown % 3 === 1 ? '#102942' : '#19364B');
      fillPainterlyDaub(ctx, crownX, crownY, crownR, crownR * (0.55 + random() * 0.42), crownColor, (0.12 + random() * 0.12) * eased, (random() - 0.5) * 1.6);
    }
    ctx.strokeStyle = colorAlpha('#071225', 0.29 * eased);
    ctx.lineWidth = Math.max(1.2, stage.width * 0.005);
    ctx.beginPath();
    ctx.moveTo(stage.x - stage.width * 0.02, stage.y + stage.height);
    ctx.bezierCurveTo(stage.x + stage.width * 0.02, stage.y + stage.height * 0.88, stage.x + stage.width * 0.09, stage.y + stage.height * 0.94, stage.x + stage.width * 0.18, stage.y + stage.height * 0.84);
    ctx.moveTo(stage.x + stage.width * 1.02, stage.y + stage.height);
    ctx.bezierCurveTo(stage.x + stage.width * 0.98, stage.y + stage.height * 0.89, stage.x + stage.width * 0.91, stage.y + stage.height * 0.95, stage.x + stage.width * 0.82, stage.y + stage.height * 0.85);
    ctx.stroke();
  } else if (scene === 'lake') {
    // 月湖：两岸芦苇切入镜头，中央留给倒影和动物，增强“站在水边”的空间感。
    ctx.strokeStyle = colorAlpha('#101D33', 0.33 * eased);
    ctx.lineWidth = Math.max(0.8, stage.width * 0.0026);
    for (var reed = 0; reed < 12; reed++) {
      var reedLeft = reed % 2 === 0;
      var reedBaseX = stage.x + stage.width * (reedLeft ? random() * 0.17 : 0.83 + random() * 0.17);
      var reedBaseY = stage.y + stage.height * (0.96 + random() * 0.06);
      var reedTopX = reedBaseX + stage.width * ((reedLeft ? 1 : -1) * (0.01 + random() * 0.05));
      var reedTopY = stage.y + stage.height * (0.76 + random() * 0.15);
      ctx.beginPath();
      ctx.moveTo(reedBaseX, reedBaseY);
      ctx.quadraticCurveTo((reedBaseX + reedTopX) / 2 + stage.width * (random() - 0.5) * 0.03, (reedBaseY + reedTopY) / 2, reedTopX, reedTopY);
      ctx.stroke();
      if (reed % 3 === 0) fillPainterlyDaub(ctx, reedTopX, reedTopY, stage.width * 0.009, stage.height * 0.026, '#263B4F', 0.18 * eased, reedLeft ? -0.28 : 0.28);
    }
    ctx.strokeStyle = colorAlpha(world.accent, 0.10 * eased);
    ctx.lineWidth = Math.max(0.6, stage.width * 0.0016);
    for (var ripple = 0; ripple < 4; ripple++) {
      var rippleY = stage.y + stage.height * (0.88 + ripple * 0.024);
      ctx.beginPath();
      ctx.moveTo(stage.x + stage.width * (0.34 - ripple * 0.02), rippleY);
      ctx.quadraticCurveTo(stage.x + stage.width * 0.50, rippleY + stage.height * 0.008, stage.x + stage.width * (0.66 + ripple * 0.02), rippleY);
      ctx.stroke();
    }
  } else {
    // 星原：几根长草和散落的花形星光，让画面像躺在柔软草坡上看天。
    ctx.strokeStyle = colorAlpha('#172742', 0.30 * eased);
    ctx.lineWidth = Math.max(0.8, stage.width * 0.0023);
    for (var grass = 0; grass < 14; grass++) {
      var grassLeft = grass % 2 === 0;
      var grassX = stage.x + stage.width * (grassLeft ? random() * 0.23 : 0.77 + random() * 0.23);
      var grassY = stage.y + stage.height * (0.97 + random() * 0.05);
      ctx.beginPath();
      ctx.moveTo(grassX, grassY);
      ctx.quadraticCurveTo(grassX + stage.width * (grassLeft ? 0.018 : -0.018), stage.y + stage.height * 0.88, grassX + stage.width * (grassLeft ? 0.042 : -0.042), stage.y + stage.height * (0.82 + random() * 0.10));
      ctx.stroke();
    }
    for (var flower = 0; flower < 5; flower++) {
      var flowerLeft = flower % 2 === 0;
      drawFourPointStar(ctx, stage.x + stage.width * (flowerLeft ? 0.07 + random() * 0.15 : 0.78 + random() * 0.15), stage.y + stage.height * (0.82 + random() * 0.11), stage.width * (0.004 + random() * 0.004), flower % 2 === 0 ? '#F4D28D' : world.accent, (0.24 + random() * 0.18) * eased);
    }
  }
  ctx.restore();
}

// 把32×32角色坐标投到夜空中。最终身体略向上收束，既保留软糯比例，
// 又让观看者感到自己正从树梢下方仰望，而不是看一枚平贴在画布上的图标。
function projectAnimalPoint(point, center, size, rotation) {
  var localX = (point.x - 16) / 32 * size;
  var localY = (point.y - 16) / 32 * size;
  var upwardPerspective = clamp(localY / Math.max(1, size) + 0.08, 0, 0.54);
  localX *= 1 - upwardPerspective * 0.11;
  localY *= 0.965;
  return {
    x: center.x + localX * Math.cos(rotation) - localY * Math.sin(rotation),
    y: center.y + localX * Math.sin(rotation) + localY * Math.cos(rotation)
  };
}

// 水粉星云不是一块光滑的数字渐变，而是几层轻微错位、边缘不齐的薄色。
// 近看能发现纸上叠色，远看才共同组成动物的头、身体与尾巴体积。
function drawAnimalGouacheClouds(ctx, stage, icon, fit, center, size, reveal) {
  var world = animalWorld(icon);
  var random = seededRandom((stage.seed ^ 0xB5297A4D) >>> 0);
  var cloudReveal = clamp((reveal - 0.14) / 0.86, 0, 1);
  if (cloudReveal <= 0) return;
  var colors = [world.body || '#A89A90', world.shadow || '#66708D', world.accent, '#9A8BAD', '#C8929E'];
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  fit.glow.forEach(function (glow, glowIndex) {
    for (var wash = 0; wash < 4; wash++) {
      var washX = center.x + size * (glow[0] + (random() - 0.5) * glow[2] * 0.44);
      var washY = center.y + size * (glow[1] + (random() - 0.5) * glow[3] * 0.34);
      var washRX = size * glow[2] * (0.48 + random() * 0.38);
      var washRY = size * glow[3] * (0.46 + random() * 0.36);
      fillPainterlyDaub(
        ctx,
        washX,
        washY,
        washRX,
        washRY,
        colors[(glowIndex + wash) % colors.length],
        (0.016 + random() * 0.026) * cloudReveal * (0.72 + glow[4] * 0.28),
        random() - 0.5
      );
    }
  });
  // 少量半透明颜料沉积让内部不是均匀发光的塑料面。
  for (var fleck = 0; fleck < 18; fleck++) {
    var home = fit.glow[fleck % fit.glow.length];
    var angle = random() * Math.PI * 2;
    var distance = Math.sqrt(random()) * 0.78;
    var fleckX = center.x + size * (home[0] + Math.cos(angle) * home[2] * distance);
    var fleckY = center.y + size * (home[1] + Math.sin(angle) * home[3] * distance);
    var fleckR = Math.max(0.32, stage.width * (0.00038 + random() * 0.00075));
    ctx.fillStyle = colorAlpha(colors[(fleck + 1) % colors.length], (0.035 + random() * 0.070) * cloudReveal);
    ctx.beginPath();
    ctx.arc(fleckX, fleckY, fleckR, 0, Math.PI * 2);
    ctx.fill();
  }

  // 小块半干颜料覆盖在体积色上，刻意保留深浅不均和擦笔缺口。
  // 这些块只在角色自身的几团体积范围内出现，因此不会变成矩形贴纸纹理。
  for (var scumble = 0; scumble < 16; scumble++) {
    var scumbleHome = fit.glow[scumble % fit.glow.length];
    var scumbleAngle = random() * Math.PI * 2;
    var scumbleDistance = Math.sqrt(random()) * 0.70;
    var scumbleX = center.x + size * (scumbleHome[0] + Math.cos(scumbleAngle) * scumbleHome[2] * scumbleDistance);
    var scumbleY = center.y + size * (scumbleHome[1] + Math.sin(scumbleAngle) * scumbleHome[3] * scumbleDistance);
    var scumbleRX = size * (0.010 + random() * 0.034);
    var scumbleRY = size * (0.003 + random() * 0.012);
    var scumbleColor = scumble % 9 === 0 ? '#24375E' : colors[(scumble + 2) % colors.length];
    fillPainterlyDaub(ctx, scumbleX, scumbleY, scumbleRX, scumbleRY, scumbleColor, (0.038 + random() * 0.072) * cloudReveal, random() - 0.5);
  }
  ctx.restore();
}

// 只用约六成断续金箔光丝暗示轮廓；其余部分交给星粒和观者的眼睛补全。
// 这取代完整描边，避免最终角色再次变成霓虹灯牌或等距灯珠图标。
function drawBrokenAnimalFilaments(ctx, points, stage, icon, center, size, rotation, reveal, palette) {
  var filamentReveal = clamp((reveal - 0.40) / 0.60, 0, 1);
  if (filamentReveal <= 0) return;
  var world = animalWorld(icon);
  var outerWidth = Math.max(0.70, stage.width * 0.0021);
  var innerWidth = Math.max(0.30, stage.width * 0.00078);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (var i = 1; i < points.length; i++) {
    var previous = points[i - 1];
    var current = points[i];
    if (previous.tone !== current.tone || previous.pathIndex !== current.pathIndex) continue;
    if (current.tone === 'cheek') continue;
    var key = ((((i + 3) * 1103515245) ^ stage.seed ^ ((current.pathIndex || 0) * 2654435761)) >>> 0) % 100;
    var visibility = current.tone === 'face' ? 88 : (current.tone === 'prop' ? 56 : (current.tone === 'accent' ? 35 : 28));
    // 连续两三小段后故意留白，形成手工金箔断痕，而不是随机缺牙。
    if (key >= visibility || (current.tone !== 'face' && Math.floor(i / 5) % 7 === 3)) continue;
    var start = projectAnimalPoint(previous, center, size, rotation);
    var end = projectAnimalPoint(current, center, size, rotation);
    var toneColor = current.tone === 'face'
      ? '#FFF5DF'
      : (current.tone === 'prop' ? (world.prop || '#F0D28D') : (current.tone === 'accent' ? world.accent : palette[0]));
    var grainAlpha = 0.72 + (key % 17) / 60;
    ctx.shadowColor = toneColor;
    ctx.shadowBlur = outerWidth * 3.0;
    ctx.strokeStyle = colorAlpha(toneColor, 0.10 * filamentReveal * grainAlpha);
    ctx.lineWidth = outerWidth;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.shadowBlur = innerWidth * 1.25;
    var innerAlpha = current.tone === 'face' ? 0.78 : (current.tone === 'prop' ? 0.50 : (current.tone === 'accent' ? 0.42 : 0.32));
    ctx.strokeStyle = colorAlpha(current.tone === 'outline' ? '#FFE9B9' : toneColor, innerAlpha * filamentReveal * grainAlpha);
    ctx.lineWidth = innerWidth * (0.78 + (key % 5) * 0.055);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  ctx.restore();
}

function animalParticleSource(point, index, sourceCount) {
  if (sourceCount <= 1) return 0;
  // 五朵烟花各自完成一件事：头、身体、尾巴/外形、故事纹样、表情与心口星。
  if (point.tone === 'face' || point.tone === 'cheek') return Math.min(sourceCount - 1, 4);
  if (point.tone === 'prop') return Math.min(sourceCount - 1, 2);
  if (point.tone === 'accent') return Math.min(sourceCount - 1, 3);
  if (typeof point.pathIndex === 'number') return Math.min(sourceCount - 1, point.pathIndex);
  return index % sourceCount;
}

// 美术母版的最终显影：真实水粉/蜡笔负责角色体积，程序粒子只负责“从烟花中诞生”。
// 不对图片做硬描边，也不盖整齐灯珠；两层极软的月光和少量离散金粉把它放回夜空。
function drawHandPaintedAnimalMaster(ctx, image, stage, icon, center, size, reveal, palette) {
  if (!image) return;
  var masterReveal = clamp((reveal - 0.16) / 0.84, 0, 1);
  if (masterReveal <= 0) return;
  var ease = 1 - Math.pow(1 - masterReveal, 3);
  var random = seededRandom((stage.seed ^ 0x91E10DA5) >>> 0);
  var masterSize = Math.min(stage.baseSize * 0.72, stage.width * 0.78, stage.height * 0.64);
  var scale = (stage.reducedMotion ? 1 : 0.91 + ease * 0.09);
  var drawSize = masterSize * scale;
  var floatY = stage.reducedMotion ? 0 : (1 - ease) * size * 0.075;
  var dx = center.x - drawSize / 2;
  var dy = center.y - drawSize / 2 + floatY;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

  // 先投一层很淡的蜂蜜金色体积光，边缘被夜雾吞掉，不出现贴纸白边。
  var aura = ctx.createRadialGradient(center.x, center.y, masterSize * 0.05, center.x, center.y, masterSize * 0.54);
  aura.addColorStop(0, colorAlpha('#FFE7B5', 0.105 * ease));
  aura.addColorStop(0.46, colorAlpha('#D7B878', 0.042 * ease));
  aura.addColorStop(1, colorAlpha('#18203C', 0));
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(center.x, center.y, masterSize * 0.56, 0, Math.PI * 2);
  ctx.fill();

  // 模糊的底层像水粉颜料渗进粗纹纸，清晰层才是作品定格。
  ctx.globalAlpha = 0.16 * ease;
  ctx.shadowColor = '#F4D79D';
  ctx.shadowBlur = Math.max(8, stage.width * 0.026);
  ctx.drawImage(image, dx, dy, drawSize, drawSize);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = (0.22 + 0.76 * ease) * masterReveal;
  ctx.drawImage(image, dx, dy, drawSize, drawSize);

  // 显影时从四周回收的星屑逐渐贴近角色，最终只剩不规则金粉。
  ctx.globalCompositeOperation = 'lighter';
  for (var i = 0; i < 34; i++) {
    var angle = random() * Math.PI * 2;
    var finalDistance = masterSize * (0.31 + random() * 0.27);
    var startDistance = masterSize * (0.57 + random() * 0.42);
    var settle = clamp((masterReveal - (i % 7) * 0.018) / 0.87, 0, 1);
    var distance = startDistance + (finalDistance - startDistance) * settle;
    var px = center.x + Math.cos(angle) * distance;
    var py = center.y + Math.sin(angle) * distance * 0.76;
    var particleColor = i % 9 === 0 ? '#F3B6C4' : palette[i % palette.length];
    var radius = Math.max(0.34, stage.width * (0.00055 + random() * 0.00086));
    var alpha = (0.12 + random() * 0.32) * masterReveal;
    if (i % 11 === 0) drawFourPointStar(ctx, px, py, radius * 2.5, particleColor, alpha * 1.16);
    else {
      ctx.fillStyle = colorAlpha(particleColor, alpha);
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 每幅角色仍保留一颗“最初被接住的星”，但不遮住角色自己的道具与表情。
  var starX = center.x + masterSize * (icon === 'hummingbird' ? 0.22 : 0.17);
  var starY = center.y + masterSize * (icon === 'swan' ? 0.16 : 0.25);
  fillSoftEllipse(ctx, starX, starY, masterSize * 0.058, masterSize * 0.042, '#FFE4A8', 0.12 * ease);
  drawFourPointStar(ctx, starX, starY, Math.max(1.45, stage.width * 0.0041), '#FFF9EA', 0.78 * ease);
  ctx.restore();
}

// v20 全景母版：让动物、云雾、远山和烟花成为同一幅画，而不是把角色贴在程序背景上。
// 不同画布比例使用带焦点的 cover 裁切；动物位于源图上半部，因此略向上保留画面。
function drawHandPaintedSceneMaster(ctx, image, stage) {
  if (!image) return;
  var reveal = clamp(stage.sealReveal || 0, 0, 1);
  if (reveal <= 0) return;
  var ease = 1 - Math.pow(1 - reveal, 3);
  var iw = Number(image.width) || 480;
  var ih = Number(image.height) || 640;
  var sourceRatio = iw / ih;
  var targetRatio = stage.width / stage.height;
  var sx = 0, sy = 0, sw = iw, sh = ih;
  if (targetRatio > sourceRatio) {
    sh = iw / targetRatio;
    sy = clamp(ih * 0.39 - sh * 0.43, 0, ih - sh);
  } else {
    sw = ih * targetRatio;
    sx = (iw - sw) * 0.5;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = ease;
  ctx.drawImage(image, sx, sy, sw, sh, stage.x, stage.y, stage.width, stage.height);

  // 边缘压回靛蓝，避免缩略图和海报裁切后像一张突兀的矩形照片。
  var vignette = ctx.createRadialGradient(
    stage.x + stage.width * 0.52, stage.y + stage.height * 0.42, stage.baseSize * 0.16,
    stage.x + stage.width * 0.52, stage.y + stage.height * 0.42, Math.max(stage.width, stage.height) * 0.74
  );
  vignette.addColorStop(0, 'rgba(4,8,24,0)');
  vignette.addColorStop(0.72, colorAlpha('#071027', 0.02 * ease));
  vignette.addColorStop(1, colorAlpha('#030817', 0.34 * ease));
  ctx.fillStyle = vignette;
  ctx.fillRect(stage.x, stage.y, stage.width, stage.height);
  ctx.restore();
}

function drawSceneMasterEmbers(ctx, stage, palette) {
  var reveal = clamp(stage.sealReveal || 0, 0, 1);
  if (reveal <= 0) return;
  var random = seededRandom((stage.seed ^ 0x3C6EF372) >>> 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (var i = 0; i < 26; i++) {
    var px = stage.x + stage.width * (0.08 + random() * 0.84);
    var py = stage.y + stage.height * (0.08 + random() * 0.68);
    var radius = Math.max(0.34, stage.width * (0.0007 + random() * 0.0011));
    var alpha = (0.10 + random() * 0.24) * reveal;
    var color = i % 8 === 0 ? '#F3B6C4' : palette[i % palette.length];
    if (i % 9 === 0) drawFourPointStar(ctx, px, py, radius * 2.5, color, alpha * 1.2);
    else {
      ctx.fillStyle = colorAlpha(color, alpha);
      ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

// 五朵烟花在最后一拍共同变成一只拥有身体、姿态与故事动作的星光角色。
// 它不是盖在烟花上的印章：每一颗轮廓粒子都从先前某朵花火飞来，最终留下物种轮廓、表情与腮红。
function drawFireworkAnimalSeal(ctx, ranked, stage, icon) {
  if (!icon || !ranked.length) return;
  var reveal = clamp((stage.progress - 0.66) / 0.34, 0, 1);
  if (reveal <= 0) return;
  var eased = reveal * reveal * (3 - 2 * reveal);
  var main = ranked[0];
  var palette = main.palette || STAR_FLOWER_PALETTES.main;
  var fit = animalCharacterFit(icon);
  var sceneCenter = animalSceneCenter(stage);
  var center = { x: sceneCenter.x, y: sceneCenter.y + stage.baseSize * fit.y };
  // 在竖屏结果页上足够醒目，在作品集小卡片里也能一眼认出动物。
  // 汇聚阶段只有极轻的 6% 推镜，定格时回到清晰比例；减少动态模式直接显示最终尺度。
  var cameraPush = stage.reducedMotion ? 1 : 0.94 + eased * 0.06;
  var size = Math.min(stage.baseSize * 0.58, stage.width * 0.68, stage.height * 0.55) * cameraPush * fit.scale;
  var avatarWidthScale = fit.width;
  var avatarHeightScale = fit.height;
  var avatarTilt = (((stage.seed >>> 3) % 9) - 4) * fit.tilt * 3;
  var points = animalSeal.sampleAnimalDoodle(icon, {
    storyPose: true,
    widthScale: avatarWidthScale,
    heightScale: avatarHeightScale
  });
  var random = seededRandom((stage.seed ^ 0xC2B2AE35) >>> 0);

  ctx.save();
  if (stage.fullSceneMaster) {
    drawSceneMasterEmbers(ctx, stage, palette);
    ctx.restore();
    return;
  }
  if (stage.animalMaster) {
    drawHandPaintedAnimalMaster(ctx, stage.animalMaster, stage, icon, center, size, reveal, palette);
    ctx.restore();
    return;
  }
  drawAnimalGouacheClouds(ctx, stage, icon, fit, center, size, reveal);

  // 先用一层极薄、可透出纸纹的水粉身体承接星粒。它只填闭合形状，
  // 表情和开放线条仍由后面的蜡笔断线与烟花粒子完成。
  var paintedReveal = clamp((reveal - 0.24) / 0.76, 0, 1);
  if (paintedReveal > 0) {
    ctx.globalCompositeOperation = 'source-over';
    animalSeal.drawAnimalDoodle(
      ctx,
      icon,
      center.x,
      center.y,
      size,
      colorAlpha('#F8E8C6', 0.16 * paintedReveal),
      {
        storyPose: true,
        widthScale: avatarWidthScale,
        heightScale: avatarHeightScale,
        rotation: avatarTilt,
        paintOnly: true,
        fillOpen: true,
        lineWidth: 1.16,
        fillColor: colorAlpha(animalWorld(icon).body || '#7186AD', 0.48 * paintedReveal),
        secondaryFillColor: colorAlpha(animalWorld(icon).shadow || '#53637F', 0.38 * paintedReveal),
        accentFillColor: colorAlpha(animalWorld(icon).accent, 0.24 * paintedReveal),
        accentColor: colorAlpha(animalWorld(icon).accent, 0.18 * paintedReveal),
        faceColor: colorAlpha('#FFF2D8', 0.24 * paintedReveal)
      }
    );
  }
  ctx.globalCompositeOperation = 'lighter';

  // 头部和身体分别拥有不同体积的柔光，角色会像由星雾凝成，而不是空心线稿。
  var bodyLightReveal = clamp((reveal - 0.18) / 0.82, 0, 1);
  fit.glow.forEach(function (glow, glowIndex) {
    var glowColor = glowIndex === 0 ? '#FFE4AF' : (glowIndex === 1 ? animalWorld(icon).accent : '#F5C9D4');
    fillSoftEllipse(
      ctx,
      center.x + size * glow[0],
      center.y + size * glow[1],
      size * glow[2],
      size * glow[3],
      glowColor,
      (0.022 + glow[4] * 0.017) * bodyLightReveal
    );
  });

  // 低密度的内部星尘打破“空心线稿”，但只停留在体积光范围内，不铺满脸部。
  var innerDustReveal = clamp((reveal - 0.34) / 0.66, 0, 1);
  var dustRandom = seededRandom((stage.seed ^ 0x4F1BBCDC) >>> 0);
  for (var innerDust = 0; innerDust < 26; innerDust++) {
    var dustGlow = fit.glow[innerDust % fit.glow.length];
    var dustAngle = dustRandom() * Math.PI * 2;
    var dustDistance = Math.sqrt(dustRandom()) * 0.72;
    var innerX = center.x + size * (dustGlow[0] + Math.cos(dustAngle) * dustGlow[2] * dustDistance);
    var innerY = center.y + size * (dustGlow[1] + Math.sin(dustAngle) * dustGlow[3] * dustDistance);
    var innerColor = innerDust % 6 === 0 ? '#F2B1C0' : (innerDust % 3 === 0 ? animalWorld(icon).accent : '#F7D79D');
    var innerSize = Math.max(0.35, stage.width * (0.00048 + dustRandom() * 0.00072));
    ctx.fillStyle = colorAlpha(innerColor, (0.065 + dustRandom() * 0.145) * innerDustReveal);
    ctx.beginPath();
    ctx.arc(innerX, innerY, innerSize, 0, Math.PI * 2);
    ctx.fill();
  }

  // 汇聚前先留一层低饱和光晕，像烟花余烬在薄雾里慢慢显出脸庞。
  var auraReveal = clamp((reveal - 0.28) / 0.72, 0, 1);
  if (auraReveal > 0) {
    ctx.save();
    ctx.translate(center.x, center.y + size * 0.035);
    ctx.scale(1.08, 0.80);
    var aura = ctx.createRadialGradient(-size * 0.025, -size * 0.015, size * 0.02, 0, 0, size * 0.36);
    aura.addColorStop(0, colorAlpha('#FFE7B5', 0.075 * auraReveal));
    aura.addColorStop(0.52, colorAlpha('#E8C58A', 0.032 * auraReveal));
    aura.addColorStop(1, colorAlpha('#E8C58A', 0));
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 腮红不是两枚实心圆，而是由一小团雾粉色余烬慢慢显影。
  var cheekPoints = points.filter(function (point) { return point.tone === 'cheek'; });
  var cheekCloudReveal = clamp((reveal - 0.44) / 0.56, 0, 1);
  if (cheekPoints.length >= 4 && cheekCloudReveal > 0) {
    var cheekHalf = Math.floor(cheekPoints.length / 2);
    [cheekPoints.slice(0, cheekHalf), cheekPoints.slice(cheekHalf)].forEach(function (group) {
      if (!group.length) return;
      var cheekX = group.reduce(function (sum, point) { return sum + point.x; }, 0) / group.length;
      var cheekY = group.reduce(function (sum, point) { return sum + point.y; }, 0) / group.length;
      var cheekLocalX = (cheekX - 16) / 32 * size;
      var cheekLocalY = (cheekY - 16) / 32 * size;
      var cheekFinalX = center.x + cheekLocalX * Math.cos(avatarTilt) - cheekLocalY * Math.sin(avatarTilt);
      var cheekFinalY = center.y + cheekLocalX * Math.sin(avatarTilt) + cheekLocalY * Math.cos(avatarTilt);
      var cheekRadius = Math.max(5, size * 0.055);
      var cheekGlow = ctx.createRadialGradient(cheekFinalX, cheekFinalY, 0, cheekFinalX, cheekFinalY, cheekRadius);
      cheekGlow.addColorStop(0, colorAlpha('#F6B1BB', 0.18 * cheekCloudReveal));
      cheekGlow.addColorStop(0.42, colorAlpha('#F2A7B4', 0.09 * cheekCloudReveal));
      cheekGlow.addColorStop(1, colorAlpha('#F2A7B4', 0));
      ctx.fillStyle = cheekGlow;
      ctx.beginPath();
      ctx.arc(cheekFinalX, cheekFinalY, cheekRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  points.forEach(function (point, index) {
    var particleKey = (((index + 1) * 2654435761) ^ stage.seed) >>> 0;
    var particleRole = particleKey % 100;
    // 轮廓主动留出近两成呼吸空隙，避免采样点变成等距灯珠。
    if (point.tone === 'outline' && particleRole < 34) return;
    if (point.tone === 'accent' && particleRole < 20) return;
    if (point.tone === 'prop' && particleRole < 7) return;
    var toneDelay = point.tone === 'face' ? 0.11 : (point.tone === 'cheek' ? 0.16 : (point.tone === 'prop' ? 0.08 : (point.tone === 'accent' ? 0.045 : 0)));
    var pointReveal = clamp((reveal - toneDelay - (index % 11) * 0.005) / (0.80 - toneDelay), 0, 1);
    if (pointReveal <= 0) return;
    var pointEase = pointReveal * pointReveal * (3 - 2 * pointReveal);
    var projected = projectAnimalPoint(point, center, size, avatarTilt);
    var settleScatter = point.tone === 'cheek' ? size * 0.018 : size * 0.0055;
    var finalX = projected.x + (random() - 0.5) * settleScatter;
    var finalY = projected.y + (random() - 0.5) * settleScatter;
    // 每朵真实爆点负责角色的一部分，让聚拢路径像五笔共同完成的画，而不是交叉乱线。
    var sourceEntry = ranked[animalParticleSource(point, index, ranked.length)];
    var sourceAngle = random() * Math.PI * 2 + index * 0.31;
    var sourceRadius = size * (0.08 + random() * 0.22);
    var sourceX = sourceEntry.center.x + Math.cos(sourceAngle) * sourceRadius;
    var sourceY = sourceEntry.center.y + Math.sin(sourceAngle) * sourceRadius;
    var drift = Math.sin(index * 1.73 + reveal * Math.PI) * size * 0.025 * (1 - pointEase);
    var particleX = sourceX + (finalX - sourceX) * pointEase + drift;
    var particleY = sourceY + (finalY - sourceY) * pointEase - Math.abs(drift) * 0.38;
    var color = point.tone === 'cheek'
      ? '#F2A7B4'
        : (point.tone === 'face'
        ? '#FFF5DF'
        : (point.tone === 'prop'
          ? (animalWorld(icon).prop || '#F0D28D')
          : (point.tone === 'accent'
            ? (particleRole > 86 ? animalWorld(icon).accent : '#EFD29A')
            : (particleRole > 88 ? animalWorld(icon).accent : (particleRole % 3 === 0 ? '#FFF4D8' : '#EFD29A')))));
    var radiusScale = point.tone === 'cheek' ? 1.10 : (point.tone === 'face' ? 0.90 : 1);
    var particleAlpha = 0.66 + random() * 0.22;
    // 68%针尖星尘、24%普通余烬、6%锚点星、2%主闪光。
    if (particleRole < 68) {
      radiusScale *= 0.42 + random() * 0.18;
      particleAlpha *= 0.76;
    } else if (particleRole < 92) {
      radiusScale *= 0.72 + random() * 0.25;
    } else if (particleRole < 98) {
      radiusScale *= 1.05 + random() * 0.20;
      particleAlpha *= 0.90;
    } else {
      radiusScale *= 1.52;
    }
    // 小猫的尾巴位于身体后方，亮度与粒子密度自然向后退一层。
    var tailDepth = icon === 'cat' && point.tone === 'outline' && point.pathIndex === 2 ? 0.70 : 1;
    radiusScale *= tailDepth < 1 ? 0.86 : 1;
    particleAlpha *= tailDepth;
    var radius = Math.max(particleRole < 68 ? 0.22 : 0.34, stage.width * (0.00068 + random() * 0.00088)) * radiusScale;
    ctx.shadowColor = color;
    ctx.shadowBlur = radius * (2.2 + reveal * 1.7);
    if ((point.tone === 'outline' || point.tone === 'accent') && particleRole >= 98 && reveal > 0.48) {
      drawFourPointStar(ctx, particleX, particleY, radius * 2.15, color, 0.50 * pointReveal * tailDepth);
    } else {
      ctx.fillStyle = colorAlpha(color, particleAlpha * pointReveal);
      ctx.beginPath();
      ctx.arc(particleX, particleY, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    // 汇聚途中留下两枚越来越淡的余烬，最后定格时自动消失。
    if (pointEase < 0.96 && particleRole >= 68 && index % 3 === 0) {
      for (var trailIndex = 1; trailIndex <= 2; trailIndex++) {
        var trailMix = Math.max(0, pointEase - trailIndex * 0.055);
        var trailX = sourceX + (finalX - sourceX) * trailMix + drift * (1 - trailMix);
        var trailY = sourceY + (finalY - sourceY) * trailMix - Math.abs(drift) * 0.25;
        ctx.fillStyle = colorAlpha(color, particleAlpha * pointReveal * (0.22 - trailIndex * 0.065));
        ctx.beginPath();
        ctx.arc(trailX, trailY, Math.max(0.18, radius * (0.56 - trailIndex * 0.12)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  ctx.shadowBlur = 0;

  drawBrokenAnimalFilaments(ctx, points, stage, icon, center, size, avatarTilt, reveal, palette);

  // 最终定格只补表情和物种纹样，不再把整个外轮廓重新描一圈。
  // 远看先是水粉夜空，靠近才读出弯眼、鼻子与故事动作。
  var crayonReveal = clamp((reveal - 0.62) / 0.38, 0, 1);
  if (crayonReveal > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = '#F7DDA8';
    ctx.shadowBlur = Math.max(0.8, stage.width * 0.0028);
    animalSeal.drawAnimalDoodle(
      ctx,
      icon,
      center.x,
      center.y,
      size,
      colorAlpha('#FFF0CE', 0.52 * crayonReveal),
      {
        storyPose: true,
        widthScale: avatarWidthScale,
        heightScale: avatarHeightScale,
        rotation: avatarTilt,
        skipOutline: true,
        lineWidth: 0.21,
        accentColor: colorAlpha(animalWorld(icon).accent, 0.38 * crayonReveal),
        propColor: colorAlpha(animalWorld(icon).prop || '#F0D28D', 0.70 * crayonReveal),
        propFillColor: colorAlpha(animalWorld(icon).prop || '#F0D28D', 0.11 * crayonReveal),
        faceColor: colorAlpha('#FFF4DF', 0.66 * crayonReveal),
        cheeks: false
      }
    );
    ctx.restore();
  }

  if (reveal > 0.72) {
    var freckleReveal = clamp((reveal - 0.72) / 0.28, 0, 1);
    drawFourPointStar(ctx, center.x - size * 0.20, center.y + size * 0.055, Math.max(0.8, stage.width * 0.0021), '#F2A7B4', 0.54 * freckleReveal);
    drawFourPointStar(ctx, center.x + size * 0.19, center.y + size * 0.095, Math.max(0.65, stage.width * 0.0017), '#F6D58E', 0.48 * freckleReveal);
  }

  // 轮廓外只留少量游离星屑，像刚刚冷却的烟花，不再保留杂乱放射线。
  var haloReveal = clamp((reveal - 0.54) / 0.46, 0, 1);
  for (var haloIndex = 0; haloIndex < 22; haloIndex++) {
    var haloAngle = haloIndex / 22 * Math.PI * 2 + (random() - 0.5) * 0.24;
    var haloDistance = size * (0.50 + random() * 0.20);
    var haloX = center.x + Math.cos(haloAngle) * haloDistance;
    var haloY = center.y + Math.sin(haloAngle) * haloDistance * 0.76;
    var haloColor = haloIndex % 5 === 0 ? '#F2A7B4' : palette[haloIndex % palette.length];
    var haloSize = Math.max(0.42, stage.width * (0.0007 + random() * 0.00055));
    if (haloIndex % 6 === 0) drawFourPointStar(ctx, haloX, haloY, haloSize * 2.1, haloColor, 0.42 * haloReveal);
    else {
      ctx.fillStyle = colorAlpha(haloColor, (0.18 + random() * 0.20) * haloReveal);
      ctx.beginPath();
      ctx.arc(haloX, haloY, haloSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 眼睛旁的腮红由粉色余烬组成，中心仍保留最初被送回夜空的那颗小星星。
  var storyStar = fit.star || [0, 0.31];
  var heartX = center.x + size * storyStar[0];
  var heartY = center.y + size * storyStar[1];
  fillSoftEllipse(ctx, heartX, heartY, size * 0.082, size * 0.058, '#FFE4A8', 0.15 * eased);
  drawFourPointStar(ctx, heartX, heartY, Math.max(1.65, stage.width * 0.0045), '#FFF9EA', 0.88 * eased);
  ctx.fillStyle = colorAlpha('#F2B1C0', 0.34 * eased);
  ctx.beginPath(); ctx.arc(heartX - size * 0.035, heartY + size * 0.018, Math.max(0.42, stage.width * 0.0011), 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = colorAlpha('#AFC7EA', 0.30 * eased);
  ctx.beginPath(); ctx.arc(heartX + size * 0.040, heartY - size * 0.012, Math.max(0.38, stage.width * 0.0010), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// 五颗星沿真实笔迹一颗接一颗回到天空，再开成安静的月金色花火。
// 每朵中心始终保留一颗星，升空与绽放在同一画面交叠，讲清“回归”的因果。
function drawArtworkFireworks(ctx, artwork, x, y, width, height, options) {
  options = options || {};
  var progress = options.progress === undefined ? 1 : clamp(options.progress, 0, 1);
  if (progress <= 0) return;
  var style = options.style || getArtworkStyle(artwork);
  var paths = artwork && artwork.paths || [];
  if (!paths.length) return;
  var seed = artworkSeed(artwork);
  var baseSize = Math.min(width, height);
  var entries = [];

  paths.forEach(function (path, pathIndex) {
    var mapped = options.mapping === 'normalized'
      ? mapNormalized(path.points || [], x, y, width, height)
      : mapArtwork(path.points || [], artwork, x, y, width, height, options.padding);
    if (mapped.length < 2) return;
    var metrics = analyseFireworkPath(mapped, baseSize);
    entries.push({
      path: path,
      index: pathIndex,
      mapped: mapped,
      center: mapped[0],
      metrics: metrics,
      score: metrics.length * (0.82 + Math.min(2.4, metrics.curvature) * 0.12) + metrics.pauseCount * baseSize * 0.014
    });
  });
  if (!entries.length) return;

  var ranked = entries.slice().sort(function (a, b) {
    return b.score === a.score ? a.index - b.index : b.score - a.score;
  });
  ranked.forEach(function (entry, rank) { entry.rank = rank; });
  var genome = getFireworkGenome(artwork);
  arrangeFireworkEntries(ranked, genome, {
    x: x,
    y: y,
    width: width,
    height: height
  });
  var minSpeed = Math.min.apply(null, entries.map(function (entry) { return entry.metrics.speed; }));
  var maxSpeed = Math.max.apply(null, entries.map(function (entry) { return entry.metrics.speed; }));
  var minLength = Math.min.apply(null, entries.map(function (entry) { return entry.metrics.length; }));
  var maxLength = Math.max.apply(null, entries.map(function (entry) { return entry.metrics.length; }));
  // 一主、两中、两远：主焰需要足够大，才能从用户笔迹的长线条中夺回视觉中心。
  var rankScale = genome.scaleProfile;
  var sealIcon = options.sealIcon || artwork.sealIcon || '';
  var sealReveal = sealIcon ? clamp((progress - 0.66) / 0.34, 0, 1) : 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  // 夜幕不是突然变亮：每一颗星获得自由，都会为深蓝天空添一层暖光。
  var skyLight = clamp((progress - 0.20) / 0.68, 0, 1);
  if (skyLight > 0) {
    var skyGlow = ctx.createRadialGradient(
      x + width * 0.5, y + height * 0.35, baseSize * 0.02,
      x + width * 0.5, y + height * 0.35, Math.max(width, height) * 0.74
    );
    skyGlow.addColorStop(0, colorAlpha('#E8C58A', 0.085 * skyLight));
    skyGlow.addColorStop(0.38, colorAlpha('#52618C', 0.055 * skyLight));
    skyGlow.addColorStop(1, colorAlpha('#0A0E20', 0));
    ctx.fillStyle = skyGlow;
    ctx.fillRect(x, y, width, height);

    var mist = ctx.createLinearGradient(x, y + height * 0.28, x, y + height * 0.82);
    mist.addColorStop(0, colorAlpha('#FFF4D8', 0));
    mist.addColorStop(0.48, colorAlpha('#F1D39B', 0.025 * skyLight));
    mist.addColorStop(0.72, colorAlpha('#91A1C7', 0.018 * skyLight));
    mist.addColorStop(1, colorAlpha('#FFF4D8', 0));
    ctx.fillStyle = mist;
    ctx.fillRect(x, y, width, height);
  }

  // 在第一朵盛开时，后面的星仍沿星河升空，形成清晰的连续故事。
  if (options.showRising) {
    entries.forEach(function (entry) {
      var burstAt = 0.20 + entry.index * 0.105;
      drawReturningStar(ctx, entry, progress, burstAt, baseSize, width, seed);
    });
  }

  // 回到天空的星屑采用同一暖色家族，逐渐填满最初空旷的夜幕。
  var skyDustReveal = clamp((progress - 0.34) / 0.56, 0, 1);
  if (skyDustReveal > 0) {
    var skyRandom = seededRandom((seed ^ 0x6D2B79F5) >>> 0);
    var skyEase = 1 - Math.pow(1 - skyDustReveal, 3);
    for (var skyDust = 0; skyDust < 22; skyDust++) {
      var source = entries[skyDust % entries.length].center;
      var targetX = x + width * (0.055 + skyRandom() * 0.89);
      var targetY = y + height * (0.045 + skyRandom() * 0.69);
      var dustX = source.x + (targetX - source.x) * skyEase;
      var dustY = source.y + (targetY - source.y) * skyEase;
      var dustColor = FIREWORK_COLOR_WHEEL[(skyDust + seed) % FIREWORK_COLOR_WHEEL.length];
      var dustAlpha = (0.16 + skyRandom() * 0.30) * skyDustReveal;
      var dustSize = Math.max(0.54, width * (0.0011 + skyRandom() * 0.00135));
      ctx.shadowColor = dustColor;
      ctx.shadowBlur = dustSize * 3.8;
      if (skyDust % 7 === 0) {
        drawFourPointStar(ctx, dustX, dustY, dustSize * 2.4, dustColor, Math.min(0.82, dustAlpha * 1.18));
      } else {
        ctx.fillStyle = colorAlpha(dustColor, dustAlpha);
        ctx.beginPath();
        ctx.arc(dustX, dustY, dustSize, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
  }

  var isFullSceneMaster = !!(options.animalMaster && Number(options.animalMaster.height) > Number(options.animalMaster.width) * 1.12);
  var sceneStage = {
    sealReveal: sealReveal,
    seed: seed,
    x: x,
    y: y,
    width: width,
    height: height,
    baseSize: baseSize
  };
  if (isFullSceneMaster) drawHandPaintedSceneMaster(ctx, options.animalMaster, sceneStage);
  else drawAnimalNightBackdrop(ctx, sceneStage, sealIcon);

  drawStarFlowerComposition(ctx, ranked, {
    progress: progress,
    seed: seed,
    x: x,
    y: y,
    width: width,
    height: height,
    baseSize: baseSize,
    minSpeed: minSpeed,
    maxSpeed: maxSpeed,
    minLength: minLength,
    maxLength: maxLength,
    rankScale: rankScale,
    sealReveal: sealReveal
  });

  drawFireworkAnimalSeal(ctx, ranked, {
    progress: progress,
    seed: seed,
    x: x,
    y: y,
    width: width,
    height: height,
    baseSize: baseSize,
    sealReveal: sealReveal,
    reducedMotion: !!options.reducedMotion,
    animalMaster: options.animalMaster || null,
    fullSceneMaster: isFullSceneMaster
  }, sealIcon);

  // 最后才落前景，让云絮和失焦星尘真正遮住画框边缘，形成镜头内外的距离。
  if (!isFullSceneMaster) drawAnimalForeground(ctx, {
    sealReveal: sealReveal,
    seed: seed,
    x: x,
    y: y,
    width: width,
    height: height,
    baseSize: baseSize
  }, sealIcon);

  // 仅保留为旧作品的显式兼容模式；正常结果页、作品集与分享海报均使用“星花”。
  if (options.legacyFireworks === true) ranked.forEach(function (entry) {
    var path = entry.path;
    var mapped = entry.mapped;
    var pathIndex = entry.index;
    var metrics = entry.metrics;
    var burstAt = 0.20 + entry.index * 0.105;
    var local = clamp((progress - burstAt) / 0.27, 0, 1);
    if (local <= 0) return;
    var expand = 1 - Math.pow(1 - local, 3);
    var center = entry.center;
    var lengthNorm = maxLength > minLength ? (metrics.length - minLength) / (maxLength - minLength) : 0.5;
    var speedNorm = maxSpeed > minSpeed ? (metrics.speed - minSpeed) / (maxSpeed - minSpeed) : 0.5;
    var hierarchy = rankScale[Math.min(rankScale.length - 1, entry.rank)];
    var radius = baseSize * (0.118 + lengthNorm * 0.034) * hierarchy;
    var curveStrength = clamp(metrics.curvature / Math.PI, 0, 1);
    // 名次只决定舞台角色，笔迹数据继续决定每朵的尺度、旋转、弯度与疏密。
    // 因而五道星路一定得到五种可辨认的花火，而不是同一种模板换颜色。
    var kind = ['peony', 'dandelion', 'halo', 'willow', 'comet'][entry.rank % 5];
    var rayCounts = { peony: 29, dandelion: 35, halo: 31, willow: 23, comet: 20 };
    var rayCount = rayCounts[kind] + ((seed + pathIndex) % 2);
    var palette = fireworkPalette(null, pathIndex, seed, kind);
    var random = seededRandom((seed ^ ((pathIndex + 1) * 2654435761)) >>> 0);
    var baseAngle = metrics.angle + (random() - 0.5) * 0.12;

    // 第一层：暖白星核与香槟薄雾，像夜空被一点点重新点亮。
    var coreReveal = clamp(local / 0.34, 0, 1);
    var halo = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius * 1.55 * expand);
    halo.addColorStop(0, colorAlpha('#FFF7E2', 0.25 * coreReveal));
    halo.addColorStop(0.18, colorAlpha(palette[0], 0.17 * coreReveal));
    halo.addColorStop(0.48, colorAlpha(palette[1], 0.07 * coreReveal));
    halo.addColorStop(1, colorAlpha(palette[1], 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 1.55 * expand, 0, Math.PI * 2);
    ctx.fill();

    // 主花背后留一束极淡的体积光，扩大场面但不制造白色爆闪。
    if (entry.rank <= 1) {
      var beamReveal = clamp((local - 0.18) / 0.5, 0, 1);
      if (beamReveal > 0) {
        var beam = ctx.createLinearGradient(center.x, center.y, center.x, y + height * 0.92);
        beam.addColorStop(0, colorAlpha(palette[0], 0.042 * beamReveal));
        beam.addColorStop(0.62, colorAlpha(palette[1], 0.012 * beamReveal));
        beam.addColorStop(1, colorAlpha(palette[1], 0));
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(center.x - radius * 0.08, center.y);
        ctx.lineTo(center.x + radius * 0.72, y + height * 0.92);
        ctx.lineTo(center.x - radius * 0.72, y + height * 0.92);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 所有造型都共享一层完整的内爆星芒，确保垂柳与彗尾也有“完全盛开”的圆形基底。
    var innerReveal = clamp((local - 0.06) / 0.42, 0, 1);
    var innerCount = 18 + (entry.rank === 0 ? 6 : 2);
    for (var innerRay = 0; innerRay < innerCount; innerRay++) {
      var innerAngle = baseAngle + innerRay / innerCount * Math.PI * 2 + (random() - 0.5) * 0.055;
      var innerLength = radius * (0.42 + random() * 0.20) * expand;
      var innerStart = radius * 0.055 * expand;
      var innerX = center.x + Math.cos(innerAngle) * innerLength;
      var innerY = center.y + Math.sin(innerAngle) * innerLength;
      ctx.strokeStyle = colorAlpha(innerRay % 4 === 0 ? palette[2] : palette[innerRay % 2], 0.22 * innerReveal);
      ctx.lineWidth = Math.max(0.34, width * 0.00082);
      ctx.beginPath();
      ctx.moveTo(center.x + Math.cos(innerAngle) * innerStart, center.y + Math.sin(innerAngle) * innerStart);
      ctx.lineTo(innerX, innerY);
      ctx.stroke();
      for (var innerDust = 1; innerDust <= 3; innerDust++) {
        var innerMix = innerDust / 4;
        var innerColor = innerDust === 3 ? palette[2] : palette[(innerRay + innerDust) % 2];
        ctx.fillStyle = colorAlpha(innerColor, (0.34 + innerMix * 0.34) * innerReveal);
        ctx.beginPath();
        ctx.arc(
          center.x + (innerX - center.x) * innerMix,
          center.y + (innerY - center.y) * innerMix,
          Math.max(0.46, width * (0.00105 + innerMix * 0.00045)),
          0, Math.PI * 2
        );
        ctx.fill();
      }
    }

    for (var ray = 0; ray < rayCount; ray++) {
      var angleStep = Math.PI * 2 / rayCount;
      var angle = baseAngle + ray * angleStep;
      if (kind === 'peony') angle += (random() - 0.5) * 0.09;
      else if (kind === 'dandelion' || kind === 'halo') angle += (random() - 0.5) * 0.045;
      else if (kind === 'willow') angle = Math.PI + ray / Math.max(1, rayCount - 1) * Math.PI + (random() - 0.5) * 0.08;
      else angle = baseAngle - 0.68 + ray / Math.max(1, rayCount - 1) * 1.36 + Math.sin(ray * 1.7) * 0.045;
      var petalLength = radius * (0.8 + random() * 0.2);
      if (kind === 'dandelion') petalLength *= 0.9 + (ray % 3) * 0.08;
      if (kind === 'halo') petalLength *= 0.96;
      if (kind === 'willow') petalLength *= 0.96 + (ray % 2) * 0.12;
      if (kind === 'comet') petalLength *= 0.86 + (rayCount - ray) / rayCount * 0.4;
      var rayRadius = petalLength * expand;
      var nx = Math.cos(angle), ny = Math.sin(angle);
      var px = -ny, py = nx;
      var alternating = ray % 2 ? 1 : -1;
      var bendAmount = kind === 'peony' ? (0.26 + curveStrength * 0.18)
        : (kind === 'halo' ? 0.34 : (kind === 'willow' ? 0.12 : 0.08));
      var bend = alternating * radius * bendAmount * expand + (random() - 0.5) * radius * 0.09;
      var innerRatio = kind === 'halo' ? 0.58 : (kind === 'dandelion' ? 0.16 : 0.09);
      var inner = radius * innerRatio * expand;
      var tipX = center.x + nx * rayRadius;
      var tipY = center.y + ny * rayRadius + baseSize * 0.0035 * local * local;
      if (kind === 'willow') tipY += radius * (0.2 + Math.abs(nx) * 0.2) * expand;
      var midX = center.x + nx * rayRadius * 0.56 + px * bend;
      var midY = center.y + ny * rayRadius * 0.56 + py * bend;
      if (kind === 'willow') midY += radius * 0.02 * expand;
      if (kind === 'comet') {
        midX += px * radius * 0.08 * Math.sin(ray * 1.6);
        midY += py * radius * 0.08 * Math.sin(ray * 1.6);
      }
      var start = { x: center.x + nx * inner, y: center.y + ny * inner };
      var control = { x: midX, y: midY };
      var end = { x: tipX, y: tipY };
      var rayAlpha = (kind === 'dandelion' ? 0.16 : 0.20) + (ray % 3) * 0.018;
      rayAlpha *= 0.3 + local * 0.7;
      var rayColor = palette[ray % 2];

      ctx.strokeStyle = colorAlpha(ray % 5 === 0 ? palette[2] : rayColor, rayAlpha);
      ctx.lineWidth = Math.max(0.34, width * (kind === 'willow' ? 0.00105 : 0.00076));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(midX, midY, tipX, tipY);
      ctx.stroke();

      // 第二层：慢画的笔迹结成更细密的“珍珠瓣”，快画的笔迹留出舒展呼吸感。
      var baseParticles = { peony: 7, dandelion: 5, halo: 4, willow: 8, comet: 7 }[kind];
      var particleCount = Math.max(2, baseParticles - Math.round(speedNorm) + (ray % 2));
      for (var dust = 0; dust < particleCount; dust++) {
        var u = (dust + 1) / (particleCount + 1);
        var reveal = clamp((local - u * 0.5) / 0.32, 0, 1);
        if (reveal <= 0) continue;
        var grain = quadraticPoint(start, control, end, u);
        var grainJitter = (random() - 0.5) * radius * 0.04;
        var grainColor = (dust + ray) % 5 === 0 ? palette[2] : palette[(dust + ray) % 2];
        var grainRadius = Math.max(0.58, width * (0.00125 + ((dust + ray) % 3) * 0.00038)) * (entry.rank === 0 ? 1.08 : 1);
        ctx.shadowColor = grainColor;
        ctx.shadowBlur = grainRadius * 2.6;
        ctx.fillStyle = colorAlpha(grainColor, (0.52 + u * 0.34) * reveal);
        ctx.beginPath();
        ctx.arc(grain.x + px * grainJitter, grain.y + py * grainJitter, grainRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.shadowColor = rayColor;
      ctx.shadowBlur = ray % 4 === 0 ? Math.max(2, width * 0.005) : 0;
      ctx.fillStyle = colorAlpha(ray % 5 === 0 ? palette[2] : rayColor, (0.62 + (ray % 2) * 0.12) * local);
      ctx.beginPath();
      ctx.arc(tipX, tipY, Math.max(0.55, width * (0.0015 + (ray % 2) * 0.00058)), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if ((ray + entry.rank) % (kind === 'dandelion' ? 6 : 4) === 0 && local > 0.42) {
        drawFourPointStar(ctx, tipX, tipY, Math.max(0.9, width * 0.0028), palette[(ray + 1) % 2], 0.62 * local);
      }
    }

    // 最后一层光冠比主花瓣更晚抵达，形成“先开、再完全舒展”的第二次呼吸。
    var coronaReveal = clamp((local - 0.46) / 0.44, 0, 1);
    var coronaCount = 32 + (entry.rank === 0 ? 14 : (entry.rank <= 2 ? 7 : 0));
    for (var corona = 0; corona < coronaCount; corona++) {
      var coronaAngle = baseAngle + corona / coronaCount * Math.PI * 2 + (random() - 0.5) * 0.07;
      var coronaRadius = radius * (0.92 + random() * 0.33) * expand;
      var coronaX = center.x + Math.cos(coronaAngle) * coronaRadius;
      var coronaY = center.y + Math.sin(coronaAngle) * coronaRadius + radius * 0.025 * local * local;
      var coronaColor = corona % 6 === 0 ? palette[2] : palette[corona % 2];
      var coronaSize = Math.max(0.5, width * (0.00115 + random() * 0.00105));
      ctx.shadowColor = coronaColor;
      ctx.shadowBlur = coronaSize * (corona % 5 === 0 ? 4.8 : 2.4);
      if (corona % 9 === 0) {
        drawFourPointStar(ctx, coronaX, coronaY, coronaSize * 2.2, coronaColor, 0.74 * coronaReveal);
      } else {
        ctx.fillStyle = colorAlpha(coronaColor, (0.48 + random() * 0.36) * coronaReveal);
        ctx.beginPath();
        ctx.arc(coronaX, coronaY, coronaSize, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    // 第三层：停顿不会被判断好坏，而是被保存成外围的卫星星尘。
    var orbitCount = (kind === 'halo' ? 5 : 3) + Math.min(3, metrics.pauseCount) + (entry.rank === 0 ? 2 : 0);
    for (var orbit = 0; orbit < orbitCount; orbit++) {
      var orbitAngle = baseAngle + orbit / orbitCount * Math.PI * 2 + (random() - 0.5) * 0.3;
      var orbitReveal = clamp((local - 0.48 - orbit * 0.012) / 0.34, 0, 1);
      if (orbitReveal <= 0) continue;
      var orbitRadius = radius * (0.82 + random() * 0.42) * expand;
      var orbitX = center.x + Math.cos(orbitAngle) * orbitRadius;
      var orbitY = center.y + Math.sin(orbitAngle) * orbitRadius + baseSize * 0.003 * local * local;
      var orbitColor = palette[orbit % 2];
      if (orbit < metrics.pauseCount && orbit % 2 === 0) {
        drawFourPointStar(ctx, orbitX, orbitY, Math.max(0.85, width * 0.0027), orbitColor, 0.62 * orbitReveal);
      } else {
        ctx.fillStyle = colorAlpha(orbit % 4 === 0 ? '#FFF7E2' : orbitColor, 0.46 * orbitReveal);
        ctx.beginPath();
        ctx.arc(orbitX, orbitY, Math.max(0.42, width * (0.00095 + (orbit % 2) * 0.00034)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 无论花火开得多大，中心永远留着原来的星，成为“重获自由”的叙事锚点。
    var coreRadius = Math.max(2.7, width * (entry.rank === 0 ? 0.0092 : 0.0078));
    drawFourPointStar(ctx, center.x, center.y, coreRadius, '#FFF9EA', 0.98 * coreReveal);
    ctx.fillStyle = colorAlpha('#F5C86A', 0.78 * coreReveal);
    ctx.beginPath();
    ctx.arc(center.x, center.y, Math.max(0.75, width * 0.0021), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

module.exports = {
  colorAlpha: colorAlpha,
  mapNormalized: mapNormalized,
  getArtworkBounds: getArtworkBounds,
  mapArtwork: mapArtwork,
  partialPath: partialPath,
  traceCurve: traceCurve,
  strokeCurve: strokeCurve,
  drawMoonlightPath: drawMoonlightPath,
  drawTravelStar: drawTravelStar,
  strokeFingerprint: strokeFingerprint,
  fireworkSignature: fireworkSignature,
  ensureFireworkIdentity: ensureFireworkIdentity,
  getFireworkGenome: getFireworkGenome,
  analyzeArtworkShape: analyzeArtworkShape,
  getArtworkStyle: getArtworkStyle,
  getAnimalSceneKind: animalSceneKind,
  getAnimalScene: animalSceneMeta,
  drawGouacheNightTexture: drawGouacheNightTexture,
  drawArtworkAtmosphere: drawArtworkAtmosphere,
  drawFinalArtworkPaths: drawFinalArtworkPaths,
  drawArtworkFireworks: drawArtworkFireworks
};
