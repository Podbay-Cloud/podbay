import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTestDb,
  landingExperimentAssignments,
  landingExperimentAudit,
  landingExperimentEvents,
  user,
  type Database,
} from "@podbay/db";
import {
  getExperimentDetail,
  listExperimentSummaries,
  pinExperimentVariant,
  recordAttributedUserEvent,
  recordLandingEvent,
  stopExperiment,
} from "../lib/landing-experiment-store";
import {
  LANDING_EXPERIMENT,
  AGENT_COMPUTER_LANDING_2026_08,
  AGENT_COMPUTER_LANDING_TAXONOMY_2026_08,
  JULY_LANDING_EXPERIMENT,
  AUGUST_LANDING_EXPERIMENT,
  chooseLandingVariant,
  isCrawler,
  isLandingEvent,
  isLandingVariant,
  isLandingVisitorId,
} from "../lib/landing-experiment-config";
import { middleware } from "../middleware";

let close: (() => Promise<void>) | null = null;

afterEach(async () => {
  await close?.();
  close = null;
  vi.restoreAllMocks();
});

async function freshDb(): Promise<Database> {
  const test = await createTestDb();
  close = test.close;
  return test.db;
}

describe("landing experiment configuration", () => {
  it("has stable semantic assignment boundaries and strict allowlists", () => {
    // Active experiment is the agent-computer A/A: 50/50 [agent-computer, outcomes].
    expect(chooseLandingVariant(0)).toBe("agent-computer");
    expect(chooseLandingVariant(0.49)).toBe("agent-computer");
    expect(chooseLandingVariant(0.5)).toBe("outcomes");
    expect(chooseLandingVariant(0.99)).toBe("outcomes");
    // agent-home is still a valid variant globally (kept for history), just not in the active split.
    expect(chooseLandingVariant(0.5, AUGUST_LANDING_EXPERIMENT)).toBe("agent-computer");
    expect(isLandingVariant("agent-computer")).toBe(true);
    expect(isLandingVariant("agent-home")).toBe(true);
    expect(isLandingVariant("v2")).toBe(false);
    expect(isLandingEvent("signin_completed")).toBe(true);
    expect(isLandingEvent("anything")).toBe(false);
    expect(isLandingVisitorId("visitor_1234567890abcdef")).toBe(true);
    expect(isLandingVisitorId("../visitor")).toBe(false);
  });

  it("recognizes crawlers without classifying ordinary browsers", () => {
    expect(isCrawler("Mozilla/5.0 Googlebot/2.1")).toBe(true);
    expect(isCrawler("facebookexternalhit/1.1")).toBe(true);
    expect(isCrawler("Mozilla/5.0 Chrome/140 Safari/537.36")).toBe(false);
  });
});

describe("landing experiment request assignment", () => {
  it("assigns on the first root response and preserves a valid repeat assignment", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    const first = middleware(new NextRequest("https://podbay.cloud/"));
    const variant = first.cookies.get(LANDING_EXPERIMENT.cookie.variant)?.value;
    const visitor = first.cookies.get(LANDING_EXPERIMENT.cookie.visitor)?.value;
    expect(variant).toBe("outcomes"); // 0.75 → the second A/A arm (still SERVED agent-computer)
    expect(isLandingVisitorId(visitor)).toBe(true);

    const repeat = middleware(
      new NextRequest("https://podbay.cloud/", {
        headers: {
          cookie: `${LANDING_EXPERIMENT.cookie.variant}=${variant}; ${LANDING_EXPERIMENT.cookie.visitor}=${visitor}`,
        },
      }),
    );
    expect(repeat.cookies.getAll()).toHaveLength(0);
    expect(
      repeat.headers.get(`x-middleware-request-${LANDING_EXPERIMENT.requestHeaders.variant}`),
    ).toBe("outcomes");
  });

  it("recovers invalid cookies, excludes crawlers, and leaves previews untouched", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    const recovered = middleware(
      new NextRequest("https://podbay.cloud/", {
        headers: { cookie: `${LANDING_EXPERIMENT.cookie.variant}=v2; pb_landing_visitor=bad` },
      }),
    );
    expect(recovered.cookies.get(LANDING_EXPERIMENT.cookie.variant)?.value).toBe("agent-computer");
    expect(
      isLandingVisitorId(recovered.cookies.get(LANDING_EXPERIMENT.cookie.visitor)?.value),
    ).toBe(true);

    const crawler = middleware(
      new NextRequest("https://podbay.cloud/", {
        headers: { "user-agent": "Mozilla/5.0 Googlebot/2.1" },
      }),
    );
    expect(crawler.cookies.getAll()).toHaveLength(0);
    expect(
      crawler.headers.get(`x-middleware-request-${LANDING_EXPERIMENT.requestHeaders.eligible}`),
    ).toBe("0");

    const preview = middleware(
      new NextRequest("https://podbay.cloud/preview/landing/agent-computer"),
    );
    expect(preview.cookies.getAll()).toHaveLength(0);
  });
});

