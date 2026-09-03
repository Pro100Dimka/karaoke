/* eslint-disable no-multi-assign */
import { clamp } from "../../../../utils/math";

const rect = (ctx, x, y, w, h) => {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, h / 2) : ctx.rect(x, y, w, h);
};

export function drawPianoRoll(ctx, frame, palette, pitch = {}) {
  const {
    width,
    height,
    keyboard,
    lane,
    rowHeight,
    playhead,
    min,
    max,
    time,
    y,
    notes = [],
    connections = []
  } = frame;

  const noteHeight = clamp(rowHeight * 0.72, 5, 15);
  const center = rowHeight / 2;

  ctx.clearRect(0, 0, width, height);
  ctx.save();

  ctx.beginPath();
  ctx.rect(keyboard, 0, lane, height);
  ctx.clip();
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.shadowBlur = 0;
  ctx.strokeStyle = palette.hover;
  ctx.lineWidth = clamp(rowHeight * 0.24, 2, 5);

  for (const line of connections) {
    ctx.globalAlpha = line.state === "past" ? 0.3 : 0.72;
    ctx.beginPath();
    ctx.moveTo(line.fromX, line.fromY);
    ctx.lineTo(line.toX, line.toY);
    ctx.stroke();
  }

  for (const note of notes) {
    const current = note.state === "current";
    const past = note.state === "past";
    const top = y(note.note) + (rowHeight - noteHeight) / 2;
    const alpha = past ? clamp(0.58 * (1 - (time - note.end) / 2.8), 0.08, 0.58) : 1;

    const gradient = ctx.createLinearGradient(0, top, 0, top + noteHeight);
    gradient.addColorStop(0, current ? palette.text : palette.highlight);
    gradient.addColorStop(0.34, palette.hover);
    gradient.addColorStop(1, palette.primary);

    ctx.globalAlpha = alpha;
    ctx.fillStyle = gradient;
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = current ? 1.8 : 1.1;
    ctx.shadowColor = current ? palette.hover : "transparent";
    ctx.shadowBlur = current ? 12 : 0;

    rect(ctx, note.left, top, Math.max(1.5, note.right - note.left), noteHeight);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
  ctx.save();

  ctx.globalAlpha = 1;
  ctx.shadowColor = palette.hover;
  ctx.shadowBlur = 10;
  ctx.strokeStyle = palette.hover;
  ctx.lineWidth = 2.2;

  ctx.beginPath();
  ctx.moveTo(playhead, 0);
  ctx.lineTo(playhead, height);
  ctx.stroke();

  if (pitch.detected && Number.isFinite(pitch.midi) && pitch.midi >= min && pitch.midi <= max) {
    ctx.beginPath();
    ctx.arc(playhead, y(pitch.midi) + center, Math.max(3, rowHeight * 0.2), 0, Math.PI * 2);
    ctx.fillStyle = palette.text;
    ctx.strokeStyle = ctx.shadowColor = palette.success;
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}
