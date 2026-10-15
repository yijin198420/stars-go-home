// utils/artworkTitles.js —— 为每晚作品生成可爱、积极、动物专属的标题。
// 标题只从笔迹取意，不把线条解释成性格或心理结论。

const artworkVoice = require('./artworkVoice.js');

const ANIMALS = [
  '月兔', '小鹿', '小熊', '小狐狸', '小猫', '松鼠', '海獭', '小海豹',
  '白鲸', '企鹅', '刺猬', '小象', '天鹅', '蜂鸟', '蝴蝶', '小羊'
];

// 每种动物有自己的身体特点、动作和小物件，不再把同一句夜空文案轮流套在动物名后面。
// 24 × 16 = 384 个经过人工检查的标题，足够覆盖一整年的夜晚且不重复。
const ANIMAL_TITLE_FAMILIES = {
  月兔: [
    '抱着月饼看星星', '把月光揉成糖', '踮脚碰了碰月亮', '耳朵接住小星星',
    '在云朵上翻跟头', '给月亮送胡萝卜', '用耳朵扇来晚风', '把星糖装满口袋',
    '围着月亮蹦一圈', '趴在云边吃月饼', '抱住一团软月光', '把梦卷成胡萝卜',
    '跳进星星棉花糖', '耳尖开出小星花', '给云朵盖月光被', '捧着月芽说晚安',
    '在银河里跳格子', '把月亮擦得亮亮', '枕着耳朵做甜梦', '和小星星碰鼻尖',
    '把晚风团成圆球', '在月光里蹦蹦跳', '给星河分一块饼', '抱着云朵转个圈'
  ],
  小鹿: [
    '鹿角挂满小星灯', '踩着星星去散步', '在月光里跳圆舞', '用鹿角接住彩虹',
    '把露珠串成项链', '给小花说声晚安', '踮着蹄尖碰月亮', '带着萤火逛森林',
    '把星光别在鹿角', '在云边轻轻转圈', '给月亮送一束花', '让鹿角开满星花',
    '驮着晚风慢慢走', '踏出一条金光路', '和树叶跳小圆舞', '在星河边喝露水',
    '把晨露摇成铃铛', '顶着月牙眨眨眼', '穿过花丛闻星光', '用蹄印盖小星章',
    '让萤火住进鹿角', '带着月光回花园', '围着星树转一圈', '在软草上做甜梦'
  ],
  小熊: [
    '抱着蜂蜜看月亮', '把蜂蜜分给星星', '枕着软云打呼噜', '抱住一团暖星光',
    '给月亮烤小饼干', '在星河里泡蜂蜜', '用熊掌拍亮星星', '把晚安装进肚兜',
    '和月亮碰一碰杯', '抱着云朵滚一圈', '把星糖放进蜜罐', '给小星星盖被子',
    '坐在月牙上晃脚', '在暖云里伸懒腰', '把梦搅成蜂蜜糖', '捧着小灯说晚安',
    '用肚皮接住月光', '和萤火玩拍拍手', '把枕头拍得松松', '抱住今晚的好梦',
    '给星河添一勺甜', '揣着月饼慢慢走', '在星光里打个滚', '用熊掌画小太阳'
  ],
  小狐狸: [
    '用尾巴扫亮星星', '把晚霞围成围巾', '和月亮玩躲猫猫', '尾巴卷住小星光',
    '给云朵梳蓬松毛', '踩着月影轻轻跳', '把星糖装进尾巴', '用耳尖接住晚风',
    '在花火里转圈圈', '把月亮擦成金色', '用尾巴画彩虹桥', '给星星讲小笑话',
    '叼来一朵月光花', '把云絮卷成甜筒', '在星河边摇尾巴', '用爪印盖晚安章',
    '给月牙系红围巾', '追着萤火绕花园', '把晚风扫成波浪', '尾巴开出小星花',
    '在软云上踮脚尖', '把甜梦叼回树屋', '和星星碰碰耳朵', '披着月光打个滚'
  ],
  小猫: [
    '把云朵踩成枕头', '追着月光毛线球', '在星星旁打呼噜', '用肉垫拍亮月亮',
    '胡须挂住小星星', '给月牙挠挠下巴', '踩着软云走猫步', '把晚风团成线球',
    '窝在星光里踩奶', '和月亮一起眯眼', '用尾巴圈住甜梦', '把银河拨成琴弦',
    '趴在月牙晒肚皮', '在云朵上伸懒腰', '用爪爪盖星星章', '抱着毛线球晚安',
    '把萤火当小铃铛', '沿着月光走猫步', '给夜空留个爪印', '把星尘蹭在脸颊',
    '在软毯云里翻身', '用胡须量量月亮', '和小星星贴贴脸', '抱着月牙摇尾巴'
  ],
  松鼠: [
    '装满一口袋星光', '把月亮饼分一半', '给云朵存小松果', '抱着松果数星星',
    '用尾巴扫扫软云', '在树梢晃小铃铛', '把露珠装进果壳', '给月亮送小榛子',
    '沿着星枝跳格子', '尾巴卷成小月牙', '给萤火分松果糖', '在云顶晒蓬松尾',
    '用果壳接住月光', '把晚安放进树洞', '抱着月饼荡秋千', '给星星织果壳帽',
    '踩着月影跳树枝', '把小风装进松果', '尾巴摇出星星雨', '在树叶床上翻身',
    '捧着榛子说晚安', '给月牙挂小果灯', '把甜梦收进果篮', '和萤火一起数数'
  ],
  海獭: [
    '捧着月亮泡泡', '抱着小星星漂漂', '把贝壳摇成晚安曲', '用肚皮托住月光',
    '牵着海草转圈圈', '把星糖放进贝壳', '在银河里仰泳', '给月亮敲贝壳鼓',
    '捧着珍珠眨眨眼', '抱住一朵软浪花', '用小爪梳亮水纹', '和星星一起漂漂',
    '把晚风划成波纹', '在月光里搓搓手', '给贝壳盖云朵被', '捧着小鱼说晚安',
    '用尾巴摇出星光', '把海浪卷成枕头', '抱着月牙晒肚皮', '给星河串贝壳链',
    '在泡泡里翻个身', '用水花拍亮夜空', '把甜梦装进贝壳', '牵着月光游一圈'
  ],
  小海豹: [
    '拍出一朵月光浪', '顶着星星转圈圈', '在云海里拍拍手', '用肚皮滑过银河',
    '给月亮拍个小球', '把浪花顶成皇冠', '在星光里滚一圈', '用小鳍抱住晚安',
    '拍着水花数星星', '把月牙当滑滑梯', '在软冰上摇摇摆', '给云朵盖小鳍印',
    '顶着泡泡眨眨眼', '和星星拍手合唱', '把海风拍成节拍', '在月光里拍拍肚',
    '用鼻尖碰小星星', '给浪花戴金帽子', '抱着冰花做甜梦', '把晚安滑进心里',
    '在银河边拍水花', '顶着月亮走一圈', '用小鳍挥来好梦', '和泡泡一起跳舞'
  ],
  白鲸: [
    '唱起月光摇篮曲', '吹出一串星泡泡', '驮着小月亮游泳', '把歌声送进云里',
    '用尾巴拍亮银河', '给星星唱晚安歌', '吹起金色泡泡雨', '在云海里慢慢游',
    '让月光坐上背鳍', '把晚风唱成鲸歌', '驮着星糖转一圈', '用水柱碰碰月亮',
    '在星河里摆摆尾', '给云朵吹个泡泡', '把甜梦唱给海听', '带着小鱼看花火',
    '用鲸歌摇亮星星', '让泡泡亲亲月牙', '背着软云游一圈', '在月光里唱和声',
    '把银河吹成彩带', '给夜空送一声笑', '牵着星光慢慢游', '用尾巴画大心心'
  ],
  企鹅: [
    '揣着暖暖星光', '把月亮围巾系好', '踩着雪花跳小舞', '抱着星星摇摇摆',
    '给冰山戴月光帽', '把小鱼分给月亮', '在星河边滑一圈', '用肚皮接住雪花',
    '踩出一排小星印', '和月牙碰一碰肚', '把晚安揣进口袋', '给云朵织暖围巾',
    '抱着冰花转圈圈', '在月光里排排走', '用小翅膀拍拍手', '把星糖放进围巾',
    '给雪人点亮眼睛', '沿着银河滑滑梯', '和星星一起摇摆', '把甜梦孵得暖暖',
    '戴着月牙小礼帽', '踩着星光回冰屋', '给小鱼唱晚安歌', '用脚印画小爱心'
  ],
  刺猬: [
    '背着一颗小太阳', '把星星变成糖豆', '顶着月光去散步', '让软刺开满星花',
    '背着苹果看月亮', '给小花送星星糖', '把月牙别在软刺', '用鼻尖碰碰星光',
    '驮着萤火转一圈', '把晚风梳进软刺', '在树叶床上打滚', '给星星分苹果派',
    '用小爪抱住月光', '背着彩虹慢慢走', '把甜梦挂满软刺', '和蘑菇说声晚安',
    '用软刺接住露珠', '给月亮送小苹果', '顶着花环看星星', '把云朵卷成小窝',
    '在月光里缩成球', '背着星灯绕花园', '用鼻尖推亮月牙', '抱着松果做甜梦'
  ],
  小象: [
    '吹出一朵晚安云', '用长鼻卷起月亮', '给星星洗泡泡澡', '把月光喷成彩虹',
    '用大耳扇来晚风', '驮着云朵去散步', '把星糖卷进口袋', '给月牙洗洗脸',
    '在银河边踩水花', '用长鼻吹小喇叭', '把耳朵变成云帆', '给星星戴泡泡帽',
    '卷着花朵看月亮', '在星光里摇耳朵', '用脚印盖月亮章', '把晚安吹进云里',
    '和萤火玩喷水花', '给夜空画条彩虹', '用长鼻牵小星星', '把甜梦卷成小球',
    '顶着月牙慢慢走', '在云海里扑扑耳', '给小花浇月光水', '用鼻尖亲亲星星'
  ],
  天鹅: [
    '载着月光慢慢游', '把湖面画成丝带', '和星星跳一支舞', '用翅膀抱住晚风',
    '给月亮梳梳羽毛', '在银河里转个圈', '把水波叠成裙摆', '用长颈绕个小心心',
    '给星光轻轻点头', '驮着花瓣游一圈', '把月影摇成小船', '在云湖里梳梳羽',
    '用翅尖碰小星星', '给晚风披羽毛毯', '把露珠戴成项链', '和月牙贴贴脸',
    '沿着星河画圆舞', '用白羽接住月光', '给湖面撒星星糖', '把甜梦叠进翅膀',
    '在月光里摆摆裙', '牵着小鱼看星星', '用水纹写声晚安', '给云朵跳天鹅舞'
  ],
  蜂鸟: [
    '衔来一颗甜星星', '把花香送给月亮', '在星光里扇扇翅', '用长喙点亮花心',
    '给月牙送一滴蜜', '绕着萤火跳快舞', '把晚风酿成花蜜', '在云边亲亲小花',
    '用翅膀抖落星尘', '给夜空送来花香', '把月光含在喙尖', '在花蕊边喝露水',
    '用小翅画八字舞', '给花苞盖星光被', '把甜梦酿成蜜糖', '追着花火转一圈',
    '用长喙碰小月牙', '在月光里停一秒', '给萤火分一滴蜜', '把花瓣扇成小船',
    '衔着彩虹看星星', '在云朵间轻轻飞', '用翅尖写声晚安', '给月亮送一朵花'
  ],
  蝴蝶: [
    '把夜风染成粉色', '给月亮系蝴蝶结', '在星河边跳舞', '用翅膀撒星星糖',
    '把花瓣披成斗篷', '给云朵画上彩边', '在月光里转圈圈', '用触角碰小星星',
    '把晚安系成丝带', '给花火扇扇风', '沿着银河画花边', '用翅尖接住露珠',
    '把甜梦染成彩色', '在云端轻轻停停', '给月牙戴上花环', '用花香写声晚安',
    '把星光别在翅膀', '和萤火跳双人舞', '给夜空添一朵花', '用翅膀抱住月光',
    '把彩虹折成小扇', '在星花里眨眨眼', '给云朵系小铃铛', '沿着月影慢慢飞'
  ],
  小羊: [
    '枕着云朵做甜梦', '把月光卷成软毛', '数着星星打哈欠', '给月亮织小毯子',
    '用卷毛接住星尘', '在云海里蹦一圈', '把晚安揉成棉花', '给星星盖羊毛被',
    '踩着软云去散步', '把月牙顶成发卡', '在星光里咩咩笑', '给晚风织白围巾',
    '用小蹄踏亮星星', '把甜梦卷成毛球', '和云朵比谁更软', '给月亮送一团暖',
    '在草地数萤火虫', '用卷毛挂小星灯', '把月光铺成软毯', '给小花唱咩咩歌',
    '抱着云团打个盹', '在银河边伸懒腰', '用羊角碰小月牙', '把好梦装满羊毛'
  ]
};

