import express from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import { createServer as createViteServer } from "vite";
import path from "node:path";
import os from "node:os";
import { handleUpload } from "@vercel/blob/client";
import {
  hosted,
  sessions,
  session,
  fingerprint,
  newSession,
  readObject,
  writeObject,
  changeCounter,
  newProjectQuota,
  modelAllowance,
  acquireLease,
  publishAssets,
  incomingFile,
  deleteBlob,
  type StoredProject,
} from "./cloud";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  editInput,
  evidenceExists,
  issueList,
  type Project,
  type Beat,
} from "../shared/project";
import {
  busy,
  listProjectIds,
  claimReviewed,
  claimSignature,
  event,
  exclusive,
  load,
  projectDir,
  root,
  save,
  trackReviewed,
  trackSignature,
} from "./store";
import { normalizeVideo, readPdf, stopChildren } from "./media";
import { metaConfig, segment, storyboard } from "./meta";
import { render } from "./render";
import { sampleProject } from "./sample";

const app = express();
const port = Number(process.env.PORT || 4317);
await fs.mkdir(root, { recursive: true });
const uploads = hosted
  ? path.join(os.tmpdir(), "oddly-clear-uploads")
  : path.resolve(".local/uploads");
await fs.mkdir(uploads, { recursive: true });
// Recover interrupted tasks as failed; never silently rerun a paid model request.
for (const id of hosted ? [] : await fs.readdir(root)) {
  try {
    const p = await load(id);
    if (p.job?.status === "running") {
      p.job.status = "failed";
      p.job.message =
        "The application stopped during processing. You can retry.";
      await save(p);
    }
  } catch {
    /* unrelated temp files */
  }
}
app.disable("x-powered-by");
app.use((req, res, next) => {
  const allowed = hosted
    ? [
        process.env.VERCEL_URL,
        process.env.VERCEL_PROJECT_PRODUCTION_URL,
        new URL(
          process.env.PUBLIC_ORIGIN || "https://oddly-clear-studio.vercel.app",
        ).host,
      ].filter(Boolean)
    : [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowed.includes(req.headers.host || ""))
    return res
      .status(403)
      .json({ error: "This host is not configured for this studio." });
  const origins = allowed.map((h) => `${hosted ? "https" : "http"}://${h}`);
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    !origins.includes(req.headers.origin)
  )
    return res
      .status(403)
      .json({ error: "Cross-origin writes are not allowed." });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (!hosted) return next();
  let token = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("ocs_session="))
    ?.slice(12);
  if (!token || !/^([a-f0-9]{64})$/.test(token)) {
    token = newSession();
    res.cookie("ocs_session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 7 * 86400000,
      path: "/",
    });
  }
  sessions.run(fingerprint(token), next);
});
app.use("/api", express.json({ limit: "1mb" }));
const upload = multer({
  dest: uploads,
  limits: { fileSize: 200 * 1024 * 1024, files: 2, fields: 5 },
});
const statusError = (message: string, status = 422) =>
  Object.assign(new Error(message), { status });
