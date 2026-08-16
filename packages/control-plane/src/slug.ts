import { randomBytes } from "node:crypto";
import { uniqueNamesGenerator, adjectives, animals } from "unique-names-generator";

/**
 * Generate a memorable pod slug: `adjective-animal-4hex` (e.g. "brave-otter-4f2a").
 * Words come from unique-names-generator's curated dictionaries (~1400 adjectives ×
 * ~350 animals), so slugs are varied and vetted; the 4-hex suffix + the store-lookup
 * retry in launchPod guarantee uniqueness.
 */
export function generateSlug(): string {
  const words = uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: "-",
    style: "lowerCase",
  });
  const stem = words
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${stem}-${randomBytes(2).toString("hex")}`;
}

/** adjective(s)-animal(s)-4hex, all lowercase, hyphen-separated. */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{4}$/;
