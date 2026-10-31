import { useEffect, useRef, useState } from "react";
import { fittedRect, paintFrame, WIDTH, HEIGHT } from "../shared/composition";
import { observationAt, type Project } from "../shared/project";
import { Icon } from "./Icons";

const time = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
type Box = [number, number, number, number];
export function Preview({
  project,
  selected,
  onSelected,
  drawing,
  onRegion,
}: {
  project: Project;
  selected: number;
  onSelected: (index: number) => void;
  drawing: boolean;
  onRegion: (box: Box, frame: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef(new Map<string, HTMLImageElement>());
  const dragStart = useRef<[number, number] | null>(null),
    dragBox = useRef<Box | null>(null);
  const [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0);
  const beat = project.beats[selected];
  const total = project.beats.reduce((n, b) => n + b.duration, 0);
  const offset = project.beats
    .slice(0, selected)
    .reduce((n, b) => n + b.duration, 0);
  useEffect(() => {
    imageCache.current.clear();
    setPlaying(false);
  }, [project.id]);
  useEffect(() => {
    if (video.current) video.current.currentTime = beat.sourceStart;
    setPosition(offset);
  }, [project.id, selected, beat.sourceStart]);
  useEffect(() => {
    if (drawing) setPlaying(false);
  }, [drawing]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing && !drawing) void v.play().catch(() => setPlaying(false));
    else v.pause();
    return () => v.pause();
  }, [playing, drawing, selected, project.id]);
  useEffect(() => {
    const v = video.current,
      c = canvas.current;
    if (!v || !c) return;
    const ctx = c.getContext("2d")!;
    let request = 0;
    function paint() {
      const o = observationAt(beat.track, v!.currentTime, project.video.fps);
      let mask: HTMLImageElement | undefined;
      if (o?.mask) {
        const url = `/api/projects/${project.id}/media/${o.mask}`;
        if (!imageCache.current.has(url)) {
          if (imageCache.current.size >= 96) {
            const oldest = imageCache.current.keys().next().value;
            if (oldest) imageCache.current.delete(oldest);
          }
          const img = new Image();
          img.src = url;
          imageCache.current.set(url, img);
        }
        const img = imageCache.current.get(url)!;
        if (img.complete && img.naturalWidth) mask = img;
      }
      paintFrame(
        ctx,
        project,
        beat,
        selected,
        v!.currentTime,
        v!.readyState >= 2 ? v! : undefined,
        mask,
      );
      if (dragBox.current) {
        ctx.strokeStyle = "#fff";
        ctx.setLineDash([12, 8]);
        ctx.lineWidth = 4;
        ctx.strokeRect(...dragBox.current);
        ctx.setLineDash([]);
      }
      request = requestAnimationFrame(paint);
    }
    request = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(request);
  }, [project, beat, selected]);
  const coordinate = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) * WIDTH) / rect.width,
      ((e.clientY - rect.top) * HEIGHT) / rect.height,
    ];
  };
  function seek(seconds: number) {
    let start = 0;
    for (let i = 0; i < project.beats.length; i++) {
      const b = project.beats[i];
      if (seconds < start + b.duration || i === 3) {
        if (i !== selected) onSelected(i);
        // Seek after React has switched the selected beat.
        requestAnimationFrame(() => {
          if (video.current)
            video.current.currentTime =
              b.sourceStart + Math.min(seconds - start, b.duration - 0.03);
        });
        break;
      }
      start += b.duration;
    }
    setPosition(seconds);
  }
  return (
    <section className="preview-area" aria-label="Film preview">
      <div className="preview-meta">
        <span>FILM PREVIEW</span>
        <span>
          9:16 <i /> 1080 × 1920
        </span>
      </div>
      <div className={`canvas-wrap ${drawing ? "drawing" : ""}`}>
        <canvas
          ref={canvas}
          role="img"
          width={WIDTH}
          height={HEIGHT}
          aria-label="Composed film frame"
          onPointerDown={(e) => {
            if (!drawing) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            dragStart.current = coordinate(e);
          }}
          onPointerMove={(e) => {
            if (!drawing || !dragStart.current) return;
            const [x, y] = coordinate(e),
              [sx, sy] = dragStart.current;
            dragBox.current = [
              Math.min(x, sx),
              Math.min(y, sy),
              Math.abs(x - sx),
              Math.abs(y - sy),
            ];
          }}
          onPointerUp={(e) => {
            if (!drawing || !dragStart.current) return;
            const [x, y] = coordinate(e),
              [sx, sy] = dragStart.current;
            dragStart.current = null;
            dragBox.current = null;
            const r = fittedRect(project.video.width, project.video.height);
            const left = Math.max(r.x, Math.min(x, sx)),
              top = Math.max(r.y, Math.min(y, sy)),
              right = Math.min(r.x + r.w, Math.max(x, sx)),
              bottom = Math.min(r.y + r.h, Math.max(y, sy));
            if (right > left + r.w * 0.02 && bottom > top + r.h * 0.02)
              onRegion(
                [
                  (left - r.x) / r.w,
                  (top - r.y) / r.h,
                  (right - left) / r.w,
                  (bottom - top) / r.h,
                ],
                Math.min(
                  Math.ceil(project.video.duration * project.video.fps) - 1,
                  Math.floor(
                    (video.current?.currentTime ?? beat.sourceStart) *
                      project.video.fps +
                      0.001,
                  ),
                ),
              );
          }}
        />
        {drawing && (
          <span className="draw-hint">Drag a box around the part</span>
        )}
      </div>
      <video
        ref={video}
        className="source-player"
        src={`/api/projects/${project.id}/media/video.mp4`}
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={() => {
          if (video.current) video.current.currentTime = beat.sourceStart;
        }}
        onTimeUpdate={() => {
          const v = video.current;
          if (!v) return;
          setPosition(offset + Math.max(0, v.currentTime - beat.sourceStart));
          if (
            v.currentTime >= beat.sourceStart + beat.duration - 0.04 &&
            playing
          ) {
            if (selected < 3) onSelected(selected + 1);
            else {
              setPlaying(false);
              v.currentTime = beat.sourceStart;
              setPosition(offset);
            }
          }
        }}
      />
      <div className="playback">
        <button
          className="play-button"
          aria-label={playing ? "Pause preview" : "Play preview"}
          disabled={drawing}
          onClick={() => setPlaying(!playing)}
        >
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
        <span className="timecode">
          {time(position)} <em>/ {time(total)}</em>
        </span>
        <input
          aria-label="Film playhead"
          type="range"
          min={0}
          max={Math.max(0.1, total - 0.04)}
          step="0.03"
          value={Math.min(position, total - 0.04)}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="silent">
          <Icon name="sound" size={16} /> Silent cut
        </span>
      </div>
    </section>
  );
}
