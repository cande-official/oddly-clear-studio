import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { get, put, del, list, BlobPreconditionFailedError } from "@vercel/blob";
import { zipSync, unzipSync } from "fflate";
import type { Project } from "../shared/project";

export const hosted = process.env.PUBLIC_MODE === "true";
export const sessions = new AsyncLocalStorage<string>();
export const session = () => {
  const value = sessions.getStore();
  if (!value) throw new Error("A private browser session is required.");
  return value;
};
export const fingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const newSession = () => randomBytes(32).toString("hex");
export const remotePath = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw Object.assign(Error("Project not found."), { status: 404 });
  return `projects/${session()}/${id}.json`;
};
export async function readObject<T>(
  name: string,
): Promise<{ value: T; etag: string } | null> {
  // Blob conditional writes require the object's strong ETag. The delivery CDN
  // weakens that tag when it Brotli-compresses JSON, even with useCache:false.
  const r = await get(name, {
    access: "private",
    useCache: false,
    headers: { "accept-encoding": "identity" },
  });
  if (!r || r.statusCode !== 200) return null;
  return {
    value: JSON.parse(await new Response(r.stream).text()) as T,
    etag: r.blob.etag.replace(/^W\//, ""),
  };
}
export async function writeObject(name: string, value: unknown, etag?: string) {
  return put(name, JSON.stringify(value), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
  });
}
export async function changeCounter<T>(
  name: string,
  initial: T,
  change: (value: T) => T,
): Promise<T> {
  for (let retry = 0; retry < 5; retry++) {
    const old = await readObject<T>(name);
    const next = change(old?.value ?? initial);
    try {
      await writeObject(name, next, old?.etag);
      return next;
    } catch (e) {
      if (
        !(e instanceof BlobPreconditionFailedError) &&
        !String(e).includes("already exists")
      )
        throw e;
    }
  }
  throw Object.assign(new Error("The service is busy. Please retry shortly."), {
    status: 409,
  });
}
export async function acquireLease(id: string) {
  if (!hosted) return async () => {};
  const key = `locks/${session()}/${id}.json`,
    owner = newSession();
  let etag = "";
  const old = await readObject<{ until: number; owner: string }>(key);
  if (old && old.value.until > Date.now())
    throw Object.assign(
      new Error("This project is processing. Wait for it to finish."),
      { status: 409 },
    );
  try {
    etag = (
      await writeObject(key, { owner, until: Date.now() + 330_000 }, old?.etag)
    ).etag;
  } catch {
    throw Object.assign(
      new Error("This project is processing. Wait for it to finish."),
      { status: 409 },
    );
  }
  return async () => {
    await del(key, { ifMatch: etag }).catch(() => {});
  };
}
export async function newProjectQuota() {
  if (!hosted) return;
  const error = () =>
    Object.assign(
      new Error(
        "The free public demo has reached its project capacity. Existing projects and downloads remain available. Run the open-source studio locally for more.",
      ),
      { status: 429 },
    );
  await changeCounter(
    `limits/session-${session()}.json`,
    { projects: 0 },
    (v) => {
      if (v.projects >= 3) throw error();
      return { projects: v.projects + 1 };
    },
  );
  await changeCounter("limits/projects.json", { projects: 0 }, (v) => {
    if (v.projects >= 12) throw error();
    return { projects: v.projects + 1 };
  });
}
export async function modelAllowance() {
  if (!hosted) return { remainingUsd: null };
  const v = await readObject<{ charged: number; held: Record<string, number> }>(
    "limits/meta-budget-v1.json",
  );
  const spent =
    (v?.value.charged ?? 0) +
    Object.values(v?.value.held ?? {}).reduce((a, b) => a + b, 0);
  return {
    remainingUsd: Math.max(
      0,
      Number(
        (Number(process.env.META_DEMO_BUDGET_USD || "0") - spent).toFixed(6),
      ),
    ),
  };
}
export function reservationUsd(model: string, frames: number) {
  // Spark 1.3: documented 1,048,576-token context plus max_output_tokens=8000.
  // Standard rates checked for this hackathon: $1.25/M in, $4.25/M out.
  return model === "sam-3.1" ? Math.max(50, frames) / 5000 : 1.35;
}
export async function reserveModel(model: string, frames: number) {
  if (!hosted) return { settle: async (_usage: Record<string, unknown>) => {} };
  const reserve = reservationUsd(model, frames);
  const id = newSession(),
    limit = Number(process.env.META_DEMO_BUDGET_USD || "0");
  await changeCounter(
    "limits/meta-budget-v1.json",
    { charged: 0, held: {} as Record<string, number> },
    (v) => {
      const total =
        v.charged + Object.values(v.held).reduce((a, b) => a + b, 0);
      if (total + reserve > limit + 1e-8)
        throw Object.assign(
          new Error(
            "The live Meta demo budget is fully reserved or used. You can edit the verified example, export it, or run locally with your own key.",
          ),
          { status: 429 },
        );
      return { ...v, held: { ...v.held, [id]: reserve } };
    },
  );
  return {
    settle: async (usage: Record<string, unknown>) => {
      const actual =
        model === "sam-3.1"
          ? (Number(usage.video_frames_processed ?? frames) / 1000) * 0.2
          : (Number(usage.input_tokens ?? 0) * 1.25 +
              Number(usage.output_tokens ?? 0) * 4.25) /
            1e6;
      // Unknown/failed requests retain their conservative reservation. No automatic replay.
      if (!Number.isFinite(actual) || actual < 0) return;
      await changeCounter(
        "limits/meta-budget-v1.json",
        { charged: 0, held: {} as Record<string, number> },
        (v) => {
          if (v.held[id] === undefined) return v;
          const held = { ...v.held };
          delete held[id];
          return { charged: v.charged + actual, held };
        },
      );
    },
  };
}
export type StoredProject = Project & {
  _assets?: { name: string; etag: string };
};
const allowedFile =
  /^(video\.mp4|source\.pdf|poster\.jpg|mask-[a-zA-Z0-9-]+\.png|film-r\d+\.mp4)$/;