// v11–v14.6 曾使用的自动标题。只匹配完整旧组合，避免改动普通的用户自定义标题。
const LEGACY_ACTIONS = [
  '穿过今晚的银河', '捧住一小片月光', '把星星送回夜空', '在云边等晚风',
  '收藏了一场流星雨', '沿着彗尾去远方', '守着最后一束光', '在月亮背面做梦',
  '把晚风写成一封信', '遇见了金色花火', '从星河里慢慢归来', '替夜空点亮一盏灯',
  '枕着云朵看星星', '在银河拐角散步', '轻轻推开月光的门', '带着星尘回家',
  '把一颗星藏进口袋', '听见夜空开花', '乘着月亮去旅行', '在星光里打了个盹'
];

const FEATURE_ANIMALS = {
  paused: ['小熊', '小猫', '刺猬', '小海豹', '月兔'],
  winding: ['白鲸', '小狐狸', '海獭', '天鹅', '小象'],
  quick: ['蜂鸟', '松鼠', '蝴蝶', '小鹿', '企鹅'],
  light: ['月兔', '小羊', '小猫', '企鹅', '刺猬'],
  long: ['小鹿', '白鲸', '小象', '天鹅', '海獭'],
  balanced: ['小熊', '小狐狸', '小鹿', '海獭', '松鼠']
};

