import { useCallback, useEffect, useRef, useState } from "react";
import type { Beat, Project } from "../shared/project";
import { Preview } from "./Preview";
import { Icon } from "./Icons";

interface StudioProject extends Project {
  checks: { id: string; claim: boolean; track: boolean }[];
  validation: string[];
}
interface Config {
  ready: boolean;
  enabled: boolean;
  keyPresent: boolean;
  hosted?: boolean;
  liveRemainingUsd?: number;
  uploadPrefix?: string;
}
interface Summary {
  id: string;
  title: string;
  sample: boolean;
  updatedAt: string;
}
async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  if (
    response.headers.get("content-type")?.includes("application/x-ndjson") &&
    response.body
  ) {
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("The task response ended early.");
      buffer += decoder.decode(chunk.value, { stream: true });
      const end = buffer.indexOf("\n");
      if (end < 0) continue;
      const first = JSON.parse(buffer.slice(0, end));
      // Keep the request alive while the hosted container runs; polling supplies updates.
      void (async () => {
        try {
          while (!(await reader.read()).done) {}
        } finally {
          reader.releaseLock();
        }
      })().catch(() => {});
      return first as T;
    }
  }
  const data = await response.json();
  if (!response.ok)
    throw new Error([data.error, ...(data.issues || [])].join("\n"));
  return data;
}
const json = (body: unknown) => ({
  method: "POST",
  body: JSON.stringify(body),
});
const stamp = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

