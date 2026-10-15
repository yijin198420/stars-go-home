// utils/generateSummary.js —— 生成「今晚的星空总结」
// 输入是游戏页传来的成绩对象，输出是多行温柔的总结文字。
// 注意：全程不使用诊断式表达，只做描述和陪伴。

// 星星类型与心情的中文名、收尾文案，统一从文案库取，避免两处重复维护
const texts = require('./starTexts.js');
const moodClosers = texts.moodClosers;

// result 结构：
// { count, breathCount, missed, byType: { tired: 3, hope: 2, ... }, mood: 'tired' }
function generateSummary(result) {
  const lines = [];

  // 先肯定用户为自己留出的时间，而不是把数量放在第一位
  lines.push('今晚，你为自己留了一小会儿。');

  const actions = [];
  if (result.count > 0) {
    actions.push(result.pathArtwork ? '牵回了 ' + result.count + ' 颗星' : '接住了 ' + result.count + ' 颗星');
  }
  const restCount = (result.breathCount || 0) + (result.pauseCount || 0);
  if (restCount > 0) actions.push('停下来呼吸了 ' + restCount + ' 次');
  if (actions.length > 0) {
    lines.push('你' + actions.join('，也') + '。');
  } else {
    lines.push(result.pathArtwork
      ? '作品还没有画完也没关系，你还是在这里待了一会儿。'
      : '什么都没有接住也没关系，你还是在这里待了一会儿。');
  }

  // 今晚被命名的那颗星：保留用户主动表达的内容
  if (result.namedStar) {
    lines.push('有一颗星，被你叫作「' + result.namedStar + '」。');
  }

  if (result.starMapName) {
    lines.push(result.pathArtwork
      ? '你把今晚的笔迹取名为「' + result.starMapName + '」。'
      : '你把这些光连成了「' + result.starMapName + '」。');
  }

  return lines;
}

// 找出今晚接住最多的星光类型。它只描述游戏结果，不解释为用户的真实情绪。
function generateDominantHint(result) {
  let maxType = null;
  let maxNum = 0;
  Object.keys(result.byType || {}).forEach(function (type) {
    if (result.byType[type] > maxNum) {
      maxNum = result.byType[type];
      maxType = type;
    }
  });
  if (!maxType || maxNum === 0) {
    return '今晚的夜空很安静。';
  }
  const hints = result.pathArtwork ? {
    tired: '你的作品里，雾蓝色多一些。今晚可以把休息放在前面。',
    anxious: '紫色的光在你的笔迹里停了一会儿。先不用想远，只顾好眼前。',
    sad: '雨蓝色留在了今晚的画里。感受不必马上变轻。',
    hope: '暖金色成为今晚作品里最多的光。很小的期待，也值得留下。',
    calm: '月白色安静地留在你的作品里。这样待一会儿，也很好。'
  } : {
    tired: '你接住的星光里，蓝色多一些。今晚可以把休息放在前面。',
    anxious: '紫色的光在今晚多停了一会儿。先不用想远，只顾好眼前。',
    sad: '雨蓝色的光被你接住得最多。感受不必马上变轻。',
    hope: '今晚接住最多的是金色星光。很小的期待，也值得留下。',
    calm: '今晚接住最多的是月白星光。安静待一会儿，也很好。'
  };
  return hints[maxType] || '今晚的星光已经在这里安放好了。';
}

// 按心情取一句收尾
function getMoodCloser(mood) {
  return moodClosers[mood] || moodClosers.unknown;
}

module.exports = {
  generateSummary,
  generateDominantHint,
  getMoodCloser
};
