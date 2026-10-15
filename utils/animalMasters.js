// utils/animalMasters.js —— 烟花动物全景美术母版加载器
//
// 每只动物拥有一张独立的竖版夜空：地貌、月亮、云层与烟花构图都不同。
// 用户笔迹和 fireworkSeed 仍决定升空节奏、额外星尘与揭幕过程；同一作品
// 重播时始终使用同一张全景画，避免生成结果漂移。

var ICONS = [
  'rabbit', 'deer', 'bear', 'fox',
  'cat', 'squirrel', 'otter', 'seal',
  'whale', 'penguin', 'hedgehog', 'elephant',
  'swan', 'hummingbird', 'butterfly', 'sheep'
];

var browserCache = {};
var canvasCaches = [];

function safeIcon(icon) {
  return ICONS.indexOf(icon) >= 0 ? icon : 'rabbit';
}

function sourceFor(icon) {
  var filename = safeIcon(icon) + '.webp';
  // 独立网页从站点根目录下的 assets 读取；保留小程序分支便于引擎复用。
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return './assets/scenes/v20/' + filename;
  }
  return '/assets/scenes/v20/' + filename;
}

function cacheFor(canvas) {
  if (typeof window !== 'undefined' && typeof Image !== 'undefined') return browserCache;
  for (var i = 0; i < canvasCaches.length; i++) {
    if (canvasCaches[i].canvas === canvas) return canvasCaches[i].images;
  }
  var images = {};
  canvasCaches.push({ canvas: canvas, images: images });
  // 结果页、作品集和海报最多同时存在少量画布；限制缓存避免长列表反复进入后滞留。
  if (canvasCaches.length > 24) canvasCaches.shift();
  return images;
}

function createImage(canvas) {
  if (canvas && typeof canvas.createImage === 'function') return canvas.createImage();
  if (typeof Image !== 'undefined') return new Image();
  return null;
}

function get(canvas, icon) {
  var entry = cacheFor(canvas)[safeIcon(icon)];
  return entry && entry.state === 'ready' ? entry.image : null;
}

function load(canvas, icon, callback) {
  icon = safeIcon(icon);
  callback = typeof callback === 'function' ? callback : function () {};
  var cache = cacheFor(canvas);
  var existing = cache[icon];
  if (existing) {
    if (existing.state === 'ready') callback(existing.image);
    else if (existing.state === 'loading') existing.callbacks.push(callback);
    else callback(null);
    return existing.image || null;
  }

  var image = createImage(canvas);
  if (!image) {
    cache[icon] = { state: 'error', image: null, callbacks: [] };
    callback(null);
    return null;
  }

  var entry = cache[icon] = {
    state: 'loading',
    image: image,
    callbacks: [callback]
  };
  image.onload = function () {
    entry.state = 'ready';
    var callbacks = entry.callbacks.slice();
    entry.callbacks.length = 0;
    callbacks.forEach(function (fn) { fn(image); });
  };
  image.onerror = function () {
    entry.state = 'error';
    var callbacks = entry.callbacks.slice();
    entry.callbacks.length = 0;
    callbacks.forEach(function (fn) { fn(null); });
  };
  image.src = sourceFor(icon);
  return null;
}

function preload(canvas, icons, callback) {
  var list = (icons || ICONS).map(safeIcon);
  var remaining = list.length;
  var result = {};
  if (!remaining) {
    if (callback) callback(result);
    return;
  }
  list.forEach(function (icon) {
    load(canvas, icon, function (image) {
      result[icon] = image;
      remaining -= 1;
      if (!remaining && callback) callback(result);
    });
  });
}

module.exports = {
  ICONS: ICONS,
  sourceFor: sourceFor,
  get: get,
  load: load,
  preload: preload
};
