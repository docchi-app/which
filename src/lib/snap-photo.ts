// Turning a camera frame or a gallery photo into a snap photo: always exactly
// 3:4 (1080 × 1440), the shape of the snap card, so it fills the card with
// nothing cut. Drawing it fresh also drops hidden data such as GPS location.

import { SnapError } from "./snap";

export const SNAP_W = 1080;
export const SNAP_H = 1440;
const MAX_BYTES = 560 * 1024;

/** An upright phone photo (close to 3:4): it can fill the card as it is. */
export const isUpright = (w: number, h: number) => Math.abs(w / h - 3 / 4) < 0.04;

function canvas(w = SNAP_W, h = SNAP_H) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { c, ctx };
}

const toBlob = (c: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality));

/** WebP (JPEG where the browser can't make WebP), as sharp as fits in ~560 KB. */
export async function encode(c: HTMLCanvasElement): Promise<Blob> {
  for (const quality of [0.86, 0.78, 0.68, 0.58]) {
    let blob = await toBlob(c, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(c, "image/jpeg", quality);
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new SnapError("too_big");
}

export type Source = CanvasImageSource & { width: number; height: number };

/** Reads a gallery file the right way up. */
export async function loadPhoto(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

/**
 * Fills the 3:4 frame: `zoom` ≥ 1 on top of "just covers the frame", and
 * `cx`/`cy` (0–1) is the point of the photo at the frame's centre.
 */
export function drawFill(src: Source, zoom = 1, cx = 0.5, cy = 0.5): HTMLCanvasElement {
  const { c, ctx } = canvas();
  const scale = Math.max(SNAP_W / src.width, SNAP_H / src.height) * zoom;
  const w = src.width * scale;
  const h = src.height * scale;
  const x = Math.min(0, Math.max(SNAP_W - w, SNAP_W / 2 - cx * w));
  const y = Math.min(0, Math.max(SNAP_H - h, SNAP_H / 2 - cy * h));
  ctx.drawImage(src, x, y, w, h);
  return c;
}

/** The whole photo, centred, with a soft blurred copy of itself filling the rest of the frame. */
export function drawWhole(src: Source): HTMLCanvasElement {
  const { c, ctx } = canvas();
  // Blur by shrinking to a tiny copy and scaling it back up (works in every browser).
  const tiny = canvas(27, 36);
  const s = Math.max(27 / src.width, 36 / src.height);
  tiny.ctx.drawImage(src, (27 - src.width * s) / 2, (36 - src.height * s) / 2, src.width * s, src.height * s);
  ctx.drawImage(tiny.c, -20, -20, SNAP_W + 40, SNAP_H + 40);
  ctx.fillStyle = "rgba(10, 6, 25, 0.28)";
  ctx.fillRect(0, 0, SNAP_W, SNAP_H);
  const fit = Math.min(SNAP_W / src.width, SNAP_H / src.height);
  const w = src.width * fit;
  const h = src.height * fit;
  ctx.drawImage(src, (SNAP_W - w) / 2, (SNAP_H - h) / 2, w, h);
  return c;
}

/**
 * The centre 3:4 of a live camera frame, as it looked on screen: mirrored for the
 * front camera, cropped in by `zoom` (≥ 1, when the phone can't zoom the camera
 * itself) and made brighter or darker by `brightness` (1 = as is).
 */
export function drawFromVideo(video: HTMLVideoElement, mirror: boolean, zoom = 1, brightness = 1): HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const { c, ctx } = canvas();
  let sw = vw;
  let sh = (vw * 4) / 3;
  if (sh > vh) {
    sh = vh;
    sw = (vh * 3) / 4;
  }
  sw /= zoom;
  sh /= zoom;
  if (mirror) {
    ctx.translate(SNAP_W, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, SNAP_W, SNAP_H);
  if (brightness !== 1) brighten(ctx, brightness);
  return c;
}

/** Multiplies every pixel (the same as CSS `brightness()`, which not every browser has on a canvas). */
function brighten(ctx: CanvasRenderingContext2D, k: number) {
  const img = ctx.getImageData(0, 0, SNAP_W, SNAP_H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] * k;
    d[i + 1] = d[i + 1] * k;
    d[i + 2] = d[i + 2] * k;
  }
  ctx.putImageData(img, 0, 0);
}

/** The photo's average colour as 6 hex digits ("3a6ea5"), for a placeholder while it loads. */
export async function averageColor(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const { ctx } = canvas(1, 1);
  ctx.drawImage(bitmap, 0, 0, 1, 1);
  bitmap.close?.();
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}
