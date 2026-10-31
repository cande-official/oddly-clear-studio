import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { geometry } from "../scripts/create-sample";
import {
  projectDir,
  save,
  event,
  claimSignature,
  trackSignature,
} from "./store";
import { unzipSync } from "fflate";
import { hosted, newProjectQuota, publishAssets } from "./cloud";
import type { Project, Beat } from "../shared/project";
export async function sampleProject(): Promise<Project> {
  if (hosted) {
    await newProjectQuota();
    const files = unzipSync(
      new Uint8Array(await fs.readFile("assets/verified-example.zip")),
    );
    const p = JSON.parse(
      new TextDecoder().decode(files["project.json"]),
    ) as Project;
    p.id = randomUUID();
    p.createdAt = p.updatedAt = new Date().toISOString();
    p.events = [];
    await fs.mkdir(projectDir(p.id), { recursive: true });
    for (const [name, data] of Object.entries(files))
      if (name !== "project.json")
        await fs.writeFile(path.join(projectDir(p.id), name), data);
    event(
      p,
      "verified_example_opened",
      "Recorded real Spark/SAM results copied to this private browser session. No new model request. QA reviews are from the example, not this visitor.",
    );
    await publishAssets(p, projectDir(p.id));
    await save(p);
    return p;
  }
  const sampleDir = path.resolve(".local/sample");
  try {
    await fs.access(path.join(sampleDir, "video.mp4"));
  } catch {
    throw new Error(
      "Run npm run sample:assets once to prepare the sample footage and source.",
    );
  }
  const id = randomUUID(),
    dir = projectDir(id);
  await fs.mkdir(dir, { recursive: true });
  for (const name of ["video.mp4", "source.pdf", "poster.jpg"])
    await fs.copyFile(path.join(sampleDir, name), path.join(dir, name));
  const beats = makeSampleBeats();
  const p: Project = {
    id,
    title: "Why the tiny tail rotor?",
    question: "Why does a helicopter need a tail rotor?",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 0,
    sample: true,
    video: {
      name: "helicopter-study.mp4",
      width: 1280,
      height: 720,
      duration: 28,
      fps: 30,
    },
    source: {
      name: "FAA · Aerodynamics of Flight.pdf",
      pages: JSON.parse(
        await fs.readFile(path.join(sampleDir, "pages.json"), "utf8"),
      ),
      url: "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/helicopter_flying_handbook",
    },
    beats,
    job: null,
    export: null,
    events: [],
  };
  event(
    p,
    "sample_created",
    "Original procedural animation with fixture regions; no AI generation or SAM call. The fourth claim still needs review.",
  );
  await save(p);
  return p;
}
export function makeSampleBeats(): Beat[] {
  const captions = [
    [
      "The reaction",
      "The engine turns the main rotor. The fuselage tends to turn the other way.",
      "main rotor",
      "as the engine turns the main rotor disk in a counterclockwise direction, the helicopter fuselage wants to turn clockwise.",
    ],
    [
      "The counterforce",
      "The tail rotor counters that turning tendency.",
      "tail rotor",
      "To counteract this torque-induced turning tendency, an antitorque rotor or tail rotor is incorporated into most helicopter designs.",
    ],
    [
      "Power changes",
      "More engine power means more torque to counter.",
      "main rotor",
      "The amount of torque is directly related to the amount of engine power being used to turn the main rotor disk.",
    ],
    [
      "The control",
      "Antitorque pedals let the pilot vary tail-rotor thrust.",
      "tail rotor",
      "This control change is accomplished through the use of antitorque pedals",
    ],
  ];
  return captions.map(([heading, caption, target, quote], i) => {
    const observations = Array.from({ length: 840 }, (_, frame) => {
      const g = geometry(frame / 30);
      return {
        frame,
        objectId: "0",
        box: (target === "tail rotor"
          ? [
              (g.tailX - 82 + g.x) / 1280,
              (g.tailY - 82 + g.y) / 720,
              164 / 1280,
              164 / 720,
            ]
          : [(176 + g.x) / 1280, (158 + g.y) / 720, 790 / 1280, 105 / 720]) as [
          number,
          number,
          number,
          number,
        ],
      };
    });
    const beat: Beat = {
      id: `beat-${i + 1}`,
      heading,
      caption,
      target,
      sourceStart: i * 7,
      duration: 7,
      citation: { page: 15, quote },
      track: {
        id: randomUUID(),
        provider: "sample",
        target,
        selectedObject: "0",
        observations,
      },
    };
    if (i < 3) beat.reviewSignature = claimSignature(beat);
    beat.track!.reviewedSignature = trackSignature(beat);
    return beat;
  });
}
