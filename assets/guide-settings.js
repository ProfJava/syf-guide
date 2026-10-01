/* guide-settings.js — what every setting does, for guide-slides.html
 * (v0.140.2). Same rule as guide-data.js: ONE list, each entry carries both languages,
 * so the Arabic and English guides cannot document different settings.
 *
 * Labels are quoted exactly as the UI shows them (src/rail.js, src/help.js,
 * src/ai-keys.js, src/app.js). A setting renamed in the UI must be renamed here.
 * v0.164.1 — follows the settings window as it is since v0.161–0.164: sections
 * عام · الأدوات (الاختصارات · روابط مخصّصة) · المظهر (الشريط · الاستايل · الخطوط · الوقت) ·
 * المفاتيح · من أنا.
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

  var RAIL_AR = 'زرّ ⚙ في آخر الشريط العائم ← «الإعدادات»';
  var RAIL_EN = 'The ⚙ button at the end of the floating rail → «Settings»';

  window.SYF_GUIDE_SETTINGS = [

    g('gen', '⚙', ['عام', RAIL_AR + ' ← عام (القسم الأول، يفتح افتراضيًا)'], ['General', RAIL_EN + ' → General (the first section, open by default)'], [
      ['اللغة — Language', 'العربية أو English. يقلب اتجاه الواجهة، ويغلق النوافذ المفتوحة، ويعيد بناء الشريط. أول تثبيت يخمّنها من لغة متصفّحك ويسألك مرّة.',
       'Language', 'Arabic or English. Flips the interface direction, closes open windows and rebuilds the rail. A fresh install guesses from your browser language and asks you once.'],
      ['قوائم منسدلة محسّنة (سلكت ٢) مع بحث داخل الخيارات', 'كل قائمة منسدلة في الأدوات وصفحات الإضافة تفتح قائمة أوضح، وفيها خانة بحث متى زادت خياراتها على سبعة (تفهم الهمزة والتشكيل). الأسهم وEnter وEsc تعمل. لا تمسّ قوائم المواقع التي تتصفّحها. مفعّلة افتراضيًا، ويسري الإطفاء فورًا.',
       'Enhanced dropdowns (Select2 style) with search inside the options', 'Every dropdown in the tools and extension pages opens a clearer list, with a search box once it has more than seven options. Arrows, Enter and Esc work. The dropdowns of the sites you browse are left alone. On by default; switching it off applies at once.'],
      ['⬇ تصدير', 'تحت «النسخ الاحتياطي»: ينزّل ملف syf-shortcuts-settings.json بكل إعداداتك — بلا المفاتيح وكلمات السر والخزنة والأقفال، ويخبرك كم عنصرًا حسّاسًا لم يُكتب.',
       '⬇ Export', 'Under «Backup»: downloads syf-shortcuts-settings.json with all your settings — without keys, passwords, the vault or the locks, and tells you how many sensitive items were left out.'],
      ['⬆ استيراد', 'يقرأ ملفًّا مصدَّرًا ويتحقّق من كل قيمة قبل حفظها (ومنها رمز اللون المخصّص). أعد تحميل الصفحة بعده.',
       '⬆ Import', 'Reads an exported file and checks every value before saving it (the custom colour code included). Reload the page afterwards.'],
      ['↺ إعادة تعيين', '⚠️ يمسح كل الإعدادات والبيانات. يحتاج ضغطتين: الأولى تطلب التأكيد لأربع ثوانٍ.',
       '↺ Reset', '⚠️ Wipes every setting and all data. Needs two presses: the first asks for confirmation for four seconds.']
    ]),

    g('tools', '🔧', ['الأدوات ← الاختصارات', RAIL_AR + ' ← الأدوات ← الاختصارات'], ['Tools → Shortcuts', RAIL_EN + ' → Tools → Shortcuts'], [
      ['مفتاح الفئة', 'يُظهر الفئة كلها على الشريط أو يخفيها، والعدد بجانبها = أدواتها الظاهرة من مجموعها. انقر اسم الفئة لفتح أدواتها. «مطوّرين» و«المساعد الذكي» مخفيّتان في التثبيت الجديد.',
       'Category switch', 'Shows or hides the whole category on the rail; the number beside it = its tools shown out of its total. Click the name to open its tools. «Developers» and «AI assistant» start hidden on a fresh install.'],
      ['مفتاح الأداة', 'يُظهر أداة واحدة أو يخفيها. عشرة روابط جاهزة (Gmail وYouTube…) مخفيّة في البداية.',
       'Tool switch', 'Shows or hides a single tool. Ten ready-made links (Gmail, YouTube…) start hidden.'],
      ['مقبض السحب (النقاط الست)', 'اسحب رأس الفئة لترتيب الفئات على الشريط، واسحب سطر الأداة لترتيبها داخل فئتها.',
       'Drag handle (six dots)', 'Drag a category header to reorder the categories on the rail; drag a tool row to reorder it inside its category.'],
      ['⌨ زرّ الاختصار', 'اضغطه ثم اضغط التوليفة التي تريدها لفتح الأداة. Esc يلغي، وBackspace يحذف الاختصار.',
       '⌨ Shortcut button', 'Press it, then press the combination that should open the tool. Esc cancels; Backspace removes the shortcut.'],
      ['★ النجمة', 'تضيف الأداة إلى رفّ المفضّلة في أعلى الشريط.',
       '★ Star', 'Adds the tool to the favourites shelf at the top of the rail.'],
      ['العدد تحت «الاختصارات»', 'كم أداة ظاهرة على الشريط من كل الأدوات (مثل 73/110). و«روابط مخصّصة» تحته يعرض عدد روابطك.',
       'The number under «Shortcuts»', 'How many tools are shown on the rail out of all of them (e.g. 73/110). «Custom links» below it shows how many links you added.']
    ]),

    g('links', '🔗', ['الأدوات ← روابط مخصّصة', RAIL_AR + ' ← الأدوات ← روابط مخصّصة'], ['Tools → Custom links', RAIL_EN + ' → Tools → Custom links'], [
      ['إضافة', 'اكتب اسمًا ورابطًا ثم «إضافة» — يظهر زرّ يفتح موقعك داخل فئة «روابط». الرابط يُفحص قبل حفظه.',
       'Add', 'Type a name and a URL, then «Add» — a button that opens your site appears in the «Links» category. The URL is checked before it is saved.'],
      ['✕ حذف', 'يحذف الرابط من القائمة ومن الشريط.',
       '✕ Delete', 'Removes the link from the list and from the rail.']
    ]),

    g('win', '🪟', ['رأس نافذة الأداة', 'أعلى كل نافذة أداة تفتحها — على الشريط العائم وفي وضع العمل'], ['The tool window\'s head', 'The top of every tool window you open — on the floating rail and in Workspace mode'], [
      ['✕ إغلاق', 'يغلق النافذة. سحب الرأس ينقلها، والمقبض في زاويتها السفلى يغيّر حجمها.',
       '✕ Close', 'Closes the window. Drag the head to move it; the grip in its bottom corner resizes it.'],
      ['★ المفضّلة', 'يضيف الأداة إلى رفّ المفضّلة أعلى الشريط أو يزيلها منه.',
       '★ Favourite', 'Adds the tool to the favourites shelf at the top of the rail, or removes it.'],
      ['? شرح الأداة', 'يفتح دليل الاستخدام في تبويب جديد على شريحة هذه الأداة نفسها.',
       '? Explain this tool', 'Opens the user guide in a new tab, on this very tool\'s slide.'],
      ['📷 تصوير الأداة ونسخ الصورة', 'يلتقط النافذة كما تراها وينسخها صورةً إلى الحافظة — الصقها مباشرة في محادثة أو مستند. لا يُنزَّل ملف، ولا يُصوَّر إلا التبويب الظاهر أمامك. ✓ على الزرّ يعني أنها نُسخت.',
       '📷 Snap this tool and copy the picture', 'Captures the window exactly as you see it and copies it to the clipboard as an image — paste it straight into a chat or a document. No file is downloaded, and only the tab in front of you is ever captured. A ✓ on the button means it was copied.'],
      ['▢ تكبير', 'يملأ الصفحة بالنافذة، وضغطة ثانية تعيد حجمها.',
       '▢ Maximise', 'Fills the page with the window; press again to restore its size.'],
      ['▭ تصغير', 'يطوي النافذة إلى شريط أسفل الشاشة؛ انقره لتعود. ترتيب هذه الأزرار وشكلها من «المظهر ← الاستايل ← شكل أزرار النافذة».',
       '▭ Minimise', 'Folds the window into a strip at the bottom of the screen; click it to bring it back. The order and look of these buttons come from «Appearance → Style → Window buttons».']
    ]),

    g('bar', '🧭', ['الشريط', RAIL_AR + ' ← المظهر ← الشريط'], ['Bar', RAIL_EN + ' → Appearance → Bar'], [
      ['موضع الشريط', 'يمين أو يسار أو أعلى أو أسفل الشاشة. الافتراضي: يمين.',
       'Rail position', 'Right, left, top or bottom of the screen. Default: right.'],
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

    g('colors', '🎨', ['الاستايل', RAIL_AR + ' ← المظهر ← الاستايل'], ['Style', RAIL_EN + ' → Appearance → Style'], [
      ['اللون', 'عشرون لوناً جاهزاً لهويّة الشريط ونوافذ الأدوات (تركوازي هو الافتراضي): أحمر، عنابي، فوشيا، نيلي، كحلي، أزرق مخضر، زيتي، ليموني، كهرماني، بني، مرجاني، فحمي وغيرها.',
       'Colour', 'Twenty ready accent colours for the rail and tool windows (teal is the default): red, maroon, fuchsia, indigo, navy, teal, olive, lime, amber, brown, coral, charcoal and more.'],
      ['لون مخصّص', 'اختر أي لون من المنتقي — تتلوّن الواجهة وأنت تسحب ويُحفظ عند الإفلات — أو اكتب رمزه في الحقل بجانبه مثل #e11d48 (بـ# أو بدونها). الرمز الخاطئ يُعلَّم بالأحمر ولا يُحفظ.',
       'Custom colour', 'Pick any colour from the picker — the interface recolours as you drag and saves when you let go — or type its code in the field beside it, e.g. #e11d48 (with or without #). A wrong code is marked red and not saved.'],
      ['نمط الأزرار', 'خمسة عشر نمطًا: صلب، زجاجي، ثلجي، زجاج سائل، محدّد، داكن، واضح، نيون، متدرّج، هادئ، ناعم بارز، مجسّم، دائري، بسيط، ذهبي — شكل رسم أزرار الشريط. «ثلجي» أو «واضح» أوضح على المواقع المزدحمة.',
       'Button style', 'Fifteen styles: solid, glass, frosted, liquid glass, outlined, dark, clear, neon, gradient, tonal, soft 3D, 3D key, round, minimal, gold — how the rail\'s buttons are drawn. «Frosted» or «clear» read better on busy sites.'],
      ['شكل أزرار النافذة', '«مع فاصل» (الافتراضي: أزرار النافذة ثم خطّ ثم أزرار الأداة)، أو «بدون فاصل»، أو «إشارات ماك» (دوائر حمراء وصفراء وخضراء).',
       'Window buttons', '«With divider» (default: the window buttons, a hairline, then the tool buttons), «No divider», or «Mac lights» (red, yellow and green dots).'],
      ['شكل القائمة الجانبية', 'شكل قائمة نافذة الإعدادات نفسها: «أيقونات + عمود» (الافتراضي)، أو «قائمة بعناوين»، أو «لوحة ملوّنة». يتغيّر فورًا.',
       'Side menu look', 'The look of this settings window\'s own menu: «Icons + column» (default), «Headed list», or «Coloured panel». Changes at once.'],
      ['الشكل الزجاجي للأزرار مع الأيقونات', 'أزرار ومفاتيح زجاجية بأيقونة مرسومة لكل زرّ في الأدوات وصفحات الإضافة. مفعّل افتراضيًا؛ إطفاؤه يعيد كل زرّ إلى شكله الأصلي.',
       'Glass look for buttons, with icons', 'Glass buttons and switches, with a drawn icon on every button in the tools and extension pages. On by default; switching it off returns each button to its own look.']
    ]),

    g('fonts', '🔤', ['الخطوط', RAIL_AR + ' ← المظهر ← الخطوط'], ['Fonts', RAIL_EN + ' → Appearance → Fonts'], [
      ['خط الواجهة', 'خط النظام (الافتراضي) أو واحد من 12 خطًا عربيًا مدمجًا (تجوّل، القاهرة، المراعي…). يسري على الشريط والنوافذ وصفحات الإضافة، ويعمل بلا إنترنت.',
       'Interface font', 'The system font (default) or one of 12 bundled Arabic fonts (Tajawal, Cairo, Almarai…). Applies to the rail, the windows and the extension pages, and works offline.'],
      ['خط مثبّت على جهازك', 'اكتب اسم أي خط موجود على جهازك ثم «تطبيق».',
       'A font installed on this device', 'Type the name of any font on your machine, then «Apply».'],
      ['طبّق الخط أيضاً على المواقع التي أتصفّحها', 'يفرض الخط المختار على نصوص المواقع أيضًا، ويترك أيقونات المواقع والكود كما هي. مطفأ افتراضيًا.',
       'Use this font on the sites I browse too', 'Forces the chosen font on website text too, leaving icon fonts and code alone. Off by default.']
    ]),

    g('clock', '🕒', ['الوقت', RAIL_AR + ' ← المظهر ← الوقت'], ['Time', RAIL_EN + ' → Appearance → Time'], [
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
      ['نقرة على الساعة', 'تبدّل بين 12 و24 ساعة، والمرور فوقها يفتح بطاقة اليوم: الميلادي والهجري والصلاة القادمة والمناسبات والتذكيرات.',
       'Click the clock', 'Toggles 12/24-hour; hovering opens today\'s card: Gregorian and Hijri dates, the next prayer, occasions and reminders.']
    ]),

    g('keys', '⌨', ['المفاتيح', RAIL_AR + ' ← المفاتيح'], ['Keys', RAIL_EN + ' → Keys'], [
      ['سجّل توليفة', 'اختر أداة من القائمة، اضغط «⌨ سجّل توليفة»، ثم اضغط التوليفة (يجب أن تحوي Alt أو Ctrl أو ⌘). توليفة مستخدمة تنتقل للأداة الجديدة.',
       'Record a combo', 'Pick a tool, press «⌨ Record a combo», then press the combination (it must include Alt, Ctrl or ⌘). A combination already in use moves to the new tool.'],
      ['الاختصارات الافتراضية لكل الأدوات', 'Alt+K ثم حرف الفئة ثم حرف الأداة — لكل أداة اختصار بلا إعداد. يتحكّم أيضًا في ⌘K/Ctrl+K للبحث. إطفاؤه يعيد المفتاحين للموقع.',
       'Built-in shortcuts for every tool', 'Alt+K, then the category letter, then the tool letter — every tool has a shortcut with no setup. Also controls ⌘K/Ctrl+K for search. Turning it off gives both keys back to the site.'],
      ['اعرض قائمة الاختصارات الافتراضية', 'يفتح لوحة الحروف على الشاشة لترى كل اختصار.',
       'Show the built-in shortcut list', 'Opens the letter sheet on screen so you can see every shortcut.'],
      ['اختصارات ثابتة', 'Alt+H يخفي الشريط ويُظهره، وAlt+Q يغلق كل النوافذ، و⌘K/Ctrl+K يبحث في كل الأدوات. لا تعمل وأنت تكتب داخل حقل.',
       'Fixed shortcuts', 'Alt+H hides and shows the rail, Alt+Q closes every window, ⌘K/Ctrl+K searches every tool. They do nothing while you type in a field.']
    ]),

    g('options', '⚙', ['صفحة الخيارات', 'chrome://extensions ← SYF ← الخيارات (أو زرّ 📖 في قسم المفاتيح)'], ['Options page', 'chrome://extensions → SYF → Options (or the 📖 button in the Keys section)'], [
      ['إظهار الشريط على الصفحات', 'يشغّل الشريط العائم على المواقع أو يطفئه كليًا — مثل Alt+H وأيقونة الإضافة في شريط المتصفّح.',
       'Show the toolbar on pages', 'Turns the floating rail on or off on websites — same as Alt+H and the extension\'s toolbar icon.'],
      ['الموضع الافتراضي / اللون الأساسي', 'نفس إعدادَي الموضع واللون في نافذة الإعدادات (واللون المخصّص يظهر باسم «لون مخصّص» ورمزه).',
       'Default position / accent colour', 'The same position and colour settings as the settings window (a custom colour shows as «Custom colour» with its code).'],
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
     new picture AND new numbers. v0.164.1: every rail screen re-shot and re-measured. */
  var PINS = {
    gen:     [[68.2, 17.3, 1], [4.4, 34.8, 1], [80.6, 58.9], [68, 58.9], [52.6, 58.9]],
    tools:   [[51, 26.2], [55, 32.5], [60, 32.5], [10.5, 32.5], [6, 32.5], [75.1, 17.7]],
    links:   [[32.7, 26.9], [5.1, 34.1]],
    win:     [[5.7, 5.5], [39.5, 5.5], [27.3, 5.5], [33.4, 5.5], [11.8, 5.5], [18, 5.5]],
    bar:     [[49.9, 17, 1], [49.2, 30.4, 1], [54, 45.1, 1], [51.9, 56.1, 1], [44.3, 74, 1], [4.4, 93.4, 1], null],
    colors:  [[56.9, 16.5, 1], [52.6, 32.2], [53, 39.8, 1], [47.7, 69.9, 1], [44.6, 81.6, 1], [4.4, 93.6, 1]],
    fonts:   [[51.5, 17.3, 1], [38.8, 56.7], [4.4, 71.9, 1]],
    clock:   [[4.4, 17.6, 1], [56, 34.2, 1], [52.5, 52.3, 1], [51.2, 65, 1], [50.8, 77.7, 1], [6.8, 24.3, 1]],
    keys:    [[10.2, 25.7], [28.4, 60.1, 1], [44.2, 74.6], [66.6, 15.1, 1]],
    options: [[93.7, 20.8], [59.5, 28.2], [82, 72.1]],
    aikeys:  [[89.3, 26.2, 1], null, [71.6, 69.6, 1], [84.1, 40.2, 1], [14.9, 88.7]],
    dock:    [[83.6, 10.5, 1], [83.9, 18, 1], [73, 91.5, 1]]
  };
  window.SYF_GUIDE_SETTINGS.forEach(function (s) {
    if (!PINS[s.id]) return;
    s.img = 'guide-img/set-' + s.id + '.png';
    s.items.forEach(function (it, i) { it.pin = PINS[s.id][i] || null; });
  });
}());
