import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneRepo, parseGithubRemote } from "../src/gh-auth.js";

describe("parseGithubRemote — owner/repo from ~/work's origin", () => {
  it("parses https + ssh remotes, with or without .git", () => {
    expect(parseGithubRemote("https://github.com/velsa/podbay.git")).toBe("velsa/podbay");
    expect(parseGithubRemote("https://github.com/velsa/podbay")).toBe("velsa/podbay");
    expect(parseGithubRemote("git@github.com:velsa/podbay.git")).toBe("velsa/podbay");
    expect(parseGithubRemote("https://github.com/octocat/Hello-World/\n")).toBe("octocat/Hello-World");
  });
  it("returns null for a non-GitHub or empty remote", () => {
    expect(parseGithubRemote("https://gitlab.com/x/y.git")).toBeNull();
    expect(parseGithubRemote("")).toBeNull();
    expect(parseGithubRemote("not a url")).toBeNull();
  });
});

// Exercises the REAL clone mechanics of Phase C (git clone → cp -a → temp cleanup,
// with the empty-check + refusal) against a local file:// origin — no network, and
// never the pod's real ~/work. This is the path that was shipped but never tested:
// "clone into an EMPTY workspace actually lands the repo (incl. .git + dotfiles)".
let root: string;
let origin: string;
const urlFor = () => `file://${origin}`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "podbay-clone-test-"));
  // A real origin repo with a normal file, a DOTFILE, and a NESTED dir — so we prove
  // `cp -a '.../.'` copies hidden entries and subtrees, and .git survives the move.
  origin = join(root, "origin");
  mkdirSync(origin);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: origin, env: { ...process.env, HOME: root } });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "t");
  writeFileSync(join(origin, "README.md"), "# hello\n");
  writeFileSync(join(origin, ".env.example"), "KEY=value\n"); // a dotfile
  mkdirSync(join(origin, "src"));
  writeFileSync(join(origin, "src", "index.ts"), "export const x = 1;\n"); // a nested file
  git("add", "-A");
  git("commit", "-q", "-m", "init");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("cloneRepo (Phase C: add-GitHub → clone into ~/work)", () => {
  it("clones into an EMPTY workspace — files, dotfiles, nested tree, and .git all land", async () => {
    const work = join(root, "work-empty");
    mkdirSync(work);

    const r = await cloneRepo("owner/repo", { workDir: work, urlFor });

    expect(r).toEqual({ ok: true, dest: work });
    expect(readFileSync(join(work, "README.md"), "utf8")).toBe("# hello\n");
    expect(existsSync(join(work, ".env.example"))).toBe(true); // dotfile copied
    expect(existsSync(join(work, "src", "index.ts"))).toBe(true); // nested tree copied
    expect(existsSync(join(work, ".git"))).toBe(true); // it's a real working clone
    expect(existsSync(join(work, ".podbay-clone"))).toBe(false); // temp dir cleaned up
  });

  it("REFUSES a non-empty workspace and leaves it untouched (never overwrites work)", async () => {
    const work = join(root, "work-taken");
    mkdirSync(work);
    writeFileSync(join(work, "keep.txt"), "precious\n");

    const r = await cloneRepo("owner/repo", { workDir: work, urlFor });

    expect(r).toEqual({ ok: false, reason: "not-empty" });
    expect(readFileSync(join(work, "keep.txt"), "utf8")).toBe("precious\n"); // untouched
    expect(existsSync(join(work, ".git"))).toBe(false); // nothing was cloned in
  });

  it("rejects an invalid repo name before touching the workspace", async () => {
    const work = join(root, "work-invalid");
    mkdirSync(work);

    const r = await cloneRepo("not a valid repo!", { workDir: work, urlFor });

    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(existsSync(join(work, ".git"))).toBe(false);
  });

  it("with force, REPLACES a non-empty workspace with the repo", async () => {
    const work = join(root, "work-overwrite");
    mkdirSync(work);
    writeFileSync(join(work, "old.txt"), "stale\n");
    mkdirSync(join(work, "olddir"));
    writeFileSync(join(work, "olddir", "nested.txt"), "also stale\n");

    const r = await cloneRepo("owner/repo", { workDir: work, urlFor, force: true });

    expect(r).toEqual({ ok: true, dest: work });
    expect(existsSync(join(work, "old.txt"))).toBe(false); // old top-level file gone
    expect(existsSync(join(work, "olddir"))).toBe(false); // old subtree gone
    expect(readFileSync(join(work, "README.md"), "utf8")).toBe("# hello\n"); // repo landed
    expect(existsSync(join(work, ".git"))).toBe(true);
    expect(existsSync(join(work, ".podbay-clone"))).toBe(false);
  });

  it("a FAILED forced clone leaves the existing workspace untouched", async () => {
    const work = join(root, "work-failsafe");
    mkdirSync(work);
    writeFileSync(join(work, "precious.txt"), "do not lose\n");

    // urlFor points at an origin that doesn't exist → git clone fails → cloneRepo rejects.
    await expect(
      cloneRepo("owner/repo", {
        workDir: work,
        urlFor: () => `file://${join(root, "does-not-exist")}`,
        force: true,
      }),
    ).rejects.toThrow();

    // The clone-first ordering means the wipe never ran — existing work survives.
    expect(readFileSync(join(work, "precious.txt"), "utf8")).toBe("do not lose\n");
    expect(existsSync(join(work, ".podbay-clone"))).toBe(false); // no half-clone left behind
  });
});
