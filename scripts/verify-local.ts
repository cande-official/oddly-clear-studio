import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import type { Project } from "../shared/project";
import { makeSampleBeats } from "../server/sample";
import { projectDir } from "../server/store";
const base = "http://127.0.0.1:4317";
const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  scope: "Local HTTP + actual upload/PDF extraction. No live model calls.",
};
let testProjectId: string | undefined;
const body = (p: Project) => ({
  revision: p.revision,
  title: p.title,
  question: p.question,
  beats: p.beats.map(
    ({ id, heading, caption, sourceStart, duration, target, citation }) => ({
      id,
      heading,
      caption,
      sourceStart,
      duration,
      target,
      citation,
    }),
  ),
});
async function request(url: string, data?: unknown, method = "POST") {
  const r = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: r.status, data: await r.json() };
}
try {
  assert.equal((await fetch(base + "/api/health")).status, 200);
  const form = new FormData();
  form.set("question", "Why does the tail rotor matter?");
  form.set("rights", "true");
  form.set(
    "video",
    new Blob([await fs.readFile(".local/sample/video.mp4")], {
      type: "video/mp4",
    }),
    "uploaded-helicopter.mp4",
  );
  form.set(
    "pdf",
    new Blob([await fs.readFile(".local/sample/source.pdf")], {
      type: "application/pdf",
    }),
    "FAA-source.pdf",
  );
  const uploaded = await fetch(base + "/api/projects", {
    method: "POST",
    body: form,
  });
  let p: Project = await uploaded.json();
  assert.equal(uploaded.status, 201, JSON.stringify(p));
  testProjectId = p.id;
  assert.equal(p.sample, false);
  assert.equal(p.source.pages.length, 28);
  assert.equal(p.video.fps, 30);
  assert(p.source.pages[14].text.includes("antitorque pedals"));
  evidence.upload = {
    projectId: p.id,
    pages: p.source.pages.length,
    fps: p.video.fps,
    actualTextVerified: true,
  };
  const url = `/api/projects/${p.id}`;
  const gated = await request(url + "/render", { revision: p.revision });
  assert.equal(gated.status, 422);
  evidence.emptyDraftBlocked = true;
  p.beats = makeSampleBeats();
  const saved = await request(url, { ...body(p), beats: p.beats }, "PATCH");
  assert.equal(saved.status, 200);
  p = saved.data;
  assert(p.beats.every((b) => !b.track && !b.reviewSignature));
  evidence.clientCannotInjectReviewOrTrack = true;
  const reviewed = await request(url + "/review/beat-1", {
    revision: p.revision,
    kind: "claim",
  });
  assert.equal(reviewed.status, 200);
  p = reviewed.data;
  assert(reviewed.data.checks[0].claim);
  p.beats[0].caption += " Edited.";
  const edited = await request(url, body(p), "PATCH");
  assert.equal(edited.status, 200);
  p = edited.data;
  assert.equal(edited.data.checks[0].claim, false);
  evidence.editInvalidatesClaim = true;
  p.beats[0].citation.quote =
    "This exact quote is deliberately absent from the source document.";
  const badQuote = await request(url, body(p), "PATCH");
  assert.equal(badQuote.status, 200);
  p = badQuote.data;
  const invalid = await request(url + "/review/beat-1", {
    revision: p.revision,
    kind: "claim",
  });
  assert.equal(invalid.status, 422);
  evidence.fabricatedQuoteBlocked = true;
  const stale = await request(url, { ...body(p), revision: 0 }, "PATCH");
  assert.equal(stale.status, 409);
  evidence.staleRevisionBlocked = true;
  const badRange = body(p);
  badRange.beats[2].sourceStart = 1000;
  assert.equal((await request(url, badRange, "PATCH")).status, 422);
  evidence.invalidSourceRangeBlocked = true;
  const region = await request(url + "/region/beat-3", {
    revision: p.revision,
    box: [0.7, 0.25, 0.15, 0.3],
  });
  assert.equal(region.status, 200);
  p = region.data;
  const regionReviewed = await request(url + "/review/beat-3", {
    revision: p.revision,
    kind: "track",
  });
  assert.equal(regionReviewed.status, 200);
  p = regionReviewed.data;
  assert.equal(regionReviewed.data.checks[2].track, true);
  evidence.manualRegionAtNonzeroSourceTime = true;
  const config = await (await fetch(base + "/api/config")).json();
  if (!config.ready) {
    assert.equal(
      (await request(url + "/storyboard", { revision: p.revision })).status,
      503,
    );
    evidence.unconfiguredModelBlocked = true;
  }
  const range = await fetch(base + url + "/media/video.mp4", {
    headers: { Range: "bytes=0-1023" },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 1024);
  evidence.videoRangeRequests = true;
  const source = await fetch(base + url + "/media/source.pdf");
  assert.equal(source.status, 200);
  assert.equal(source.headers.get("content-type"), "application/pdf");
  evidence.pdfDelivery = true;
  const fresh = await (await fetch(base + url)).json();
  assert.equal(fresh.revision, p.revision);
  evidence.savedProjectRestored = true;
  evidence.completedAt = new Date().toISOString();
  evidence.passed = true;
} catch (error) {
  evidence.passed = false;
  evidence.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
}
if (testProjectId && evidence.passed) {
  await fs.rm(projectDir(testProjectId), { recursive: true });
  evidence.disposableUploadRemoved = true;
}
await fs.mkdir(".local/verification", { recursive: true });
await fs.writeFile(
  ".local/verification/http-flow.json",
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
