"use client";

import { useEffect, useState } from "react";

/**
 * A counter that ticks locally from a fixed start time.
 *
 * The point is not precision, it is LIVENESS: an operator staring at a stuck
 * update needs to see the number move to know the page isn't dead. Ticking on the
 * client costs nothing, so the seconds advance even between the page's (much
 * rarer) server refreshes.
 */
export default function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return <span className="tabular-nums">{s < 90 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span>;
}
