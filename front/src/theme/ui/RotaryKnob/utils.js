import { clamp } from "../../../utils/math";

export function getRotaryDragValue({ value, lastY, clientY, min, max, fine = false }) {
  const sensitivity = fine ? 900 : 180;
  return clamp(value + ((lastY - clientY) / sensitivity) * (max - min), min, max);
}

export function getRotaryWheelValue({ value, deltaY, step, min, max, fine = false }) {
  const direction = deltaY < 0 ? 1 : -1;
  return clamp(value + direction * step * (fine ? 0.2 : 1), min, max);
}

export function getRotaryPointerValue({ clientX, clientY, rect, min, max }) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const cssAngle = (Math.atan2(clientX - centerX, centerY - clientY) * 180) / Math.PI;
  const clockwise = (cssAngle - 225 + 360) % 360;
  const ratio = clockwise <= 270 ? clockwise / 270 : clientX < centerX ? 0 : 1;
  return clamp(min + ratio * (max - min), min, max);
}
