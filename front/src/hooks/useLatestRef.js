import { useRef } from "react";

export default function useLatestRef(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
