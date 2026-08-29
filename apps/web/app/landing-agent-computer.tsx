import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  Clock3,
  KeyRound,
  Laptop,
  ShieldCheck,
  Smartphone,
  UserRound,
  Wrench,
} from "lucide-react";
import { TrackedLink } from "./landing-examples";
import { getCurrentUser } from "@/lib/session";
import { listEnvironments } from "@/lib/environments";
import styles from "./landing-agent.module.css";
import GithubMark from "@/components/github-mark";
import LandingAccountLink from "@/components/landing-account-link";
import LandingFooter from "@/components/landing-footer";
import { LANDING_PLAYBOOKS, type LandingPlaybookId } from "@/lib/landing-playbooks";

export default async function AgentComputerLanding({
  user: suppliedUser,
}: {
  user?: Awaited<ReturnType<typeof getCurrentUser>>;
}) {
  const [user, catalog] = await Promise.all([
    suppliedUser === undefined ? getCurrentUser() : suppliedUser,
    listEnvironments(),
  ]);
  const available = new Map(catalog.map((entry) => [entry.name, entry]));
  const primaryHref = user ? "/dashboard" : "/signin";
  const primaryLabel = user ? "Open dashboard" : "Give Claude a real home";

  return (
    <main className={styles.landing}>
      <header className={`${styles.shell} ${styles.header}`}>
        <Link className={styles.brand} href={user ? "/dashboard" : "/"} aria-label="Podbay home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.brandMark} src="/podbay-mark.svg" alt="" />
          <span className={styles.wordmark}><span>pod</span>bay</span>
        </Link>
        <nav className={styles.nav} aria-label="Primary navigation">
          <a href="#why">Why Podbay</a>
          <a href="#starting-points">Starting points</a>
          <a href="#trust">Trust</a>
          <Link href="/docs">Docs</Link>
          {user ? <LandingAccountLink user={user} /> : <Link href="/signin">Sign in</Link>}
        </nav>
      </header>

      <section className={`${styles.shell} ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Claude is the interface. Podbay is its computer.</p>
          <h1>The always-on computer for your coding agent.</h1>
          <p className={styles.heroText}>
            Close the lid &mdash; it keeps working. Files, servers, and running jobs stay put,
            reachable from any device.
          </p>
          <div className={styles.heroActions}>
            <TrackedLink
              className={styles.primaryCta}
              href={primaryHref}
              eventName="landing_primary_cta"
              item="agent-computer-hero"
            >
              {primaryLabel}
            </TrackedLink>
            <a
              className={styles.secondaryCta}
              href="https://github.com/Podbay-Cloud/podbay"
              target="_blank"
              rel="noopener"
            >
              <GithubMark /> Self-host it <ArrowUpRight aria-hidden />
            </a>
          </div>
          <div className={styles.subscriptionLine}>
            <KeyRound aria-hidden />
            <span className={styles.subscriptionCopy}>
              <strong>Use your existing Claude subscription.</strong>
              <span>Official CLI · No token markup · Self-host it (BSL 1.1)</span>
              <span className={styles.pilotNote}>Codex support is in pilot.</span>
            </span>
          </div>
        </div>
      </section>

      <section
        className={`${styles.shell} ${styles.continuity}`}
        id="workspace"
        aria-label="Claude on desktop and mobile connected to one running pod"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Remote control &ne; always-on</p>
            <h2>Podbay runs the machine your session lives on.</h2>
          </div>
          <p>Remote control gives you access. Podbay gives you uptime.</p>
        </div>
        <div className={styles.continuityFlow}>
          <div className={styles.continuityMoment}>
            <div className={styles.momentLabel}>
              <strong>01</strong><span>Start on desktop</span>
            </div>
            <article className={styles.desktopSurface}>
              <div className={styles.surfaceTitle}>
                <Laptop aria-hidden />
                <span>Claude Desktop</span>
                <i />
              </div>
              <div className={styles.desktopChat}>
                <span className={styles.appContext}>Claude Code · project-aurora</span>
                <p>Investigate why invited users lose their team role after signup.</p>
                <p>I&rsquo;ll trace the flow. I won&rsquo;t change existing records without you.</p>
              </div>
              <span className={styles.surfaceFoot}>Native Claude app · desktop</span>
            </article>
          </div>

          <div className={`${styles.continuityMoment} ${styles.continuityMomentActive}`}>
            <div className={styles.momentLabel}>
              <strong>02</strong><span>Laptop closes</span>
            </div>
            <article className={styles.podbaySurface}>
              <h2>Your pod keeps working.</h2>
              <p>
                Claude can install packages, run services, schedule jobs, and put your project on a live URL.
              </p>
              <div className={styles.podLive}>
                <i /><strong>project-aurora pod</strong><span>Running</span>
              </div>
            </article>
          </div>

          <div className={styles.continuityMoment}>
            <div className={styles.momentLabel}>
              <strong>03</strong><span>Continue on phone</span>
            </div>
            <article className={styles.mobileSurface}>
              <div className={styles.surfaceTitle}>
                <Smartphone aria-hidden />
                <span>Claude Mobile</span>
                <i />
              </div>
              <div className={styles.mobileChat}>
                <span className={styles.appContext}>Claude Remote Control</span>
                <p>
                  I found the issue. Should I backfill existing pending invites too?
                </p>
                <p>Yes—pending invites only.</p>
              </div>
              <span className={styles.surfaceFoot}>Native Claude app · mobile</span>
            </article>
          </div>
        </div>
        <p className={styles.simulated}>Simulated Claude conversation · Pod status reflects shipped UI</p>
      </section>

      <section className={styles.reasonsBand} id="why">
        <div className={styles.shell}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Close the lid</p>
              <h2>Your project keeps its momentum.</h2>
            </div>
            <p>Move the agent runtime off the computer that holds your personal life and needs to stay useful to you.</p>
          </div>
          <div className={styles.reasons}>
            <article>
              <Clock3 aria-hidden />
              <h3>Available when you are</h3>
              <p>The workspace stays up between devices and visits. Long tasks do not depend on your laptop remaining awake.</p>
            </article>
            <article>
              <Laptop aria-hidden />
              <h3>A full cloud computer</h3>
              <p>Each pod gets CPU, memory, disk, and a persistent filesystem. Claude can install packages, run Postgres, start dev servers, and expose a private or public URL.</p>
            </article>
            <article>
              <ShieldCheck aria-hidden />
              <h3>A smaller blast radius</h3>
              <p>Skills run against a project-scoped cloud machine, not your home directory, browser sessions, or local network.</p>
            </article>
          </div>
        </div>
      </section>

      <section className={`${styles.shell} ${styles.playbookSection}`} id="starting-points">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Prepared ways of working</p>
            <h2>Start with a capable agent, not a blank chat.</h2>
          </div>
          <p>Each workspace combines a working foundation, job-specific guidance, and vetted, pinned skills. Inspect it, change it, make it yours.</p>
        </div>
        <div className={styles.playbookGrid}>
          {(Object.keys(LANDING_PLAYBOOKS) as LandingPlaybookId[]).map((id) => {
            const playbook = LANDING_PLAYBOOKS[id];
            const entry = available.get(id);
            const launchable = playbook.readiness === "Ready" && Boolean(entry);
            const launchLabel = playbook.kind === "workspace"
              ? "Launch this workspace"
              : "Launch this playbook";
            const content = (
              <>
                <span className={styles.playbookMedia}>
                  <Image
                    src={playbook.image}
                    alt={playbook.imageAlt}
                    fill
                    loading="lazy"
                    sizes="(max-width: 760px) 100vw, 50vw"
                  />
                  <span className={styles.conceptTag}>Concept preview</span>
                  <span className={launchable ? styles.readyTag : styles.pilotTag}>{playbook.readiness}</span>
                </span>
                <span className={styles.playbookBody}>
                  <strong>{entry?.title ?? playbook.title}</strong>
                  <span>{playbook.computerDescription}</span>
                  <small>{playbook.proof}</small>
                  <b>{launchable ? launchLabel : "Pilot in progress"} {launchable && <ArrowUpRight aria-hidden />}</b>
                </span>
              </>
            );
            return launchable ? (
              <TrackedLink
                className={styles.playbookCard}
                href={user ? `/new?env=${id}` : "/signin"}
                eventName="landing_playbook_select"
                item={id}
                key={id}
              >
                {content}
              </TrackedLink>
            ) : (
              <article className={`${styles.playbookCard} ${styles.playbookUnavailable}`} key={id}>
                {content}
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.trustBand} id="trust">
        <div className={`${styles.shell} ${styles.trust}`}>
          <div>
            <p className={styles.eyebrow}>Full workspace, clear boundary</p>
            <h2>Off your laptop. Still under your control.</h2>
            <p className={styles.trustIntro}>
              Claude gets what it needs inside the pod. Your personal machine stays outside the boundary.
            </p>
          </div>
          <div className={styles.trustGrid}>
            <article>
              <UserRound aria-hidden />
              <h3>Your Claude account</h3>
              <p>Official Claude Code CLI, signed in to the subscription you already use.</p>
            </article>
            <article>
              <KeyRound aria-hidden />
              <h3>Project access only</h3>
              <p>Give the pod this project&rsquo;s files and secrets—not your entire machine.</p>
            </article>
            <article>
              <Wrench aria-hidden />
              <h3>Admin access when needed</h3>
              <p>Inspect, debug, or recover the pod from the terminal. It&rsquo;s the escape hatch, not the workflow.</p>
            </article>
            <article>
              <ShieldCheck aria-hidden />
              <h3>No path back to your laptop</h3>
              <p>Your home directory, browser sessions, and local network stay out of reach.</p>
            </article>
          </div>
        </div>
      </section>

      <section className={`${styles.shell} ${styles.finalCta}`}>
        <p className={styles.eyebrow}>Private alpha</p>
        <h2>Give your agent a computer of its own.</h2>
        <TrackedLink
          className={styles.primaryCta}
          href={primaryHref}
          eventName="landing_primary_cta"
          item="agent-computer-footer"
        >
          {primaryLabel}
        </TrackedLink>
      </section>

      <LandingFooter
        className={`${styles.shell} ${styles.footer}`}
        wordmarkClassName={styles.wordmark}
      />
    </main>
  );
}
