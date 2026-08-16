"use client";

import dynamic from "next/dynamic";
import type { PodTerminalProps } from "./pod-terminal";

// xterm.js is browser-only — load with no SSR.
const PodTerminal = dynamic(() => import("./pod-terminal"), {
  ssr: false,
  loading: () => <div className="term-loading">Connecting…</div>,
});

export default function PodTerminalLoader(props: PodTerminalProps) {
  return <PodTerminal {...props} />;
}
