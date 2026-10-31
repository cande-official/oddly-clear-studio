import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { paintFrame, WIDTH, HEIGHT, FPS } from "../shared/composition";
import { observationAt, type Project } from "../shared/project";
import { command, trackedSpawn } from "./media";
import { projectDir } from "./store";

export async function render(
  p: Project,
  progress: (value: number) => Promise<void>,
) {
  const dir = projectDir(p.id),
    temp = path.join(dir, "render-frames");
  await fs.rm(temp, { recursive: true, force: true });
  await fs.mkdir(temp, { recursive: true });
  const filename = `film-r${p.revision}.mp4`,
    pending = path.join(dir, "pending.mp4");
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
    String(FPS),
    "-i",
    "pipe:0",
    "-an",
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
    pending,
  ]);
  let encoderError = "";
  encoder.stderr!.on("data", (d) => {
    encoderError = (encoderError + d).slice(-1000);
  });
  let failed: Error | undefined;
  encoder.once("error", (e) => {
    failed = e;
  });
  encoder.stdin!.on("error", (e) => {
    failed = e;
  });
  const completion = new Promise<void>((resolve, reject) =>
    encoder.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`Video encoding failed. ${encoderError.slice(-200)}`),
          ),
    ),
  );
  // Attach a handler immediately: the encoder may exit before composition has finished.
  completion.catch(() => {});
  const canvas = createCanvas(WIDTH, HEIGHT),
    ctx = canvas.getContext("2d");
  const total = Math.round(p.beats.reduce((n, b) => n + b.duration, 0) * FPS);
  let count = 0;
  try {
    for (const [index, beat] of p.beats.entries()) {
      const countFrames = Math.round(beat.duration * FPS);
      await command("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(beat.sourceStart),
        "-i",
        path.join(dir, "video.mp4"),
        "-frames:v",
        String(countFrames),
        "-vf",
        "fps=30,scale=960:960:force_original_aspect_ratio=decrease",
        "-q:v",
        "3",
        path.join(temp, "%05d.jpg"),
      ]);
      for (let f = 0; f < countFrames; f++) {
        if (failed || encoder.exitCode !== null)
          throw failed || new Error("The video encoder stopped.");
        const image = await loadImage(
          path.join(temp, `${String(f + 1).padStart(5, "0")}.jpg`),
        );
        const sourceTime = beat.sourceStart + f / FPS;
        const o = observationAt(beat.track, sourceTime, p.video.fps);
        const mask = o?.mask
          ? await loadImage(path.join(dir, o.mask))
          : undefined;
        paintFrame(
          ctx as unknown as CanvasRenderingContext2D,
          p,
          beat,
          index,
          sourceTime,
          image as unknown as CanvasImageSource,
          mask as unknown as CanvasImageSource,
        );
        if (!encoder.stdin!.write(canvas.toBuffer("image/png")))
          await once(encoder.stdin!, "drain");
        count++;
        if (count % 30 === 0)
          await progress(Math.round(5 + (count / total) * 87));
      }
      await fs.rm(temp, { recursive: true, force: true });
      await fs.mkdir(temp, { recursive: true });
    }
    encoder.stdin!.end();
    await completion;
    // Decode the WHOLE output before making the download available.
    await command("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-i",
      pending,
      "-f",
      "null",
      "-",
    ]);
    const info = JSON.parse(
      await command("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,nb_frames:format=duration",
        "-of",
        "json",
        pending,
      ]),
    );
    if (
      info.streams[0]?.width !== WIDTH ||
      info.streams[0]?.height !== HEIGHT ||
      Number(info.streams[0]?.nb_frames) !== total
    )
      throw new Error(
        "The exported film has an unexpected size or frame count.",
      );
    await fs.rename(pending, path.join(dir, filename));
    const stat = await fs.stat(path.join(dir, filename));
    return {
      filename,
      revision: p.revision,
      duration: total / FPS,
      bytes: stat.size,
      sha256: createHash("sha256")
        .update(await fs.readFile(path.join(dir, filename)))
        .digest("hex"),
      createdAt: new Date().toISOString(),
    };
  } finally {
    if (encoder.exitCode === null) {
      encoder.kill("SIGTERM");
      await completion.catch(() => {});
    }
    await fs.rm(temp, { recursive: true, force: true });
    await fs.rm(pending, { force: true });
  }
}
