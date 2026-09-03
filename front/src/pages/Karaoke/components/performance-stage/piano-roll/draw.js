import { clamp } from "../../../../../utils/math";

const roundRect = (context, x, y, width, height, radius) => {
  context.beginPath();
  context.roundRect?.(x, y, width, height, radius);
  if (!context.roundRect) context.rect(x, y, width, height);
};

export function drawPianoRoll(context, frame, palette, pitch) {
  context.clearRect(0, 0, frame.width, frame.height);
  context.save();
  context.beginPath();
  context.rect(frame.keyboard, 0, frame.lane, frame.height);
  context.clip();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const connection of frame.connections ?? []) {
    context.globalAlpha = connection.state === "past" ? 0.3 : 0.72;
    context.strokeStyle = palette.hover;
    context.lineWidth = clamp(frame.rowHeight * 0.24, 2, 5);
    context.beginPath();
    context.moveTo(connection.fromX, connection.fromY);
    context.lineTo(connection.toX, connection.toY);
    context.stroke();
  }
  for (const note of frame.notes) {
    const height = clamp(frame.rowHeight * 0.72, 5, 15);
    const y = frame.y(note.note) + (frame.rowHeight - height) / 2;
    const opacity =
      note.state === "past" ? clamp(0.58 * (1 - (frame.time - note.end) / 2.8), 0.08, 0.58) : 1;
    const gradient = context.createLinearGradient(0, y, 0, y + height);
    gradient.addColorStop(0, note.state === "current" ? palette.text : palette.highlight);
    gradient.addColorStop(0.34, palette.hover);
    gradient.addColorStop(1, palette.primary);
    context.globalAlpha = opacity;
    context.fillStyle = gradient;
    context.strokeStyle = palette.highlight;
    context.lineWidth = note.state === "current" ? 1.8 : 1.1;
    context.shadowColor = note.state === "current" ? palette.hover : "transparent";
    context.shadowBlur = note.state === "current" ? 12 : 0;
    roundRect(context, note.left, y, Math.max(1.5, note.right - note.left), height, height / 2);
    context.fill();
    context.stroke();
  }
  context.restore();
  context.save();
  context.globalAlpha = 1;
  context.shadowBlur = 10;
  context.shadowColor = palette.hover;
  context.strokeStyle = palette.hover;
  context.lineWidth = 2.2;
  context.beginPath();
  context.moveTo(frame.playhead, 0);
  context.lineTo(frame.playhead, frame.height);
  context.stroke();
  if (
    pitch.detected &&
    Number.isFinite(pitch.midi) &&
    pitch.midi >= frame.min &&
    pitch.midi <= frame.max
  ) {
    const y = frame.y(pitch.midi) + frame.rowHeight / 2;
    context.shadowColor = palette.success;
    context.fillStyle = palette.text;
    context.strokeStyle = palette.success;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(frame.playhead, y, Math.max(3, frame.rowHeight * 0.2), 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();
}
