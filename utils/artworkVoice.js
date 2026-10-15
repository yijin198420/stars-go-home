// utils/artworkVoice.js —— 从可观察的绘画节奏生成“作品旁白”
//
// 这里只描述线条本身（停顿、速度、绕行、留白），不据此推断人格、
// 焦虑或抑郁等心理状态。安慰方向只来自用户主动选择的当下心情。

const DISCLAIMER = '根据今晚的绘画节奏生成 · 不是心理测评';

const RHYTHM_PARTS = {
  paused: {
    beginnings: ['你在几道光里停了一会儿', '星路走走停停', '有几笔没有急着抵达', '你的线条在途中轻轻顿了顿', '几颗星在路上等了等'],
    endings: ['，像给夜空留出了一点呼吸。', '，空下来的地方也被夜色接住了。', '，让这一晚有了慢慢展开的余地。', '，那些停顿也成为作品的一部分。', '，像星星在听远处的风。', '，夜空因此显得更安静了。', '，每一次停留都保留着自己的光。', '，最后仍然抵达了温柔的地方。']
  },
  winding: {
    beginnings: ['这些光绕了一点路', '几道星路弯弯地穿过夜空', '你的线条在星光间转了几个弯', '今晚的光绕了一点远路', '星星沿着柔软的弧线前行'],
    endings: ['，最后还是慢慢汇到了一起。', '，远一点的路也有自己的风景。', '，每个转弯都留下了一点亮。', '，像在寻找只属于今晚的方向。', '，夜空也跟着有了层次。', '，最后还是回到了家。', '，弯曲的部分像一段安静的旋律。', '，最终在同一个地方相遇。']
  },
  quick: {
    beginnings: ['今晚的光走得轻快', '几颗星很快越过了夜色', '你的线条带着明亮的速度', '星路一笔接着一笔向前', '这幅作品里有几道迅速的光'],
    endings: ['，也都稳稳找到了归处。', '，像风吹开了夜空的一扇门。', '，短暂却留下了清楚的方向。', '，让画面有了轻盈的节奏。', '，每一道都没有错过彼此。', '，像流星把心事轻轻带远。', '，最后停在了温暖的地方。', '，夜色也被它们悄悄点亮。']
  },
  light: {
    beginnings: ['你留下了几笔很轻的光', '今晚的星路简短而安静', '线条轻轻掠过夜空', '这幅作品没有把天空填满', '几道细小的光停在留白之间'],
    endings: ['，留白也成了作品的一部分。', '，像月光落在纸上没有出声。', '，少一点也依然是完整的。', '，让目光可以慢慢停下来。', '，安静的地方同样有光。', '，画面因此显得更柔软。', '，每一笔都保留着呼吸。', '，像一句不必说完的话。']
  },
  long: {
    beginnings: ['你让几道光走过了很远的夜空', '今晚的星路伸向了更远的地方', '线条在天空里留下长长的旅程', '几颗星沿着你的笔迹走了很久', '这幅作品把光慢慢铺向远处'],
    endings: ['，最后仍然回到了彼此身边。', '，远方也被收进了这幅画里。', '，一路上的微光都没有丢失。', '，像替今晚完成了一次远行。', '，让夜色有了深深浅浅的距离。', '，最后一段路也温柔地亮着。', '，每一步都成为作品的纹理。', '，抵达时依然保留着最初的星。']
  },
  balanced: {
    beginnings: ['这些线有快有慢', '几道星路舒展得刚刚好', '今晚的笔迹轻重相间', '光在你的线条里自然地流动', '这幅作品有着自己的呼吸'],
    endings: ['，像今晚没有说出口的呼吸。', '，彼此之间留着舒服的距离。', '，让夜空显得安稳而完整。', '，每一道都找到了合适的位置。', '，像一段慢慢落下来的旋律。', '，亮处和留白刚好相遇。', '，不急着解释也已经足够。', '，最后停成了今晚独有的样子。']
  }
};

const COMFORT_PARTS = {
  tired: {
    beginnings: ['今晚不必再完成什么了', '已经走到这里就很好', '身体发出的疲倦可以被听见', '剩下的事情可以先放一放', '这一晚不用再向前赶'],
    endings: ['，让身体先好好休息。', '，闭上眼睛也不会错过什么。', '，明天再继续也来得及。', '，你可以把重量交给床和枕头。', '，现在只需要慢慢呼吸。', '，这一点光会替你守着夜晚。', '，休息本身就是今晚要做的事。', '，先照顾好此刻的自己。']
  },
  anxious: {
    beginnings: ['没想清楚的事情', '那些还在转个不停的念头', '今晚没有答案的问题', '来不及处理的一切', '脑海里反复经过的声音'],
    endings: ['，可以先留给明天。', '，不必在这一刻全部解决。', '，可以暂时放在夜空里。', '，睡醒以后再慢慢靠近。', '，现在先让呼吸带你回来。', '，这一晚不要求你给出结论。', '，可以等天亮后再重新整理。', '，先和星光一起安静下来。']
  },
  sad: {
    beginnings: ['难过不必马上变轻', '今晚的情绪可以原样待着', '有些沉下来的心事', '你不需要急着把眼泪解释清楚', '不开心也可以被温柔地放在这里'],
    endings: ['，你已经陪自己待了一会儿。', '，它会按照自己的速度过去。', '，先让夜色替你收好一点。', '，此刻不必表现得更坚强。', '，休息不会否定你的感受。', '，你可以慢慢来。', '，这一晚有人和星光一起陪着你。', '，先把自己安稳地放回枕边。']
  },
  quiet: {
    beginnings: ['不需要解释什么', '安静本身也很完整', '今晚可以少说一点', '没有声音的片刻', '只是这样待一会儿'],
    endings: ['，慢慢待着就可以。', '，也值得被好好保留。', '，让夜色陪你把呼吸放轻。', '，不必急着变成别的样子。', '，已经是属于你的休息。', '，星星会替你守住这份安静。', '，让思绪从身边轻轻经过。', '，然后把眼睛慢慢合上。']
  },
  comfort: {
    beginnings: ['把今晚的一点暖意', '这幅画里留下的微光', '刚刚陪伴你的星星', '夜空送来的这一点温柔', '你为自己画下的光'],
    endings: ['，也留给此刻的自己。', '，可以陪你一起入睡。', '，会安静地停在枕边。', '，足够照亮今晚的一小段路。', '，不用急着和任何人分享。', '，会替你把梦照得柔软一点。', '，请允许自己慢慢收下。', '，今晚就让它陪你休息。']
  },
  unknown: {
    beginnings: ['说不清也没有关系', '今晚不必为感受取名字', '有些心情暂时没有答案', '不知道该怎么形容的时候', '这一刻是什么样都可以'],
    endings: ['，先让这一晚慢下来。', '，呼吸会带你回到此刻。', '，夜空可以先替你收着。', '，休息不需要一个理由。', '，你仍然可以好好睡一觉。', '，明天也许会有新的说法。', '，现在只需要照顾好自己。', '，星光会陪它安静地待一会儿。']
  }
};

