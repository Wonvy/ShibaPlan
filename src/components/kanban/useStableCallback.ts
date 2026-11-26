import { useCallback, useRef } from "react";

/**
 * Returns a referentially stable function that always invokes the latest
 * version of `fn` (the closure from the most recent render).
 *
 * Only call the returned function from event handlers / effects / timers,
 * never during render.
 */
export function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R
): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