describe("landing experiment persistence", () => {
  it("deduplicates funnel events and reports health without exposing visitor ids", async () => {
    const db = await freshDb();
    const input = {
      visitorId: "visitor_1234567890abcdef",
      variant: "outcomes" as const,
      type: "landing_exposure" as const,
      referrer: "https://example.com/post",
      utmSource: "newsletter",
      utmCampaign: "alpha",
    };
    expect(await recordLandingEvent(input, db)).toBe("recorded");
    expect(await recordLandingEvent(input, db)).toBe("duplicate");

    const detail = await getExperimentDetail(undefined, db);
    expect(detail?.exposures).toBe(1);
    expect(detail?.health.duplicateEvents).toBe(1);
    expect(detail?.acquisition[0]).toMatchObject({
      source: "newsletter",
      campaign: "alpha",
      visitors: 1,
    });
    expect(detail?.recentEvents[0]).not.toHaveProperty("visitorId");
    expect(await db.select().from(landingExperimentEvents)).toHaveLength(1);
  });

  it("keeps ineligible assignments out of the measured funnel", async () => {
    const db = await freshDb();
    const result = await recordLandingEvent(
      {
        visitorId: "visitor_0000000000000000",
        variant: "agent-computer",
        type: "landing_exposure",
        eligible: false,
      },
      db,
    );
    expect(result).toBe("excluded");
    expect(await db.select().from(landingExperimentAssignments)).toHaveLength(1);
    expect(await db.select().from(landingExperimentEvents)).toHaveLength(0);
    const detail = await getExperimentDetail(undefined, db);
    expect(detail?.eligibleVisitors).toBe(0);
    expect(detail?.health.ineligibleAssignments).toBe(1);
  });

  it("links authenticated activation to the original assignment", async () => {
    const db = await freshDb();
    await db.insert(user).values({ id: "u_1", name: "Builder", email: "builder@example.com" });
    await recordLandingEvent(
      {
        visitorId: "visitor_1111111111111111",
        variant: "agent-computer",
        type: "landing_exposure",
      },
      db,
    );
    await recordLandingEvent(
      {
        visitorId: "visitor_1111111111111111",
        variant: "agent-computer",
        type: "signin_completed",
        userId: "u_1",
      },
      db,
    );
    await recordAttributedUserEvent("u_1", "pod_created", "pod-1", db);
    await recordAttributedUserEvent("u_1", "agent_connected", "pod-1", db);

    const detail = await getExperimentDetail(undefined, db);
    const funnel = detail?.variants["agent-computer"]?.funnel;
    expect(funnel?.signin_completed).toBe(1);
    expect(funnel?.pod_created).toBe(1);
    expect(funnel?.agent_connected).toBe(1);
    expect(detail?.recentEvents.every((event) => !("visitorId" in event))).toBe(true);
  });

  it("stops and pins only declared variants with an immutable audit trail", async () => {
    const db = await freshDb();
    await db.insert(user).values({ id: "admin", name: "Admin", email: "admin@example.com" });

    const stopped = await stopExperiment("admin", LANDING_EXPERIMENT.id, db);
    expect(stopped.status).toBe("stopped");
    expect(stopped.pinnedVariant).toBe("agent-computer"); // the active fallback

    const pinned = await pinExperimentVariant("admin", LANDING_EXPERIMENT.id, "outcomes", db);
    expect(pinned.pinnedVariant).toBe("outcomes");
    await expect(pinExperimentVariant("admin", LANDING_EXPERIMENT.id, "unknown", db)).rejects.toThrow(
      /Unknown landing variant/,
    );
    await expect(stopExperiment("admin", JULY_LANDING_EXPERIMENT.id, db)).rejects.toThrow(
      /read-only/,
    );

    const audit = await db.select().from(landingExperimentAudit);
    expect(audit.map((entry) => entry.action)).toEqual(["stop", "pin"]);
  });

  it("keeps July history queryable while new activation attaches only to August", async () => {
    const db = await freshDb();
    await db.insert(user).values({ id: "u_history", name: "History", email: "history@example.com" });
    await recordLandingEvent(
      {
        experimentId: JULY_LANDING_EXPERIMENT.id,
        visitorId: "visitor_july_1234567890",
        variant: "outcomes",
        type: "landing_exposure",
        userId: "u_history",
      },
      db,
    );
    await recordLandingEvent(
      {
        experimentId: AGENT_COMPUTER_LANDING_TAXONOMY_2026_08.id,
        visitorId: "visitor_taxonomy_123456",
        variant: "agent-computer",
        type: "landing_exposure",
      },
      db,
    );
    await recordLandingEvent(
      {
        visitorId: "visitor_active_12345678",
        variant: "agent-computer",
        type: "landing_exposure",
        userId: "u_history",
      },
      db,
    );
    await recordAttributedUserEvent("u_history", "pod_created", "pod-history", db);

    const july = await getExperimentDetail(JULY_LANDING_EXPERIMENT.id, db);
    const taxonomy = await getExperimentDetail(AGENT_COMPUTER_LANDING_TAXONOMY_2026_08.id, db);
    const active = await getExperimentDetail(LANDING_EXPERIMENT.id, db);
    expect(july?.variants.outcomes?.funnel.landing_exposure).toBe(1);
    expect(july?.variants.outcomes?.funnel.pod_created).toBe(0);
    expect(taxonomy?.variants["agent-computer"]?.funnel.landing_exposure).toBe(1);
    expect(taxonomy?.variants["agent-computer"]?.funnel.pod_created).toBe(0);
    expect(active?.variants["agent-computer"]?.funnel.landing_exposure).toBe(1);
    expect(active?.variants["agent-computer"]?.funnel.pod_created).toBe(1);
    // All five definitions are listed newest-first. Both preceding agent-computer runs remain
    // queryable after the real-home/cloud message receives a distinct active experiment id.
    expect((await listExperimentSummaries(db)).map((entry) => entry.id)).toEqual([
      LANDING_EXPERIMENT.id,
      AGENT_COMPUTER_LANDING_TAXONOMY_2026_08.id,
      AGENT_COMPUTER_LANDING_2026_08.id,
      AUGUST_LANDING_EXPERIMENT.id,
      JULY_LANDING_EXPERIMENT.id,
    ]);
  });

  it("reports per-variant acquisition and warns on a materially imbalanced assignment", async () => {
    const db = await freshDb();
    await db.insert(landingExperimentAssignments).values(
      Array.from({ length: 30 }, (_, index) => ({
        experimentId: LANDING_EXPERIMENT.id,
        visitorId: `visitor_balance_${String(index).padStart(4, "0")}`,
        variant: "outcomes" as const,
        eligible: true,
        utmSource: "launch",
        utmCampaign: "abc",
      })),
    );

    const detail = await getExperimentDetail(LANDING_EXPERIMENT.id, db);
    expect(detail?.assignmentBalance.status).toBe("warning");
    expect(detail?.acquisition[0]).toMatchObject({
      variant: "outcomes",
      source: "launch",
      campaign: "abc",
      visitors: 30,
    });
  });
});
