/* guide-settings.js — what every setting does, for guide.html and guide-slides.html
 * (v0.140.2). Same rule as guide-data.js: ONE list, each entry carries both languages,
 * so the Arabic and English guides cannot document different settings.
 *
 * Labels are quoted exactly as the UI shows them (src/rail.js, src/help.js,
 * src/ai-keys.js, src/app.js). A setting renamed in the UI must be renamed here.
 *
 * g(id, icon, [arName, arWhere], [enName, enWhere], [[arLabel, arWhat, enLabel, enWhat], …]) */
(function () {
  'use strict';
  function g(id, icon, ar, en, items) {
    return {
      id: id, icon: icon,
      ar: { n: ar[0], where: ar[1] }, en: { n: en[0], where: en[1] },
      items: items.map(function (x) { return { ar: [x[0], x[1]], en: [x[2], x[3]] }; })
    };
  }

  var RAIL_AR = 'زرّ ⚙ في آخر الشريط العائم ← «الإعدادات وإدارة الاختصارات»';
  var RAIL_EN = 'The ⚙ button at the end of the floating rail → «Settings & tool manager»';

  window.SYF_GUIDE_SETTINGS = [

    g('tools', '🧩', ['تبويب الأدوات', RAIL_AR + ' ← 🧩 الأدوات'], ['Tools tab', RAIL_EN + ' → 🧩 Tools'], [
      ['إضافة اختصار مخصّص', 'اكتب اسمًا ورابطًا ثم «إضافة» — يظهر زرّ يفتح موقعك داخل فئة «روابط». ✕ يحذفه.',
       'Add a custom shortcut', 'Type a name and a URL, then «Add» — a button that opens your site appears in the «Links» category. ✕ deletes it.'],
      ['مربّع الفئة', 'يُظهر الفئة كلها على الشريط أو يخفيها. «مطوّرين» و«المساعد الذكي» مخفيّتان في التثبيت الجديد.',
       'Category checkbox', 'Shows or hides the whole category on the rail. «Developers» and «AI assistant» start hidden on a fresh install.'],
      ['مربّع الأداة', 'يُظهر أداة واحدة أو يخفيها. عشرة روابط جاهزة (Gmail وYouTube…) مخفيّة في البداية.',
       'Tool checkbox', 'Shows or hides a single tool. Ten ready-made links (Gmail, YouTube…) start hidden.'],
      ['⋮⋮ السحب', 'اسحب رأس الفئة لترتيب الفئات على الشريط، واسحب سطر الأداة لترتيبها داخل فئتها.',
       '⋮⋮ Drag', 'Drag a category header to reorder the categories on the rail; drag a tool row to reorder it inside its category.'],
      ['⌨ زرّ الاختصار', 'اضغطه ثم اضغط التوليفة التي تريدها لفتح الأداة. Esc يلغي، وBackspace يحذف الاختصار.',
       '⌨ Shortcut button', 'Press it, then press the combination that should open the tool. Esc cancels; Backspace removes the shortcut.'],
      ['★ النجمة', 'تضيف الأداة إلى رفّ المفضّلة في أعلى الشريط.',
       '★ Star', 'Adds the tool to the favourites shelf at the top of the rail.']
    ]),

    g('langpos', '🌐', ['اللغة والموضع', RAIL_AR + ' ← 🎨 المظهر ← اللغة والموضع'], ['Language & position', RAIL_EN + ' → 🎨 Appearance → Language & position'], [
      ['اللغة — Language', 'العربية أو English. يقلب اتجاه الواجهة، ويغلق النوافذ المفتوحة، ويعيد بناء الشريط. أول تثبيت يخمّنها من لغة متصفّحك ويسألك مرّة.',
       'Language', 'Arabic or English. Flips the interface direction, closes open windows and rebuilds the rail. A fresh install guesses from your browser language and asks you once.'],
      ['موضع الشريط', 'يمين أو يسار أو أعلى أو أسفل الشاشة. الافتراضي: يمين.',
       'Rail position', 'Right, left, top or bottom of the screen. Default: right.']
    ]),

    g('colors', '🎨', ['الألوان', RAIL_AR + ' ← 🎨 المظهر ← الألوان'], ['Colours', RAIL_EN + ' → 🎨 Appearance → Colours'], [
      ['اللون', 'ثمانية ألوان لهويّة الشريط ونوافذ الأدوات: تركوازي (الافتراضي)، أزرق، بنفسجي، أخضر، برتقالي، وردي، سماوي، رمادي.',
       'Colour', 'Eight accent colours for the rail and tool windows: teal (default), blue, purple, green, orange, pink, sky, grey.'],
      ['نمط الأزرار', 'صلب، زجاجي، ثلجي، محدّد، داكن، واضح — شكل رسم أزرار الشريط. «ثلجي» أو «واضح» أوضح على المواقع المزدحمة.',
       'Button style', 'Solid, glass, frosted, outlined, dark, clear — how the rail\'s buttons are drawn. «Frosted» or «clear» read better on busy sites.']
    ]),

    g('fonts', '🔤', ['الخطوط', RAIL_AR + ' ← 🎨 المظهر ← الخطوط'], ['Fonts', RAIL_EN + ' → 🎨 Appearance → Fonts'], [
      ['خط الواجهة', 'خط النظام (الافتراضي) أو واحد من 12 خطًا عربيًا مدمجًا (تجوّل، القاهرة، المراعي…). يسري على الشريط والنوافذ وصفحات الإضافة، ويعمل بلا إنترنت.',
       'Interface font', 'The system font (default) or one of 12 bundled Arabic fonts (Tajawal, Cairo, Almarai…). Applies to the rail, the windows and the extension pages, and works offline.'],
      ['خط مثبّت على جهازك', 'اكتب اسم أي خط موجود على جهازك ثم «تطبيق».',
       'A font installed on this device', 'Type the name of any font on your machine, then «Apply».'],
      ['طبّق الخط على المواقع التي أتصفّحها', 'يفرض الخط المختار على نصوص المواقع أيضًا، ويترك أيقونات المواقع والكود كما هي. مطفأ افتراضيًا.',
       'Use this font on the sites I browse', 'Forces the chosen font on website text too, leaving icon fonts and code alone. Off by default.']
    ]),

    g('bar', '🧭', ['الشريط والأيقونات', RAIL_AR + ' ← 🎨 المظهر ← الشريط والأيقونات'], ['The bar & its icons', RAIL_EN + ' → 🎨 Appearance → The bar & its icons'], [
      ['حجم الأيقونات', 'من 100% إلى 220% (الافتراضي 120%). إن لم تتّسع الشاشة يُعرض أكبر حجم ممكن ويقترح إخفاء فئة.',
       'Icon size', 'From 100% to 220% (default 120%). If the screen cannot fit it, the largest size that fits is used and hiding a category is suggested.'],
      ['الشفافية', 'من 35% إلى 100% — شفافية الشريط فوق الصفحة.',
       'Opacity', 'From 35% to 100% — how see-through the rail is over the page.'],
      ['تأثير التمرير', 'حركة الأيقونات تحت الماوس: تكبير Mac، تكبير، ارتفاع (الافتراضي)، توهّج، ارتداد، بدون.',
       'Hover effect', 'How icons react under the pointer: Mac magnify, zoom, lift (default), glow, jelly, none.'],
      ['عرض أدوات التصنيف', '«أيقونة + اسم» قائمة بأسماء الأدوات (الافتراضي)، أو «أيقونات فقط» شريط مضغوط تظهر الأسماء فيه عند التمرير.',
       'How a category\'s tools are shown', '«Icon + name» lists the tool names (default); «Icons only» is a compact strip with names on hover.'],
      ['إخفاء عند الحافة', 'يلتصق الشريط بحافة الشاشة ويعود حين يقترب الماوس — يوفّر المساحة.',
       'Tuck to the edge', 'The rail tucks against the screen edge and slides back when the pointer comes near — saves space.'],
      ['طيّ الشريط', 'الشارة الصغيرة على الشريط تطويه إلى أيقونة واحدة وتفتحه.',
       'Fold the bar', 'The small badge on the rail folds it down to one icon and back.']
    ]),

    g('clock', '🕒', ['الساعة والتاريخ', RAIL_AR + ' ← 🎨 المظهر ← الساعة والتاريخ'], ['Clock & date', RAIL_EN + ' → 🎨 Appearance → Clock & date'], [
      ['عرض الوقت والتاريخ على الشريط', 'يُظهر شريحة الساعة على الشريط أو يخفيها (مفعّل افتراضيًا).',
       'Show the time and date on the rail', 'Shows or hides the clock chip on the rail (on by default).'],
      ['الشكل', 'بارز، مركّب، بلون الهوية، بلا خلفية، نتيجة، رقمي.',
       'Look', 'Bold, stacked, accent, no fill, calendar, digital.'],
      ['ماذا يُعرض', 'وقت وتاريخ، أو الوقت فقط، أو التاريخ فقط.',
       'What it shows', 'Time and date, time only, or date only.'],
      ['صيغة الوقت', '12 ساعة (الافتراضي) أو 24 ساعة.',
       'Time format', '12-hour (default) or 24-hour.'],
      ['صيغة التاريخ', 'يوم وشهر، أو هجري، أو اسم اليوم.',
       'Date format', 'Day and month, Hijri, or weekday.'],
      ['نقرة على الساعة', 'تبدّل بين 12 و24 ساعة، والمرور فوقها يفتح بطاقة اليوم: الميلادي والهجري والمناسبات والتذكيرات.',
       'Click the clock', 'Toggles 12/24-hour; hovering opens today\'s card: Gregorian and Hijri dates, occasions and reminders.']
    ]),

    g('keys', '⌨', ['المفاتيح', RAIL_AR + ' ← ⌨ المفاتيح'], ['Keys', RAIL_EN + ' → ⌨ Keys'], [
      ['سجّل توليفة', 'اختر أداة من القائمة، اضغط «⌨ سجّل توليفة»، ثم اضغط التوليفة (يجب أن تحوي Alt أو Ctrl أو ⌘). توليفة مستخدمة تنتقل للأداة الجديدة.',
       'Record a combo', 'Pick a tool, press «⌨ Record a combo», then press the combination (it must include Alt, Ctrl or ⌘). A combination already in use moves to the new tool.'],
      ['الاختصارات الافتراضية لكل الأدوات', 'Alt+K ثم حرف الفئة ثم حرف الأداة — لكل أداة اختصار بلا إعداد. يتحكّم أيضًا في ⌘K/Ctrl+K للبحث. إطفاؤه يعيد المفتاحين للموقع.',
       'Built-in shortcuts for every tool', 'Alt+K, then the category letter, then the tool letter — every tool has a shortcut with no setup. Also controls ⌘K/Ctrl+K for search. Turning it off gives both keys back to the site.'],
      ['اعرض قائمة الاختصارات الافتراضية', 'يفتح لوحة الحروف على الشاشة لترى كل اختصار.',
       'Show the built-in shortcut list', 'Opens the letter sheet on screen so you can see every shortcut.'],
      ['اختصارات ثابتة', 'Alt+H يخفي الشريط ويُظهره، وAlt+Q يغلق كل النوافذ، و⌘K/Ctrl+K يبحث في كل الأدوات. لا تعمل وأنت تكتب داخل حقل.',
       'Fixed shortcuts', 'Alt+H hides and shows the rail, Alt+Q closes every window, ⌘K/Ctrl+K searches every tool. They do nothing while you type in a field.']
    ]),

    g('backup', '💾', ['النسخ الاحتياطي', RAIL_AR + ' ← 💾 النسخ'], ['Backup', RAIL_EN + ' → 💾 Backup'], [
      ['⬇ تصدير', 'ينزّل ملف syf-shortcuts-settings.json بكل إعداداتك — بلا المفاتيح وكلمات السر والخزنة والأقفال، ويخبرك كم عنصرًا حسّاسًا لم يُكتب.',
       '⬇ Export', 'Downloads syf-shortcuts-settings.json with all your settings — without keys, passwords, the vault or the locks, and tells you how many sensitive items were left out.'],
      ['⬆ استيراد', 'يقرأ ملفًّا مصدَّرًا ويتحقّق من كل قيمة قبل حفظها. أعد تحميل الصفحة بعده.',
       '⬆ Import', 'Reads an exported file and checks every value before saving it. Reload the page afterwards.'],
      ['↺ إعادة تعيين', '⚠️ يمسح كل الإعدادات والبيانات. يحتاج ضغطتين: الأولى تطلب التأكيد لأربع ثوانٍ.',
       '↺ Reset', '⚠️ Wipes every setting and all data. Needs two presses: the first asks for confirmation for four seconds.']
    ]),

    g('options', '⚙', ['صفحة الخيارات', 'chrome://extensions ← SYF ← الخيارات (أو زرّ 📖 في تبويب المفاتيح)'], ['Options page', 'chrome://extensions → SYF → Options (or the 📖 button in the Keys tab)'], [
      ['إظهار الشريط على الصفحات', 'يشغّل الشريط العائم على المواقع أو يطفئه كليًا — مثل Alt+H وأيقونة الإضافة في شريط المتصفّح.',
       'Show the toolbar on pages', 'Turns the floating rail on or off on websites — same as Alt+H and the extension\'s toolbar icon.'],
      ['الموضع الافتراضي / اللون الأساسي', 'نفس إعدادَي الموضع واللون في نافذة الإعدادات.',
       'Default position / accent colour', 'The same position and colour settings as the settings window.'],
      ['تصدير / استيراد / إعادة تعيين', 'نفس أزرار النسخ الاحتياطي وبنفس الحماية للبيانات الحسّاسة. التغيير يسري بعد إعادة تحميل الصفحات المفتوحة.',
       'Export / import / reset', 'The same backup buttons with the same protection for sensitive data. Changes apply after reloading open pages.']
    ]),

    g('aikeys', '🤖', ['مفاتيح المساعد الذكي', 'زرّ ⚙ داخل نافذة «المساعد الذكي» — تفتح في تبويب مستقل'], ['AI assistant keys', 'The ⚙ button inside the «AI assistant» window — opens in its own tab'], [
      ['المزوّد', 'بروف، أو Claude، أو ChatGPT، أو Gemini — من يجيب في المحادثة.',
       'Provider', 'PROF, Claude, ChatGPT or Gemini — who answers in the chat.'],
      ['الموديل', 'اسم النموذج لذلك المزوّد (لـClaude وChatGPT وGemini).',
       'Model', 'The model name for that provider (Claude, ChatGPT, Gemini).'],
      ['مفتاح API', 'مفتاحك أنت، يُحفظ على جهازك ولا يُرسَل إلا إلى المزوّد نفسه. «إظهار» يكشفه مؤقّتًا.',
       'API key', 'Your own key, stored on your machine and sent only to that provider. «Show» reveals it briefly.'],
      ['عنوان الـAPI ومعرّف المساعد', 'لمزوّد «بروف» فقط: عنوان الخادم ورمز المساعد.',
       'API URL and assistant token', 'For the PROF provider only: the server URL and the assistant token.'],
      ['حفظ / حذف المفتاح المحفوظ', '«حفظ» يكتب الحقول، و«حذف» يمسح المفتاح بعد ضغطة تأكيد.',
       'Save / delete the saved key', '«Save» writes the fields; «Delete» erases the key after a confirming press.']
    ]),

    g('dock', '🗔', ['إعدادات وضع العمل', 'زرّ الإعدادات في دوك وضع العمل (الشاشة المستقلّة)'], ['Workspace settings', 'The settings button on the workspace dock (the full-screen mode)'], [
      ['اتجاه الدوك', 'أفقي (الافتراضي) أو عمودي — خاص بوضع العمل.',
       'Dock direction', 'Horizontal (default) or vertical — workspace only.'],
      ['مظهر مشترك', 'تأثير التمرير، وحجم الأيقونات، وطريقة العرض، والشفافية، والإخفاء عند الحافة، والخط — نفس إعدادات الشريط العائم.',
       'Shared look', 'Hover effect, icon size, list style, opacity, tuck to the edge and font — the same settings as the floating rail.'],
      ['أدوات مساحة العمل', 'مربّع لكل أداة يخفيها من دوك وضع العمل وحده، وتبقى على الشريط العائم.',
       'Workspace tools', 'A checkbox per tool hides it from the workspace dock only; it stays on the floating rail.']
    ])
  ];

  /* v0.140.11 — a screenshot of every settings screen (guide-img/set-<id>.png) and, per
     item in order, where its numbered pin sits on that picture: [x%, y%] of the image,
     or null when the setting is not on that screen (the fold badge lives on the rail).
     A third member `1` marks the END of a label's text (its left edge in Arabic): the
     pin sits just before it instead of centred on it, so it never covers the words
     however small the picture is drawn. Measured from the real UI (the rail's settings
     window, help.html, aikeys.html, app.html) — a screen that changes layout needs a
     new picture AND new numbers. */
  var PINS = {
    tools:   [[95.9, 26.5], [84.3, 53.1], [88.4, 64.6], [93.4, 53.1], [15.5, 65.3], [8.8, 65.2]],
    langpos: [[43.4, 41.6, 1], [50.1, 67.4, 1]],
    colors:  [[60.2, 41.6, 1], [54.5, 54.7, 1]],
    fonts:   [[52.5, 27.5, 1], [65, 64.8], [13.9, 83, 1]],
    bar:     [[49.3, 28.6, 1], [56.1, 44.9, 1], [53, 54.4, 1], [42.2, 71.1, 1], [11.2, 92, 1], null],
    clock:   [[23.5, 34, 1], [58.8, 38.9, 1], [53.9, 54.7, 1], [52, 63.9, 1], [51.6, 73.1, 1], [10.4, 83.2, 1]],
    keys:    [[25.9, 28.1], [14.7, 69.1, 1], [95.9, 82.4], [53.8, 51.3, 1]],
    backup:  [[95.9, 74.7], [78.6, 74.7], [60.6, 74.7]],
    options: [[96.7, 15.7], [64.7, 15.7], [96.7, 66.2]],
    aikeys:  [[89.3, 26.2, 1], null, [71.6, 69.6, 1], [84.1, 40.2, 1], [14.9, 88.7]],
    dock:    [[83.6, 10.5, 1], [83.9, 18, 1], [73, 91.5, 1]]
  };
  window.SYF_GUIDE_SETTINGS.forEach(function (s) {
    if (!PINS[s.id]) return;
    s.img = 'guide-img/set-' + s.id + '.png';
    s.items.forEach(function (it, i) { it.pin = PINS[s.id][i] || null; });
  });
}());
