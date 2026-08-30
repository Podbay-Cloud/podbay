import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LANDING_EXPERIMENT,
  LANDING_EXPERIMENTS,
  SELFHOST_HOMEPAGE_CONTROL,
  isLandingVariant,
} from "../lib/landing-experiment-config";
import { selfhostLandingMetadata } from "../lib/selfhost-landing-metadata";

const route = readFileSync(new URL("../app/selfhost/page.tsx", import.meta.url), "utf8");
const landing = readFileSync(
  new URL("../app/selfhost/selfhost-landing.tsx", import.meta.url),
  "utf8",
);
const landingStyles = readFileSync(
  new URL("../app/selfhost/selfhost-landing.module.css", import.meta.url),
  "utf8",
);
const root = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const controls = readFileSync(
  new URL("../components/experiment-controls.tsx", import.meta.url),
  "utf8",
);

describe("self-host landing and homepage promotion", () => {
  it("keeps the self-host page stable and separate from acquisition measurement", () => {
    expect(selfhostLandingMetadata("https://podbay.cloud/selfhost").alternates?.canonical).toBe(
      "https://podbay.cloud/selfhost",
    );
    expect(route).toContain('export const dynamic = "force-dynamic"');
    expect(route).toContain("if (editionOss()) redirect(\"/dashboard\")");
    expect(route).toContain("<SelfhostLanding");
    expect(LANDING_EXPERIMENT.id).not.toBe(SELFHOST_HOMEPAGE_CONTROL.id);
    expect(SELFHOST_HOMEPAGE_CONTROL.controlType).toBe("homepage-promotion");
    expect(SELFHOST_HOMEPAGE_CONTROL.variants).toEqual(["selfhost"]);
    expect(LANDING_EXPERIMENTS).toContain(SELFHOST_HOMEPAGE_CONTROL);
    expect(isLandingVariant("selfhost")).toBe(true);
  });

  it("can replace only the root landing through an audited admin control", () => {
    expect(root).toContain("isSelfhostHomepageEnabled");
    expect(root).toContain("<SelfhostLanding");
    expect(root).toContain("export async function generateMetadata");
    expect(root).toContain('selfhostLandingMetadata("https://podbay.cloud/")');
    expect(controls).toContain("Show on homepage");
    expect(controls).toContain("Keep only at /selfhost");
    expect(controls).toContain("clearLandingHomepageOverride");
    expect(controls).toContain("The acquisition experiment and its measurements stay unchanged.");
  });

  it("preserves the approved self-host positioning and links", () => {
    expect(landing).toContain("Self-host the tools you need.");
    expect(landing).toContain("Your AI admin runs them.");
    expect(landing).toContain(
      "Manage it through the Claude app with your existing Pro or Max subscription.",
    );
    expect(landing.match(/https:\/\/github\.com\/podbay-cloud\/podbay/g)).toHaveLength(4);
    expect(landing).not.toContain("https://github.com/Podbay-Cloud/install");
    expect(landing).toContain('const primaryHref = user ? "/dashboard" : "/selfhost/signin";');
    expect(landing).not.toContain('<Link href="/signin">Sign in</Link>');
    expect(landing).toContain("Request alpha access");
  });

  it("uses only the Claude surface border in the hero visual", () => {
    expect(landingStyles).toMatch(/\.proofFrame\s*\{[^}]*border:\s*0/);
    expect(landingStyles).toMatch(/\.claudeSurface\s*\{[^}]*inset:\s*0/);
  });

  it("presents the product trust contract immediately after the supported apps", () => {
    expect(landing.indexOf('id="apps"')).toBeLessThan(landing.indexOf('id="trust"'));
    expect(landing.indexOf('id="trust"')).toBeLessThan(landing.indexOf('id="maintenance"'));
    expect(landing).toContain("It never breaks your stack.");
    expect(landing).toContain("Watches upstream");
    expect(landing).toContain("Patches the safe stuff");
    expect(landing).toContain("Asks before anything risky");
    expect(landing).toContain("One-click rollback");
    expect(landing).toContain("applied automatically");
    expect(landing).toContain("<Radar aria-hidden />");
    expect(landing).toContain("<ShieldCheck aria-hidden />");
    expect(landing).toContain("<MessageCircleQuestion aria-hidden />");
    expect(landing).toContain("<RotateCcw aria-hidden />");
    expect(landing).not.toContain("trustNumber");
    expect(landingStyles).toContain("trustIcon");
    expect(landingStyles).not.toContain("trustNumber");
  });

  it("shows attributable maintenance reports as an accessible horizontal feed", () => {
    expect(landing.indexOf('id="trust"')).toBeLessThan(landing.indexOf('id="maintenance"'));
    expect(landing.indexOf('id="maintenance"')).toBeLessThan(landing.indexOf('id="hosting"'));
    expect(landing).toContain("Self-hosting is cheap.");
    expect(landing).toContain("Keeping it alive is a second job.");
    expect(landing).toContain("castaway");
    expect(landing).toContain("Novapixel1010");
    expect(landing).toContain("valko2");
    expect(landing).toContain("eszpee");
    expect(landing).toContain("Epy");
    expect(landing).toContain("fullpwemium");
    expect(landing).toContain("https://github.com/tryghost/ghost/issues/27433");
    expect(landing).toContain("https://github.com/calcom/cal.diy/issues/23294");
    expect(landing).toContain("https://www.reddit.com/r/n8n/comments/1oaf96w/");
    expect(landing).toContain("https://github.com/umami-software/umami/issues/2651");
    expect(landing).toContain("https://github.com/louislam/uptime-kuma/issues/7017");
    expect(landing).toContain("https://github.com/knadh/listmonk/issues/2438");
    expect(landing).toContain('aria-label="Reports from people who self-host"');
    expect(landingStyles).toContain("maintenanceTrack");
    expect(landingStyles).toContain("animation-play-state: paused");
    expect(landingStyles).toMatch(/prefers-reduced-motion[\s\S]*animation:\s*none/);
    expect(landingStyles).toContain("scroll-snap-type: x mandatory");
  });

  it("uses deliberate headline breaks and balanced desktop copy", () => {
    expect(landing).toContain("<span>You ask.</span>");
    expect(landing).toContain("<span>Claude operates.</span>");
    expect(landing).toContain("<span>Podbay keeps the computer ready.</span>");
    expect(landing).toContain("<span>Start with software</span>");
    expect(landing).toContain("<span>worth owning.</span>");
    expect(landing).toContain("<span>Self-hosting is cheap.</span>");
    expect(landing).toContain("<span>Keeping it alive is a second job.</span>");
    expect(landing).toContain("<span>Own the software.</span>");
    expect(landing).toContain("<span>Skip the server chores.</span>");
    expect(landingStyles).toMatch(/\.maintenanceHeading\s*\{[^}]*grid-template-columns/);
    expect(landingStyles).toMatch(/\.trustHeading\s*\{[^}]*grid-template-columns/);
    expect(landingStyles).toMatch(/\.trustHeading h2\s*\{[^}]*white-space:\s*nowrap/);
    expect(landingStyles).toMatch(/\.reportCard\s*\{[^}]*380px/);
    expect(landingStyles).toMatch(/\.trustCard p\s*\{[^}]*max-width:\s*none/);
  });

  it("keeps the trust section concise and answers the post-install objection", () => {
    expect(landing).not.toContain("The Umami-RCE moment, handled.");
    expect(landing).not.toContain("No surprises in prod.");
    expect(landing).not.toContain("And when you need something changed?");
    expect(landing).toContain("What happens after an app is installed?");
    expect(landing).toContain("handles routine updates and investigates problems");
    expect(landing).not.toContain("What does Podbay do that Claude does not?");
  });

  it("lets the maintenance reports make the point without a closing summary", () => {
    expect(landing).not.toContain("You self-host to");
    expect(landing).not.toContain("what makes it stay that way");
    expect(landingStyles).not.toContain("maintenanceClose");
  });

  it("alternates section surfaces without doubled dividers", () => {
    expect(landing).toContain(
      '<section className={`${styles.section} ${styles.sectionTint}`} id="trust">',
    );
    expect(landing).toContain('<section className={styles.section} id="faq">');
    expect(landingStyles).toMatch(/\.maintenanceSection\s*\{[^}]*background:/);
    expect(landingStyles).not.toMatch(/\.maintenanceSection\s*\{[^}]*border-top:/);
  });

  it("sets the expectation that the supported catalog will grow", () => {
    const note = "We&rsquo;re preparing more open-source software for your AI admin.";
    expect(landing).toContain(note);
    expect(landing.indexOf(note)).toBeLessThan(landing.indexOf('id="trust"'));
    expect(landingStyles).toContain("catalogNote");
  });

  it("keeps the final action focused on the heading and buttons", () => {
    expect(landing).not.toContain("Choose the first tool you want your AI admin to run.");
    expect(landingStyles).not.toContain(".finalPanel p");
  });
});
