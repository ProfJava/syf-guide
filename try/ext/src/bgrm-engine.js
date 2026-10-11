/* SYF — «حذف الخلفية» engine (bgrm-engine.html, CLAUDE.md §5.32).
 * Runs U²-Netp (lib/models/u2netp.onnx, Apache-2.0) on onnxruntime-web 1.30.0 (lib/ort/, MIT),
 * WASM SIMD, one thread, no proxy worker. Everything is a file of the package — nothing is
 * fetched from anywhere else, and nothing is stored.
 *
 * ⛔ The two wasm paths are PINNED. Left alone, ort resolves them from its own URL (fine
 *    today) — but a later «simplification» to a CDN default would start downloading 14 MB
 *    from a third party with no error anywhere (same trap as OCR, §5.27/1). The test pins it.
 * ⛔ Traffic only over a MessagePort the tab hands us. Our parent is the HOST PAGE (the tab
 *    lives in a content script's shadow root), so `event.origin` is the site's — an origin
 *    check cannot tell our tab from the site. A port can: the pixels go down it and the mask
 *    comes back up it, and nothing is ever posted to `parent`. A page that hands us a port of
 *    its own gets answers about ITS pixels on ITS port, and sees nothing of ours.
 * Protocol (port): {op:'run', id, w, h, px:ArrayBuffer(w*h*4)} → {id, ok, mask:ArrayBuffer(w*h)}
 *                  | {id, ok:false, error}; progress {id, stage:'init'|'run'}. */
import * as ort from '../lib/ort/ort.wasm.min.mjs';

const SIZE = 320;                                   /* U²-Netp's input */
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
const MODEL_URL = new URL('../lib/models/u2netp.onnx', import.meta.url).href;

ort.env.wasm.wasmPaths = {
  mjs: new URL('../lib/ort/ort-wasm-simd-threaded.mjs', import.meta.url).href,
  wasm: new URL('../lib/ort/ort-wasm-simd-threaded.wasm', import.meta.url).href
};
ort.env.wasm.numThreads = 1;                        /* threads need cross-origin isolation */
ort.env.wasm.proxy = false;

/* same probe as src/ocr.js: validates a module that returns a v128 */
function hasSimd() {
  try {
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
    ]));
  } catch (e) { return false; }
}

let session = null;                                 /* cached for every run of this frame */
function getSession() {
  if (!session) {
    session = fetch(MODEL_URL).then((r) => {
      if (!r.ok) throw new Error('model');
      return r.arrayBuffer();
    }).then((buf) => ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }));
    session.catch(() => { session = null; });       /* a failed load may be retried */
  }
  return session;
}

/* RGBA 320² → planar float CHW, scaled by the image's max (as the reference does), then
   ImageNet mean/std */
export function toTensorData(px) {
  const n = SIZE * SIZE, out = new Float32Array(3 * n);
  let mx = 1;
  for (let i = 0; i < px.length; i += 4) { if (px[i] > mx) mx = px[i]; if (px[i + 1] > mx) mx = px[i + 1]; if (px[i + 2] > mx) mx = px[i + 2]; }
  for (let p = 0, j = 0; p < n; p++, j += 4) {
    out[p] = (px[j] / mx - MEAN[0]) / STD[0];
    out[n + p] = (px[j + 1] / mx - MEAN[1]) / STD[1];
    out[2 * n + p] = (px[j + 2] / mx - MEAN[2]) / STD[2];
  }
  return out;
}
/* the first output (d0) min-max normalised to 0–255 */
export function toMask(pred) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < pred.length; i++) { const v = pred[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const out = new Uint8Array(pred.length), d = (mx - mn) || 1;
  for (let i = 0; i < pred.length; i++) out[i] = Math.round((pred[i] - mn) / d * 255);
  return out;
}

async function run(port, msg) {
  const id = msg.id;
  /* ⛔ validate before building anything: the port may be a hostile page's */
  if (msg.w !== SIZE || msg.h !== SIZE || !(msg.px instanceof ArrayBuffer) || msg.px.byteLength !== SIZE * SIZE * 4) {
    port.postMessage({ id, ok: false, error: 'bad-input' }); return;
  }
  if (!hasSimd()) { port.postMessage({ id, ok: false, error: 'no-simd' }); return; }
  try {
    port.postMessage({ id, stage: 'init' });
    const s = await getSession();
    port.postMessage({ id, stage: 'run' });
    const input = new ort.Tensor('float32', toTensorData(new Uint8ClampedArray(msg.px)), [1, 3, SIZE, SIZE]);
    const res = await s.run({ [s.inputNames[0]]: input });
    const mask = toMask(res[s.outputNames[0]].data);
    port.postMessage({ id, ok: true, mask: mask.buffer }, [mask.buffer]);
  } catch (e) {
    port.postMessage({ id, ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
}

function serve(port) {
  port.onmessage = (e) => { const m = e.data; if (m && m.op === 'run') run(port, m); };
  port.postMessage({ op: 'ready', simd: hasSimd() });
}

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'syfs-bgrm-port' && e.ports && e.ports[0]) serve(e.ports[0]);
});
