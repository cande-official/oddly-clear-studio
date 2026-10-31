import { createCanvas } from "@napi-rs/canvas";
import { promises as fs } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { command, readPdf, trackedSpawn } from "../server/media";

export const sourceURL =
  "https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/helicopter_flying_handbook/hfh_ch02.pdf";
const sampleDir = path.resolve(".local/sample");
export function geometry(t: number) {
  return {
    x: 28 * Math.sin(t * 0.42),
    y: 9 * Math.sin(t * 0.7),
    tailX: 1025,
    tailY: 310,
  };
}
export async function ensureSample() {
  await fs.mkdir(sampleDir, { recursive: true });
  try {
    await fs.access(path.join(sampleDir, "source.pdf"));
  } catch {
    const response = await fetch(sourceURL, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error("Could not download the FAA sample source.");
    await fs.writeFile(
      path.join(sampleDir, "source.pdf"),
      Buffer.from(await response.arrayBuffer()),
    );
  }
  // Validate and persist actual extracted pages; there is no mock PDF parser.
  const pages = await readPdf(path.join(sampleDir, "source.pdf"));
  await fs.writeFile(path.join(sampleDir, "pages.json"), JSON.stringify(pages));
  try {
    await fs.access(path.join(sampleDir, "video.mp4"));
    return;
  } catch {
    /* create original fixture */
  }
  const canvas = createCanvas(1280, 720),
    ctx = canvas.getContext("2d");
  const encoder = trackedSpawn("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "-framerate",
    "30",
    "-i",
    "pipe:0",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "20",
    "-movflags",
    "+faststart",
    path.join(sampleDir, "video.mp4"),
  ]);
  let failure: Error | undefined;
  encoder.stdin!.on("error", (e) => {
    failure = e;
  });
  encoder.on("error", (e) => {
    failure = e;
  });
  const complete = new Promise<void>((resolve, reject) =>
    encoder.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Sample video encoding failed.")),
    ),
  );
  complete.catch(() => {});
  try {
    for (let frame = 0; frame < 840; frame++) {
      const t = frame / 30,
        g = geometry(t);
      const bg = ctx.createLinearGradient(0, 0, 0, 720);
      bg.addColorStop(0, "#e4e9e3");
      bg.addColorStop(1, "#b9c4b8");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1280, 720);
      ctx.strokeStyle = "#70857822";
      ctx.lineWidth = 1;
      for (let x = 0; x < 1280; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 720);
        ctx.stroke();
      }
      for (let y = 0; y < 720; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1280, y);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.fillStyle = "#1b30232b";
      ctx.beginPath();
      ctx.ellipse(640, 555, 350, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#546853";
      ctx.lineWidth = 15;
      ctx.lineCap = "round";
      for (const x of [455, 670]) {
        ctx.beginPath();
        ctx.moveTo(x, 440);
        ctx.lineTo(x - 45, 510);
        ctx.lineTo(x + 80, 510);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(360, 525);
      ctx.lineTo(785, 525);
      ctx.stroke();
      ctx.fillStyle = "#576d5c";
      ctx.beginPath();
      ctx.moveTo(700, 335);
      ctx.lineTo(1035, 296);
      ctx.lineTo(1035, 330);
      ctx.lineTo(700, 400);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#687e65";
      ctx.beginPath();
      ctx.moveTo(985, 315);
      ctx.lineTo(1050, 205);
      ctx.lineTo(1070, 210);
      ctx.lineTo(1050, 320);
      ctx.closePath();
      ctx.fill();
      const body = ctx.createLinearGradient(0, 300, 0, 460);
      body.addColorStop(0, "#a0b38f");
      body.addColorStop(0.4, "#748d6a");
      body.addColorStop(1, "#3f5944");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(305, 395);
      ctx.bezierCurveTo(320, 275, 570, 258, 695, 310);
      ctx.bezierCurveTo(785, 340, 765, 444, 650, 459);
      ctx.bezierCurveTo(470, 482, 305, 463, 305, 395);
      ctx.fill();
      ctx.fillStyle = "#173a39";
      ctx.beginPath();
      ctx.moveTo(331, 379);
      ctx.bezierCurveTo(351, 320, 442, 295, 510, 302);
      ctx.lineTo(500, 394);
      ctx.lineTo(335, 394);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#2d514b";
      ctx.beginPath();
      ctx.moveTo(531, 306);
      ctx.lineTo(600, 313);
      ctx.lineTo(622, 393);
      ctx.lineTo(520, 393);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#b6c6ae";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(525, 410);
      ctx.lineTo(665, 410);
      ctx.stroke();
      ctx.fillStyle = "#394c3d";
      ctx.fillRect(558, 217, 24, 92);
      ctx.fillStyle = "#5f775c";
      ctx.fillRect(515, 261, 113, 48);
      ctx.save();
      ctx.translate(571, 210);
      ctx.scale(1, 0.14);
      ctx.rotate(t * 4);
      ctx.fillStyle = "#34483e";
      ctx.fillRect(-390, -15, 780, 30);
      ctx.fillRect(-15, -330, 30, 660);
      ctx.restore();
      ctx.fillStyle = "#1e3527";
      ctx.beginPath();
      ctx.ellipse(571, 209, 32, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(g.tailX, g.tailY);
      ctx.rotate(t * 6);
      ctx.fillStyle = "#e5f3bd";
      ctx.fillRect(-77, -8, 154, 16);
      ctx.fillRect(-8, -77, 16, 154);
      ctx.fillStyle = "#324b33";
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#344b3d";
      ctx.font = "600 16px Arial";
      ctx.fillText("ORIGINAL ILLUSTRATIVE FOOTAGE", 72 - g.x, 643 - g.y);
      ctx.font = "15px Arial";
      ctx.fillText("Side view / simplified geometry", 72 - g.x, 669 - g.y);
      ctx.restore();
      if (failure) throw failure;
      if (!encoder.stdin!.write(canvas.toBuffer("image/png")))
        await once(encoder.stdin!, "drain");
    }
    encoder.stdin!.end();
    await complete;
    await command("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      path.join(sampleDir, "video.mp4"),
      "-frames:v",
      "1",
      path.join(sampleDir, "poster.jpg"),
    ]);
  } finally {
    if (encoder.exitCode === null) encoder.kill("SIGTERM");
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  ensureSample()
    .then(() =>
      console.log("Original sample footage and FAA source are ready."),
    )
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
