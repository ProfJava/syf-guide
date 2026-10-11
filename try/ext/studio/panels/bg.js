/* SYF Studio Lab — «حذف الخلفية»: U²-Netp (lib/models/u2netp.onnx) on onnxruntime-web,
 * WASM, one thread — every file is in the package, nothing is fetched elsewhere.
 * The model gives a 320² mask; it is upscaled to the photo, then the user refines it:
 * edge (threshold) · feather · keep/erase brush. Output: transparent, a colour, the photo
 * blurred, or another image behind the subject. */
const SL = window.SL, I = SL.icon;
const SIZE = 320, MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
const u = (p) => new URL(p, location.href).href;

let ortP = null, sessionP = null;
function session() {
  if (sessionP) return sessionP;
  ortP = ortP || import(u('lib/ort/ort.wasm.min.mjs'));
  sessionP = ortP.then(async (ort) => {
    ort.env.wasm.wasmPaths = { mjs: u('lib/ort/ort-wasm-simd-threaded.mjs'), wasm: u('lib/ort/ort-wasm-simd-threaded.wasm') };
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    const buf = await (await fetch(u('lib/models/u2netp.onnx'))).arrayBuffer();
    const s = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { ort, s };
  });
  sessionP.catch(() => { sessionP = null; });
  return sessionP;
}
async function predict(img) {
  const { ort, s } = await session();
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, SIZE, SIZE);
  const px = g.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE, data = new Float32Array(3 * n);
  let mx = 1; for (let i = 0; i < px.length; i += 4) mx = Math.max(mx, px[i], px[i + 1], px[i + 2]);
  for (let p = 0, j = 0; p < n; p++, j += 4) {
    data[p] = (px[j] / mx - MEAN[0]) / STD[0]; data[n + p] = (px[j + 1] / mx - MEAN[1]) / STD[1]; data[2 * n + p] = (px[j + 2] / mx - MEAN[2]) / STD[2];
  }
  const res = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]) });
  const pred = res[s.outputNames[0]].data;
  let mn = Infinity, mx2 = -Infinity; for (const v of pred) { if (v < mn) mn = v; if (v > mx2) mx2 = v; }
  const m = document.createElement('canvas'); m.width = m.height = SIZE;
  const mg = m.getContext('2d'), id = mg.createImageData(SIZE, SIZE), d = (mx2 - mn) || 1;
  for (let i = 0; i < n; i++) { const a = Math.round((pred[i] - mn) / d * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = a; }
  mg.putImageData(id, 0, 0);
  return m;
}

