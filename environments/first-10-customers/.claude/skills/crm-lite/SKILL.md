---
name: crm-lite
description: Build and maintain a lightweight CRM inside the pod's Next.js app — a leads table + conversation log that is the user's persistent, returnable pipeline. Use when the user is tracking prospects/outreach for the first-10-customers playbook.
---

# CRM-lite — the living pipeline

The durable artifact of the "first 10 customers" playbook. The pod is not a one-shot generator;
this CRM is what makes returning tomorrow mean **"work the pipeline,"** not start over. Build it
early and keep it current as outreach happens.

## One app, two audiences (routing + access — IMPORTANT)

The pod serves ONE Next.js app at ONE preview URL, but the landing and the CRM have opposite
audiences, so split them by route and protect the CRM:

- **`/` = the landing page** — PUBLIC. This is what prospects see; it's the shareable URL.
- **`/crm` = the pipeline dashboard** — PRIVATE, for the founder only. **Gate it behind a simple
  password** (middleware on `/crm/*`): read the password from the `CRM_PASSWORD` env var (a podbay
  secret). If `CRM_PASSWORD` is unset, generate a strong one, tell the founder, and instruct them to
  set it in the pod's Secrets — never commit a password to the repo.

This lets the preview be **public by default** (so the landing is instantly shareable) while `/crm`
stays protected. Only ever share the bare `/` URL with prospects.

**Ordering matters — the preview is PUBLIC from launch:** put the `/crm` password gate in place
**before** you add any real leads. Never leave `/crm` reachable without the gate while it holds real
pipeline data.

## What to build

A small, real feature inside the pod's Next.js + Tailwind + shadcn/ui app (not a mockup):

- **Leads** — one row per prospect: name, company/handle, source (where they came from), fit notes
  (why they match the ICP), status, next action, next-action date.
- **Conversations** — a timestamped log per lead: outreach sent (channel + the actual message),
  replies, notes. Every drafted/sent message is recorded here.
- **The dashboard at `/crm`** (password-gated): the leads table (filter/sort by status), a lead
  detail with its conversation log, and simple counts (contacted / replied / conversation booked).

## How to build it

1. **Spec first** (see the spec-driven rule): a short OpenSpec proposal for the data model +
   pages before writing code, so the schema is durable and legible.
2. **Persistence:** start with the simplest durable store that survives restarts — a local
   SQLite/Prisma DB or a committed JSON store in the repo. (A hosted Postgres is a later upgrade;
   don't block the first pipeline on it.) The pod's volume persists, so on-disk state is fine.
3. **Snappy, not reloady (REQUIRED):** the CRM is a client app — filtering, status changes, adding
   and editing a lead, and opening a lead detail must be **instant**, never a full-page reload that
   takes seconds. Use client components + local state with **optimistic updates**; persist in the
   background (an API route / server action) without blocking the UI. If every click reloads, it's
   wrong — fix it.
4. **The whole lead row is clickable** (opens the lead), not just the name.
5. **UI: this is a TOOL, keep it legible and standard — NOT a showcase.** A clean sans-serif
   (the scaffold default is fine — do not swap in an editorial/display serif), comfortable sizes
   (body ≥14px, ≥16px on mobile so it doesn't feel tiny), generous spacing, shadcn/ui components
   (table, badge for status, dialog for add/edit, cards for counts). Save distinctive/bold design
   for the LANDING page — the pipeline just needs to be fast and easy to read.
6. **Status vocabulary** (keep it small): `new → contacted → replied → conversation → won/lost`.
   The playbook's success metric is reaching **conversation** for 10 leads.

## Keep it current

- When you draft outreach, **write it into the lead's conversation log** and set status/next
  action — drafting and tracking are one motion.
- On session start, surface the pipeline state ("N contacted, M replied, K conversations booked")
  and the leads whose next action is due.
- On session end, make sure every new prospect/message is captured before the pod sleeps.

## Definition of done (this skill's slice)

Prospects can open `/` and see the landing; the founder opens `/crm` (after the password gate) and
sees their real leads and conversations, adds/updates a lead, and reads the full outreach history —
and it's all still there after the pod sleeps and wakes. Making the preview public exposes only the
landing, never `/crm`.
