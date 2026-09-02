import { useCallback, useRef } from "react";

export default function useOperationGate() {
  const operationRef = useRef(Symbol("karaoke-operation"));
  const waitersRef = useRef(new Set());
  const beginOperation = useCallback(() => {
    operationRef.current = Symbol("karaoke-operation");
    waitersRef.current.forEach((resolve) => resolve(null));
    waitersRef.current.clear();
    return operationRef.current;
  }, []);
  const waitForOperation = async (pending, operation) => {
    if (operation !== operationRef.current) return null;
    let cancel;
    const superseded = new Promise((resolve) => {
      cancel = resolve;
      waitersRef.current.add(resolve);
    });
    try {
      return await Promise.race([pending, superseded]);
    } finally {
      waitersRef.current.delete(cancel);
    }
  };
  return { operationRef, beginOperation, waitForOperation };
}
