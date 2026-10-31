import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { SourcePage } from "../shared/project";
const children = new Set<ReturnType<typeof spawn>>();
export function stopChildren() {
  for (const child of children) child.kill("SIGTERM");
}
export async function command(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    let out = "",
      err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 180_000);
    child.stdout.on("data", (d) => {
      out = (out + d.toString()).slice(-2_000_000);
    });
    child.stderr.on("data", (d) => {
      err = (err + d.toString()).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      children.delete(child);
      code === 0
        ? resolve(out)
        : reject(
            new Error(
              `${bin} could not process this media. ${err.slice(-300)}`,
            ),
          );
    });
  });
}
export async function probe(file: string) {
  const info = JSON.parse(
    await command("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file,
    ]),
  );
  const v = info.streams.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  const duration = Number(v?.duration ?? info.format?.duration);
  if (!v || !Number.isFinite(duration) || duration < 5 || duration > 120)
    throw new Error("Use a video between 5 and 120 seconds.");
  return {
    width: Number(v.width),
    height: Number(v.height),
    duration,
    fps: 30,
  };
}
export async function normalizeVideo(input: string, dir: string) {
  await probe(input);
  const file = path.join(dir, "video.mp4");
  await command("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    "fps=30,scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    file,
  ]);
  const meta = await probe(file);
  await command("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    "scale=480:-2",
    path.join(dir, "poster.jpg"),
  ]);
  return meta;
}
export async function readPdf(file: string): Promise<SourcePage[]> {
  const bytes = await fs.readFile(file);
  if (
    bytes.length > 20 * 1024 * 1024 ||
    !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))
  )
    throw new Error("Use a PDF smaller than 20 MB.");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const doc = await task.promise;
  try {
    if (doc.numPages > 80)
      throw new Error("Use a source PDF with 80 pages or fewer.");
    const pages: SourcePage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const text = await page.getTextContent();
      pages.push({
        number: i,
        text: text.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      });
      page.cleanup();
    }
    if (pages.reduce((n, p) => n + p.text.length, 0) < 80)
      throw new Error(
        "This PDF has no readable text. Use a text PDF; OCR is not supported in this version.",
      );
    if (pages.reduce((n, p) => n + p.text.length, 0) > 250_000)
      throw new Error("The source is too long. Upload a shorter PDF excerpt.");
    return pages;
  } finally {
    await task.destroy();
  }
}
export function trackedSpawn(bin: string, args: string[]) {
  const child = spawn(bin, args, { stdio: ["pipe", "ignore", "pipe"] });
  children.add(child);
  child.once("close", () => children.delete(child));
  return child;
}