function titleSeed(artwork) {
  const paths = artwork && Array.isArray(artwork.paths) ? artwork.paths : [];
  let seed = paths.length * 97;
  paths.forEach(function (path, pathIndex) {
    const points = path && Array.isArray(path.points) ? path.points : [];
    seed += points.length * (pathIndex + 7);
    points.forEach(function (point, pointIndex) {
      if (pointIndex % 7 !== 0) return;
      seed += Math.round(Number(point.x || 0) * 1009) + Math.round(Number(point.y || 0) * 917);
    });
  });
  return Math.abs(seed);
}

function getFeature(artwork) {
  const metrics = artworkVoice.analyzeArtwork(artwork);
  if (metrics.pauseCount >= 2) return 'paused';
  if (metrics.directness >= 1.42) return 'winding';
  if (metrics.averageSpeed !== null && metrics.averageSpeed >= 0.72) return 'quick';
  if (metrics.totalLength > 0 && metrics.totalLength <= Math.max(1.55, metrics.pathCount * 0.34)) return 'light';
  if (metrics.totalLength >= Math.max(3.2, metrics.pathCount * 0.72)) return 'long';
  return 'balanced';
}

function featureOffset(feature) {
  return { paused: 3, winding: 7, quick: 11, light: 13, long: 17, balanced: 0 }[feature] || 0;
}

