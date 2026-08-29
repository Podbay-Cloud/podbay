import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANDING_PLAYBOOKS } from "../lib/landing-playbooks";

const outcomes = readFileSync(new URL("../app/landing-outcomes.tsx", import.meta.url), "utf8");
const computer = readFileSync(new URL("../app/landing-agent-computer.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/landing-agent-home.tsx", import.meta.url), "utf8");
const homePage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const agentStyles = readFileSync(
  new URL("../app/landing-agent.module.css", import.meta.url),
  "utf8",
);
const landingFooter = readFileSync(
  new URL("../components/landing-footer.tsx", import.meta.url),
  "utf8",
);

describe("revised landing bundles", () => {
  it("keeps the Outcomes promise while removing the absolute no-setup claim", () => {
    expect(outcomes).toContain("Build the idea.");
    expect(outcomes).toContain("infrastructure setup handled");
    expect(outcomes).not.toContain("No setup.");
    expect(outcomes).toContain("The project has somewhere to keep going.");
    expect(outcomes).not.toContain("Community creators will be able to publish");
  });

  it("uses one shared readiness model for both catalog-bearing bundles", () => {
    expect(outcomes).toContain("LANDING_PLAYBOOKS");
    expect(computer).toContain("LANDING_PLAYBOOKS");
    expect(LANDING_PLAYBOOKS["byo-project"].readiness).toBe("Ready");
    expect(LANDING_PLAYBOOKS["doc-qa"].readiness).toBe("Ready");
    expect(LANDING_PLAYBOOKS["first-10-customers"].readiness).toBe("Ready");
    expect(LANDING_PLAYBOOKS["morning-ops-robot"].readiness).toBe("Ready");
  });

  it("leads Agent Computer with the laptop benefit and lazy-loads playbook proof", () => {
    expect(computer).toContain("The always-on computer for your coding agent.");
    expect(computer).toContain("Close the lid &mdash; it keeps working.");
    expect(computer).toContain("Claude is the interface. Podbay is its computer.");
    expect(computer).not.toContain("Claude is the interface. Your pod is the computer.");
    expect(computer).toContain("Podbay runs the machine your session lives on.");
    expect(computer).toContain("Remote control gives you access. Podbay gives you uptime.");
    expect(computer).not.toContain("Podbay hosts that computer as a private VM");
    expect(computer).not.toContain("Your private pod keeps the project");
    expect(computer).toContain("Claude Desktop");
    expect(computer).toContain("Claude Mobile");
    expect(computer).toContain("Start on desktop");
    expect(computer).toContain("Laptop closes");
    expect(computer).toContain("Continue on phone");
    expect(computer).toContain("Your pod keeps working.");
    expect(computer).toContain("className={styles.continuityMoment}");
    expect(computer).toContain("styles.continuityMomentActive");
    expect(computer).not.toContain("1 · Start");
    expect(computer).not.toContain("2 · Laptop closes");
    expect(computer).not.toContain("3 · Continue");
    expect(computer).toContain("Investigate why invited users lose their team role after signup.");
    expect(computer).toContain("I won&rsquo;t change existing records without you.");
    expect(computer).toContain("Should I backfill existing pending invites too?");
    expect(computer).toContain("Yes—pending invites only.");
    expect(computer).toContain("project-aurora pod");
    expect(computer).toContain(
      "Claude can install packages, run services, schedule jobs, and put your project on a live URL.",
    );
    expect(computer).not.toContain("A private cloud VM hosted by Podbay");
    expect(computer).not.toContain("The pod stays available while your laptop is closed.");
    expect(computer).toContain("Claude Remote Control");
    expect(computer).not.toContain("Podbay computer");
    expect(computer).not.toContain("Tests passed");
    expect(computer).not.toContain("Preview updated");
    expect(computer).toContain("Self-host it");
    expect(computer).toContain("Give Claude a real home");
    expect(computer).not.toContain("Give Claude a computer");
    expect(computer).toContain("Use your existing Claude subscription.");
    expect(computer).toContain("Official CLI · No token markup");
    expect(computer).toContain("Codex support is in pilot.");
    expect(computer).toContain("className={styles.subscriptionCopy}");
    expect(computer).toContain("className={styles.pilotNote}");
    expect(computer).not.toContain("className={styles.pilotBadge}");
    expect(computer).not.toContain("Codex support · Pilot");
    expect(computer).toContain("A full cloud computer");
    expect(computer).toContain(
      "Each pod gets CPU, memory, disk, and a persistent filesystem. Claude can install packages, run Postgres, start dev servers, and expose a private or public URL.",
    );
    expect(computer).not.toContain("Your resources stay yours");
    expect(computer).not.toContain("Browser terminal");
    expect(computer).not.toContain("TerminalSquare");
    expect(computer).toContain('loading="lazy"');
    expect(computer).toContain("Claude gets what it needs inside the pod. Your personal machine stays outside the boundary.");
    expect(computer).toContain("Your Claude account");
    expect(computer).toContain("Project access only");
    expect(computer).toContain("Admin access when needed");
    expect(computer).toContain("No path back to your laptop");
    expect(computer).toContain("className={styles.trustGrid}");
    expect(computer).not.toContain("Official Claude Code CLI</strong>");
    expect(computer).not.toContain("Isolated workspace boundary");
    expect(computer).not.toContain("Disposable workspace boundary");
  });

  it("carries the real-home and private-cloud definition into search and social metadata", () => {
    expect(homePage).toContain("Podbay — Give Claude a real home in the cloud");
    expect(homePage).toContain(
      "A Podbay pod is a private cloud VM with Claude Code, your project, and tools inside—always on, reachable anywhere, using your existing Claude subscription.",
    );
    expect(homePage).not.toContain("Podbay — An always-on workspace for your coding agent");
  });

  it("keeps continuity labels and Claude surfaces at full opacity", () => {
    expect(agentStyles).not.toMatch(/\.continuityMoment\s*\{[^}]*opacity/);
    expect(agentStyles).not.toMatch(/\.continuityMoment\s*\{[^}]*filter/);
  });

  it("pivots the two side screens inward only in the three-column layout", () => {
    expect(agentStyles).toContain(
      ".continuityMoment:first-child article { transform: perspective(1100px) rotateY(4deg); transform-origin: right center; }",
    );
    expect(agentStyles).toContain(
      ".continuityMoment:last-child article { transform: perspective(1100px) rotateY(-4deg); transform-origin: left center; }",
    );
    expect(agentStyles).toContain(
      ".continuityMoment:first-child article,\n  .continuityMoment:last-child article { transform: none; }",
    );
  });

  it("mutes side-screen copy without dimming the whole surfaces", () => {
    expect(agentStyles).toContain(
      ".continuityMoment:not(.continuityMomentActive) .surfaceTitle { color: #a5b0b4; }",
    );
    expect(agentStyles).toContain(
      ".continuityMoment:not(.continuityMomentActive) .desktopChat p,\n.continuityMoment:not(.continuityMomentActive) .mobileChat p { color: #aeb8bc; }",
    );
    expect(agentStyles).not.toContain(".continuityMoment:not(.continuityMomentActive) { opacity:");
  });

  it("centers the subscription reassurance and keeps pilot status as quiet copy", () => {
    expect(agentStyles).toMatch(/\.subscriptionLine\s*\{[^}]*align-items: center/);
    expect(agentStyles).toMatch(/\.subscriptionCopy\s*\{[^}]*display: grid/);
    expect(agentStyles).toMatch(/\.pilotNote\s*\{[^}]*color:[^}]*font-size: 11px/);
    expect(agentStyles).not.toContain(".pilotBadge");
    expect(agentStyles).not.toMatch(/\.subscriptionLine svg\s*\{[^}]*margin-top/);
  });

  it("uses one branded legal footer in canonical and forced-preview landings", () => {
    for (const bundle of [outcomes, computer, home]) {
      expect(bundle).toContain("<LandingFooter");
      expect(bundle).not.toContain("<footer");
    }
    expect(homePage).not.toContain("<SiteFooter");
    expect(landingFooter).toContain('href="/privacy"');
    expect(landingFooter).toContain('href="/terms"');
    expect(landingFooter).toContain('href="/cookies"');
    expect(landingFooter).toContain('href="mailto:support@podbay.cloud"');
  });
});
