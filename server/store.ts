import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import {
  hosted,
  readObject,
  writeObject,
  remotePath,
  hydrateAssets,
  projectIds,
  acquireLease,
  type StoredProject,
} from "./cloud";
import type { Beat, Project } from "../shared/project";
export const root = hosted
  ? path.join(os.tmpdir(), "oddly-clear-data")
  : path.resolve(".local/data");
const versions = new WeakMap<Project, string>();
export async function listProjectIds() {
  return hosted ? projectIds() : fs.readdir(root);
}
export const projectDir = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw Object.assign(new Error("Project not found."), { status: 404 });
  return path.join(root, id);
};
export async function load(id: string): Promise<Project> {
  try {
    if (hosted) {
      const record = await readObject<StoredProject>(remotePath(id));
      if (!record)
        throw Object.assign(new Error("Project not found."), { status: 404 });
      versions.set(record.value, record.etag);
      await hydrateAssets(record.value, projectDir(id));
      const job = record.value.job;
      if (
        job?.status === "running" &&
        job.startedAt &&
        Date.now() - Date.parse(job.startedAt) > 330_000
      ) {
        job.status = "failed";
        job.message =
          "This task was interrupted. No paid request was replayed. Retry when ready.";
      }
      return record.value;
    }
    return JSON.parse(
      await fs.readFile(path.join(projectDir(id), "project.json"), "utf8"),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw Object.assign(new Error("Project not found."), { status: 404 });
    throw e;
  }
}
export async function save(p: Project) {
  p.updatedAt = new Date().toISOString();
  if (hosted) {
    try {
      const r = await writeObject(remotePath(p.id), p, versions.get(p));
      versions.set(p, r.etag);
      return;
    } catch (e) {
      throw Object.assign(
        new Error(
          "This project changed or could not be saved. Refresh before retrying.",
        ),
        { status: 409, cause: e },
      );
    }
  }
  await fs.mkdir(projectDir(p.id), { recursive: true });
  const tmp = path.join(projectDir(p.id), `project-${randomUUID()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(p));
  await fs.rename(tmp, path.join(projectDir(p.id), "project.json"));
}
export function event(p: Project, type: string, detail: string) {
  p.events.push({ at: new Date().toISOString(), type, detail });
  p.events = p.events.slice(-100);
}
export function claimSignature(b: Beat): string {
  return createHash("sha256")
    .update(JSON.stringify([b.heading, b.caption, b.citation]))
    .digest("hex");
}
export function trackSignature(b: Beat): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        b.target,
        b.sourceStart,
        b.duration,
        b.track?.id,
        b.track?.selectedObject,
      ]),
    )
    .digest("hex");
}
export const claimReviewed = (b: Beat) =>
  b.reviewSignature === claimSignature(b);
export const trackReviewed = (b: Beat) => {
  const track = b.track;
  if (
    !track ||
    track.selectedObject === null ||
    track.reviewedSignature !== trackSignature(b)
  )
    return false;
  return track.observations.some(
    (o) =>
      o.objectId === track.selectedObject &&
      (track.provider === "manual" ||
        (o.frame >= Math.floor(b.sourceStart * 30) &&
          o.frame < Math.ceil((b.sourceStart + b.duration) * 30))),
  );
};
export const busy = new Set<string>();
export async function exclusive<T>(
  id: string,
  work: () => Promise<T>,
): Promise<T> {
  if (busy.has(id))
    throw Object.assign(
      new Error("This project is processing. Wait for it to finish."),
      { status: 409 },
    );
  const release = await acquireLease(id);
  busy.add(id);
  try {
    return await work();
  } finally {
    busy.delete(id);
    await release();
  }
}
