import { observationAt, type Beat, type Project } from "./project";
export const WIDTH = 1080,
  HEIGHT = 1920,
  FPS = 30;
// This subset is shared by browser Canvas2D and the server Skia canvas.
type Ctx = CanvasRenderingContext2D;
export function fittedRect(width: number, height: number) {
  const scale = Math.min(984 / width, 890 / height);
  const w = width * scale,
    h = height * scale;
  return { x: (WIDTH - w) / 2, y: 370 + (890 - h) / 2, w, h };
}
export function textLines(
  ctx: Pick<Ctx, "measureText">,
  text: string,
  max: number,
): string[] {
  const lines: string[] = [];
  let row = "";
  for (const token of text.trim().split(/\s+/)) {
    if (row && ctx.measureText(`${row} ${token}`).width > max) {
      lines.push(row);
      row = "";
    }
    for (const letter of token) {
      if (ctx.measureText(row + letter).width > max && row) {
        lines.push(row);
        row = "";
      }
      row += letter;
    }
    row += " ";
  }
  if (row.trim()) lines.push(row.trim());
  return lines.map((line) => line.trimEnd());
}
function wrap(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  max: number,
  line: number,
  maxLines = 5,
) {
  const original = Number(ctx.font.match(/([\d.]+)px/)?.[1] || 54);
  let size = original;
  let lines = textLines(ctx, text, max);
  while (lines.length > maxLines && size > 22) {
    size -= 2;
    ctx.font = ctx.font.replace(/[\d.]+px/, `${size}px`);
    lines = textLines(ctx, text, max);
  }
  const spacing = (line * size) / original;
  lines.forEach((row, i) => ctx.fillText(row, x, y + i * spacing));
}
export function paintFrame(
  ctx: Ctx,
  project: Project,
  beat: Beat,
  index: number,
  sourceSeconds: number,
  image?: CanvasImageSource,
  mask?: CanvasImageSource,
) {
  ctx.save();
  ctx.fillStyle = "#101816";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#d7fa79";
  ctx.font = "600 29px Arial";
  ctx.fillText("ODDLY CLEAR", 64, 86);
  ctx.fillStyle = "#77867e";
  ctx.font = "24px Arial";
  ctx.textAlign = "right";
  ctx.fillText(`0${index + 1} / 04`, 1016, 86);
  ctx.textAlign = "left";
  ctx.fillStyle = "#f7f5ec";
  ctx.font = "600 64px Arial";
  wrap(ctx, project.title, 64, 186, 940, 74, 2);
  const r = fittedRect(project.video.width, project.video.height);
  if (image) ctx.drawImage(image, r.x, r.y, r.w, r.h);
  const o = observationAt(beat.track, sourceSeconds, project.video.fps);
  if (o) {
    const [x, y, w, h] = o.box;
    if (mask) {
      ctx.globalAlpha = 0.42;
      ctx.drawImage(mask, r.x + x * r.w, r.y + y * r.h, w * r.w, h * r.h);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = "#d7fa79";
    ctx.lineWidth = 5;
    ctx.strokeRect(r.x + x * r.w, r.y + y * r.h, w * r.w, h * r.h);
    const lx = Math.max(48, Math.min(r.x + x * r.w, 790));
    const ly = Math.max(360, r.y + y * r.h - 15);
    ctx.font = "600 25px Arial";
    const labelWidth = Math.min(700, ctx.measureText(beat.target).width + 24);
    ctx.fillStyle = "#d7fa79";
    ctx.fillRect(lx, ly - 34, labelWidth, 43);
    ctx.fillStyle = "#132016";
    ctx.fillText(beat.target, lx + 12, ly - 4, 676);
  }
  ctx.fillStyle = "#d7fa79";
  ctx.font = "600 25px Arial";
  ctx.fillText(beat.heading.toUpperCase(), 64, 1380, 940);
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 54px Arial";
  wrap(ctx, beat.caption, 64, 1460, 950, 69, 4);
  ctx.fillStyle = "#8c9b91";
  ctx.font = "25px Arial";
  ctx.fillText(`SOURCE  /  PDF p. ${beat.citation.page}`, 64, 1790);
  ctx.fillStyle = "#627269";
  ctx.font = "22px Arial";
  ctx.fillText(
    project.sample
      ? "ILLUSTRATIVE SAMPLE · NOT LIVE AI TRACKING"
      : "SOURCE-BACKED VISUAL EXPLAINER",
    64,
    1845,
    950,
  );
  ctx.restore();
}
