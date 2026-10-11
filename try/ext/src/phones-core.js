/* SYF — phone number normalisation core (spec: specs/phone-formatter.md).
 *
 * Ported from the standalone `phone-numbers-formatter` project (v1.0.0). Pure
 * functions, no DOM and no chrome.* — which is the point: the same file runs on
 * phones.html and under node for tools/phones-test.js, so the rules that decide
 * whether a number is valid are tested against the SHIPPED code rather than a
 * retyped copy of it.
 *
 * ⛔ Nothing here reads or writes storage, and nothing here touches the network.
 * A phone list is personal data (§8) — the file it came from lives in one tab's
 * memory and dies with it. */
(function (root, factory) {
  'use strict';
  var api = factory();
  root.SYFS = root.SYFS || {};
  root.SYFS.phoneCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* cc  : country calling code, digits only
   * nsn : the national significant number lengths this country actually uses
   * mob : known MOBILE prefixes of the NSN — read by strict mode only, because
   *       "reject landlines" is a choice and a wrong prefix table would silently
   *       throw away good rows for everyone else. */
  var COUNTRIES = [
    { id: 'SA', ar: 'السعودية', cc: '966', nsn: [9], mob: ['5'] },
    { id: 'AE', ar: 'الإمارات', cc: '971', nsn: [9], mob: ['5'] },
    { id: 'KW', ar: 'الكويت', cc: '965', nsn: [8], mob: ['5', '6', '9'] },
    { id: 'QA', ar: 'قطر', cc: '974', nsn: [8], mob: ['3', '5', '6', '7'] },
    { id: 'BH', ar: 'البحرين', cc: '973', nsn: [8], mob: ['3'] },
    { id: 'OM', ar: 'عُمان', cc: '968', nsn: [8], mob: ['7', '9'] },
    { id: 'YE', ar: 'اليمن', cc: '967', nsn: [9], mob: ['7'] },
    { id: 'JO', ar: 'الأردن', cc: '962', nsn: [9], mob: ['7'] },
    { id: 'EG', ar: 'مصر', cc: '20', nsn: [10], mob: ['1'] },
    { id: 'IQ', ar: 'العراق', cc: '964', nsn: [10], mob: ['7'] },
    { id: 'SY', ar: 'سوريا', cc: '963', nsn: [9], mob: ['9'] },
    { id: 'LB', ar: 'لبنان', cc: '961', nsn: [7, 8], mob: ['3', '7', '8'] },
    { id: 'PS', ar: 'فلسطين', cc: '970', nsn: [9], mob: ['5', '6'] },
    { id: 'SD', ar: 'السودان', cc: '249', nsn: [9], mob: ['9', '1'] },
    { id: 'LY', ar: 'ليبيا', cc: '218', nsn: [9], mob: ['9'] },
    { id: 'TN', ar: 'تونس', cc: '216', nsn: [8], mob: ['2', '4', '5', '9'] },
    { id: 'DZ', ar: 'الجزائر', cc: '213', nsn: [9], mob: ['5', '6', '7'] },
    { id: 'MA', ar: 'المغرب', cc: '212', nsn: [9], mob: ['6', '7'] },
    { id: 'TR', ar: 'تركيا', cc: '90', nsn: [10], mob: ['5'] },
    { id: 'GB', ar: 'بريطانيا', cc: '44', nsn: [10], mob: ['7'] },
    { id: 'US', ar: 'الولايات المتحدة', cc: '1', nsn: [10], mob: [] },
    { id: 'IN', ar: 'الهند', cc: '91', nsn: [10], mob: ['6', '7', '8', '9'] },
    { id: 'PK', ar: 'باكستان', cc: '92', nsn: [10], mob: ['3'] }
  ];

  /* Calling codes used ONLY to recognise a number that already belongs to some
     other country. Sorted longest-first so '966' wins before '96'. */
  var KNOWN_CODES = (function () {
    var all = ['1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44',
      '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62',
      '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98', '211',
      '212', '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227', '228', '229',
      '230', '231', '232', '233', '234', '235', '236', '237', '238', '239', '240', '241', '242', '243',
      '244', '245', '248', '249', '250', '251', '252', '253', '254', '255', '256', '257', '258', '260',
      '261', '262', '263', '264', '265', '266', '267', '268', '269', '291', '297', '298', '299', '350',
      '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372', '373', '374',
      '375', '376', '377', '378', '380', '381', '382', '383', '385', '386', '387', '389', '420', '421',
      '423', '500', '501', '502', '503', '504', '505', '506', '507', '509', '590', '591', '592', '593',
      '595', '598', '599', '670', '672', '673', '674', '675', '676', '677', '678', '679', '680', '681',
      '682', '683', '685', '686', '687', '688', '689', '690', '691', '692', '850', '852', '853', '855',
      '856', '870', '880', '886', '960', '961', '962', '963', '964', '965', '966', '967', '968', '970',
      '971', '972', '973', '974', '975', '976', '977', '992', '993', '994', '995', '996', '998'];
    return all.sort(function (a, b) { return b.length - a.length; });
  }());

  var STATUS = { OK: 'ok', FIXED: 'fixed', INVALID: 'invalid', EMPTY: 'empty', FOREIGN: 'foreign', DUPLICATE: 'duplicate' };
  var FORMATS = ['plus', 'zeros', 'plain', 'local'];

  var DEFAULTS = {
    countryCode: '966',
    nsnLengths: [9],
    mobilePrefixes: ['5'],
    outputFormat: 'plus',            // plus | zeros | plain | local
    trunkPrefix: '0',
    convertArabicDigits: true,
    strictMobile: false,
    keepForeign: true,
    markDuplicates: true
  };

  /* Arabic-Indic (٠-٩) and Eastern Arabic (۰-۹) digits → ASCII. Two ranges, and
     the base is chosen per character: a sheet can hold both. */
  function toAscii(value) {
    return String(value).replace(/[٠-٩۰-۹]/g, function (ch) {
      var code = ch.charCodeAt(0);
      var base = code >= 0x06F0 ? 0x06F0 : 0x0660;
      return String(code - base);
    });
  }

  function getCountry(code) {
    for (var i = 0; i < COUNTRIES.length; i++) if (COUNTRIES[i].cc === String(code)) return COUNTRIES[i];
    return null;
  }
  function countryById(id) {
    for (var i = 0; i < COUNTRIES.length; i++) if (COUNTRIES[i].id === id) return COUNTRIES[i];
    return null;
  }

  /* ⚠️ hasOwnProperty on BOTH sides: the option object is built from stored
     preferences, and `{"__proto__": …}` survives JSON.parse as a real key. An
     unknown key is dropped rather than copied — whitelist, not sanitise (§4.1). */
  function mergeOptions(options) {
    var opts = {}, key;
    for (key in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) opts[key] = DEFAULTS[key];
    for (key in (options || {})) {
      if (Object.prototype.hasOwnProperty.call(options, key) &&
          Object.prototype.hasOwnProperty.call(DEFAULTS, key)) opts[key] = options[key];
    }
    opts.countryCode = String(opts.countryCode || '').replace(/\D/g, '');
    opts.trunkPrefix = String(opts.trunkPrefix === undefined ? '0' : opts.trunkPrefix).replace(/\D/g, '');
    if (FORMATS.indexOf(opts.outputFormat) < 0) opts.outputFormat = DEFAULTS.outputFormat;
    if (!Array.isArray(opts.nsnLengths)) opts.nsnLengths = [];
    opts.nsnLengths = opts.nsnLengths.map(Number).filter(function (n) { return n > 0 && n < 15; });
    if (!Array.isArray(opts.mobilePrefixes)) opts.mobilePrefixes = [];
    return opts;
  }

  function lengthOk(nsn, opts) {
    if (!opts.nsnLengths.length) return nsn.length >= 4 && nsn.length <= 14;
    return opts.nsnLengths.indexOf(nsn.length) !== -1;
  }
  function prefixOk(nsn, opts) {
    if (!opts.strictMobile || !opts.mobilePrefixes.length) return true;
    for (var i = 0; i < opts.mobilePrefixes.length; i++) {
      if (nsn.indexOf(String(opts.mobilePrefixes[i])) === 0) return true;
    }
    return false;
  }

  /* Does this look like a number that already belongs to another country?
     ⚠️ A number NOT written in international form (no '+' and no '00') gets a
     tighter window, or a long junk string like 50123456789012 is "read" as a
     Belize (+501) number and shipped as valid. */
  function foreignCode(digits, ownCode, international) {
    var min = international ? 8 : 10;
    var max = international ? 15 : 13;
    if (digits.length < min || digits.length > max) return null;
    for (var i = 0; i < KNOWN_CODES.length; i++) {
      var code = KNOWN_CODES[i], rest = digits.length - code.length;
      if (code !== ownCode && digits.indexOf(code) === 0 && rest >= 6 && rest <= 12) return code;
    }
    return null;
  }

  function render(cc, nsn, opts) {
    switch (opts.outputFormat) {
      case 'zeros': return '00' + cc + nsn;
      case 'plain': return cc + nsn;
      case 'local': return opts.trunkPrefix + nsn;
      default: return '+' + cc + nsn;
    }
  }

  /* One raw cell → { input, output, nsn, status, reason }. */
  function formatNumber(raw, options) {
    var opts = mergeOptions(options);
    var input = (raw === null || raw === undefined) ? '' : String(raw).trim();
    var result = { input: input, output: '', nsn: '', status: STATUS.EMPTY, reason: '' };

    if (input === '') { result.reason = 'empty'; return result; }

    var text = opts.convertArabicDigits ? toAscii(input) : input;
    /* Excel turns a long number into a float and prints 9.66501E+11. That is not
       a typo the user made, it is the spreadsheet destroying the value on the way
       in — expand it before anything else looks at it.
       ⛔ v0.139.3: only when the mantissa still HOLDS every digit. 9.66501E+11 kept six
       of twelve; expanding it wrote 966501000000 — an invented number, marked valid
       (the same sin as padding a trunk-prefixed number, §5.13/6). Those are INVALID
       with reason 'precision-lost': the real digits are gone, only the source has them. */
    var sci = /^[+-]?(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(text.replace(/\s/g, ''));
    if (sci) {
      var lead = sci[1].replace(/^0+/, '');
      var held = lead + (sci[2] || '');                 /* the digits the cell still shows */
      var need = lead.length + Number(sci[3]);          /* digits the whole number has */
      /* fewer shown than needed ⇒ lost · extra non-zero digits ⇒ not a whole number */
      if (!lead || held.length < need || /[1-9]/.test(held.slice(need))) {
        result.status = STATUS.INVALID; result.reason = 'precision-lost'; result.output = input;
        return result;
      }
      /* the digits themselves, not Number().toFixed() — no float in the path */
      text = (sci[0].charAt(0) === '+' ? '+' : '') + held.slice(0, need);
    }

    var hasPlus = /^\s*\+/.test(text);
    var digits = text.replace(/\D/g, '');
    if (!digits) {
      result.status = STATUS.INVALID; result.reason = 'no-digits'; result.output = input;
      return result;
    }

    var international = hasPlus;
    if (digits.indexOf('00') === 0 && digits.length > 4) { digits = digits.slice(2); international = true; }

    var cc = opts.countryCode, nsn = null;

    if (cc && digits.indexOf(cc) === 0 && lengthOk(digits.slice(cc.length), opts)) nsn = digits.slice(cc.length);

    if (nsn === null && opts.trunkPrefix && digits.indexOf(opts.trunkPrefix) === 0) {
      var stripped = digits.replace(new RegExp('^' + opts.trunkPrefix + '+'), '');
      if (cc && stripped.indexOf(cc) === 0 && lengthOk(stripped.slice(cc.length), opts)) nsn = stripped.slice(cc.length);
      else if (lengthOk(stripped, opts)) nsn = stripped;
    }

    /* A plain national number. ⚠️ The trunk-prefix guard is load-bearing: a
       national number never starts with the trunk prefix, so 056778899 (nine
       digits, leading zero) stays INVALID instead of being accepted as a
       nine-digit NSN. Padding it would invent a number. */
    if (nsn === null && lengthOk(digits, opts) &&
        !(opts.trunkPrefix && digits.indexOf(opts.trunkPrefix) === 0)) nsn = digits;

    if (nsn === null) {
      var foreign = foreignCode(digits, cc, international);
      if (foreign && opts.keepForeign) {
        result.status = STATUS.FOREIGN;
        result.reason = 'country-' + foreign;
        result.nsn = digits.slice(foreign.length);
        /* a foreign number is never rendered in the LOCAL format — '0' plus an
           Egyptian NSN is a number in nobody's country */
        result.output = render(foreign, result.nsn, opts.outputFormat === 'local' ? { outputFormat: 'plus' } : opts);
        return result;
      }
      result.status = STATUS.INVALID;
      result.reason = digits.length < 6 ? 'too-short' : 'unrecognized';
      result.output = input;
      return result;
    }

    if (!prefixOk(nsn, opts)) {
      result.status = STATUS.INVALID; result.reason = 'not-mobile'; result.nsn = nsn; result.output = input;
      return result;
    }

    result.nsn = nsn;
    result.output = render(cc, nsn, opts);
    result.status = result.output === input ? STATUS.OK : STATUS.FIXED;
    return result;
  }

  /* A list, with duplicates flagged. Keyed on the OUTPUT, not the input: two rows
     written differently are the same person, which is the whole reason to look. */
  function formatList(values, options) {
    var opts = mergeOptions(options);
    var seen = Object.create(null);
    return (values || []).map(function (value) {
      var item = formatNumber(value, opts);
      item.duplicate = false;
      if (opts.markDuplicates && item.output &&
          (item.status === STATUS.OK || item.status === STATUS.FIXED || item.status === STATUS.FOREIGN)) {
        var key = 'k' + item.output;
        if (seen[key]) item.duplicate = true; else seen[key] = true;
      }
      return item;
    });
  }

  /* "Does this column hold phone numbers?" — header words score, and so does the
     shape of the data, because plenty of real sheets have no header at all. */
  function scoreColumn(header, sample) {
    var score = 0;
    var head = String(header || '').toLowerCase();
    /* i18n-skip-start: MATCHERS compared against the user's own spreadsheet
       headers, not interface text. Translating them would mean searching for a
       word the file does not contain — and the failure looks like "detection just
       picked the wrong column" (§6.97/2). */
    var hints = ['phone', 'mobile', 'tel', 'cell', 'whatsapp', 'msisdn', 'contact', 'number',
      'جوال', 'جوّال', 'هاتف', 'موبايل', 'رقم', 'تليفون', 'واتس'];
    /* i18n-skip-end */
    hints.forEach(function (hint) { if (head.indexOf(hint) !== -1) score += 40; });

    var checked = 0, digity = 0;
    (sample || []).forEach(function (value) {
      var text = toAscii(String(value === null || value === undefined ? '' : value));
      if (!text.trim()) return;
      checked++;
      var digits = text.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15 && digits.length / text.replace(/\s/g, '').length > 0.6) digity++;
    });
    if (checked) score += Math.round((digity / checked) * 60);
    return score;
  }

  return {
    COUNTRIES: COUNTRIES,
    STATUS: STATUS,
    FORMATS: FORMATS,
    DEFAULTS: DEFAULTS,
    toAsciiDigits: toAscii,
    getCountry: getCountry,
    countryById: countryById,
    formatNumber: formatNumber,
    formatList: formatList,
    scoreColumn: scoreColumn
  };
}));
