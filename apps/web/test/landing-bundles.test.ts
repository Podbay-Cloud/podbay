import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANDING_PLAYBOOKS } from "../lib/landing-playbooks";

const outcomes = readFileSync(new URL("../app/landing-outcomes.tsx", import.meta.url), "utf8");
const computer = readFileSync(new URL("../app/landing-agent-computer.tsx", import.meta.url), "utf8");
const podNetwork = readFileSync(
  new URL("../app/landing-pod-network.tsx", import.meta.url),
  "utf8",
);
const home = readFileSync(new URL("../app/landing-agent-home.tsx", import.meta.url), "utf8");
const homePage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const rootLayout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const landingPlaybooks = readFileSync(
  new URL("../lib/landing-playbooks.ts", import.meta.url),
  "utf8",
);
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

  it("keeps catalog playbooks in the outcomes bundle, not the computer pitch", () => {
    expect(outcomes).toContain("LANDING_PLAYBOOKS");
    expect(computer).not.toContain("LANDING_PLAYBOOKS");
    expect(LANDING_PLAYBOOKS["byo-project"].readiness).toBe("Ready");
    expect(LANDING_PLAYBOOKS["doc-qa"].readiness).toBe("Ready");
    expect(LANDING_PLAYBOOKS["first-10-customers"].readiness).toBe("Ready");
    expect(LANDING_PLAYBOOKS["morning-ops-robot"].readiness).toBe("Ready");
  });

  it("leads Agent Computer with the lasting-computer benefit and dashboard proof", () => {
    expect(computer).toContain('Give <span className={styles.noWrap}>Claude Code</span> an always-on computer.');
    expect(computer).toContain("We call it a pod: a private cloud computer with your project, tools, and services inside.");
    expect(computer).not.toContain("a persistent computer with your project");
    expect(computer).toContain("Claude is the interface. Podbay is its computer.");
    expect(computer).toContain('import dashboardImage from "../../../docs/images/dashboard.png"');
    expect(computer).toContain("See every pod at a glance.");
    expect(computer).not.toContain("Open running apps and know when Claude is working or needs you.");
    expect(computer).toContain('/landing/session-continuity-v10.png');
    expect(computer).toContain("Continue anywhere.");
    expect(computer).not.toContain("Start here.");
    expect(computer).toContain("Close your laptop and Claude keeps working in the pod.");
    expect(computer).toContain("Pick up the same session from desktop, mobile, or web without restarting or moving the project.");
    expect(computer).toContain("Start on desktop");
    expect(computer).toContain("Pod runs 24/7");
    expect(computer).toContain("Continue on phone");
    expect(computer).not.toContain("Conceptual walkthrough · example session shown for illustration.");
    expect(computer).not.toContain('/landing/pod-computer-v1.jpg');
    expect(computer).toContain("Self-host Podbay");
    expect(computer).toContain("Start with Podbay");
    expect(computer).toContain("Continue in the official Claude apps with your Pro or Max subscription.");
    expect(computer).not.toContain("No Anthropic API key or usage markup.");
    expect(computer).not.toContain("Codex support is in pilot.");
    expect(computer).toContain("className={styles.subscriptionCopy}");
    expect(computer).not.toContain("className={styles.pilotNote}");
    expect(computer).not.toContain("className={styles.pilotBadge}");
    expect(computer).not.toContain("Codex support · Pilot");
    expect(computer).toContain("Run the whole project. See the result.");
    expect(computer).toContain("A pod gives Claude a complete environment to build, run, and test your project.");
    expect(computer).not.toContain("the system around your code");
    expect(computer).not.toContain("It can run the project, use the application, and keep the result available.");
    expect(computer).toContain("Run more than code");
    expect(computer).toContain("Development servers, databases, workers, scheduled jobs, monitors, and project skills");
    expect(computer).toContain("Verify the real app");
    expect(computer).not.toContain("Use and verify the real app");
    expect(computer).toContain(
      "Claude can open the live application, click through real flows, use its database, and verify behavior where it made the change.",
    );
    expect(computer).toContain("Develop or run in production");
    expect(computer).toContain("development with a live preview");
    expect(computer).toContain("run your production server directly from the pod");
    expect(computer).toContain("<LandingPodNetwork />");
    expect(computer).not.toContain('/landing/pod-cutaway-v1.jpg');
    expect(computer).toContain("A boundary for agent work");
    expect(computer).toContain("Powerful inside the pod. Guarded at the edges.");
    expect(computer).not.toContain("On Podbay Cloud, Claude works in a project-specific machine");
    expect(computer).toContain("Project-scoped machine");
    expect(computer).toContain("Project secrets, outside chat");
    expect(computer).toContain("Official CLI, your account");
    expect(computer).toContain("You keep full access");
    expect(computer).toContain("className={styles.trustGrid}");
    expect(computer).not.toContain("Live-pod dogfood");
    expect(computer).not.toContain("Start with a capable agent, not a blank chat.");
    expect(computer).toContain('Give your <span className={styles.noWrap}>Claude Code</span> a permanent home');
  });

  it("carries the real-home and private-cloud definition into search and social metadata", () => {
    expect(homePage).toContain("Podbay: Give Claude a real home in the cloud");
    expect(homePage).toContain(
      "A Podbay pod is a private cloud VM with Claude Code, your project, and tools inside. It is always on, reachable anywhere, and uses your existing Claude subscription.",
    );
    expect(homePage).not.toContain("Podbay: An always-on workspace for your coding agent");
  });

  it("does not use em dashes in public landing copy or metadata", () => {
    expect([outcomes, computer, podNetwork, home, homePage, rootLayout, landingPlaybooks].join("\n")).not.toContain("—");
  });

  it("uses one continuous responsive illustration for session continuity", () => {
    expect(computer).not.toContain("className={styles.continuityAlwaysOnMark}");
    expect(computer).toContain('/landing/session-continuity-v10.png');
    expect(agentStyles).toContain(".continuityVisual { width: min(770px, 100%);");
    expect(agentStyles).toContain("font-size: 10px; font-weight: 700;");
    expect(agentStyles).toContain(".continuitySteps strong { color: var(--blue-soft); font-size: 12px;");
    expect(agentStyles).toContain(".noWrap { white-space: nowrap; }");
    expect(agentStyles).not.toContain(".continuityAlwaysOnMark");
    expect(agentStyles).not.toContain(".capabilityVisual img");
    expect(agentStyles).toContain(".continuityArtwork { position: relative; aspect-ratio: 1825 / 560; overflow: hidden; }");
    expect(agentStyles).toContain("object-position: center 18%; mix-blend-mode: screen;");
    expect(agentStyles).toContain(".continuitySteps { display: grid; grid-template-columns: repeat(3, 1fr)");
    expect(agentStyles).not.toContain(".continuitySteps { grid-template-columns: 1fr;");
  });

  it("shows separate pods exchanging owner-scoped durable messages", () => {
    const tabletNetworkStyles = agentStyles.slice(
      agentStyles.indexOf("@media (max-width: 900px)"),
      agentStyles.indexOf("@media (max-width: 700px)"),
    );

    expect(podNetwork).not.toContain('"use client"');
    expect(podNetwork).toContain("Research & PMF");
    expect(podNetwork).toContain("Development");
    expect(podNetwork).toContain("Scheduled work");
    expect(podNetwork).toContain("Production");
    expect(podNetwork).toContain("Pods can message each other.");
    expect(podNetwork).toContain(">Message</i>");
    expect(podNetwork).not.toContain("Pass the work, not the access.");
    expect(podNetwork).not.toContain("Files, secrets, and permissions stay separate.");
    expect(podNetwork).not.toContain("Secure handoff");
    expect(podNetwork).not.toContain("podbay msg");
    expect(podNetwork).toContain("<animateMotion");
    expect(podNetwork).toContain("styles.mobileNetworkRail");
    expect(podNetwork).not.toContain("not shared filesystem access or authorization");
    expect(agentStyles).toContain(".podNetworkCanvas { position: relative; display: grid;");
    expect(agentStyles).toContain(".podNetworkHeading { display: flex; align-items: flex-start;");
    expect(agentStyles).toContain(".podNetworkHeading > p { max-width: 52ch; margin-top: 29px;");
    expect(agentStyles).toContain(".sectionHeading > p { max-width: 46ch; margin-top: 29px;");
    expect(agentStyles).toContain("--section-title-size: 34px;");
    expect(agentStyles).toContain(".podNetworkHeading h3,");
    expect(agentStyles).toContain("font-size: var(--section-title-size);");
    expect(agentStyles).toContain(".landing { --section-title-size: 31px; }");
    expect(agentStyles).not.toContain(".podNetworkHeading h3 { margin-top: 9px; font-size: 24px;");
    expect(agentStyles).toContain(".networkPacket { display: none; }");
    expect(agentStyles).toContain("@keyframes mobileMessageRoute");
    expect(agentStyles).toContain(".mobileNetworkRail i { display: none; }");
    expect(agentStyles).toContain(".messageRelayCopy");
    expect(agentStyles).toContain(".messageRelayRoute");
    expect(agentStyles).toContain("width: min(210px, calc(100% - 24px));");
    expect(tabletNetworkStyles).toContain(
      ".podNetworkCanvas { min-height: 0; grid-template-columns: repeat(2, minmax(0, 1fr));",
    );
  });

  it("centers the subscription reassurance without a competing support-status line", () => {
    expect(agentStyles).toMatch(/\.subscriptionLine\s*\{[^}]*align-items: center/);
    expect(agentStyles).toMatch(/\.subscriptionCopy\s*\{[^}]*display: grid/);
    expect(agentStyles).not.toContain(".pilotNote");
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
