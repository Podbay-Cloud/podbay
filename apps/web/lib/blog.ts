/**
 * Minimal file-free blog: posts are data here, rendered by app/blog. No MDX/CMS dependency —
 * cornerstone SEO content lives in one typed place and drops into the sitemap automatically.
 * Bodies are markdown-lite (## headings, - lists, blank-line paragraphs) — see BlogBody.
 *
 * NOTE (velsa): the two seed posts are FIRST DRAFTS in Podbay's honest voice (no overclaiming,
 * per the landing spec). Edit the copy / add posts freely — the plumbing (routes, metadata,
 * JSON-LD, sitemap) needs no changes.
 */
export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  /** ISO date; drives ordering + <time> + sitemap lastmod. */
  date: string;
  tags: string[];
  body: string;
}

const POSTS: BlogPost[] = [
  {
    slug: "run-claude-code-in-the-cloud",
    title: "Run Claude Code in the cloud: a persistent home for your coding agent",
    description:
      "Give your coding agent an always-on cloud workspace that keeps your repo, its context, and its setup between sessions — reachable from any browser, on the subscription you already pay for.",
    date: "2026-08-09",
    tags: ["claude-code", "cloud", "coding-agents"],
    body: `Running a coding agent on your laptop works right up until you close the lid. The session ends, the context is gone, and anything long-running stops with it. Podbay gives your agent a real home instead: a persistent cloud workspace that stays exactly as you left it.

## What "persistent" actually means

A Podbay pod keeps your \`~/work\` directory — your repo, your git state, your installed tools, your agent's settings — on a volume that survives restarts, suspends, and even image updates. You start a task, walk away, and come back to it still there. The agent isn't re-onboarding from scratch every time; it picks up where it left off.

## On the subscription you already pay for

Podbay runs the agent on **your** AI subscription — you sign in the way you already do, and there's no second metered bill for tokens. It's the same Claude Code you know, just living somewhere that doesn't sleep when your laptop does.

## Reach it from anywhere

Because the pod runs in the cloud, you reach it from any browser — the terminal, the live preview of whatever you're building, the whole workspace. You're not tethered to one machine.

## Start with a working foundation, not a blank chat

A pod isn't an empty box. Bring an existing GitHub repo and the agent maps the codebase, learns its conventions, and gets the test loop running before it changes anything. Or start from a prepared playbook and inspect, change, and make it yours.

That's the idea: your coding agent, always on, with everything it needs already in place.`,
  },
  {
    slug: "reach-your-coding-agent-from-your-phone",
    title: "Reach your coding agent from your phone",
    description:
      "Your agent runs in the cloud, so you can check on long-running work, review what it changed, and nudge it — from a browser on your phone, laptop closed.",
    date: "2026-08-09",
    tags: ["coding-agents", "remote", "workflow"],
    body: `The most underrated thing about running a coding agent in the cloud isn't speed — it's that you can walk away. The work keeps going, and you can look in on it from wherever you are.

## The laptop is no longer the bottleneck

When your agent lives on your laptop, checking on it means opening your laptop. With a Podbay pod, the agent runs in the cloud and you reach it from any browser — including the one on your phone. Kick off a long refactor before you leave, glance at the terminal from the bus, and see where it got to.

## See what it actually did

You don't want to babysit an agent — you want to review its work. From the pod you can watch the live terminal, see the changes it made, and push a branch when you're happy, all without being at your desk.

## It keeps running while you're gone

A Podbay pod runs 24/7; it only stops when you suspend it. So a task that takes an hour doesn't need you sitting there for an hour. Set it going, close the laptop, and check back when it's done.

Your coding agent, in the cloud, that you can actually reach — that's the whole pitch.`,
  },
];

export function getAllPosts(): BlogPost[] {
  return [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
}

export function getPost(slug: string): BlogPost | null {
  return POSTS.find((p) => p.slug === slug) ?? null;
}
