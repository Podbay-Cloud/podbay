import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DASHBOARD_PROOF_POINTS } from "@/components/env-gallery";
import { LANDING_PLAYBOOKS } from "@/lib/landing-playbooks";

const source = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

describe("dashboard presentation contract", () => {
  it("explains that the catalog creates a pod without making setup promises", () => {
    const page = source("app/dashboard/environments/page.tsx");
    expect(page).toContain('title="Create a pod"');
    expect(page).toContain(
      "Choose a guided playbook for a specific outcome, or an open-ended workspace for ongoing development.",
    );
    expect(page).not.toContain("agent already signed in");
    expect(page).not.toContain("preview URL live");
  });

  it("uses customer-facing catalog labels and proof instead of internal taxonomy", () => {
    const gallery = source("components/env-gallery.tsx");
    expect(gallery).toContain("Choose a goal. Your agent leads the work step by step.");
    expect(gallery).toContain("View details");
    expect(gallery).toContain("Start playbook");
    expect(gallery).toContain("Launch workspace");
    expect(gallery).toContain("Requires ${e.capability.requiredSecretCount} API key");
    expect(gallery).not.toContain('e.capability.webFetch ? "web research"');
    expect(gallery).not.toContain("e.title.charAt(0)");
  });

  it("keeps proof chips concise and consistently capitalized", () => {
    for (const [name, points] of Object.entries(DASHBOARD_PROOF_POINTS)) {
      expect(points.length, `${name} has too many proof chips`).toBeLessThanOrEqual(3);
      for (const point of points) {
        expect(point[0], `${name}: ${point}`).toBe(point[0].toUpperCase());
      }
    }
  });

  it("classifies BYO consistently without rewriting frozen landing proof", () => {
    expect(LANDING_PLAYBOOKS["byo-project"].kind).toBe("workspace");
    expect(LANDING_PLAYBOOKS["doc-qa"].kind).toBe("playbook");
    expect(LANDING_PLAYBOOKS["byo-project"].proof).toBe(
      "Repo orientation · verified commands · testing and review skills",
    );
  });

  it("names the pod action and empty state directly", () => {
    const page = source("app/dashboard/page.tsx");
    expect(page).toContain("<Plus");
    expect(page).toContain(">New pod</Link>");
    expect(page).toContain("No pods yet");
    expect(page).toContain("Create your first pod");
    expect(page).toContain("environmentTitle={environmentTitles.get(p.environmentName)");
    expect(page).not.toContain("agent already in it");
  });

  it("keeps the whole-card link separate from its action buttons", () => {
    const card = source("components/pod-card.tsx");
    expect(card).toContain("environmentTitle: string");
    expect(card).toContain("Update available");
    expect(card).toContain("aria-label={`Open ${display}`}");
    expect(card).not.toContain('role="link"');
    expect(card).not.toContain("tabIndex={0}");
  });

  it("offers one details tab stop per catalog card", () => {
    const gallery = source("components/env-gallery.tsx");
    expect(gallery).not.toContain("aria-label={`View details for ${e.title}`}");
    expect(gallery).toContain("<span className=\"text-[15px] font-semibold\">{e.title}</span>");
  });

  it("states slot usage and the support action explicitly", () => {
    const meter = source("components/slot-meter.tsx");
    expect(meter).toContain("{used} of {cap}");
    expect(meter).toContain("slots used");
    expect(meter).toContain("Request more slots");
    expect(meter).not.toContain("Need more?");
  });
});
