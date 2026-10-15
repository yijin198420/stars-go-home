// utils/specialStars.js —— 每晚会遇见的一颗特别星星
// 它们不是稀有度或抽卡奖励，只是三种不同的温柔互动。

var SPECIAL_STARS = [
  {
    id: 'echo',
    name: '回声星',
    color: '#E4D2FF',
    behavior: '碰到月亮船后，会轻轻弹回一次。',
    description: '它总会多走一小段路，再把回应送回来。',
    lines: [
      '有些回应，会晚一点到。',
      '你说过的话，并没有消失。',
      '它绕了一圈，还是回到了你身边。',
      '今晚的夜空，替你留住了一点回声。'
    ]
  },
  {
    id: 'slow',
    name: '慢慢星',
    color: '#BFDDF2',
    behavior: '它落得很慢，不需要追赶。',
    description: '它相信慢一点，也一样能够抵达。',
    lines: [
      '慢一点，也能够抵达。',
      '今晚没有什么需要赶上。',
      '你可以把速度，还给自己。',
      '它用很慢的方式，来到你这里。'
    ]
  },
  {
    id: 'whisper',
    name: '私语星',
    color: '#F1D79D',
    behavior: '靠近时，会带来一句只属于今晚的话。',
    description: '它把很轻的话藏在光里，只在被接住时说出来。',
    lines: [
      '它走了很久，今晚才落到你手里。',
      '这句话很轻，只说给现在的你。',
      '不用回答，它只是想陪你一会儿。',
      '夜色知道，你已经做得够多了。'
    ]
  }
];

function getSpecialStar(id) {
  for (var i = 0; i < SPECIAL_STARS.length; i++) {
    if (SPECIAL_STARS[i].id === id) return SPECIAL_STARS[i];
  }
  return SPECIAL_STARS[0];
}

function pickSpecialStar(lastId) {
  var pool = SPECIAL_STARS.filter(function (star) { return star.id !== lastId; });
  if (!pool.length) pool = SPECIAL_STARS.slice();
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickLine(id, previousLine) {
  var star = getSpecialStar(id);
  var pool = star.lines.filter(function (line) { return line !== previousLine; });
  if (!pool.length) pool = star.lines.slice();
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
  SPECIAL_STARS: SPECIAL_STARS,
  getSpecialStar: getSpecialStar,
  pickSpecialStar: pickSpecialStar,
  pickLine: pickLine
};
