import { z } from "zod";

export const beatInput = z.object({
  id: z.string().regex(/^beat-[1-4]$/),
  heading: z.string().trim().min(1).max(70),
  caption: z.string().trim().min(1).max(180),
  sourceStart: z.number().finite().min(0),
  duration: z.number().finite().min(5).max(10),
  target: z.string().trim().min(1).max(80),
  citation: z.object({
    page: z.number().int().positive(),
    quote: z.string().trim().min(12).max(650),
  }),
});
export type BeatInput = z.infer<typeof beatInput>;
export interface Observation {
  frame: number;
  objectId: string;
  box: [number, number, number, number];
  mask?: string;
  confidence?: number;
}
export interface Track {
  id: string;
  provider: "sam-3.1" | "sample" | "manual";
  target: string;
  selectedObject: string | null;
  observations: Observation[];
  reviewedSignature?: string;
}
export interface Beat extends BeatInput {
  reviewSignature?: string;
  track?: Track;
}
export interface SourcePage {
  number: number;
  text: string;
}
export interface Project {
  id: string;
  title: string;
  question: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  sample: boolean;
  example?: boolean;
  video: {
    name: string;
    width: number;
    height: number;
    duration: number;
    fps: number;
  };
  source: { name: string; pages: SourcePage[]; url?: string };
  beats: Beat[];
  job: {
    kind: "storyboard" | "tracking" | "render";
    startedAt?: string;
    status: "running" | "failed" | "completed";
    progress: number;
    message: string;
  } | null;
  export: {
    filename: string;
    revision: number;
    duration: number;
    bytes: number;
    sha256?: string;
    createdAt: string;
  } | null;
  events: { at: string; type: string; detail: string }[];
}
export const editInput = z.object({
  revision: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(90),
  question: z.string().trim().min(1).max(500),
  beats: z
    .array(
      beatInput.extend({
        heading: z.string().trim().max(70),
        caption: z.string().trim().max(180),
        target: z.string().trim().max(80),
        citation: z.object({
          page: z.number().int().positive(),
          quote: z.string().trim().max(650),
        }),
      }),
    )
    .length(4),
});
export const normalized = (s: string) =>
  s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
export const evidenceExists = (p: Project, b: BeatInput) => {
  const text = p.source.pages.find(
    (page) => page.number === b.citation.page,
  )?.text;
  return Boolean(
    text &&
    normalized(b.citation.quote).length >= 12 &&
    normalized(text).includes(normalized(b.citation.quote)),
  );
};
export function observationAt(
  track: Track | undefined,
  seconds: number,
  fps: number,
): Observation | undefined {
  if (!track || track.selectedObject === null) return;
  const frame = Math.floor(seconds * fps + 0.001);
  const observations = track.observations.filter(
    (o) => o.objectId === track.selectedObject,
  );
  // Missing SAM frames mean no visible object. Never carry a mask through an occlusion.
  if (track.provider !== "manual")
    return observations.find((o) => o.frame === frame);
  return observations[0];
}
export function issueList(
  p: Project,
  reviewed: (b: Beat) => boolean,
  trackReviewed: (b: Beat) => boolean,
): string[] {
  const issues: string[] = [];
  if (p.beats.length !== 4 || new Set(p.beats.map((b) => b.id)).size !== 4)
    issues.push("The story needs four distinct beats.");
  const total = p.beats.reduce((n, b) => n + b.duration, 0);
  if (total < 20 || total > 40) issues.push("The film must be 20–40 seconds.");
  for (const [i, beat] of p.beats.entries()) {
    const name = `Beat ${i + 1}`;
    if (!beatInput.safeParse(beat).success)
      issues.push(`${name}: complete the caption, target, and citation.`);
    if (beat.sourceStart + beat.duration > p.video.duration + 0.02)
      issues.push(`${name}: source range exceeds the footage.`);
    if (!evidenceExists(p, beat))
      issues.push(`${name}: the quote must occur on the cited PDF page.`);
    if (!reviewed(beat))
      issues.push(`${name}: review the claim against the source.`);
    if (!trackReviewed(beat))
      issues.push(`${name}: choose and review a highlight region.`);
  }
  return issues;
}
