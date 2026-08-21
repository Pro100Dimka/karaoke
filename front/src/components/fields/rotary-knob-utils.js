import { clamp } from "../../utils/math";

export function getRotaryDragValue({ value, lastY, clientY, min, max, fine = false }) {
  const sensitivity = fine ? 900 : 180;
  return clamp(value + ((lastY - clientY) / sensitivity) * (max - min), min, max);
}

export function getRotaryWheelValue({ value, deltaY, step, min, max, fine = false }) {
  const direction = deltaY < 0 ? 1 : -1;
  return clamp(value + direction * step * (fine ? 0.2 : 1), min, max);
}
