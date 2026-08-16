"use client";

import { Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * The relay's ⓘ — what it is and its limits, in plain, readable sentences. The owner is
 * lending their own connection, so the boundary belongs here where they decide — but the
 * whole detail lives in the README. This is the glance, not the manual: full sentences a
 * person reads without decoding, then a link.
 */
const LIMITS = [
  "It only runs while you do — close it and the pod loses this access.",
  "It reaches the public web only, never your home network or files.",
  "You can see everything it fetched; Podbay keeps only the site’s name.",
  "It stays signed out until you choose to log in to a specific site.",
];

export function RelayInfoDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="What is the relay?"
          title="What is the relay?"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        >
          <Info className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Relay</DialogTitle>
          <DialogDescription>
            Some sites block your pod just for living in a datacenter. The relay fetches those through{" "}
            <span className="font-medium text-foreground">your own computer</span> instead — so they come
            from you, only for the sites you choose.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-2 text-[13px] leading-relaxed text-muted-foreground">
          {LIMITS.map((l) => (
            <li key={l} className="flex gap-2.5">
              <span aria-hidden className="mt-0.5 text-success">✓</span>
              <span>{l}</span>
            </li>
          ))}
        </ul>

        <p className="text-[12.5px] text-muted-foreground">
          It&rsquo;s not an anonymous proxy — it&rsquo;s your own connection, for your own pod.{" "}
          <a
            href="https://www.npmjs.com/package/@podbay/relay"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--accent-light)] hover:underline"
          >
            How it works ↗
          </a>
        </p>
      </DialogContent>
    </Dialog>
  );
}