function mount(body) {
  const o = Object.assign({ edge: 50, feather: 1, bgMode: 'none', color: '#ffffff', blur: 18, brush: 40, brushMode: 'keep' }, SL.LS.get('bg', {}));
  const save = () => SL.LS.set('bg', o);
  let img = null, name = 'image', rawMask = null, mask = null, bgImg = null, showBefore = false, busy = false;

  const grid = SL.h('<div class="grid2"><div class="stack" data-l></div><div class="stack" data-r></div></div>'); body.appendChild(grid);
  const L = grid.querySelector('[data-l]'), R = grid.querySelector('[data-r]');
  const dz = SL.dropzone({ title: 'اسحب صورة لحذف خلفيتها', hint: 'ذكاء اصطناعي يعمل على جهازك — الصورة لا تغادره', icon: 'bg', onFiles: (fs) => SL.fileToCanvas(fs[0]).then((c) => set(c, fs[0].name)) });
  L.appendChild(dz);
  const stage = SL.h('<div class="preview checker" hidden style="cursor:crosshair;touch-action:none"><canvas></canvas><span class="tag" data-tag></span></div>');
  L.appendChild(stage);
  const view = stage.querySelector('canvas'), tag = stage.querySelector('[data-tag]');
  const bar = SL.h('<div class="row" hidden></div>'); L.appendChild(bar);
  bar.appendChild(SL.seg([['keep', 'فرشاة: إبقاء', 'brush'], ['erase', 'فرشاة: حذف', 'eraser']], o.brushMode, (v) => { o.brushMode = v; save(); }));
  const bsz = SL.slider('حجم الفرشاة', 4, 200, 1, o.brush, 'px', (v) => { o.brush = v; save(); }); bsz.style.minWidth = '220px'; bar.appendChild(bsz);
  const before = SL.button('قبل / بعد', 'contrast', 'sm', () => { showBefore = !showBefore; before.classList.toggle('pri', showBefore); paint(); }); bar.appendChild(before);

  const c1 = SL.h('<div class="card stack"></div>'); R.appendChild(c1);
  c1.appendChild(SL.h('<h3>' + I('sparkles', 's') + 'الحذف التلقائي</h3>'));
  const prog = SL.h('<div class="note">اضغط «حذف الخلفية» — أول تشغيل يحمّل النموذج (٤٫٤ م.ب) من الإضافة نفسها.</div>'); c1.appendChild(prog);
  const run = SL.button('حذف الخلفية', 'sparkles', 'pri block', go); c1.appendChild(run);
  c1.appendChild(SL.slider('حدّة الحافّة', 0, 100, 1, o.edge, '', (v) => { o.edge = v; save(); rebuild(); }));
  c1.appendChild(SL.slider('تنعيم الحافّة', 0, 12, 1, o.feather, 'px', (v) => { o.feather = v; save(); rebuild(); }));

  const c2 = SL.h('<div class="card stack"></div>'); R.appendChild(c2);
  c2.appendChild(SL.h('<h3>' + I('layers', 's') + 'الخلفية الجديدة</h3>'));
  c2.appendChild(SL.seg([['none', 'شفّافة', 'grid'], ['color', 'لون', 'palette'], ['blur', 'الأصل مموّهاً', 'blur'], ['image', 'صورة', 'image']], o.bgMode, (v) => { o.bgMode = v; save(); paintBg(); paint(); }));
  const colRow = SL.h('<div class="row"></div>'); c2.appendChild(colRow);
  ['#ffffff', '#000000', '#f3f4f6', '#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#a855f7'].forEach((cc) => {
    const b = SL.h('<button type="button" style="width:28px;height:28px;border-radius:8px;border:1px solid var(--line);cursor:pointer"></button>'); b.style.background = cc; b.title = cc;
    b.addEventListener('click', () => { o.color = cc; ci.value = cc; save(); paint(); }); colRow.appendChild(b);
  });
  const ci = SL.h('<input type="color">'); ci.value = o.color; ci.addEventListener('input', () => { o.color = ci.value; save(); paint(); }); colRow.appendChild(ci);
  const blurS = SL.slider('شدّة التمويه', 2, 60, 1, o.blur, 'px', (v) => { o.blur = v; save(); paint(); }); c2.appendChild(blurS);
  const pickBg = SL.button('اختر صورة الخلفية', 'upload', 'sm', () => SL.pickFiles('image/*').then((f) => { if (f[0]) SL.fileToCanvas(f[0]).then((c) => { bgImg = c; paint(); }); })); c2.appendChild(pickBg);
  function paintBg() { colRow.hidden = o.bgMode !== 'color'; blurS.hidden = o.bgMode !== 'blur'; pickBg.hidden = o.bgMode !== 'image'; }
  paintBg();

  const c3 = SL.h('<div class="card stack"></div>'); R.appendChild(c3);
  c3.appendChild(SL.h('<h3>' + I('download', 's') + 'حفظ</h3>'));
  const row = SL.h('<div class="row"></div>'); c3.appendChild(row);
  row.appendChild(SL.button('تنزيل PNG', 'download', 'pri', () => { const c = result(); if (c) SL.toBlob(c).then((b) => SL.download(b, SL.base(name) + '-nobg.png')); }));
  row.appendChild(SL.button('WebP', 'download', '', () => { const c = result(); if (c) SL.toBlob(c, 'image/webp', .92).then((b) => SL.download(b, SL.base(name) + '-nobg.webp')); }));
  row.appendChild(SL.button('نسخ', 'copy', '', () => { const c = result(); if (c) SL.copyCanvas(c); }));
  c3.appendChild(SL.button('فتح في المحرر الاحترافي', 'editor', 'block', () => { const c = result(); if (c) { SL.setDoc(c, SL.base(name) + '-nobg.png'); SL.open('editor'); } }));

  function set(c, n) {
    img = c; name = n || 'image'; rawMask = mask = null; stage.hidden = false; bar.hidden = true;
    view.width = c.width; view.height = c.height; tag.textContent = SL.dims(c.width, c.height); paint();
  }
  async function go() {
    if (!img) { SL.toast('أضف صورة أولاً', 'image', true); return; }
    if (busy) return; busy = true; run.disabled = true;
    const t0 = performance.now(); prog.textContent = SL.t('يحمّل النموذج…');
    try {
      const sm = await (prog.textContent = SL.t('يحلّل الصورة…'), predict(img));
      rawMask = document.createElement('canvas'); rawMask.width = img.width; rawMask.height = img.height;
      const g = rawMask.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(sm, 0, 0, img.width, img.height);
      rebuild(); bar.hidden = false;
      prog.textContent = SL.t('تمّ في {0} ث — صحّح الحوافّ بالفرشاة إن لزم.', ((performance.now() - t0) / 1000).toFixed(1));
    } catch (e) { prog.textContent = SL.t('تعذّر تشغيل النموذج: {0}', (e && e.message) || e); }
    busy = false; run.disabled = false;
  }
  /* raw mask → edge curve → feather → the working mask (brush edits go on top of it) */
  function rebuild() {
    if (!rawMask) return;
    const w = rawMask.width, h = rawMask.height, t = document.createElement('canvas'); t.width = w; t.height = h;
    const g = t.getContext('2d'); g.drawImage(rawMask, 0, 0);
    const id = g.getImageData(0, 0, w, h), d = id.data, k = 1 + o.edge / 12, mid = 128;
    for (let i = 3; i < d.length; i += 4) d[i] = Math.max(0, Math.min(255, (d[i] - mid) * k + mid));
    g.putImageData(id, 0, 0);
    mask = document.createElement('canvas'); mask.width = w; mask.height = h;
    const mg = mask.getContext('2d'); if (o.feather) mg.filter = 'blur(' + o.feather + 'px)'; mg.drawImage(t, 0, 0); mg.filter = 'none';
    paint();
  }
  function result() {
    if (!img) return null;
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d');
    if (!mask) { g.drawImage(img, 0, 0); return c; }
    const fgc = document.createElement('canvas'); fgc.width = img.width; fgc.height = img.height; const fg = fgc.getContext('2d');
    fg.drawImage(img, 0, 0); fg.globalCompositeOperation = 'destination-in'; fg.drawImage(mask, 0, 0);
    if (o.bgMode === 'color') { g.fillStyle = o.color; g.fillRect(0, 0, c.width, c.height); }
    else if (o.bgMode === 'blur') { g.filter = 'blur(' + o.blur + 'px)'; g.drawImage(img, -o.blur, -o.blur, c.width + o.blur * 2, c.height + o.blur * 2); g.filter = 'none'; }
    else if (o.bgMode === 'image' && bgImg) { const s = Math.max(c.width / bgImg.width, c.height / bgImg.height); g.drawImage(bgImg, (c.width - bgImg.width * s) / 2, (c.height - bgImg.height * s) / 2, bgImg.width * s, bgImg.height * s); }
    g.drawImage(fgc, 0, 0);
    return c;
  }
  let rq = 0;
  function paint() { cancelAnimationFrame(rq); rq = requestAnimationFrame(() => { if (!img) return; const g = view.getContext('2d'); g.clearRect(0, 0, view.width, view.height); g.drawImage(showBefore || !mask ? img : result(), 0, 0); }); }

  /* brush on the mask */
  let drawing = false, last = null;
  function pt(e) { const r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) * view.width / r.width, y: (e.clientY - r.top) * view.height / r.height, k: view.width / r.width }; }
  function dab(p) {
    const g = mask.getContext('2d'), r = o.brush * p.k / 2;
    g.save(); g.globalCompositeOperation = o.brushMode === 'keep' ? 'source-over' : 'destination-out';
    const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.7, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill(); g.restore();
  }
  stage.addEventListener('pointerdown', (e) => { if (!mask) return; drawing = true; try { stage.setPointerCapture(e.pointerId); } catch (x) {} last = pt(e); dab(last); paint(); });
  stage.addEventListener('pointermove', (e) => {
    if (!drawing) return; const p = pt(e), dx = p.x - last.x, dy = p.y - last.y, n = Math.max(1, Math.floor(Math.hypot(dx, dy) / (o.brush * p.k * .15)));
    for (let i = 1; i <= n; i++) dab({ x: last.x + dx * i / n, y: last.y + dy * i / n, k: p.k }); last = p; paint();
  });
  stage.addEventListener('pointerup', () => { drawing = false; });

  if (SL.doc()) set(SL.doc().canvas, SL.doc().name);
  return SL.onDoc((d) => set(d.canvas, d.name));
}

SL.tools.push({ id: 'bg', group: 'edit', label: 'حذف الخلفية', icon: 'bg', badge: 'AI', desc: 'ذكاء اصطناعي على جهازك يفصل الموضوع عن خلفيته — ثم خلفية شفّافة أو لون أو تمويه.', mount });
