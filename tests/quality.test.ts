import { test } from "node:test";
import assert from "node:assert/strict";
import {
  issueList,
  evidenceExists,
  observationAt,
  type Beat,
  type Project,
} from "../shared/project";
import {
  claimSignature,
  claimReviewed,
  trackSignature,
  trackReviewed,
} from "../server/store";
import { segmentationPrompt, sseEvents } from "../server/meta";
import { textLines } from "../shared/composition";
import { createCanvas } from "@napi-rs/canvas";
function fixture(): Project {
  const beat: Beat = {
    id: "beat-1",
    heading: "Reaction",
    caption: "The body turns in the opposite direction.",
    duration: 7,
    sourceStart: 0,
    target: "rotor",
    citation: { page: 2, quote: "The body tends to rotate clockwise." },
    track: {
      id: "track-a",
      provider: "sam-3.1",
      target: "rotor",
      selectedObject: "7",
      observations: [
        { frame: 0, objectId: "7", box: [0.2, 0.2, 0.3, 0.3] },
        { frame: 2, objectId: "7", box: [0.21, 0.2, 0.3, 0.3] },
      ],
    },
  };
  const beats = Array.from({ length: 4 }, (_, i) => {
    const b = structuredClone(beat);
    b.id = `beat-${i + 1}`;
    b.reviewSignature = claimSignature(b);
    b.track!.reviewedSignature = trackSignature(b);
    return b;
  });
  return {
    id: "fixture",
    title: "A mechanism",
    question: "Why does it move?",
    revision: 0,
    sample: false,
    createdAt: "",
    updatedAt: "",
    video: {
      name: "clip.mp4",
      duration: 28,
      width: 1280,
      height: 720,
      fps: 30,
    },
    source: {
      name: "source.pdf",
      pages: [
        { number: 1, text: "This is another page." },
        {
          number: 2,
          text: "The body tends to rotate clockwise. Another sentence.",
        },
      ],
    },
    beats,
    job: null,
    export: null,
    events: [],
  };
}
test("a quote on a different page does not count as evidence", () => {
  const p = fixture();
  assert.equal(evidenceExists(p, p.beats[0]), true);
  p.beats[0].citation.page = 1;
  assert.equal(evidenceExists(p, p.beats[0]), false);
});
test("claim editing invalidates approval even when a quote still exists", () => {
  const p = fixture();
  assert.equal(claimReviewed(p.beats[0]), true);
  p.beats[0].caption = "The body never turns.";
  assert.equal(claimReviewed(p.beats[0]), false);
  assert(
    issueList(p, claimReviewed, trackReviewed).some((i) =>
      i.includes("review the claim"),
    ),
  );
});
test("changing the selected object or source range invalidates highlight approval", () => {
  const p = fixture(),
    b = p.beats[0];
  assert.equal(trackReviewed(b), true);
  b.sourceStart = 1;
  assert.equal(trackReviewed(b), false);
  b.track!.reviewedSignature = trackSignature(b);
  b.track!.selectedObject = "9";
  assert.equal(trackReviewed(b), false);
});
test("absent SAM frames remain absent rather than carrying a region across occlusion", () => {
  const b = fixture().beats[0];
  assert.equal(observationAt(b.track, 0, 30)?.objectId, "7");
  assert.equal(observationAt(b.track, 1 / 30, 30), undefined);
  assert.equal(observationAt(b.track, 2 / 30, 30)?.frame, 2);
});
test("export rejects unreviewed claims, repeated beat IDs, and invalid footage ranges", () => {
  const p = fixture();
  assert.deepEqual(issueList(p, claimReviewed, trackReviewed), []);
  p.beats[3].reviewSignature = undefined;
  p.beats[1].id = "beat-1";
  p.beats[2].sourceStart = 26;
  const issues = issueList(p, claimReviewed, trackReviewed);
  assert(issues.some((i) => i.includes("four distinct")));
  assert(issues.some((i) => i.includes("exceeds")));
  assert(issues.some((i) => i.includes("review the claim")));
});
test("SSE data split across chunks and CRLF boundaries is assembled once", async () => {
  const chunks = [
    'data: {"type":"response.output_',
    'text.delta","delta":"abc"}\r',
    '\n\r\ndata: {"type":"response.completed"}\n\n',
  ];
  const stream = new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
      c.close();
    },
  });
  const events = [];
  for await (const e of sseEvents(new Response(stream))) events.push(e);
  assert.deepEqual(events, [
    { type: "response.output_text.delta", delta: "abc" },
    { type: "response.completed" },
  ]);
});
test("long captions retain all characters and stay inside the video text area", () => {
  const ctx = createCanvas(1080, 1920).getContext("2d");
  ctx.font = "600 54px Arial";
  const text = "A very long label " + "W".repeat(120) + " finishes here.";
  const lines = textLines(
    ctx as unknown as CanvasRenderingContext2D,
    text,
    950,
  );
  assert.equal(lines.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
  assert(lines.every((line) => ctx.measureText(line).width <= 950));
});

test("a drawn SAM seed keeps its source frame and converts to inclusive media pixels", () => {
  const p = fixture();
  const prompt = segmentationPrompt(p, "tail rotor", {
    frame: 210,
    box: [0.75, 0.25, 0.125, 0.25],
  });
  assert.equal(
    prompt,
    "<210f>0<|box;x1=960;y1=180;x2=1119;y2=359;w=1280;h=720|>",
  );
  assert.throws(
    () =>
      segmentationPrompt(p, "tail rotor", {
        frame: 840,
        box: [0.75, 0.25, 0.125, 0.25],
      }),
    /outside this clip/,
  );
});

test("hosted reservations cover maximum Spark context/output and SAM minimum frames", async () => {
  const { reservationUsd } = await import("../server/cloud");
  assert(
    reservationUsd("muse-spark-1.3", 0) >= (1048576 * 1.25 + 8000 * 4.25) / 1e6,
  );
  assert.equal(reservationUsd("sam-3.1", 1), 0.01);
  assert.equal(reservationUsd("sam-3.1", 840), 0.168);
});