export function App() {
  const [project, setProject] = useState<StudioProject | null>(null),
    [draft, setDraft] = useState<StudioProject | null>(null);
  const [projects, setProjects] = useState<Summary[]>([]),
    [config, setConfig] = useState<Config | null>(null);
  const [selected, setSelected] = useState(0),
    [inspector, setInspector] = useState<"claim" | "highlight">("claim");
  const [busy, setBusy] = useState(false),
    [initial, setInitial] = useState(true),
    [error, setError] = useState("");
  const [modal, setModal] = useState<"new" | "export" | "models" | null>(null),
    [drawing, setDrawing] = useState(false);
  const [question, setQuestion] = useState(""),
    [video, setVideo] = useState<File | null>(null),
    [pdf, setPdf] = useState<File | null>(null),
    [rights, setRights] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty = Boolean(draft && project && draft !== project),
    running = project?.job?.status === "running",
    locked = busy || running;
  const adopt = useCallback((p: StudioProject) => {
    setProject(p);
    setDraft(p);
    localStorage.setItem("oddly-clear-project", p.id);
  }, []);
  const refreshList = useCallback(async () => {
    const list = await api<Summary[]>("/api/projects");
    setProjects(list);
    return list;
  }, []);
  useEffect(() => {
    let cancelled = false;
    // Establish the HttpOnly session before parallel requests can create competing cookies.
    void api<Config>("/api/config")
      .then(async (c) => [c, await api<Summary[]>("/api/projects")] as const)
      .then(async ([c, list]) => {
        if (cancelled) return;
        setConfig(c);
        setProjects(list);
        const saved = localStorage.getItem("oddly-clear-project");
        const id = list.find((p) => p.id === saved)?.id || list[0]?.id;
        if (id) {
          const p = await api<StudioProject>(`/api/projects/${id}`);
          if (!cancelled) adopt(p);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setInitial(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adopt]);
  useEffect(() => {
    if (!project || !running) return;
    let cancelled = false;
    const id = setInterval(() => {
      void api<StudioProject>(`/api/projects/${project.id}`)
        .then((p) => {
          if (!cancelled) adopt(p);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [project?.id, running, adopt]);
  useEffect(() => {
    if (modal) {
      if (modal === "new") {
        setQuestion("");
        setVideo(null);
        setPdf(null);
        setRights(false);
      }
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [modal]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft(): Promise<StudioProject> {
    if (!draft || !project) throw new Error("Open a project first.");
    if (!dirty) return project;
    const beats = draft.beats.map(
      ({ id, heading, caption, sourceStart, duration, target, citation }) => ({
        id,
        heading,
        caption,
        sourceStart,
        duration,
        target,
        citation,
      }),
    );
    const p = await api<StudioProject>(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        revision: project.revision,
        title: draft.title,
        question: draft.question,
        beats,
      }),
    });
    adopt(p);
    return p;
  }
  function updateBeat(patch: Partial<Beat>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            beats: d.beats.map((b, i) =>
              i === selected ? { ...b, ...patch } : b,
            ),
          }
        : d,
    );
  }
  async function review(kind: "claim" | "track") {
    await action(async () => {
      const p = await saveDraft();
      adopt(
        await api(
          `/api/projects/${p.id}/review/${p.beats[selected].id}`,
          json({ kind, revision: p.revision }),
        ),
      );
    });
  }
  function select(index: number) {
    setSelected(index);
    setDrawing(false);
  }
  async function newSample() {
    await action(async () => {
      if (dirty) await saveDraft();
      adopt(await api("/api/projects/sample", json({})));
      select(0);
      setModal(null);
      await refreshList();
    });
  }
  async function openProject(id: string) {
    await action(async () => {
      if (dirty) await saveDraft();
      adopt(await api(`/api/projects/${id}`));
      select(0);
    });
  }
  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    await action(async () => {
      if (!video || !pdf) throw new Error("Choose a video and PDF.");
      if (dirty) await saveDraft();
      if (video.size > 200 * 1024 * 1024 || pdf.size > 20 * 1024 * 1024)
        throw new Error("Use a video under 200 MB and a PDF under 20 MB.");
      if (config?.hosted) {
        if (video.size > 5 * 1024 * 1024 || pdf.size > 16 * 1024 * 1024)
          throw new Error(
            "The public demo accepts clips under 5 MB and PDFs under 16 MB.",
          );
        const { ticket } = await api<{ ticket: string }>(
          "/api/uploads/prepare",
          json({}),
        );
        const { upload } = await import("@vercel/blob/client");
        await Promise.all([
          upload(`${config.uploadPrefix}${ticket}-video.mp4`, video, {
            access: "private",
            handleUploadUrl: "/api/blob-upload",
            contentType: video.type || "video/mp4",
          }),
          upload(`${config.uploadPrefix}${ticket}-source.pdf`, pdf, {
            access: "private",
            handleUploadUrl: "/api/blob-upload",
            contentType: "application/pdf",
          }),
        ]);
        adopt(
          await api(
            "/api/projects",
            json({ ticket, question, rights: String(rights) }),
          ),
        );
        select(0);
        setModal(null);
        await refreshList();
        return;
      }
      const form = new FormData();
      form.set("question", question);
      form.set("rights", String(rights));
      form.set("video", video);
      form.set("pdf", pdf);
      adopt(await api("/api/projects", { method: "POST", body: form }));
      select(0);
      setModal(null);
      await refreshList();
    });
  }
  const p = draft,
    beat = p?.beats[selected],
    total = p?.beats.reduce((n, b) => n + b.duration, 0) || 0;
  const sameClaim =
    beat &&
    project &&
    JSON.stringify([beat.heading, beat.caption, beat.citation]) ===
      JSON.stringify([
        project.beats[selected].heading,
        project.beats[selected].caption,
        project.beats[selected].citation,
      ]);
  const sameTrack =
    beat &&
    project &&
    JSON.stringify([beat.target, beat.sourceStart, beat.duration]) ===
      JSON.stringify([
        project.beats[selected].target,
        project.beats[selected].sourceStart,
        project.beats[selected].duration,
      ]);
  const claimOK = Boolean(project?.checks[selected]?.claim && sameClaim),
    trackOK = Boolean(project?.checks[selected]?.track && sameTrack);
  const reviewedClaims =
    p?.beats.map((b, i) =>
      Boolean(
        project?.checks[i]?.claim &&
        JSON.stringify([b.heading, b.caption, b.citation]) ===
          JSON.stringify([
            project.beats[i].heading,
            project.beats[i].caption,
            project.beats[i].citation,
          ]),
      ),
    ) || [];
  const approved = reviewedClaims.filter(Boolean).length;
  const sourcePage = p?.source.pages.find(
    (page) => page.number === beat?.citation.page,
  );
  const base = p ? `/api/projects/${p.id}` : "";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Oddly Clear Studio home">
          <span className="brand-mark">
            <i />
            <i />
          </span>
          <span>
            oddly clear<span className="brand-studio">studio</span>
          </span>
        </a>
        <div className="project-crumb">
          Workspace <span>/</span> {p?.title || "New film"}{" "}
          {p?.sample && <b className="sample-label">SAMPLE</b>}
          {p?.example && <b className="sample-label">VERIFIED EXAMPLE</b>}
        </div>
        <div className="top-actions">
          {dirty && (
            <button
              className="icon-button"
              aria-label="Save changes"
              title="Save changes"
              disabled={locked}
              onClick={() =>
                void action(async () => {
                  await saveDraft();
                  await refreshList();
                })
              }
            >
              <Icon name="save" size={16} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="New film"
            title="New film"
            disabled={locked}
            onClick={() => setModal("new")}
          >
            <Icon name="plus" size={17} />
          </button>
          <button className="model-status" onClick={() => setModal("models")}>
            <i className={config?.ready ? "connected" : ""} />
            {config?.ready ? "Meta enabled" : "Connect Meta"}
          </button>
          <button
            className="primary"
            disabled={!p || locked}
            onClick={() => setModal("export")}
          >
            <Icon name="download" size={16} /> Export film
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <Icon name="info" />
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <Icon name="close" />
          </button>
        </div>
      )}
      {!p ? (
        <main className="welcome">
          <div className="welcome-copy">
            <span className="eyebrow">ENGINEERING, MADE VISIBLE</span>
            <h1>
              Make the mechanism
              <br />
              <em>make sense.</em>
            </h1>
            <p>
              Turn a question, your footage, and a source PDF into a clear
              visual story. Four beats. Every claim connected to its evidence.
            </p>
            <div className="welcome-actions">
              <button
                className="primary"
                disabled={busy || initial}
                onClick={() => setModal("new")}
              >
                <Icon name="plus" /> Start a film
              </button>
              <button
                className="text-button"
                disabled={busy || initial}
                onClick={() => void newSample()}
              >
                {config?.hosted
                  ? "Open the verified Meta example"
                  : "Explore the sample"}{" "}
                <Icon name="arrow" />
              </button>
            </div>
            <span className="welcome-note">
              20–40 seconds · Vertical MP4 · Your source stays in view
            </span>
          </div>
          <div className="welcome-art">
            <div className="diagram-orbit">
              <div className="diagram-hub" />
              <div className="diagram-arm a" />
              <div className="diagram-arm b" />
              <div className="diagram-ring" />
            </div>
            <div className="diagram-caption">
              <span>01 / A CLOSER LOOK</span>
              <strong>
                The small part.
                <br />
                The whole story.
              </strong>
              <span>FROM FOOTAGE TO UNDERSTANDING</span>
            </div>
          </div>
        </main>
      ) : (
        <main className="workspace">
          <aside className="media-panel">
            <div className="panel-heading">
              <h2>Project</h2>
              <button
                className="icon-button"
                aria-label="Create a new film"
                disabled={locked}
                onClick={() => setModal("new")}
              >
                <Icon name="plus" />
              </button>
            </div>
            <label className="project-switch">
              <span className="sr-only">Open project</span>
              <select
                aria-label="Open project"
                disabled={locked}
                value={p.id}
                onChange={(e) => void openProject(e.target.value)}
              >
                {projects.some((s) => s.id === p.id) ? null : (
                  <option value={p.id}>{p.title}</option>
                )}
                {projects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="section-label">SOURCE MATERIAL</div>
            <div className="media-thumb">
              <img
                src={`${base}/media/poster.jpg`}
                alt="Source footage still"
              />
              <span>
                <Icon name="film" size={14} /> {stamp(p.video.duration)}
              </span>
            </div>
            <div className="asset-title">
              <Icon name="film" />
              <span>{p.video.name}</span>
            </div>
            <p className="asset-meta">
              {p.video.width} × {p.video.height} · {p.video.fps} fps
            </p>
            <a
              className="source-asset"
              href={`${base}/media/source.pdf`}
              target="_blank"
              rel="noreferrer"
            >
              <span className="pdf-icon">
                <Icon name="file" size={22} />
              </span>
              <span>
                <strong>{p.source.name}</strong>
                <small>{p.source.pages.length} pages · Reference</small>
              </span>
              <Icon name="external" size={13} />
            </a>
            <div className="section-label question-label">THE QUESTION</div>
            <label>
              <span className="sr-only">Engineering question</span>
              <textarea
                className="question-input"
                value={p.question}
                maxLength={500}
                disabled={locked}
                onChange={(e) => setDraft({ ...p, question: e.target.value })}
              />
            </label>
            <button
              className="generate-button"
              disabled={locked}
              onClick={() => {
                if (!config?.ready) {
                  setModal("models");
                  return;
                }
                void action(async () => {
                  const current = await saveDraft();
                  adopt(
                    await api(
                      `${base}/storyboard`,
                      json({ revision: current.revision }),
                    ),
                  );
                });
              }}
            >
              <Icon name="spark" size={16} />
              {project?.job?.kind === "storyboard" && running
                ? "Building storyboard…"
                : "Generate storyboard"}
              <Icon name="arrow" size={15} />
            </button>
            <p className="micro-copy">
              With Meta: sends this footage and extracted PDF text to Meta for a
              new draft. Replaces the four current beats.
            </p>
            <div className="media-panel-bottom">
              <span className="local-dot" />{" "}
              {dirty
                ? "Unsaved changes"
                : config?.hosted
                  ? "Saved to this private session"
                  : "Saved on this Mac"}
              <button
                className="text-button save-button"
                disabled={!dirty || locked}
                onClick={() =>
                  void action(async () => {
                    await saveDraft();
                    await refreshList();
                  })
                }
              >
                <Icon name="save" size={14} /> Save
              </button>
            </div>
            {config?.hosted && (
              <p className="micro-copy">
                <a href="/demo" target="_blank" rel="noreferrer">
                  Watch the 3-minute demo
                </a>
                <br />
                <a
                  href="https://github.com/cande-official/oddly-clear-studio"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open source code
                </a>
              </p>
            )}
          </aside>
          <section className="editor">
            <div className="editor-toolbar">
              <div>
                <span className="eyebrow">YOUR FILM</span>
                <label>
                  <span className="sr-only">Film title</span>
                  <input
                    value={p.title}
                    maxLength={90}
                    disabled={locked}
                    onChange={(e) => setDraft({ ...p, title: e.target.value })}
                  />
                </label>
              </div>
              <span className="format-chip">
                EN <span>/</span> {total.toFixed(0)}s
              </span>
            </div>
            <Preview
              project={p}
              selected={selected}
              onSelected={select}
              drawing={drawing && !locked}
              onRegion={(box, frame) => {
                setDrawing(false);
                void action(async () => {
                  const current = await saveDraft();
                  adopt(
                    await api(
                      `${base}/region/${beat!.id}`,
                      json({ revision: current.revision, box, frame }),
                    ),
                  );
                });
              }}
            />
            <div className="storyboard">
              <div className="storyboard-heading">
                <h2>
                  Storyboard <span>04 beats</span>
                </h2>
                <span>{approved}/4 sources reviewed</span>
              </div>
              <div className="timeline-ruler">
                <span>00:00</span>
                <span>{stamp(total / 3)}</span>
                <span>{stamp((total * 2) / 3)}</span>
                <span>{stamp(total)}</span>
              </div>
              <div className="beat-strip">
                {p.beats.map((b, i) => (
                  <button
                    key={b.id}
                    className={`beat-tile ${selected === i ? "active" : ""}`}
                    onClick={() => select(i)}
                  >
                    <div className="beat-tile-top">
                      <span>0{i + 1}</span>
                      <span>{b.duration}s</span>
                    </div>
                    <strong>
                      {b.heading ||
                        [
                          "The hook",
                          "The mechanism",
                          "The explanation",
                          "The takeaway",
                        ][i]}
                    </strong>
                    <div className="beat-tile-bottom">
                      <span
                        className={
                          reviewedClaims[i] ? "review-dot ok" : "review-dot"
                        }
                      />
                      <span>
                        {reviewedClaims[i]
                          ? "Source reviewed"
                          : "Needs source review"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="editor-footer">
              <span>
                {p.sample
                  ? "Illustrative sample · Fixture regions, no live AI tracking"
                  : p.example
                    ? "Recorded Spark + SAM example · Opening makes no model call"
                    : "Original footage · Human review before export"}
              </span>
              <a href={`${base}/storyboard.json`} download>
                <Icon name="download" size={13} /> Storyboard JSON
              </a>
            </div>
          </section>
          <aside className="inspector">
            <div className="panel-heading">
              <h2>Beat 0{selected + 1}</h2>
              <span className="inspector-status">
                {claimOK && trackOK ? (
                  <>
                    <Icon name="check" size={13} /> Reviewed
                  </>
                ) : (
                  "Review needed"
                )}
              </span>
            </div>
            <div className="inspector-tabs">
              <button
                className={inspector === "claim" ? "active" : ""}
                onClick={() => setInspector("claim")}
              >
                <Icon name="book" size={15} /> Script & source
              </button>
              <button
                className={inspector === "highlight" ? "active" : ""}
                onClick={() => setInspector("highlight")}
              >
                <Icon name="target" size={15} /> Highlight
              </button>
            </div>
            {beat && (
              <div className="inspector-body">
                <fieldset disabled={locked}>
                  <label className="field">
                    <span>Beat heading</span>
                    <input
                      value={beat.heading}
                      maxLength={70}
                      placeholder="Name this moment"
                      onChange={(e) => updateBeat({ heading: e.target.value })}
                    />
                  </label>
                  {inspector === "claim" ? (
                    <>
                      <label className="field">
                        <span>
                          What the viewer learns{" "}
                          <small>{beat.caption.length}/180</small>
                        </span>
                        <textarea
                          className="caption-input"
                          value={beat.caption}
                          maxLength={180}
                          placeholder="One clear, source-backed idea."
                          onChange={(e) =>
                            updateBeat({ caption: e.target.value })
                          }
                        />
                      </label>
                      <div className="timing-fields">
                        <label className="field">
                          <span>
                            Source start <small>sec</small>
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            max={Math.max(0, p.video.duration - beat.duration)}
                            value={beat.sourceStart}
                            onChange={(e) =>
                              updateBeat({
                                sourceStart: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          <span>
                            Duration <small>sec</small>
                          </span>
                          <input
                            type="number"
                            min="5"
                            max="10"
                            step="0.5"
                            value={beat.duration}
                            onChange={(e) =>
                              updateBeat({ duration: Number(e.target.value) })
                            }
                          />
                        </label>
                      </div>
                      <div className="evidence-heading">
                        <Icon name="file" size={16} />
                        <h3>Connect the evidence</h3>
                      </div>
                      <label className="field">
                        <span>
                          Source page{" "}
                          <a
                            href={`${base}/media/source.pdf#page=${beat.citation.page}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open PDF <Icon name="external" size={11} />
                          </a>
                        </span>
                        <select
                          value={beat.citation.page}
                          onChange={(e) =>
                            updateBeat({
                              citation: {
                                ...beat.citation,
                                page: Number(e.target.value),
                              },
                            })
                          }
                        >
                          {p.source.pages.map((page) => (
                            <option key={page.number} value={page.number}>
                              PDF page {page.number}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Exact supporting quote</span>
                        <textarea
                          className="quote-input"
                          value={beat.citation.quote}
                          maxLength={650}
                          placeholder="Paste an exact excerpt from this page."
                          onChange={(e) =>
                            updateBeat({
                              citation: {
                                ...beat.citation,
                                quote: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                      <details className="source-excerpt">
                        <summary>Read page {beat.citation.page} text</summary>
                        <p>{sourcePage?.text}</p>
                      </details>
                      <button
                        className={`review-button ${claimOK ? "reviewed" : ""}`}
                        disabled={locked || claimOK}
                        onClick={() => void review("claim")}
                      >
                        <Icon name="check" size={16} />
                        {claimOK ? "Source reviewed" : "Approve source support"}
                      </button>
                      <p className="micro-copy">
                        Confirm the excerpt actually supports this claim.
                        Finding a matching quote is only the first check.
                      </p>
                    </>
                  ) : (
                    <>
                      <label className="field">
                        <span>Part to highlight</span>
                        <input
                          value={beat.target}
                          maxLength={80}
                          placeholder="e.g. tail rotor"
                          onChange={(e) =>
                            updateBeat({ target: e.target.value })
                          }
                        />
                      </label>
                      <button
                        className="generate-button"
                        disabled={!beat.target || locked}
                        onClick={() => {
                          if (!config?.ready) {
                            setModal("models");
                            return;
                          }
                          void action(async () => {
                            const current = await saveDraft();
                            adopt(
                              await api(
                                `${base}/track/${beat.id}`,
                                json({ revision: current.revision }),
                              ),
                            );
                          });
                        }}
                      >
                        <Icon name="target" size={16} />{" "}
                        {beat.track?.provider === "manual"
                          ? "Track drawn region with SAM"
                          : "Track with SAM 3.1"}
                      </button>
                      <p className="micro-copy">
                        {beat.track?.provider === "manual"
                          ? "Sends this clip and your drawn region to Meta."
                          : "Sends this clip and target phrase to Meta."}{" "}
                        Review object identity and visibility through the entire
                        beat.
                      </p>
                      <div className="region-info">
                        <span>Current highlight</span>
                        <strong>
                          {beat.track?.provider === "sample"
                            ? "Sample fixture regions"
                            : beat.track?.provider === "sam-3.1"
                              ? "SAM 3.1 tracked masks"
                              : beat.track?.provider === "manual"
                                ? "Manual fixed region"
                                : "Not selected"}
                        </strong>
                        <small>
                          {beat.track?.provider === "manual"
                            ? "Stays in place throughout this beat. Not automatic tracking."
                            : `${beat.track?.observations.length || 0} frame observations`}
                        </small>
                      </div>
                      {beat.track && (
                        <label className="field">
                          <span>Tracked object</span>
                          <select
                            value={beat.track.selectedObject ?? ""}
                            onChange={(e) =>
                              void action(async () => {
                                const current = await saveDraft();
                                adopt(
                                  await api(
                                    `${base}/region/${beat.id}`,
                                    json({
                                      revision: current.revision,
                                      objectId: e.target.value,
                                    }),
                                  ),
                                );
                              })
                            }
                          >
                            <option value="" disabled>
                              Choose the correct object
                            </option>
                            {[
                              ...new Set(
                                beat.track.observations.map((o) => o.objectId),
                              ),
                            ].map((id) => (
                              <option key={id} value={id}>
                                Object {id}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <button
                        className={`outline-button ${drawing ? "is-drawing" : ""}`}
                        disabled={!beat.target || locked}
                        onClick={() => setDrawing(!drawing)}
                      >
                        <Icon name="target" size={16} />
                        {drawing ? "Cancel drawing" : "Draw a fixed region"}
                      </button>
                      <p className="micro-copy">
                        Use a fixed box for static subjects, or track the drawn
                        region with SAM. Drawing replaces this beat’s track.
                      </p>
                      <button
                        className={`review-button ${trackOK ? "reviewed" : ""}`}
                        disabled={locked || !beat.track || trackOK}
                        onClick={() => void review("track")}
                      >
                        <Icon name="check" size={16} />
                        {trackOK ? "Highlight reviewed" : "Approve highlight"}
                      </button>
                    </>
                  )}
                </fieldset>
              </div>
            )}
          </aside>
        </main>
      )}
      {running && (
        <div className="job-bar" role="status">
          <span className="spinner" />
          <span>{project?.job?.message}</span>
          <progress max="100" value={project?.job?.progress} />
          <b>{project?.job?.progress}%</b>
        </div>
      )}
      {project?.job?.status === "failed" && (
        <div className="job-failed" role="alert">
          <Icon name="info" size={16} />
          {project.job.message}
        </div>
      )}
      <dialog
        ref={dialog}
        className={`modal modal-${modal}`}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setModal(null);
        }}
      >
        <div className="modal-head">
          <span className="eyebrow">ODDLY CLEAR STUDIO</span>
          <button
            aria-label="Close dialog"
            className="icon-button"
            disabled={busy}
            onClick={() => setModal(null)}
          >
            <Icon name="close" />
          </button>
        </div>
        {modal && error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        {modal === "export" && project?.job?.status === "failed" && (
          <p className="modal-error" role="alert">
            {project.job.message}
          </p>
        )}
        {modal === "new" && (
          <form onSubmit={(e) => void createProject(e)}>
            <h2>Start with a good question.</h2>
            <p className="modal-intro">
              One clip. One source. A story worth understanding.
            </p>
            <fieldset disabled={busy}>
              <label className="field">
                <span>What do you want to explain?</span>
                <input
                  required
                  minLength={5}
                  maxLength={500}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Why does a helicopter need a tail rotor?"
                  autoFocus
                />
              </label>
              <div className="upload-pair">
                <label className="upload-box">
                  <Icon name="film" size={26} />
                  <strong>{video?.name || "Choose footage"}</strong>
                  <small>
                    {config?.hosted
                      ? "MP4 / MOV · 5–30 sec · up to 5 MB"
                      : "MP4 / MOV · 5–120 sec · up to 200 MB"}
                  </small>
                  <input
                    required
                    type="file"
                    aria-label="Source video"
                    accept="video/mp4,video/quicktime,video/webm"
                    onChange={(e) => setVideo(e.target.files?.[0] || null)}
                  />
                </label>
                <label className="upload-box">
                  <Icon name="file" size={26} />
                  <strong>{pdf?.name || "Choose a source PDF"}</strong>
                  <small>
                    {config?.hosted
                      ? "Text PDF · up to 80 pages / 16 MB"
                      : "Text PDF · up to 80 pages / 20 MB"}
                  </small>
                  <input
                    required
                    type="file"
                    aria-label="Source PDF"
                    accept="application/pdf"
                    onChange={(e) => setPdf(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
              <label className="rights">
                <input
                  type="checkbox"
                  required
                  checked={rights}
                  onChange={(e) => setRights(e.target.checked)}
                />
                <span>I have the right to use this footage and source.</span>
              </label>
              <p className="micro-copy">
                {config?.hosted
                  ? "Files are stored privately for this browser session. Use public or non-sensitive materials. Meta generation and tracking are separate actions; free-credit content may be used by Meta for product improvement."
                  : "Imported files are processed locally. Meta generation and tracking are separate actions."}
              </p>
              <button className="primary full" type="submit">
                {busy ? "Preparing footage and source…" : "Create storyboard"}
                <Icon name="arrow" size={17} />
              </button>
            </fieldset>
            <button
              className="text-button sample-link"
              type="button"
              disabled={busy}
              onClick={() => void newSample()}
            >
              {config?.hosted
                ? "Or open the verified Meta example"
                : "Or explore the illustrative sample"}
            </button>
          </form>
        )}
        {modal === "models" && (
          <>
            <h2>Connect the models.</h2>
            <p className="modal-intro">
              Muse Spark drafts the story. SAM 3.1 follows the part.
            </p>
            <div className="connection-status">
              <i className={config?.ready ? "connected" : ""} />
              {config?.ready
                ? "Meta is enabled on this Mac"
                : config?.keyPresent
                  ? "Key found. Live calls are disabled."
                  : "No Meta API key configured yet."}
            </div>
            <p>
              After checking your credits in Meta Billing, add these settings to
              the project’s <code>.env.local</code>. Keep the key out of your
              source repository.
            </p>
            <pre>MODEL_API_KEY=your-key{`\n`}META_API_ENABLED=true</pre>
            <p className="micro-copy">
              Standard models only. No key is sent to the browser. Meta’s
              free-credit terms may permit product improvement use; check
              Billing before sending private footage. The sample and manual
              editor work without connecting.
            </p>
            <div className="modal-links">
              <a href="https://dev.meta.ai/" target="_blank" rel="noreferrer">
                Meta developer dashboard <Icon name="external" size={13} />
              </a>
              <button
                className="outline-button"
                onClick={() =>
                  void action(async () => setConfig(await api("/api/config")))
                }
              >
                Check connection settings
              </button>
            </div>
          </>
        )}
        {modal === "export" && p && (
          <>
            <h2>Your story, ready to leave.</h2>
            <p className="modal-intro">
              {total}s · 1080 × 1920 · 30 fps · Silent MP4
            </p>
            {p.export && p.export.revision === p.revision && !dirty ? (
              <>
                <video
                  className="export-player"
                  controls
                  src={`${base}/media/${p.export.filename}`}
                />
                <a
                  className="primary full"
                  href={`${base}/media/${p.export.filename}?download=1`}
                  download
                >
                  <Icon name="download" size={17} /> Download MP4{" "}
                  <span>{(p.export.bytes / 1024 / 1024).toFixed(1)} MB</span>
                </a>
              </>
            ) : (
              <>
                <div className="export-checks">
                  {project?.validation.length ? (
                    <>
                      <span className="section-label">BEFORE YOU EXPORT</span>
                      {project.validation.map((issue, i) => (
                        <p key={i}>
                          <span className="review-dot" />
                          {issue}
                        </p>
                      ))}
                    </>
                  ) : (
                    <p className="all-clear">
                      <Icon name="check" /> All claims and highlights reviewed
                    </p>
                  )}
                </div>
                {dirty && (
                  <p className="dirty-note">
                    Save changes to refresh the review checks.
                  </p>
                )}
                <button
                  className="primary full"
                  disabled={
                    locked || (!dirty && Boolean(project?.validation.length))
                  }
                  onClick={() =>
                    void action(async () => {
                      const current = await saveDraft();
                      if (current.validation.length) {
                        adopt(current);
                        return;
                      }
                      adopt(
                        await api(
                          `${base}/render`,
                          json({ revision: current.revision }),
                        ),
                      );
                    })
                  }
                >
                  <Icon name="film" size={17} />
                  {running
                    ? "Rendering film…"
                    : dirty
                      ? "Save & check storyboard"
                      : "Render film"}
                </button>
                {running && (
                  <progress
                    className="export-progress"
                    max="100"
                    value={project?.job?.progress}
                  />
                )}
              </>
            )}
            <p className="micro-copy">
              The final file is checked by decoding every frame before the
              download becomes available.
              {p.sample ? " Sample exports are marked as illustrative." : ""}
            </p>
          </>
        )}
      </dialog>
    </div>
  );
}
