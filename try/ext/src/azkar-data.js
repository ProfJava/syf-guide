/* SYF — بيانات الأذكار المشتركة + تصفية الأذكار المخصّصة (v0.122.0).
 * ONE source of truth for the built-in lists, loaded in BOTH worlds: as a content
 * script before src/islam2.js, and through importScripts() in background.js (a
 * classic worker). Until v0.122.0 the periodic list lived twice (IK_AZKAR in the
 * worker, AZKAR in islam2.js) and the morning/evening lists once, in the panel only
 * — the worker could not show a dhikr it did not have. Now that the user can ADD
 * adhkar (`azkar_custom`) and the worker pushes them one by one as daily goals, a
 * copy per world would be a copy per bug.
 * ⛔ Keep it free of the window, document and chrome globals — one home has none. */
(function (root) {
  /* i18n-skip-start: the adhkar themselves — the CONTENT the tools exist to show,
     not the interface around them (§6.97/2). They stay Arabic in every language. */
  var GEN = [
    'سبحان الله وبحمده، سبحان الله العظيم',
    'لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير',
    'اللهم صلِّ وسلِّم على نبينا محمد ﷺ',
    'أستغفر الله العظيم وأتوب إليه',
    'لا حول ولا قوة إلا بالله',
    'سبحان الله، والحمد لله، ولا إله إلا الله، والله أكبر',
    'حسبي الله لا إله إلا هو، عليه توكلت وهو رب العرش العظيم',
    'اللهم إني أسألك العفو والعافية في الدنيا والآخرة',
    'رب اغفر لي وتب عليّ إنك أنت التواب الرحيم',
    'لا إله إلا أنت سبحانك إني كنت من الظالمين',
    'اللهم أعني على ذكرك وشكرك وحسن عبادتك',
    'رضيت بالله رباً، وبالإسلام ديناً، وبمحمد ﷺ نبياً'
  ];
  /* [text, repeat] — mornings get أصبحنا wording, evenings أمسينا */
  var SABAH = [
    ['آية الكرسي: الله لا إله إلا هو الحي القيوم، لا تأخذه سنة ولا نوم، له ما في السماوات وما في الأرض…', 1],
    ['قل هو الله أحد + قل أعوذ برب الفلق + قل أعوذ برب الناس', 3],
    ['أصبحنا وأصبح الملك لله، والحمد لله، لا إله إلا الله وحده لا شريك له', 1],
    ['اللهم بك أصبحنا وبك أمسينا، وبك نحيا وبك نموت وإليك النشور', 1],
    ['سيد الاستغفار: اللهم أنت ربي لا إله إلا أنت، خلقتني وأنا عبدك، وأنا على عهدك ووعدك ما استطعت…', 1],
    ['بسم الله الذي لا يضر مع اسمه شيء في الأرض ولا في السماء وهو السميع العليم', 3],
    ['رضيت بالله رباً وبالإسلام ديناً وبمحمد ﷺ نبياً', 3],
    ['أعوذ بكلمات الله التامات من شر ما خلق', 3],
    ['لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير', 10],
    ['سبحان الله وبحمده', 100]
  ];
  var MASAA = [
    ['آية الكرسي: الله لا إله إلا هو الحي القيوم، لا تأخذه سنة ولا نوم، له ما في السماوات وما في الأرض…', 1],
    ['قل هو الله أحد + قل أعوذ برب الفلق + قل أعوذ برب الناس', 3],
    ['أمسينا وأمسى الملك لله، والحمد لله، لا إله إلا الله وحده لا شريك له', 1],
    ['اللهم بك أمسينا وبك أصبحنا، وبك نحيا وبك نموت وإليك المصير', 1],
    ['سيد الاستغفار: اللهم أنت ربي لا إله إلا أنت، خلقتني وأنا عبدك، وأنا على عهدك ووعدك ما استطعت…', 1],
    ['بسم الله الذي لا يضر مع اسمه شيء في الأرض ولا في السماء وهو السميع العليم', 3],
    ['رضيت بالله رباً وبالإسلام ديناً وبمحمد ﷺ نبياً', 3],
    ['أعوذ بكلمات الله التامات من شر ما خلق', 3],
    ['لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير', 10],
    ['سبحان الله وبحمده', 100]
  ];
  /* i18n-skip-end */

  /* ===== صوت الشيخ (v0.127.0) =====
   * Real recordings instead of the robot voice: hisnmuslim.com — the official site of
   * كتاب حصن المسلم — publishes ONE mp3 per dhikr (recited by حامد بن محمد الدريهم)
   * with the book's own repeat count, and our list is the same book's chapter 27, so
   * the pairing is exact: every id below was matched by TEXT and its REPEAT checked
   * against ours (3 for المعوذات, 10 for التهليل, 100 for التسبيح…).
   * ⛔ The index IS the contract: AUDIO.s[i] belongs to SABAH[i]. Add a dhikr to a
   * list and you add its id here, or the panel recites the wrong one — which is worse
   * than silence. A list is longer than its audio row (the user's own adhkar) → the
   * extra items simply have none and fall back to the device voice.
   * 77/78 are the two the book writes once and reads with BOTH openings («وإذا أمسى
   * قال: أمسينا…»), which is why the evening column may repeat a morning id. */
  var AUDIO = {
    s: [75, 76, 77, 78, 79, 86, 87, 97, 92, 91],
    m: [75, 76, 77, 78, 79, 86, 87, 97, 92, 91]
  };
  var AUDIO_BASE = 'https://www.hisnmuslim.com/audio/ar/';
  /* '' when this dhikr has no recording — the caller decides what to do with silence */
  function audioUrl(kind, i) {
    var row = AUDIO[kind];
    var id = row && row[i | 0];
    return (typeof id === 'number' && id > 0) ? AUDIO_BASE + id + '.mp3' : '';
  }

  var MAX_ITEMS = 100, MAX_LEN = 500, MAX_N = 1000;
  function cleanText(t) { return (typeof t === 'string') ? t.replace(/\s+/g, ' ').trim().slice(0, MAX_LEN) : ''; }
  function cleanN(n) { n = parseInt(n, 10); return (n >= 1 && n <= MAX_N) ? n : 1; }

  /* `azkar_custom` as stored → { gen:[text], s:[[text,n]], m:[[text,n]] }.
   * Filtered ON READ (§5.11): every item ends in textContent, in a toast and in a
   * system notification, and «استيراد» writes any JSON object as it came. Anything
   * that is not a string of the right shape is DROPPED, never coerced — a dhikr
   * that reads «[object Object]» is worse than one fewer dhikr. */
  function normCustom(raw) {
    var o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    function list(a, withN) {
      if (!Array.isArray(a)) return [];
      var out = [];
      for (var i = 0; i < a.length && out.length < MAX_ITEMS; i++) {
        var it = a[i], t;
        if (withN) { if (!Array.isArray(it)) continue; t = cleanText(it[0]); if (t) out.push([t, cleanN(it[1])]); }
        else { t = cleanText(it); if (t) out.push(t); }
      }
      return out;
    }
    return { gen: list(o.gen, false), s: list(o.s, true), m: list(o.m, true) };
  }
  /* built-in first, the user's own appended — the order both surfaces show */
  function lists(custom) {
    var c = normCustom(custom);
    return { gen: GEN.concat(c.gen), s: SABAH.concat(c.s), m: MASAA.concat(c.m) };
  }

  root.SYFS_AZKAR = { GEN: GEN, SABAH: SABAH, MASAA: MASAA, normCustom: normCustom, lists: lists, cleanText: cleanText, cleanN: cleanN, MAX_ITEMS: MAX_ITEMS, MAX_LEN: MAX_LEN, MAX_N: MAX_N, AUDIO: AUDIO, AUDIO_BASE: AUDIO_BASE, audioUrl: audioUrl };
}(typeof self !== 'undefined' ? self : this));