const view = (p: Project) => ({
  ...p,
  _assets: undefined,
  checks: p.beats.map((b) => ({
    id: b.id,
    claim: claimReviewed(b),
    track: trackReviewed(b),
  })),
  validation: issueList(p, claimReviewed, trackReviewed),
});
const checkRevision = (p: Project, revision: unknown) => {
  if (p.revision !== revision)
    throw statusError("This project changed. Refresh before saving.", 409);
};
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/config", async (_req, res) => {
  const config = await metaConfig();
  const allowance = await modelAllowance();
  res.json({
    hosted,
    liveRemainingUsd: allowance.remainingUsd,
    uploadPrefix: hosted ? `incoming/${session()}/` : undefined,
    keyPresent: Boolean(config.key),
    enabled: config.enabled,
    ready: Boolean(
      config.key &&
      config.enabled &&
      (allowance.remainingUsd === null || allowance.remainingUsd >= 0.01),
    ),
  });
});
app.get("/api/projects", async (_req, res) => {
  const list = [];
  for (const id of await listProjectIds()) {
    try {
      const p = await load(id);
      list.push({
        id,
        title: p.title,
        sample: p.sample,
        updatedAt: p.updatedAt,
      });
    } catch {
      /* skip non-project */
    }
  }
  res.json(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});
app.post("/api/uploads/prepare", async (_req, res) => {
  if (!hosted) throw statusError("Hosted uploads are unavailable here.", 404);
  await newProjectQuota();
  const ticket = newSession().slice(0, 32);
  await writeObject(`uploads/${session()}/${ticket}.json`, {
    used: false,
    expires: Date.now() + 600000,
    issued: { video: false, pdf: false },
  });
  res.json({ ticket });
});
app.post("/api/blob-upload", async (req, res) => {
  if (!hosted) throw statusError("Hosted uploads are unavailable here.", 404);
  const result = await handleUpload({
    request: req,
    body: req.body,
    onBeforeGenerateToken: async (pathname) => {
      const match = pathname.match(
        /^incoming\/([a-f0-9]{64})\/([a-f0-9]{32})-(video\.mp4|source\.pdf)$/,
      );
      if (!match || match[1] !== session())
        throw statusError("Upload does not belong to this session.", 403);
      const kind = match[3] === "video.mp4" ? "video" : "pdf";
      await changeCounter(
        `uploads/${session()}/${match[2]}.json`,
        { used: true, expires: 0, issued: { video: true, pdf: true } },
        (v) => {
          if (v.used || v.expires < Date.now() || v.issued[kind])
            throw statusError(
              "This upload ticket has expired or was already used.",
              409,
            );
          return { ...v, issued: { ...v.issued, [kind]: true } };
        },
      );
      return {
        allowedContentTypes:
          kind === "video"
            ? ["video/mp4", "video/quicktime", "video/webm"]
            : ["application/pdf"],
        maximumSizeInBytes: (kind === "video" ? 5 : 16) * 1024 * 1024,
        validUntil: Date.now() + 600000,
        addRandomSuffix: false,
        allowOverwrite: false,
      };
    },
    onUploadCompleted: async () => {},
  });
  res.json(result);
});
app.post("/api/projects/sample", async (_req, res) =>
  res.status(201).json(view(await sampleProject())),
);
app.post(
  "/api/projects",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "pdf", maxCount: 1 },
  ]),
  async (req, res) => {
    let files = req.files as Record<string, Express.Multer.File[]> | undefined;
    let incoming = Object.values(files || {}).flat();
    let remoteIncoming: string[] = [];
    let dir: string | undefined;
    try {
      if (hosted) {
        if (!req.is("application/json"))
          throw statusError("Use the hosted upload flow.");
        const ticket = z
          .string()
          .regex(/^[a-f0-9]{32}$/)
          .parse(req.body.ticket);
        await changeCounter(
          `uploads/${session()}/${ticket}.json`,
          { used: true, expires: 0, issued: { video: false, pdf: false } },
          (v) => {
            if (
              v.used ||
              v.expires < Date.now() ||
              !v.issued.video ||
              !v.issued.pdf
            )
              throw statusError("Upload ticket is unavailable.", 409);
            return { ...v, used: true };
          },
        );
        files = {};
        for (const [field, name] of [
          ["video", "video.mp4"],
          ["pdf", "source.pdf"],
        ]) {
          const remote = `incoming/${session()}/${ticket}-${name}`;
          remoteIncoming.push(remote);
          const data = await incomingFile(remote);
          if (data.length > (field === "video" ? 5 : 16) * 1024 * 1024)
            throw statusError("Upload exceeds the public demo limit.");
          const filename = path.join(uploads, randomUUID());
          await fs.writeFile(filename, data);
          const f = {
            path: filename,
            originalname:
              field === "video" ? "Uploaded clip.mp4" : "Uploaded source.pdf",
          } as Express.Multer.File;
          incoming.push(f);
          files[field] = [f];
        }
      }
      const question = z
        .string()
        .trim()
        .min(5)
        .max(500)
        .parse(req.body.question);
      if (req.body.rights !== "true")
        throw statusError("Confirm that you can use this footage and PDF.");
      if (!files?.video?.[0] || !files?.pdf?.[0])
        throw statusError("Choose one video and one PDF.");
      const id = randomUUID();
      dir = projectDir(id);
      await fs.mkdir(dir, { recursive: true });
      const pages = await readPdf(files.pdf[0].path);
      await fs.copyFile(files.pdf[0].path, path.join(dir, "source.pdf"));
      const video = await normalizeVideo(files.video[0].path, dir);
      if (hosted && video.duration > 30.05)
        throw statusError(
          "The public demo accepts clips up to 30 seconds. Use the local studio for longer footage.",
        );
      const now = new Date().toISOString();
      const p: Project = {
        id,
        title: question.slice(0, 90),
        question,
        createdAt: now,
        updatedAt: now,
        revision: 0,
        sample: false,
        video: { ...video, name: files.video[0].originalname.slice(0, 120) },
        source: { name: files.pdf[0].originalname.slice(0, 120), pages },
        beats: Array.from({ length: 4 }, (_, i) => ({
          id: `beat-${i + 1}`,
          heading: "",
          caption: "",
          target: "",
          sourceStart: 0,
          duration: Math.min(7, video.duration),
          citation: { page: pages[0].number, quote: "" },
        })),
        job: null,
        export: null,
        events: [],
      };
      event(
        p,
        "project_created",
        "Video normalized to 30 fps; PDF text extracted locally. No media sent to Meta.",
      );
      await publishAssets(p, dir);
      await save(p);
      res.status(201).json(view(p));
    } catch (e) {
      if (dir) await fs.rm(dir, { recursive: true, force: true });
      throw e;
    } finally {
      await Promise.all(incoming.map((f) => fs.rm(f.path, { force: true })));
      if (remoteIncoming.length)
        await deleteBlob(remoteIncoming).catch(() => {});
    }
  },
);
app.get("/api/projects/:id", async (req, res) =>
  res.json(view(await load(req.params.id))),
);
app.get("/api/projects/:id/media/:filename", async (req, res) => {
  const p = await load(req.params.id),
    filename = req.params.filename;
  if (
    !/^(video\.mp4|source\.pdf|poster\.jpg|mask-[a-zA-Z0-9-]+\.png|film-r\d+\.mp4)$/.test(
      filename,
    )
  )
    throw statusError("File not found.", 404);
  if (filename.startsWith("film-") && p.export?.filename !== filename)
    throw statusError(
      "That export is out of date. Render the current draft.",
      409,
    );
  res.setHeader("Cache-Control", "private, no-store");
  if (req.query.download === "1") res.attachment(`oddly-clear-${filename}`);
  res.sendFile(filename, { root: projectDir(p.id), dotfiles: "allow" });
});
app.get("/api/projects/:id/storyboard.json", async (req, res) => {
  const p = await load(req.params.id);
  res.attachment("oddly-clear-storyboard.json").json({
    title: p.title,
    question: p.question,
    sample: p.sample,
    revision: p.revision,
    source: { name: p.source.name },
    beats: p.beats.map((b) => ({
      ...b,
      reviewSignature: undefined,
      track: b.track
        ? {
            provider: b.track.provider,
            target: b.track.target,
            selectedObject: b.track.selectedObject,
            reviewed: trackReviewed(b),
          }
        : null,
    })),
    checks: view(p).checks,
  });
});
app.patch("/api/projects/:id", async (req, res) =>
  exclusive(req.params.id, async () => {
    const input = editInput.parse(req.body),
      p = await load(req.params.id);
    checkRevision(p, input.revision);
    if (
      input.beats.some(
        (b, i) =>
          b.id !== `beat-${i + 1}` ||
          b.citation.page > p.source.pages.length ||
          b.sourceStart + b.duration > p.video.duration + 0.02,
      )
    )
      throw statusError("Check beat IDs, source page, and source time ranges.");
    p.title = input.title;
    p.question = input.question;
    p.beats = input.beats.map((b) => {
      const previous = p.beats.find((old) => old.id === b.id)!;
      return {
        ...b,
        reviewSignature: previous.reviewSignature,
        track: b.target === previous.target ? previous.track : undefined,
      };
    });
    p.revision++;
    p.export = null;
    event(
      p,
      "draft_saved",
      `Revision ${p.revision}; changed claims or timing need review.`,
    );
    await save(p);
    res.json(view(p));
  }),
);
app.post("/api/projects/:id/review/:beat", async (req, res) =>
  exclusive(req.params.id, async () => {
    const p = await load(req.params.id);
    checkRevision(p, req.body.revision);
    const b = p.beats.find((b) => b.id === req.params.beat);
    if (!b) throw statusError("Beat not found.", 404);
    if (req.body.kind === "claim") {
      if (!b.caption || !b.heading || !evidenceExists(p, b))
        throw statusError(
          "Add a claim and an exact quote from the selected PDF page before reviewing.",
        );
      b.reviewSignature = claimSignature(b);
      event(
        p,
        "claim_reviewed",
        `${b.id}: source support reviewed on PDF page ${b.citation.page}.`,
      );
    } else if (req.body.kind === "track") {
      if (
        !b.track ||
        b.track.selectedObject === null ||
        !b.track.observations.some(
          (o) =>
            o.objectId === b.track!.selectedObject &&
            (b.track!.provider === "manual" ||
              (o.frame >= Math.floor(b.sourceStart * p.video.fps) &&
                o.frame <
                  Math.ceil((b.sourceStart + b.duration) * p.video.fps))),
        )
      )
        throw statusError("Select a visible target before reviewing.");
      b.track.reviewedSignature = trackSignature(b);
      event(
        p,
        "track_reviewed",
        `${b.id}: ${b.track.provider} region reviewed.`,
      );
    } else throw statusError("Unknown review type.");
    p.revision++;
    p.export = null;
    await save(p);
    res.json(view(p));
  }),
);
app.post("/api/projects/:id/region/:beat", async (req, res) =>
  exclusive(req.params.id, async () => {
    const p = await load(req.params.id);
    checkRevision(p, req.body.revision);
    const b = p.beats.find((b) => b.id === req.params.beat);
    if (!b) throw statusError("Beat not found.", 404);
    if (req.body.objectId !== undefined) {
      const objectId = z.string().parse(req.body.objectId);
      if (!b.track?.observations.some((o) => o.objectId === objectId))
        throw statusError("Unknown tracked object.");
      b.track.selectedObject = objectId;
      b.track.reviewedSignature = undefined;
    } else {
      const box = z
        .tuple([
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().min(0.02).max(1),
          z.number().min(0.02).max(1),
        ])
        .parse(req.body.box);
      if (box[0] + box[2] > 1.001 || box[1] + box[3] > 1.001 || !b.target)
        throw statusError(
          "Draw a region inside the footage and name its target.",
        );
      b.track = {
        id: randomUUID(),
        provider: "manual",
        target: b.target,
        selectedObject: "manual",
        observations: [
          {
            frame: z
              .number()
              .int()
              .min(0)
              .max(Math.ceil(p.video.duration * p.video.fps) - 1)
              .parse(req.body.frame ?? Math.floor(b.sourceStart * p.video.fps)),
            objectId: "manual",
            box,
          },
        ],
      };
    }
    p.revision++;
    p.export = null;
    event(p, "region_selected", `${b.id}: region selected, needs review.`);
    await save(p);
    res.json(view(p));
  }),
);
async function startJob(
  p: Project,
  kind: NonNullable<Project["job"]>["kind"],
  res: express.Response,
  work: () => Promise<void>,
) {
  if (busy.has(p.id)) throw statusError("A task is already running.", 409);
  const release = await acquireLease(p.id);
  busy.add(p.id);
  const stable = structuredClone(p);
  p.job = {
    startedAt: new Date().toISOString(),
    kind,
    status: "running",
    progress: 1,
    message:
      kind === "render"
        ? "Composing your film…"
        : kind === "tracking"
          ? "Finding and tracking the target…"
          : "Reading footage and source…",
  };
  try {
    await save(p);
  } catch (e) {
    busy.delete(p.id);
    await release();
    throw e;
  }
  if (hosted) {
    res.status(202).type("application/x-ndjson");
    res.write(JSON.stringify(view(p)) + "\n");
  } else res.status(202).json(view(p));
  const heartbeat = hosted
    ? setInterval(() => {
        if (!res.destroyed) res.write("\n");
      }, 5000)
    : undefined;
  void (async () => {
    try {
      await work();
      const oldAssets = await publishAssets(p, projectDir(p.id));
      p.job = {
        kind,
        status: "completed",
        progress: 100,
        message:
          kind === "render"
            ? "Film encoded and fully decoded. Ready to download."
            : "Ready for review.",
      };
      event(p, `${kind}_completed`, p.job.message);
      await save(p);
      if (oldAssets) await deleteBlob(oldAssets).catch(() => {});
    } catch (e) {
      p.title = stable.title;
      p.beats = stable.beats;
      p.revision = stable.revision;
      p.export = stable.export;
      (p as StoredProject)._assets = (stable as StoredProject)._assets;
      p.job = {
        kind,
        status: "failed",
        progress: 0,
        message:
          e instanceof Error
            ? e.message
            : "Processing failed. Retry when ready.",
      };
      event(p, `${kind}_failed`, p.job.message);
    } finally {
      try {
        await save(p);
      } finally {
        busy.delete(p.id);
        await release();
        if (heartbeat) clearInterval(heartbeat);
        if (hosted && !res.destroyed) res.end(JSON.stringify(view(p)) + "\n");
      }
    }
  })();
}
app.post("/api/projects/:id/storyboard", async (req, res) => {
  const config = await metaConfig();
  if (!config.enabled || !config.key)
    throw statusError("Connect Meta and verify available credits first.", 503);
  const p = await load(req.params.id);
  checkRevision(p, req.body.revision);
  await startJob(p, "storyboard", res, async () => {
    const result = await storyboard(p);
    p.title = result.title;
    p.beats = result.beats;
    p.sample = false;
    p.revision++;
    p.export = null;
  });
});
app.post("/api/projects/:id/track/:beat", async (req, res) => {
  const config = await metaConfig();
  if (!config.enabled || !config.key)
    throw statusError("Connect Meta and verify available credits first.", 503);
  const p = await load(req.params.id);
  checkRevision(p, req.body.revision);
  const b = p.beats.find((b) => b.id === req.params.beat);
  if (!b?.target) throw statusError("Name the visible target first.");
  await startJob(p, "tracking", res, async () => {
    // Every beat uses the same normalized footage. Reuse a completed match for
    // the exact target rather than charging for an identical full-video request.
    const seed =
      b.track?.provider === "manual" ? b.track.observations[0] : undefined;
    const matching = seed
      ? undefined
      : p.beats.find(
          (other) =>
            other.id !== b.id &&
            other.target === b.target &&
            other.track?.provider === "sam-3.1" &&
            other.track.target === b.target &&
            other.track.observations.length > 0,
        );
    if (matching?.track) {
      b.track = {
        ...structuredClone(matching.track),
        id: randomUUID(),
        reviewedSignature: undefined,
      };
      event(
        p,
        "tracking_reused",
        `${b.id}: reused ${matching.id} full-video SAM result for the same target; review required.`,
      );
    } else {
      b.track = await segment(p, b.target, seed);
    }
    p.revision++;
    p.export = null;
  });
});
app.post("/api/projects/:id/render", async (req, res) => {
  const p = await load(req.params.id);
  checkRevision(p, req.body.revision);
  const issues = issueList(p, claimReviewed, trackReviewed);
  if (issues.length)
    return res
      .status(422)
      .json({ error: "Review the storyboard before exporting.", issues });
  await startJob(p, "render", res, async () => {
    p.export = null;
    p.export = await render(p, async (value) => {
      p.job!.progress = value;
      await save(p);
    });
  });
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Endpoint not found." }),
);
let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use(
  (
    error: Error & { status?: number; code?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) return;
    res.setHeader("Cache-Control", "no-store");
    const status =
      error instanceof z.ZodError
        ? 422
        : error.status || (error instanceof multer.MulterError ? 413 : 500);
    res.status(status).json({
      error:
        error instanceof z.ZodError
          ? error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          : error.message || "Something went wrong.",
    });
  },
);
const server = app.listen(port, hosted ? "0.0.0.0" : "127.0.0.1", () =>
  console.log(
    `Oddly Clear Studio · http://127.0.0.1:${port} · PID ${process.pid}`,
  ),
);
async function shutdown() {
  stopChildren();
  await vite?.close();
  server.close(() => process.exit(0));
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