function animalFromTitle(title) {
  return ANIMALS.find(function (animal) { return String(title || '').indexOf(animal) === 0; }) || '';
}

function titlesForAnimals(animals) {
  const titles = [];
  animals.forEach(function (animal) {
    ANIMAL_TITLE_FAMILIES[animal].forEach(function (ending) { titles.push(animal + ending); });
  });
  return titles;
}

function selectTitle(candidates, seed, used, recentAnimals, allowRecentAnimals) {
  const total = candidates.length;
  for (let step = 0; step < total; step++) {
    // 37 与 120、384 都互质，可遍历完整候选池而不会提前循环。
    const title = candidates[(seed + step * 37) % total];
    const animal = animalFromTitle(title);
    if (!used.has(title) && (allowRecentAnimals || !recentAnimals.has(animal))) return title;
  }
  return '';
}

function generateArtworkTitle(artwork, usedTitles) {
  const used = new Set((usedTitles || []).filter(Boolean));
  const recentAnimals = new Set((usedTitles || []).slice(0, 4).map(animalFromTitle).filter(Boolean));
  const feature = getFeature(artwork);
  const seed = titleSeed(artwork) + featureOffset(feature);
  const preferred = titlesForAnimals(FEATURE_ANIMALS[feature] || ANIMALS);
  const all = titlesForAnimals(ANIMALS);
  return selectTitle(preferred, seed, used, recentAnimals, false)
    || selectTitle(all, seed * 3 + 19, used, recentAnimals, false)
    || selectTitle(all, seed * 5 + 23, used, recentAnimals, true)
    || '刺猬背着一颗小太阳';
}

function generateTitleForAnimal(artwork, animal, usedTitles) {
  const family = ANIMAL_TITLE_FAMILIES[animal];
  if (!family) return generateArtworkTitle(artwork, usedTitles);
  const used = new Set((usedTitles || []).filter(Boolean));
  const seed = titleSeed(artwork) + ANIMALS.indexOf(animal) * 17;
  for (let step = 0; step < family.length; step++) {
    const title = animal + family[(seed + step * 5) % family.length];
    if (!used.has(title)) return title;
  }
  return animal + family[seed % family.length];
}

function isLegacyAutoTitle(title) {
  const animal = animalFromTitle(title);
  return !!animal && LEGACY_ACTIONS.indexOf(String(title).slice(animal.length)) >= 0;
}

function upgradeLegacyArtworkTitle(title, artwork, usedTitles) {
  if (!isLegacyAutoTitle(title)) return String(title || '');
  return generateTitleForAnimal(artwork, animalFromTitle(title), usedTitles);
}

module.exports = {
  ANIMALS,
  ANIMAL_TITLE_FAMILIES,
  generateArtworkTitle,
  generateTitleForAnimal,
  isLegacyAutoTitle,
  upgradeLegacyArtworkTitle
};
