/* guide-data.js — the illustrated guide's content, v0.140.2.
 *
 * ONE file for both languages, read by guide.html (ar) and guide-en.html (en).
 * The two help pages are separate prose and may drift by design; a catalogue must
 * not — a tool documented in Arabic and missing in English is a bug you only find
 * by counting, so there is one list and each entry carries both languages.
 *
 * `img` is a screenshot in guide-img/<id>.png taken from the SHIPPED tool over the
 * shipped stylesheet (tools/mount-harness.html?one=<id>), at the width the tool
 * actually opens at. A tool with no panel — a launcher or a link — has no img, and
 * that is the honest picture of it: there is nothing to show but the click.
 *
 * ⚠️ Not translated through src/i18n.js: this page is not built from Arabic msgids,
 * it IS the text, twice. Adding a tool means adding one entry with both languages.
 */
(function () {
  'use strict';

  /* category order and labels follow the rail (src/rail.js → cats) */
  window.SYF_GUIDE_CATS = [
    { id: 'calc',   ar: 'حاسبات',        en: 'Calculators' },
    { id: 'note',   ar: 'ملاحظات ونصوص', en: 'Notes & text' },
    { id: 'util',   ar: 'أدوات',          en: 'Utilities' },
    { id: 'time',   ar: 'الوقت',          en: 'Time' },
    { id: 'islam',  ar: 'إسلامية',        en: 'Islamic' },
    { id: 'links',  ar: 'روابط',          en: 'Links' },
    { id: 'docs',   ar: 'المستندات',      en: 'Documents' },
    { id: 'media',  ar: 'الصور والفيديو', en: 'Images & video' },
    { id: 'dev',    ar: 'مطوّرين',         en: 'Developers' },
    { id: 'shield', ar: 'الحماية',        en: 'Privacy & protection' },
    { id: 'perf',   ar: 'الأداء',          en: 'Performance' },
    { id: 'ai',     ar: 'المساعد الذكي',  en: 'AI assistant' }
  ];

  /* t: [id, cat, hasImage, arName, arWhat, [arSteps], enName, enWhat, [enSteps]] */
  function t(id, cat, img, an, aw, as, en, ew, es) {
    return { id: id, cat: cat, img: img, ar: { n: an, w: aw, s: as }, en: { n: en, w: ew, s: es } };
  }

  window.SYF_GUIDE = [

    /* ===== حاسبات ===== */
    t('calc', 'calc', 1,
      'حاسبة', 'حاسبة بالأقواس وبالنسبة المئوية، تعمل بلوحة المفاتيح مثل ما تعمل بالضغط.',
      ['اكتب العملية أو اضغط الأزرار — الأقواس والإشارة السالبة مدعومة (2×−3 = −6).', 'من لوحة المفاتيح: الأرقام (ومعها ٠-٩) والعمليات، Enter أو = للنتيجة، Backspace يحذف آخر حرف، Esc يمسح، Ctrl/⌘+C ينسخ الناتج.', '«C» يمسح، و«⌫» يحذف آخر حرف، و«%» يحوّل العدد الذي قبله إلى نسبة.', 'السجلّ تحت الحاسبة يحفظ آخر 20 عملية — انقر سطرًا لتعيد استخدام نتيجته.'],
      'Calculator', 'Brackets and percentages, driven by the keyboard as well as by the buttons.',
      ['Type the expression or press the keys — brackets and negative signs are supported (2×−3 = −6).', 'From the keyboard: digits (Arabic-Indic ٠-٩ too) and operators, Enter or = for the result, Backspace deletes the last character, Esc clears, Ctrl/⌘+C copies the result.', '«C» clears, «⌫» deletes the last character, «%» turns the preceding number into a percentage.', 'The history under the calculator keeps the last 20 operations — click a row to reuse its result.']),

    t('units', 'calc', 1,
      'محوّل الوحدات', 'أحد عشر بابًا للتحويل — طول ووزن وحرارة ومساحة وحجم وسرعة وزمن وبيانات وضغط وطاقة وزاوية.',
      ['اختر الباب من الشريط الجانبي، واكتب القيمة.', 'زرّ ↑↓ يعكس الوحدتين، والقائمة تحتها تعرض القيمة في كل الوحدات دفعةً واحدة.'],
      'Unit converter', 'Eleven families — length, weight, temperature, area, volume, speed, time, data, pressure, energy, angle.',
      ['Pick the family in the side rail, then type the value.', 'The ↑↓ button swaps the two units; the list below shows the value in every unit at once.']),

    t('currency', 'calc', 1,
      'العملات', 'تحويل عملات بأسعار تُجلب من الشبكة وتُخزَّن ليوم، فتبقى تعمل بلا اتصال بعد أول جلب.',
      ['اكتب المبلغ واختر عملتك الأساسية.', '«العملات المعروضة» يختار أي العملات تظهر في القائمة.', 'بلا اتصال تظهر «لا يوجد سعر لهذه العملة» بدل رقم قديم يوهمك.'],
      'Currency', 'Conversion using rates fetched from the network and cached for a day, so it keeps working offline after the first fetch.',
      ['Type the amount and pick your base currency.', '«Shown currencies» chooses which ones appear in the list.', 'Offline it says «no rate for this currency» rather than showing a stale number as if it were current.']),

    t('finance', 'calc', 1,
      'حاسبة مالية', 'ثماني حاسبات في واحدة: النسبة، الخصم، هامش الربح، العمولة، الأوفر تايم، عائد الاستثمار، العائد المركّب، الراتب.',
      ['اختر الحاسبة من الشريط الجانبي.', 'الناتج يظهر فور الكتابة — لا يوجد زرّ «احسب».'],
      'Financial calculator', 'Eight calculators in one: percentage, discount, profit margin, commission, overtime, ROI, compound return, salary.',
      ['Pick the calculator in the side rail.', 'The answer appears as you type — there is no «calculate» button.']),

    t('tax', 'calc', 1,
      'حاسبة الضرائب', 'ضريبة القيمة المضافة، غرامة التأخير، ضريبة الشركات، ومكافأة نهاية الخدمة — بنسب السعودية والإمارات ومصر.',
      ['اختر النوع من الشريط الجانبي ثم الدولة.', '«إضافة الضريبة» تحسبها فوق المبلغ، و«استخراجها» تفترض أن المبلغ شاملها.'],
      'Tax calculator', 'VAT, late-payment penalty, corporate tax and end-of-service gratuity — with Saudi, UAE and Egyptian rates.',
      ['Pick the kind in the side rail, then the country.', '«Add tax» computes it on top of the amount; «extract» assumes the amount already includes it.']),

    /* ===== ملاحظات ونصوص ===== */
    t('notes', 'note', 1,
      'ملاحظات', 'ملاحظات قصيرة تُحفظ على جهازك، وتُلصق على الشاشة إن أردت.',
      ['اكتب عنوانًا ومتنًا ثم «حفظ».', '«📌 لصق على الشاشة» يترك الملاحظة عائمة فوق الصفحة.'],
      'Notes', 'Short notes stored on your machine, and pinned over the page if you want.',
      ['Type a title and a body, then «Save».', '«📌 Pin to screen» leaves the note floating over the page.']),

    t('counter', 'note', 1,
      'عدّاد الكلمات', 'كلمات وأحرف وأسطر وجُمل ودقائق قراءة — يُحسب وأنت تكتب.',
      ['الصق النصّ في الصندوق.', 'الأرقام تتغيّر مع كل حرف؛ لا يغادر النصّ التبويب.'],
      'Word counter', 'Words, characters, lines, sentences and reading minutes — counted as you type.',
      ['Paste the text into the box.', 'The numbers change with every character; the text never leaves the tab.']),

    t('clipboard', 'note', 1,
      'تاريخ الحافظة', 'سجلّ لما نسخته — بالضغط، لا تلقائيًّا.',
      ['انسخ نصًّا ثم اضغط «التقط ما في الحافظة الآن».', '⚠️ لا يلتقط شيئًا من تلقاء نفسه: ما لا تضغط له لا يُحفظ.'],
      'Clipboard history', 'A log of what you copied — on a press, never automatically.',
      ['Copy something, then press «Capture the clipboard now».', '⚠️ It captures nothing on its own: what you do not press for is not stored.']),

    t('checklist', 'note', 1,
      'قائمة المهام', 'نقاط تُشطَب، تبقى بعد إغلاق التبويب.',
      ['اكتب النقطة واضغط +.', '«مسح المنجز» يحذف المشطوب وحده، و«مسح الكل» يفرّغ القائمة.'],
      'Task list', 'Tickable items that survive closing the tab.',
      ['Type the item and press +.', '«Clear done» removes only the ticked ones; «Clear all» empties the list.']),

    t('translate', 'note', 1,
      'الترجمة', 'ترجمة بين ست لغات، عبر مزوّدك الذكي إن أعددته وإلا عبر خدمة مجانية.',
      ['اختر اللغتين، اكتب النصّ، اضغط «ترجمة».', '«⇄» يبدّل اللغتين وينقل الترجمة إلى خانة النصّ لتترجمها عكسيًّا.', 'عدّاد الأحرف يعرض حدّ الخدمة المجانية (9,600 حرف)، ويتعطّل «ترجمة» إن تجاوزته. مع مزوّدك الذكي لا حدّ.', '⚠️ النصّ يغادر جهازك — تظهر لك رسالة تسمّي الجهة وتنتظر موافقتك قبل أول إرسال.'],
      'Translate', 'Between six languages, through your own AI provider if you configured one, otherwise a free service.',
      ['Pick the two languages, type the text, press «Translate».', '«⇄» swaps the two languages and moves the translation into the input so you can translate it back.', 'A character counter shows the free service\'s limit (9,600 characters) and disables «Translate» above it. With your own AI provider there is no limit.', '⚠️ The text leaves your machine — a prompt names the destination and waits for your consent before the first send.']),

    t('voice', 'note', 1,
      'صوت ونص', 'نُطق النصّ، وإملاء الكلام نصًّا — ميكروفون واحد في وسط اللوحة.',
      ['اكتب واضغط «نطق»، أو اضغط الميكروفون وتكلّم.', 'الكلمات تظهر وأنت تتكلّم، وكتابتك بيدك تفوز على ما يخمّنه المحرّك.', '⚙ يفتح اختيار الصوت والسرعة والنبرة. الإملاء يطلب إذن الميكروفون.'],
      'Voice & text', 'Speak text aloud, and dictate speech into text — one microphone in the middle of the panel.',
      ['Type and press «Speak», or press the microphone and talk.', 'Words appear while you speak, and anything you type by hand wins over the engine\'s guess.', '⚙ opens the voice, rate and pitch. Dictation asks for microphone permission.']),

    t('textdiff', 'note', 1,
      'فرق نصّين', 'يقارن نصّين ويلوّن المحذوف والمضاف — محليًّا بالكامل.',
      ['الصق النصّ الأصلي والمعدّل ثم «قارِن».', 'الأحمر محذوف والأخضر مضاف، والكلمات المتغيّرة داخل السطر مظلَّلة.'],
      'Text diff', 'Compares two texts and colours what was removed and added — entirely on your machine.',
      ['Paste the original and the edited text, then «Compare».', 'Red is removed, green is added, and changed words inside a line are highlighted.']),

    t('readsave', 'note', 1,
      'احفظ المقال', 'يستخلص متن المقال من الصفحة ويحفظه لتقرأه لاحقًا بلا إنترنت.',
      ['افتح صفحة مقال واضغط «استخلاص المقال من هذه الصفحة».', 'محلّي بالكامل: لا تلخيص ولا إرسال لأي جهة.'],
      'Save the article', 'Extracts the article body from the page and stores it to read later, offline.',
      ['Open an article page and press «Extract the article from this page».', 'Entirely local: no summarising, nothing sent anywhere.']),

    t('phones', 'note', 0,
      'منسّق أرقام الجوال', 'يرتّب قائمة أرقام جوال ويصحّح صيغتها الدولية.',
      ['يفتح في شاشته المستقلّة — الصق الأرقام واختر الدولة.'],
      'Phone number formatter', 'Tidies a list of mobile numbers and fixes their international form.',
      ['Opens in its own page — paste the numbers and pick the country.']),

    /* ===== أدوات ===== */
    t('password', 'util', 1,
      'مولّد كلمات المرور', 'كلمة مرور عشوائية بقوّة معروضة بالبِتّات، لا بلون.',
      ['حرّك شريط الطول واختر أنواع الأحرف ثم «توليد».', 'الشريط تحت الزرّ يعرض الإنتروبيا الفعلية بالبتّات.', '«افتح الحافظة» يحفظها مشفّرة بكلمة مرور رئيسية.'],
      'Password generator', 'A random password whose strength is shown in bits, not as a colour.',
      ['Move the length slider, choose the character sets, press «Generate».', 'The bar under the button shows the real entropy in bits.', '«Open the vault» stores it encrypted behind a master password.']),

    t('vault', 'util', 1,
      'حافظة الباسوردات', 'حافظة محلّية مشفّرة (AES-GCM) بكلمة مرور رئيسية.',
      ['تفتح في صفحة مستقلّة معزولة عن المواقع.', 'كلمة المرور الرئيسية الجديدة 10 أحرف على الأقل.', '⛔ لا ملء تلقائي ولا مزامنة — انسخ كلمة السرّ والصقها بنفسك.'],
      'Password vault', 'A local vault encrypted (AES-GCM) behind a master password.',
      ['Opens in a separate page, isolated from websites.', 'A new master password needs at least 10 characters.', '⛔ No autofill and no sync — you copy the password and paste it yourself.']),

    t('qrgen', 'util', 1,
      'مولّد QR', 'رمز QR لنصّ أو رابط أو هاتف أو واي-فاي أو رسالة أو موقع أو بطاقة.',
      ['اختر النوع من الشبكة أعلى اللوحة واملأ الحقل.', 'الرمز يُرسم فورًا، وتحته إصداره وحجمه بالبايت.'],
      'QR generator', 'A QR code for text, a link, a phone, Wi-Fi, a message, a location or a contact card.',
      ['Pick the kind from the grid at the top and fill the field.', 'The code is drawn immediately, with its version and byte size underneath.']),

    t('qrread', 'util', 1,
      'قارئ QR وباركود', 'يقرأ رمزًا من صورة أو من الكاميرا أو من لقطة تلصقها.',
      ['اختر صورة، أو الصق لقطة بـ Ctrl+V، أو شغّل الكاميرا.', '⚠️ النتيجة نصّ يُعرض ولا يُفتح تلقائيًّا — رمز على ملصق مدخل لا يُؤتمن.'],
      'QR & barcode reader', 'Reads a code from an image, from the camera, or from a screenshot you paste.',
      ['Pick an image, paste a screenshot with Ctrl+V, or start the camera.', '⚠️ The result is shown as text and never opened automatically — a code on a sticker in a lobby is not trusted.']),

    t('speed', 'util', 1,
      'قياس الاتصال', 'قياس تقديري لزمن الاستجابة وسرعتي التنزيل والرفع عبر Cloudflare.',
      ['اضغط «اختبار» وانتظر ثوانٍ.', 'قياس واحد قصير — لا يُغني عن اختبار سرعة كامل.'],
      'Connection test', 'An estimate of latency, download and upload speed via Cloudflare.',
      ['Press «Test» and wait a few seconds.', 'One short sample — not a substitute for a full speed test.']),

    t('display', 'util', 1,
      'العرض والقراءة', 'وضع ليلي للموقع، ووضع قراءة يعرض متن المقال وحده، وتحكّم في الحجم وملء الشاشة.',
      ['«تفعيل الوضع الليلي» يُحفظ لهذا الموقع ويسري تلقائيًّا عند فتحه.', '«وضع القراءة» للصفحة الحالية فقط ولا يُحفظ.'],
      'Display & reading', 'A night mode per site, a reading mode showing only the article, plus zoom and full screen.',
      ['«Enable night mode» is remembered for this site and applies automatically next time.', '«Reading mode» is for the current page only and is not stored.']),

    t('formfill', 'util', 1,
      'الملء التلقائي للفورمات', 'يملأ حقول النماذج من بروفايل محفوظ محليًّا، أو ببيانات عشوائية للاختبار.',
      ['املأ البروفايل مرّة واحدة ثم اضغط «املأ» في أي صفحة.', '⛔ لا يملأ حقول كلمات المرور أبدًا، ويملأ الحقول الفارغة فقط.'],
      'Form autofill', 'Fills form fields from a locally stored profile, or with random data for testing.',
      ['Fill the profile once, then press «Fill» on any page.', '⛔ It never fills password fields, and only fills empty ones.']),

    t('watch', 'util', 1,
      'مراقب تغيّر الصفحة', 'يفحص الصفحة كل فترة ويخبرك إن تغيّرت.',
      ['اختر «الصفحة كاملة» أو عنصرًا تحدّده، واضبط المدّة، ثم «ابدأ المراقبة».', '⚠️ يعمل ما دام التبويب مفتوحًا؛ تُقارَن بصمة رقمية ولا يُحفظ نصّ الصفحة.'],
      'Page change watcher', 'Re-checks the page every so often and tells you when it changed.',
      ['Choose «whole page» or pick an element, set the interval, press «Start watching».', '⚠️ Runs only while the tab is open; it compares a digest and never stores the page text.']),

    t('sessions', 'util', 1,
      'جلسات التبويبات', 'يحفظ التبويبات المفتوحة باسم، ويعيد فتحها لاحقًا.',
      ['سمِّ الجلسة واضغط «احفظ التبويبات المفتوحة».', 'بضغطة منك فقط — لا حفظ تلقائي، والعناوين تبقى على هذا الجهاز.'],
      'Tab sessions', 'Saves the open tabs under a name and reopens them later.',
      ['Name the session and press «Save the open tabs».', 'Only on your press — nothing is saved automatically, and the URLs stay on this machine.']),

    t('ytplus', 'util', 1,
      'يوتيوب+', 'سرعة وجودة افتراضيتان، إخفاء عناصر الصفحة، وأدوات تحديد مقطع A→B داخل المشغّل.',
      ['اضبط السرعة والجودة هنا؛ تسري تلقائيًّا عند فتح أي فيديو.', 'أدوات اللحظة (A→B وصورة داخل صورة) تظهر داخل صفحة يوتيوب نفسها.'],
      'YouTube+', 'A default speed and quality, page elements you can hide, and A→B clip tools inside the player.',
      ['Set the speed and quality here; they apply automatically on any video.', 'The in-player tools (A→B and picture-in-picture) appear on the YouTube page itself.']),

    t('appmode', 'util', 0,
      'وضع العمل', 'كل الأدوات في شاشة مستقلّة بدل نافذة عائمة فوق موقع.',
      ['من زرّ المربّعات الأربعة أعلى الشريط.', 'مساحة أوسع، ونوافذ متعدّدة جنبًا إلى جنب.'],
      'Workspace mode', 'Every tool in its own full screen instead of floating over a website.',
      ['From the four-squares button at the top of the rail.', 'More room, and several windows side by side.']),

    t('railtoggle', 'util', 0,
      'إخفاء/إظهار الشريط', 'يخفي الشريط العائم عن الصفحة ويعيده.',
      ['الاختصار Alt+H.'],
      'Hide/show the rail', 'Hides the floating rail from the page and brings it back.',
      ['Shortcut: Alt+H.']),

    t('closeall', 'util', 0,
      'إغلاق كل الأدوات', 'يغلق كل نوافذ الأدوات المفتوحة دفعة واحدة.',
      ['الاختصار Alt+Q.'],
      'Close every tool', 'Closes all open tool windows at once.',
      ['Shortcut: Alt+Q.']),

    /* ===== الوقت ===== */
    t('timer', 'time', 1,
      'مؤقّت وإيقاف', 'مؤقّت تنازلي بتنبيه صوتي، وساعة إيقاف، وبومودورو.',
      ['اكتب الدقائق والثواني أو اضغط أحد الأزرار الجاهزة — الرقم الكبير يتغيّر فورًا، ثم «بدء».', '«إيقاف مؤقت» يوقف ويستأنف؛ «تصفير» يبدأ من الصفر.', 'يُحسب بساعة الجهاز، فيرنّ في موعده ولو كان التبويب في الخلفية.'],
      'Timer & stopwatch', 'A countdown with an audible alarm, a stopwatch, and a pomodoro.',
      ['Type the minutes and seconds or press a preset — the big number changes at once — then «Start».', '«Pause» stops and resumes; «Reset» returns to zero.', 'It runs on the device clock, so it rings on time even while the tab is in the background.']),

    t('alerts', 'time', 1,
      'تنبيهات ومواعيد', 'تنبيه في وقت محدّد، وتذكيرات متكرّرة.',
      ['اكتب عنوان التنبيه واختر الوقت ثم «إضافة».', '⚠️ يعمل ما دامت النافذة مفتوحة — للمواعيد بتاريخ استخدم «التقويم والمهام»، فتنبيهه يصلك والصفحة مغلقة.'],
      'Alerts & appointments', 'An alert at a set time, and repeating reminders.',
      ['Type the alert title, pick the time, press «Add».', '⚠️ Works while this window is open — for dated appointments use «Calendar & tasks», whose alert reaches you with the page closed.']),

    t('worldclock', 'time', 1,
      'الساعة العالمية', 'ساعات مدن تختارها من نحو 400 منطقة زمنية، تمشي في الوقت الحقيقي.',
      ['ابحث عن المدينة أو المنطقة الزمنية بالاسم واضغط «إضافة» — حتى 20 ساعة.', 'كل سطر يعرض فرق توقيته عن جهازك (مثل +3 س).', '✕ يحذف المدينة؛ مدينة موجودة لا تُضاف مرّتين.'],
      'World clock', 'Clocks for places you choose from about 400 time zones, ticking live.',
      ['Search the city or time zone by name and press «Add» — up to 20 clocks.', 'Each row shows its offset from this device (e.g. +3 h).', '✕ removes a city; a city already on the list is not added twice.']),

    t('calendar', 'time', 1,
      'التقويم والمهام', 'تقويم شهري بمهام مرتبطة بأيام، وتنبيهات تصلك والصفحة مغلقة.',
      ['انقر يومًا لإضافة مهمّة أو موعد.', 'التنبيه يمرّ عبر عامل الإضافة، فلا يشترط بقاء تبويب مفتوحًا.'],
      'Calendar & tasks', 'A month view with tasks attached to days, and alerts that reach you with the page closed.',
      ['Click a day to add a task or an appointment.', 'The alert goes through the extension worker, so no tab needs to stay open.']),

    t('datediff', 'time', 1,
      'الفرق بين تاريخين', 'أيام وأسابيع وأشهر بين تاريخين، وأيام العمل وحدها، وإضافة/طرح مدّة.',
      ['اختر «من» و«إلى» — الناتج يظهر فورًا.', 'حدّد عطلة الأسبوع، وفعّل استثناء العطل الرسمية لتحصل على أيام العمل.'],
      'Date difference', 'Days, weeks and months between two dates, working days alone, and adding/subtracting a span.',
      ['Pick «from» and «to» — the answer appears at once.', 'Set the weekend and tick the public-holiday exclusion to get working days.']),

    t('timelog', 'time', 1,
      'سجلّ وقت المهام', 'مؤقّت يبدأ عند الضغط ويجمع وقت كل مهمّة في تقرير يومي وأسبوعي.',
      ['اكتب اسم المهمّة واضغط «ابدأ».', 'وقت البدء مخزَّن لا عدّاد — أغلق التبويب وعُد، الوقت مستمرّ.'],
      'Task time log', 'A timer you start on a press, totalling each task into a daily and weekly report.',
      ['Type the task name and press «Start».', 'It stores the start time rather than counting — close the tab and come back, the clock kept running.']),

    /* ===== إسلامية ===== */
    t('prayer', 'islam', 1,
      'مواقيت الصلاة', 'مواقيت اليوم لمدينتك، مع تنبيه قبل الأذان بالدقائق التي تختارها.',
      ['اختر المدينة من القائمة.', 'فعّل «تنبيه قبل الصلاة»، اضبط الدقائق، اختر الصلوات، ثم «حفظ».'],
      'Prayer times', 'Today\'s times for your city, with an alert the number of minutes you choose before the adhan.',
      ['Pick your city from the list.', 'Tick «alert before prayer», set the minutes, choose which prayers, then «Save».']),

    t('hijri', 'islam', 1,
      'هجري ⇄ ميلادي', 'تحويل في الاتّجاهين، وحاسبة تواريخ تحتها.',
      ['اكتب تاريخًا ميلاديًّا فيظهر الهجري تحته مباشرةً، والعكس في القسم الثاني.'],
      'Hijri ⇄ Gregorian', 'Conversion both ways, with a date calculator underneath.',
      ['Type a Gregorian date and the Hijri one appears right below it; the second section goes the other way.']),

    t('athkar', 'islam', 1,
      'الأذكار', 'أذكار الصباح والمساء بعدّاد لكل ذكر، وأذكارك أنت، وآية اليوم.',
      ['انقر الذكر ليُعدّ تكراره — يكتمل عند بلوغ العدد.', '«أذكاري» لإضافة ذِكر من عندك.'],
      'Athkar', 'Morning and evening athkar with a counter for each, your own additions, and a verse of the day.',
      ['Tap a dhikr to count a repetition — it completes when the count is reached.', '«My athkar» adds one of your own.']),

    t('wird', 'islam', 1,
      'الورد اليومي', 'صفحات المصحف بوِرد يومي وسلسلة أيّام وعدّاد ختمات، مع تلاوة الصفحة.',
      ['اضبط «صفحات/يوم» ثم اقرأ واضغط «قرأت».', '⚠️ تحتاج اتصالًا أوّل مرّة لكل صفحة، ثم تُحفظ للقراءة بلا اتصال.'],
      'Daily wird', 'Mushaf pages as a daily portion, with a day streak, a khatmah counter and page recitation.',
      ['Set «pages/day», read, then press «Read».', '⚠️ Needs a connection the first time for each page; afterwards it is stored for offline reading.']),

    t('quran', 'islam', 1,
      'مشغّل القرآن', 'تلاوة بصوت القارئ الذي تختاره، بقائمة سور ومفضّلة ومؤقّت نوم.',
      ['اختر القارئ ثم السورة.', 'الساعة تضبط مؤقّت إيقاف، والسهم المزدوج يكرّر.', 'قائمة القرّاء تُجلب من mp3quran.net؛ مشاري العفاسي مُخفى منها بطلبك.'],
      'Quran player', 'Recitation by the reciter you choose, with a surah list, favourites and a sleep timer.',
      ['Pick the reciter, then the surah.', 'The clock sets a stop timer; the loop arrows repeat.', 'The reciter list comes from mp3quran.net; Mishary Alafasy is hidden from it at your request.']),

    t('qradio', 'islam', 1,
      'إذاعة القرآن', 'إذاعات قرآنية مباشرة من عدّة بلدان.',
      ['اختر إذاعة من القائمة واضغط تشغيل.', 'النجمة تضيفها للمفضّلة.'],
      'Quran radio', 'Live Quran radio stations from several countries.',
      ['Pick a station from the list and press play.', 'The star adds it to your favourites.']),

    t('ithkar', 'islam', 1,
      'تنبيهات الأذكار والصلاة', 'أذكار دورية على الشاشة، وتنبيه قبل الأذان، وأهداف أذكار الصباح والمساء.',
      ['فعّل «أذكار دورية» واختر المدّة وشكل التنبيه (توست أو إشعار نظام).', 'أهداف الأذكار: يظهر التنبيه بالذكر الأول ويبقى حتى تضغط «✓ قرأته».'],
      'Athkar & prayer alerts', 'Periodic athkar on screen, an alert before the adhan, and morning/evening athkar goals.',
      ['Tick «periodic athkar», choose the interval and the form (toast or system notification).', 'Goals: the alert shows the first dhikr and stays until you press «✓ read».']),

    t('occasions', 'islam', 1,
      'المناسبات والأيام الفاضلة', 'ما هو قادم خلال ستّين يومًا — الأيام البيض، الاثنين والخميس، والمناسبات.',
      ['القائمة تُبنى من تاريخ اليوم الهجري تلقائيًّا.', '«الإعدادات» يختار أي الأنواع تظهر.'],
      'Occasions & virtuous days', 'What is coming in the next sixty days — the white days, Mondays and Thursdays, and occasions.',
      ['The list is built from today\'s Hijri date automatically.', '«Settings» chooses which kinds appear.']),

    /* ===== روابط ===== */
    t('lnk-custom', 'links', 1,
      'روابط مخصّصة', 'روابطك أنت على الشريط، باسم تختاره.',
      ['اكتب الاسم والرابط ثم «إضافة رابط».', 'تظهر مع بقيّة الروابط في فئة «روابط».'],
      'Custom links', 'Your own links on the rail, under a name you choose.',
      ['Type the name and the URL, then «Add link».', 'They appear alongside the rest in the «Links» category.']),

    t('siteviewer', 'links', 1,
      'عارض المواقع', 'يفتح أي موقع في نافذة داخل الصفحة التي أنت فيها.',
      ['الصق العنوان، اختر الحجم، ثم «فتح داخل الصفحة».', 'بعض المواقع تمنع العرض داخل إطار؛ عندها افتحها في تبويب.'],
      'Site viewer', 'Opens any site in a window inside the page you are on.',
      ['Paste the URL, pick a size, press «Open in page».', 'Some sites refuse to be framed; open those in a tab instead.']),

    t('waweb', 'links', 0,
      'واتساب ويب', 'يفتح web.whatsapp.com مباشرة.',
      [], 'WhatsApp Web', 'Opens web.whatsapp.com directly.', []),

    t('lnk-gmail', 'links', 0, 'Gmail', 'اختصار يفتح Gmail.', [], 'Gmail', 'A shortcut that opens Gmail.', []),
    t('lnk-outlook', 'links', 0, 'Outlook', 'اختصار يفتح Outlook.', [], 'Outlook', 'A shortcut that opens Outlook.', []),
    t('lnk-teams', 'links', 0, 'Microsoft Teams', 'اختصار يفتح Teams.', [], 'Microsoft Teams', 'A shortcut that opens Teams.', []),
    t('lnk-facebook', 'links', 0, 'Facebook', 'اختصار يفتح Facebook.', [], 'Facebook', 'A shortcut that opens Facebook.', []),
    t('lnk-youtube', 'links', 0, 'YouTube', 'اختصار يفتح YouTube.', [], 'YouTube', 'A shortcut that opens YouTube.', []),
    t('lnk-drive', 'links', 0, 'Google Drive', 'اختصار يفتح Google Drive.', [], 'Google Drive', 'A shortcut that opens Google Drive.', []),
    t('lnk-calendar', 'links', 0, 'Google Calendar', 'اختصار يفتح Google Calendar.', [], 'Google Calendar', 'A shortcut that opens Google Calendar.', []),
    t('lnk-telegram', 'links', 0, 'Telegram', 'اختصار يفتح Telegram Web.', [], 'Telegram', 'A shortcut that opens Telegram Web.', []),
    t('lnk-linkedin', 'links', 0, 'LinkedIn', 'اختصار يفتح LinkedIn.', [], 'LinkedIn', 'A shortcut that opens LinkedIn.', []),
    t('lnk-x', 'links', 0, 'X (Twitter)', 'اختصار يفتح X.', [], 'X (Twitter)', 'A shortcut that opens X.', []),
    t('lnk-google', 'links', 0, 'بحث Google', 'اختصار يفتح بحث Google.', [], 'Google Search', 'A shortcut that opens Google Search.', []),

    /* ===== المستندات ===== */
    t('mdview', 'docs', 1,
      'عارض Markdown', 'يعرض Markdown منسّقًا، ويحرّره، ويصدّره HTML أو PDF.',
      ['الصق النصّ أو افتح ملف .md.', '«حيّ» يعرض ويحرّر جنبًا إلى جنب. الإضافة تفتح ملفات .md الخام منسّقة من تلقائها.'],
      'Markdown viewer', 'Renders Markdown, edits it, and exports HTML or PDF.',
      ['Paste the text or open a .md file.', '«Live» shows the preview and the editor side by side. The extension also renders raw .md pages automatically.']),

    t('pdfcompress', 'docs', 1,
      'أدوات PDF', 'ضغط ودمج وتقسيم واستخراج وتدوير وتوقيع وترقيم وعلامة مائية — محلّي بالكامل.',
      ['اختر العملية من الشريط الجانبي ثم الملف.', '⛔ لا يُرفع الملفّ إلى أي خادم.', '⚠️ الضغط يحوّل الصفحات إلى صور، فيفقد النصّ قابليّة البحث.'],
      'PDF tools', 'Compress, merge, split, extract, rotate, sign, number and watermark — entirely local.',
      ['Pick the operation in the side rail, then the file.', '⛔ The file is never uploaded anywhere.', '⚠️ Compression turns pages into images, so the text stops being searchable.']),

    t('whiteboard', 'docs', 1,
      'السبّورة', 'رسم حرّ وأشكال ونصّ فوق لوح أبيض، للشرح السريع.',
      ['اختر الأداة من الشريط العلوي وارسم.', 'الألوان وسُمك القلم بجانب سلّة المسح.'],
      'Whiteboard', 'Free drawing, shapes and text on a white board, for a quick explanation.',
      ['Pick the tool in the top bar and draw.', 'Colour and pen width sit next to the bin.']),

    t('ziptool', 'docs', 1,
      'أرشيف ZIP', 'يفكّ أرشيفًا ويستعرض محتواه، وينشئ أرشيفًا جديدًا — في الذاكرة.',
      ['اختر ملف ZIP لترى قائمته، أو ابنِ أرشيفًا من ملفات تختارها.', '⛔ المسارات المطلقة و«..» تُرفض — أرشيف خبيث لا يكتب خارج مجلّده.'],
      'ZIP archive', 'Unpacks an archive and lists it, or builds a new one — all in memory.',
      ['Pick a ZIP file to see its listing, or build one from files you choose.', '⛔ Absolute paths and «..» are refused — a malicious archive cannot write outside its folder.']),

    t('sheetview', 'docs', 0, 'جداول الإكسيل', 'يفتح محرّر جداول في شاشة مستقلّة، يقرأ ويكتب xlsx و csv.',
      ['يفتح تبويبًا جديدًا داخل الإضافة.'],
      'Spreadsheets', 'Opens a spreadsheet editor in its own screen, reading and writing xlsx and csv.',
      ['Opens a new tab inside the extension.']),
    t('docedit', 'docs', 0, 'مستندات Word', 'محرّر مستندات يفتح ويحفظ docx.',
      ['يفتح تبويبًا جديدًا داخل الإضافة.'],
      'Word documents', 'A document editor that opens and saves docx.',
      ['Opens a new tab inside the extension.']),
    t('slidesedit', 'docs', 0, 'عروض PowerPoint', 'محرّر شرائح يفتح ويحفظ pptx.',
      ['يفتح تبويبًا جديدًا داخل الإضافة.'],
      'PowerPoint decks', 'A slide editor that opens and saves pptx.',
      ['Opens a new tab inside the extension.']),
    t('pdfword', 'docs', 0, 'PDF إلى Word', 'يحوّل PDF إلى مستند قابل للتحرير.',
      ['يفتح تبويبًا جديدًا داخل الإضافة.'],
      'PDF to Word', 'Converts a PDF into an editable document.',
      ['Opens a new tab inside the extension.']),
    t('mailwriter', 'docs', 0, 'محرّر الإيميلات', 'يكتب رسالة منسّقة ويصدّرها HTML جاهزًا للّصق.',
      ['يفتح تبويبًا جديدًا داخل الإضافة.'],
      'Email composer', 'Writes a formatted message and exports paste-ready HTML.',
      ['Opens a new tab inside the extension.']),
    t('ocr', 'docs', 0, 'استخراج نصّ من صورة', 'يقرأ النصّ داخل صورة (OCR) محليًّا.',
      ['يفتح تبويبًا جديدًا داخل الإضافة.'],
      'Text from an image', 'Reads the text inside an image (OCR), locally.',
      ['Opens a new tab inside the extension.']),

    /* ===== الصور والفيديو ===== */
    t('screenshot', 'media', 1,
      'لقطة شاشة', 'لقطة لمنطقة تحدّدها، أو للمنطقة المرئية، أو للصفحة كاملة.',
      ['«حدّد منطقة والتقطها» ثم اسحب مستطيلًا.', 'اسحب نحو حافة الشاشة لتمرير الصفحة والتقاط منطقة أطول منها.'],
      'Screenshot', 'A shot of a region you select, of the visible area, or of the whole page.',
      ['«Select a region and capture» then drag a rectangle.', 'Drag towards the edge to scroll and capture a region taller than the screen.']),

    t('imgedit', 'media', 1,
      'محرر الصور والمحوّل', 'قصّ وتدوير وطمس وكتابة فوق الصورة، وتحويل الصيغة والحجم، و PDF ⇄ صور.',
      ['افتح صورة، أو أرسِل لقطة إلى المحرّر من أداة التصوير.', 'الشريط الجانبي: تحرير · تحويل صيغة · PDF ⇄ صور · ضغط · تغيير الحجم.'],
      'Image editor & converter', 'Crop, rotate, blur and annotate, convert format and size, and PDF ⇄ images.',
      ['Open an image, or send a capture here from the screenshot tool.', 'Side rail: edit · convert format · PDF ⇄ images · compress · resize.']),

    t('imgbatch', 'media', 1,
      'معالج الصور المجمّع', 'يصغّر ويحوّل ويضغط مجموعة صور دفعة واحدة، وينزّلها ملف ZIP واحدًا.',
      ['اختر الصور، اضبط البُعد والصيغة والضغط، ثم «نفّذ على الكل».', 'محلّي بالكامل: لا تُرفع صورة.'],
      'Batch image processor', 'Resizes, converts and compresses a set of images at once and downloads one ZIP.',
      ['Pick the images, set the dimension, format and compression, then «Run on all».', 'Entirely local: no image is uploaded.']),

    t('exif', 'media', 1,
      'بيانات الصورة (EXIF)', 'يعرض ما تحمله الصورة من بيانات، ويصنع نسخة نظيفة منها.',
      ['اختر صورة لتقرأ وسومها.', '«تنزيل نسخة نظيفة» يُسقط الموقع والجهاز والوقت قبل أن تشاركها.'],
      'Image metadata (EXIF)', 'Shows what a photo carries, and makes a clean copy of it.',
      ['Pick an image to read its tags.', '«Download a clean copy» drops the location, device and time before you share it.']),

    t('screenrec', 'media', 1,
      'تسجيل الشاشة', 'يسجّل نافذة أو شاشة تختارها ملفَّ WebM، مع الميكروفون إن أردت.',
      ['فعّل الميكروفون إن احتجته، ثم «بدء التسجيل» واختر ما يُسجَّل.', 'يطلب المتصفّح إذن المشاركة.'],
      'Screen recording', 'Records a window or a screen you pick into a WebM file, with the microphone if you want.',
      ['Tick the microphone if you need it, press «Start recording» and choose what to record.', 'The browser asks for sharing permission.']),

    t('videodl', 'media', 1,
      'تحميل الفيديو والصوت', 'يبحث عن مقاطع الوسائط في الصفحة ليحفظ ما لك حقّ حفظه.',
      ['شغّل المقطع لحظات ثم اضغط «ابحث عن وسائط في هذه الصفحة».', '⚠️ يوتيوب والبثّ المشفّر والمقسّم (HLS/DASH) غير مدعوم.'],
      'Video & audio download', 'Finds the media clips on the page so you can save what you have the right to save.',
      ['Play the clip for a moment, then press «Find media on this page».', '⚠️ YouTube, encrypted streams and segmented ones (HLS/DASH) are not supported.']),

    t('regionshot', 'media', 0, 'التقاط منطقة', 'يبدأ تحديد المنطقة فورًا بلا فتح نافذة.',
      ['اختصار مباشر لأداة اللقطة.'],
      'Capture a region', 'Starts the region selection immediately, without opening a window.',
      ['A direct shortcut into the screenshot tool.']),
    t('status', 'media', 0, 'صانع الحالات', 'يصنع حالة (ستوري) بمقاس الجوال من صورة ونصّ.',
      ['يفتح تبويبًا جديدًا داخل الإضافة.'],
      'Status maker', 'Builds a phone-sized status/story from an image and text.',
      ['Opens a new tab inside the extension.']),
    t('frames', 'media', 0, 'الفيديو ⇒ صور', 'يستخرج لقطات من فيديو.',
      ['يفتح تبويبًا جديدًا داخل الإضافة.'],
      'Video ⇒ frames', 'Extracts still frames from a video.',
      ['Opens a new tab inside the extension.']),
    t('vaudio', 'media', 0, 'فصل الصوت', 'يفصل المسار الصوتي من ملف فيديو.',
      ['يفتح تبويبًا جديدًا داخل الإضافة.'],
      'Extract the audio', 'Separates the audio track from a video file.',
      ['Opens a new tab inside the extension.']),
    t('vtrim', 'media', 0, 'قصّ الفيديو', 'يقصّ مقطعًا من فيديو بلا إعادة ترميز حيثما أمكن.',
      ['يفتح تبويبًا جديدًا داخل الإضافة.'],
      'Trim a video', 'Cuts a section out of a video, without re-encoding where possible.',
      ['Opens a new tab inside the extension.']),
    t('vconv', 'media', 0, 'تحويل صيغة الفيديو', 'يحوّل الفيديو بين الصيغ.',
      ['يفتح تبويبًا جديدًا داخل الإضافة.'],
      'Convert a video', 'Converts video between formats.',
      ['Opens a new tab inside the extension.']),

    /* ===== مطوّرين ===== */
    t('devformat', 'dev', 1,
      'منسّقات ومحوّلات', 'JSON و CSV⇄JSON ومصغّر/منسّق ومقارنة نصّين و SQL و SVG.',
      ['الصق النصّ واختر العملية من الشريط الجانبي.', '«صالح ✓» تحت الصندوق تخبرك أن الـJSON سليم قبل أن تنسّقه.'],
      'Formatters & converters', 'JSON, CSV⇄JSON, minify/beautify, two-text compare, SQL and SVG.',
      ['Paste the text and pick the operation in the side rail.', '«Valid ✓» under the box tells you the JSON parses before you format it.']),

    t('codemin', 'dev', 1,
      'ضغط وتنسيق الكود', 'تصغير وتنسيق CSS و JS و JSON، مع الحجم قبل وبعد ونسبة التوفير.',
      ['الصق الكود أو اختر ملفًّا — النوع يُكتشف تلقائيًّا.', '⚠️ تصغير JS يحافظ على الأسطر (ASI)، وليس مصغّرًا كاملًا كـ terser.'],
      'Minify & format code', 'Minifies and formats CSS, JS and JSON, showing the size before and after and the saving.',
      ['Paste the code or pick a file — the type is detected.', '⚠️ JS minification preserves line breaks (ASI); it is not a full minifier like terser.']),

    t('devencode', 'dev', 1,
      'ترميز وتشفير', 'Base64 و URL، وبصمات Hash/HMAC، وقراءة JWT.',
      ['اختر الباب من الشريط الجانبي، الصق النصّ، ثم «ترميز» أو «فكّ».', 'قراءة JWT عرض فقط ولا تتحقّق من التوقيع.'],
      'Encoding & hashing', 'Base64 and URL, Hash/HMAC digests, and JWT reading.',
      ['Pick the tab in the side rail, paste the text, then «Encode» or «Decode».', 'JWT reading only displays; it does not verify the signature.']),

    t('devconvert', 'dev', 1,
      'محوّلات المطوّرين', 'cURL ⇄ fetch/axios، و YAML ⇄ JSON، و .env ⇄ JSON.',
      ['الصق أمر cURL واضغط «→ fetch».', '⛔ تحويل نصّي صرف — لا شبكة ولا تنفيذ ولا تخزين.'],
      'Developer converters', 'cURL ⇄ fetch/axios, YAML ⇄ JSON, and .env ⇄ JSON.',
      ['Paste a cURL command and press «→ fetch».', '⛔ Pure text conversion — no network, no execution, nothing stored.']),

    t('devregex', 'dev', 1,
      'مختبر Regex', 'يجرّب النمط على نصّك ويشرحه، ويعرض الاستبدال.',
      ['اكتب النمط والأعلام والنصّ ثم «اختبر».', '«اشرح النمط» يفكّه إلى جُمل مفهومة.', 'يعمل في Worker بمهلة — نمط كارثي (ReDoS) يُوقَف بدل أن يجمّد التبويب.', '⚠️ على موقع تمنع سياسته (CSP) تشغيل الـWorker يرفض المختبر العمل ويقترح «وضع العمل».'],
      'Regex lab', 'Runs the pattern against your text, explains it, and previews a replacement.',
      ['Type the pattern, the flags and the subject, then «Test».', '«Explain the pattern» breaks it into readable sentences.', 'It runs in a Worker with a timeout — a catastrophic pattern (ReDoS) is stopped instead of freezing the tab.', '⚠️ On a site whose policy (CSP) blocks the Worker, the lab refuses to run and offers Workspace mode.']),

    t('devfake', 'dev', 1,
      'بيانات وهمية للاختبار', 'أسماء وهويّات وجوالات وإيميلات وآيبان — بنية صالحة، أصحاب لا وجود لهم.',
      ['اكتب عدد السجلّات واضغط «توليد».', '«نسخ CSV» أو «نسخ JSON» لنقلها إلى اختبارك.'],
      'Fake test data', 'Names, IDs, mobiles, emails and IBANs — structurally valid, belonging to nobody.',
      ['Type the number of records and press «Generate».', '«Copy CSV» or «Copy JSON» to move them into your test.']),

    t('devcolor', 'dev', 1,
      'ملتقط الألوان', 'يلتقط لونًا من الشاشة، ويستخرج ألوان الصفحة، ويفحص تباين WCAG.',
      ['«التقط لونًا من الشاشة» يفتح القطّارة.', 'القيم HEX و RGB و HSL بجانب كلٍّ منها زرّ نسخ.'],
      'Colour picker', 'Picks a colour off the screen, extracts the page palette, and checks WCAG contrast.',
      ['«Pick a colour from the screen» opens the eyedropper.', 'HEX, RGB and HSL each sit beside a copy button.']),

    t('devinspect', 'dev', 1,
      'فاحص العناصر', 'يشير إلى عنصر في الصفحة ويعرض محدّده وأنماطه ومقاساته.',
      ['اضغط «ابدأ اختيار عنصر» ثم مرّر وانقر.', 'Esc يلغي. يتجاهل واجهة الإضافة نفسها.'],
      'Element inspector', 'Points at an element on the page and shows its selector, styles and box.',
      ['Press «Start picking an element», hover, then click.', 'Esc cancels. It ignores the extension\'s own UI.']),

    t('devviewport', 'dev', 1,
      'معاينة الأجهزة', 'يفتح الصفحة بمقاسات أجهزة معروفة لتفحص تجاوب التصميم.',
      ['اختر مقاسًا جاهزًا أو اكتب مقاسك ثم «فتح بالمقاس المخصّص».', '⚠️ معاينة عرض فقط — لا تغيّر نوع الجهاز (User-Agent).'],
      'Device preview', 'Opens the page at known device sizes to check responsive design.',
      ['Pick a preset or type your own, then «Open at a custom size».', '⚠️ Width preview only — it does not change the device type (User-Agent).']),

    t('devpage', 'dev', 1,
      'فحوص الصفحة', 'فحص وصولية، وفحص روابط، وقراءة سياسة CSP.',
      ['اضغط «افحص وصولية هذه الصفحة».', 'صور بلا alt، ترتيب عناوين، حقول بلا تسمية، تباين نصّ — انقر النتيجة لإبراز العنصر.'],
      'Page checks', 'An accessibility audit, a link check, and a read of the CSP.',
      ['Press «Audit this page for accessibility».', 'Images without alt, heading order, unlabelled fields, text contrast — click a result to highlight the element.']),

    t('devnet', 'dev', 1,
      'طلبات وترويسات', 'مرسِل طلبات من أصل هذه الصفحة بجلستها وكوكيزها، وعارض للترويسات.',
      ['اختر الطريقة والمسار، أضف الترويسات والجسم، ثم «إرسال».', '⚠️ يُرسَل من أصل هذه الصفحة وأنت مسجّل الدخول — لا تضرب مضيفًا آخر. لا يُحفظ ما تكتبه.'],
      'Requests & headers', 'Sends requests from this page\'s origin with its session and cookies, and shows headers.',
      ['Pick the method and path, add headers and a body, press «Send».', '⚠️ It goes out from this page\'s origin while you are signed in — do not aim it at another host. Nothing you type is stored.']),

    t('devlogs', 'dev', 1,
      'محلّل السجلّات', 'يحلّل سجلّ nginx/Apache: الحالات وأعلى المسارات وعناوين IP والمتصفّحات وخطّ زمني للأخطاء.',
      ['الصق السطور أو اختر ملفًّا ثم «حلّل».', '⛔ السجلّ يحمل عناوين IP لمستخدمين حقيقيين — التحليل محلّي بالكامل ولا يُخزَّن.'],
      'Log analyser', 'Parses an nginx/Apache access log: statuses, top paths, IPs, user agents and an error timeline.',
      ['Paste the lines or pick a file, then «Analyse».', '⛔ A log carries real users\' IP addresses — the analysis is entirely local and nothing is stored.']),

    t('techdetect', 'dev', 1,
      'كاشف تقنيات الموقع', 'يخمّن ما بُني به الموقع من بصمات في الصفحة نفسها.',
      ['اضغط «اكشف التقنيات المستخدمة».', 'فحص محلّي، والبصمات تقريبية — بعض المواقع تُخفي تقنياتها.'],
      'Tech detector', 'Guesses what the site is built with, from fingerprints in the page itself.',
      ['Press «Detect the technologies used».', 'A local check, and fingerprints are approximate — some sites hide what they use.']),

    t('perfaudit', 'dev', 1,
      'فحص سرعة الموقع', 'قياس محلّي من Performance API: زمن التحميل، Web Vitals حيّة، وأثقل الموارد.',
      ['اضغط «افحص سرعة الصفحة».', '⚠️ لالتقاط وقت التحميل: أبقِ الإضافة مفعّلة، أعد تحميل الصفحة، ثم افحص.'],
      'Site speed audit', 'A local measurement from the Performance API: load time, live Web Vitals, and the heaviest resources.',
      ['Press «Audit this page\'s speed».', '⚠️ To capture load time: keep the extension enabled, reload the page, then audit.']),

    /* ===== الحماية ===== */
    t('adblock', 'shield', 1,
      'مانع الإعلانات والتتبّع', 'حجب الإعلانات وأدوات التتبّع على مستوى الشبكة.',
      ['فعّله، وأضف المواقع التي تريد استثناءها — الاستثناء يشمل نطاقاتها الفرعية.', 'الحجب يسري على كل الصفحات الجديدة.', 'أدوات التتبّع تُحجب من المواقع الخارجية فقط، فلا تتعطّل لوحات تحكّم الخدمات ولا تسجيل الدخول بفيسبوك.'],
      'Ad & tracker blocker', 'Blocks ads and trackers at the network level.',
      ['Turn it on, and add the sites you want to exempt — an exemption covers its subdomains.', 'The blocking applies to every new page.', 'Trackers are blocked only as third parties, so vendor dashboards and Facebook login keep working.']),

    t('waprivacy', 'shield', 1,
      'خصوصية واتساب', 'قفل شاشة واتساب ويب بكلمة مرور، وتمويه الأسماء والصور والرسائل.',
      ['اضبط كلمة مرور و«حفظ القفل».', '«اقفل عند إخفاء التبويب» يغلق الشاشة تلقائيًّا حين تنتقل لتبويب آخر.', 'القفل يسري في اللوحة الجانبية أيضًا، وإشعارات الرسائل أثناء القفل تظهر بلا اسم ولا نصّ.', '⚠️ حماية من نظرة عابرة على شاشتك، لا تشفير للرسائل.'],
      'WhatsApp privacy', 'Locks the WhatsApp Web screen behind a password, and blurs names, pictures and messages.',
      ['Set a password and press «Save the lock».', '«Lock when the tab is hidden» closes the screen when you switch away.', 'The lock also holds in the side panel, and message notifications while locked show no name and no text.', '⚠️ Protection from a glance at your screen, not message encryption.']),

    t('msprivacy', 'shield', 1,
      'خصوصية ماسنجر', 'نفس القفل والتمويه على messenger.com و facebook.com/messages.',
      ['اضبط كلمة مرور و«حفظ القفل».'],
      'Messenger privacy', 'The same lock and blur on messenger.com and facebook.com/messages.',
      ['Set a password and press «Save the lock».']),

    t('sitecleaner', 'shield', 1,
      'منظّف الموقع', 'يحذف كوكيز هذا الموقع وتخزينه المحلّي — لاختبار انتهاء الجلسة.',
      ['اختر ما يُحذف ثم «تنظيف هذا الموقع».', '⚠️ يسجّل خروجك من هذا الموقع. «مسح كاش المتصفّح كاملًا» يشمل كل المواقع.'],
      'Site cleaner', 'Deletes this site\'s cookies and local storage — for testing what a fresh session sees.',
      ['Choose what to delete, then «Clean this site».', '⚠️ It signs you out of this site. «Clear the whole browser cache» covers every site.']),

    t('cookiemgr', 'shield', 1,
      'مدير الكوكيز', 'يعرض كوكيز هذا الموقع ويحذف واحدة أو يعدّلها.',
      ['«تحديث» يقرأ الكوكيز، والتصفية تبحث بالاسم.', 'القيم لا تُخزَّن ولا تغادر الجهاز.'],
      'Cookie manager', 'Lists this site\'s cookies and lets you delete or edit one.',
      ['«Refresh» reads them; the filter searches by name.', 'The values are not stored and never leave the machine.']),

    t('waopen', 'shield', 0, 'افتح واتساب ويب', 'اختصار مباشر إلى واتساب ويب.', [],
      'Open WhatsApp Web', 'A direct shortcut to WhatsApp Web.', []),
    t('wablur', 'shield', 0, 'تبديل تمويه واتساب', 'يشغّل التمويه ويطفئه بضغطة.', [],
      'Toggle the WhatsApp blur', 'Turns the blur on and off in one press.', []),
    t('msopen', 'shield', 0, 'افتح ماسنجر', 'اختصار مباشر إلى ماسنجر.', [],
      'Open Messenger', 'A direct shortcut to Messenger.', []),
    t('msblur', 'shield', 0, 'تبديل تمويه ماسنجر', 'يشغّل التمويه ويطفئه بضغطة.', [],
      'Toggle the Messenger blur', 'Turns the blur on and off in one press.', []),

    /* ===== الأداء ===== */
    t('speedlite', 'perf', 1,
      'الوضع الخفيف', 'يحجب الصور والخطوط الخارجية والفيديو ليتصفّح على اتصال بطيء.',
      ['فعّل ما تريد حجبه.', 'أعد تحميل الصفحة بعد التغيير ليسري.', 'المواقع المستثناة تعمل كاملة.'],
      'Lite mode', 'Blocks images, external fonts and video so you can browse on a slow connection.',
      ['Tick what you want blocked.', 'Reload the page after a change for it to apply.', 'Exempted sites load in full.']),

    t('speedembed', 'perf', 1,
      'تحميل بالنقر', 'يستبدل المحتوى المضمَّن (يوتيوب، خرائط، تويتر…) ببطاقة تُحمَّل عند النقر.',
      ['فعّله — يسري فورًا وعلى كل الصفحات الجديدة.', 'الصفحات التي تحوي مقاطع مضمَّنة تفتح أخفّ بكثير.'],
      'Click to load', 'Replaces embedded content (YouTube, Maps, X…) with a card that loads on click.',
      ['Turn it on — it applies at once and to every new page.', 'Pages full of embeds open far lighter.']),

    t('speedfreeze', 'perf', 1,
      'مجمّد الحركة', 'يوقف الحركات المستمرّة على الصفحة — أقلّ استهلاكًا للمعالج والبطارية.',
      ['اختر ما يُجمَّد: حركات CSS، التشغيل التلقائي، صور GIF.', 'يسري فورًا وعلى الصفحات الجديدة.'],
      'Motion freezer', 'Stops the constant motion on a page — less CPU and battery.',
      ['Choose what to freeze: CSS animation, autoplay, animated GIFs.', 'Applies at once and to new pages.']),

    t('speedfetch', 'perf', 1,
      'التحميل المسبق للروابط', 'يجهّز الرابط عند مرور الماوس فوقه، فيفتح شبه فوريّ.',
      ['فعّله وشاهد العدّاد يرتفع.', 'يتجاهل روابط الخروج والحذف والمعاملات، ويتعطّل مع وضع توفير البيانات.'],
      'Link prefetch', 'Prepares a link when the mouse passes over it, so it opens almost instantly.',
      ['Turn it on and watch the counter rise.', 'It ignores sign-out, delete and transaction links, and switches itself off under data saver.']),

    t('speedtabs', 'perf', 1,
      'موفّر ذاكرة التبويبات', 'يجمّد التبويبات الخاملة ليستردّ الذاكرة.',
      ['اختر مدّة الخمول، أو اضغط «جمّد التبويبات الخاملة الآن».', 'لا يجمّد المثبَّتة ولا ما يشغّل صوتًا.'],
      'Tab memory saver', 'Freezes idle tabs to reclaim memory.',
      ['Pick the idle time, or press «Freeze idle tabs now».', 'It never freezes pinned tabs or anything playing audio.']),

    /* ===== المساعد الذكي ===== */
    t('sam-ai', 'ai', 1,
      'مساعد بروف', 'محادثة مع مزوّد ذكاء اصطناعي تختاره أنت بمفتاحك أنت.',
      ['اضغط ⚙ لتفتح صفحة المفاتيح، اختر المزوّد (Claude / ChatGPT / Gemini) وأدخل مفتاحك هناك.', '⛔ المفتاح لا يُكتب في صفحة تتصفّحها ولا يمرّ بأي خادم لنا.'],
      'Prof assistant', 'A chat with an AI provider you pick, using your own key.',
      ['Press ⚙ to open the keys page, pick the provider (Claude / ChatGPT / Gemini) and enter your key there.', '⛔ The key is never typed into a page you are browsing and never passes through a server of ours.'])
  ];
}());