function distance(a, b) {
  const dx = Number(b.x || 0) - Number(a.x || 0);
  const dy = Number(b.y || 0) - Number(a.y || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function analyzeArtwork(artwork) {
  const paths = artwork && Array.isArray(artwork.paths) ? artwork.paths : [];
  let totalLength = 0;
  let directLength = 0;
  let totalDuration = 0;
  let pauseCount = 0;
  let timedSegments = 0;
  let pointCount = 0;

  paths.forEach((path) => {
    const points = path && Array.isArray(path.points) ? path.points : [];
    if (points.length < 2) return;
    pointCount += points.length;
    directLength += distance(points[0], points[points.length - 1]);

    for (let i = 1; i < points.length; i++) {
      totalLength += distance(points[i - 1], points[i]);
      const previousTime = Number(points[i - 1].t);
      const currentTime = Number(points[i].t);
      if (Number.isFinite(previousTime) && Number.isFinite(currentTime) && currentTime >= previousTime) {
        const delta = currentTime - previousTime;
        totalDuration += delta;
        timedSegments += 1;
        if (delta >= 0.32) pauseCount += 1;
      }
    }
  });

  const hasTiming = timedSegments > 0 && totalDuration > 0;
  return {
    pathCount: paths.length,
    pointCount,
    totalLength,
    directness: directLength > 0 ? totalLength / directLength : 1,
    duration: hasTiming ? totalDuration : null,
    averageSpeed: hasTiming ? totalLength / totalDuration : null,
    pauseCount: hasTiming ? pauseCount : 0,
    hasTiming
  };
}

function rhythmFeature(metrics) {
  if (metrics.hasTiming && metrics.pauseCount >= 2) {
    return 'paused';
  }
  if (metrics.directness >= 1.42) {
    return 'winding';
  }
  if (metrics.hasTiming && metrics.averageSpeed >= 0.72) {
    return 'quick';
  }
  if (metrics.totalLength > 0 && metrics.totalLength <= Math.max(1.55, metrics.pathCount * 0.34)) {
    return 'light';
  }
  if (metrics.totalLength >= Math.max(3.2, metrics.pathCount * 0.72)) {
    return 'long';
  }
  return 'balanced';
}

function partsLine(parts, index) {
  return parts.beginnings[index % parts.beginnings.length] +
    parts.endings[Math.floor(index / parts.beginnings.length) % parts.endings.length];
}

function artworkSeed(artwork, metrics) {
  let seed = Math.round(metrics.totalLength * 10000) + metrics.pointCount * 31 + metrics.pathCount * 997;
  (artwork.paths || []).forEach(function (path, pathIndex) {
    (path.points || []).forEach(function (point, pointIndex) {
      if (pointIndex % 9 !== 0) return;
      seed += Math.round(Number(point.x || 0) * 1009) + Math.round(Number(point.y || 0) * 917) + pathIndex * 53;
    });
  });
  return Math.abs(seed);
}

function generateArtworkVoice(artwork, mood, options) {
  const metrics = analyzeArtwork(artwork);
  if (!metrics.pathCount || !metrics.pointCount) return null;
  const feature = rhythmFeature(metrics);
  const rhythmParts = RHYTHM_PARTS[feature];
  const comfortParts = COMFORT_PARTS[mood] || COMFORT_PARTS.unknown;
  const rhythmTotal = rhythmParts.beginnings.length * rhythmParts.endings.length;
  const comfortTotal = comfortParts.beginnings.length * comfortParts.endings.length;
  const used = new Set((options && options.usedSignatures || []).filter(Boolean));
  const seed = artworkSeed(artwork, metrics);
  let lines = [];
  let signature = '';
  for (let attempt = 0; attempt < rhythmTotal * comfortTotal; attempt++) {
    const cursor = seed + attempt;
    const rhythmIndex = cursor % rhythmTotal;
    const comfortIndex = (Math.floor(cursor / rhythmTotal) + seed * 7) % comfortTotal;
    lines = [partsLine(rhythmParts, rhythmIndex), partsLine(comfortParts, comfortIndex)];
    signature = lines.join('\n');
    if (!used.has(signature)) break;
  }
  return {
    version: 2,
    feature,
    lines,
    signature,
    disclaimer: DISCLAIMER,
    metrics
  };
}

module.exports = {
  DISCLAIMER,
  analyzeArtwork,
  generateArtworkVoice
};
