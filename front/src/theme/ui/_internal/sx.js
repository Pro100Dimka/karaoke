export default function mergeSx(sx, style) {
  return sx ? { ...sx, ...style } : style;
}
