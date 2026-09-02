import { useEffect, useState } from "react";
import { onHardwareSuspensionChange } from "../utils/platform";

export default function useHardwareSuspended() {
  const [suspended, setSuspended] = useState(() => Boolean(globalThis.document?.hidden));
  useEffect(() => onHardwareSuspensionChange(setSuspended), []);
  return suspended;
}