export async function publishAssets(p: StoredProject, dir: string) {
  if (!hosted) return;
  const names = new Set([
    "video.mp4",
    "source.pdf",
    "poster.jpg",
    ...p.beats.flatMap(
      (b) =>
        b.track?.observations
          .map((o) => o.mask)
          .filter((n): n is string => Boolean(n)) ?? [],
    ),
    ...(p.export ? [p.export.filename] : []),
  ]);
  const files: Record<string, Uint8Array> = {};
  let size = 0;
  for (const name of names) {
    if (!allowedFile.test(name)) throw Error("Invalid media filename.");
    const data = await fs.readFile(path.join(dir, name));
    size += data.length;
    if (size > 48 * 1024 * 1024)
      throw Error(
        "This project exceeds the public demo storage limit. Run the full studio locally for larger media.",
      );
    files[name] = data;
  }
  const name = `media/${session()}/${p.id}-${newSession().slice(0, 12)}.zip`;
  const r = await put(name, Buffer.from(zipSync(files, { level: 1 })), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/zip",
  });
  const previous = p._assets;
  p._assets = { name, etag: r.etag };
  await fs.writeFile(path.join(dir, ".asset-version"), r.etag);
  return previous?.name;
}
export async function hydrateAssets(p: StoredProject, dir: string) {
  if (!hosted || !p._assets) return;
  if (
    (await fs
      .readFile(path.join(dir, ".asset-version"), "utf8")
      .catch(() => "")) === p._assets.etag
  )
    return;
  const r = await get(p._assets.name, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200)
    throw Error("Project media could not be restored.");
  const files = unzipSync(
    new Uint8Array(await new Response(r.stream).arrayBuffer()),
  );
  await fs.mkdir(dir, { recursive: true });
  let size = 0;
  for (const [name, data] of Object.entries(files)) {
    if (!allowedFile.test(name)) throw Error("Invalid media archive.");
    size += data.length;
    if (size > 48 * 1024 * 1024)
      throw Error("Media archive exceeds the demo limit.");
    await fs.writeFile(path.join(dir, name), data);
  }
  await fs.writeFile(path.join(dir, ".asset-version"), p._assets.etag);
}
export async function projectIds() {
  const r = await list({ prefix: `projects/${session()}/`, limit: 100 });
  return r.blobs.map((b) => path.basename(b.pathname, ".json"));
}
export async function incomingFile(name: string) {
  if (
    !name.startsWith(`incoming/${session()}/`) ||
    !/^incoming\/[a-f0-9]{64}\/[a-f0-9]{32}-(video\.mp4|source\.pdf)$/.test(
      name,
    )
  )
    throw Object.assign(
      Error("Upload does not belong to this browser session."),
      { status: 403 },
    );
  const r = await get(name, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) throw Error("Upload not found.");
  return new Uint8Array(await new Response(r.stream).arrayBuffer());
}
export { del as deleteBlob };
