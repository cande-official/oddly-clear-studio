import { promises as fs } from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
const id = (
  await fs.readFile(".local/verification/live-project-id.txt", "utf8")
).trim();
const dir = path.resolve(".local/data", id),
  p = JSON.parse(await fs.readFile(path.join(dir, "project.json"), "utf8"));
p.example = true;
p.events = [
  {
    at: new Date().toISOString(),
    type: "verified_example",
    detail:
      "Recorded real Muse Spark / SAM outputs on original illustrative footage. Opening this example makes no model request. Claims were reviewed during product QA, not by this visitor.",
  },
];
p.source.name = "FAA Helicopter Flying Handbook — Chapter 2.pdf";
p.video.name = "Original helicopter illustration.mp4";
const names = new Set([
  "video.mp4",
  "source.pdf",
  "poster.jpg",
  p.export.filename,
  ...p.beats.flatMap((b: any) => b.track.observations.map((o: any) => o.mask)),
]);
const files: Record<string, Uint8Array> = {
  "project.json": new TextEncoder().encode(JSON.stringify(p)),
};
for (const name of names as Set<string>)
  files[name] = new Uint8Array(await fs.readFile(path.join(dir, name)));
await fs.mkdir("assets", { recursive: true });
const data = zipSync(files, { level: 6 });
await fs.writeFile("assets/verified-example.zip", data);
console.log(
  JSON.stringify({
    files: names.size + 1,
    bytes: data.length,
    noCredentialsIncluded: true,
  }),
);
