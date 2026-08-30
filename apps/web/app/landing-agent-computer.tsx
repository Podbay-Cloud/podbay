import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  Boxes,
  Eye,
  Globe2,
  KeyRound,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import dashboardImage from "../../../docs/images/dashboard.png";
import { TrackedLink } from "./landing-examples";
import { getCurrentUser } from "@/lib/session";
import styles from "./landing-agent.module.css";
import GithubMark from "@/components/github-mark";
import LandingAccountLink from "@/components/landing-account-link";
import LandingFooter from "@/components/landing-footer";
import LandingPodNetwork from "./landing-pod-network";

export default async function AgentComputerLanding({
  user: suppliedUser,
}: {
  user?: Awaited<ReturnType<typeof getCurrentUser>>;
}) {
  const user = suppliedUser === undefined ? await getCurrentUser() : suppliedUser;
  const primaryHref = user ? "/dashboard" : "/signin";
  const primaryLabel = user ? "Open dashboard" : "Start with Podbay";

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
          <a href="#workspace">How it works</a>
          <a href="#trust">Safety</a>
          <Link href="/docs">Docs</Link>
          {user ? <LandingAccountLink user={user} /> : <Link href="/signin">Sign in</Link>}
        </nav>
      </header>

      <section className={`${styles.shell} ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Claude is the interface. Podbay is its computer.</p>
          <h1>Give <span className={styles.noWrap}>Claude Code</span> a computer that keeps working.</h1>
          <p className={styles.heroText}>
            Podbay gives Claude Code a pod (cloud computer) with your project, tools, services,
            and data. It keeps working when your laptop closes.
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
              <GithubMark /> Self-host Podbay <ArrowUpRight aria-hidden />
            </a>
          </div>
          <div className={styles.subscriptionLine}>
            <KeyRound aria-hidden />
            <span className={styles.subscriptionCopy}>
              <strong>Continue in the official Claude apps with your Pro or Max subscription.</strong>
            </span>
          </div>
        </div>

        <figure className={styles.heroVisual}>
          <div className={styles.dashboardFrame}>
            <div className={styles.dashboardBar} aria-hidden>
              <i /><i /><i />
              <span>podbay dashboard</span>
            </div>
            <Image
              className={styles.dashboardImage}
              src={dashboardImage}
              alt="Podbay dashboard showing pods that are working, idle, or waiting for a reply, with app previews"
              priority
              sizes="(max-width: 1050px) 100vw, 58vw"
            />
          </div>
          <figcaption>
            <strong>See every pod at a glance.</strong>
          </figcaption>
        </figure>
      </section>

      <section
        className={`${styles.shell} ${styles.continuity}`}
        id="workspace"
        aria-label="Claude on desktop and mobile connected to one running pod"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Desktop, phone, or web</p>
            <h2>Close the laptop. The pod keeps working.</h2>
          </div>
          <p>The same Claude session, files, tools, and running services stay in one Podbay workspace. Continue from desktop, mobile, or web without moving the project.</p>
        </div>
        <div className={styles.continuityVisual}>
          <div className={styles.continuityArtwork}>
            <Image
              src="/landing/session-continuity-v10.png"
              alt="One Claude session moving from a desktop app through an always-on Podbay virtual workspace to a phone"
              width={1825}
              height={862}
              sizes="(max-width: 700px) 100vw, 770px"
            />
          </div>
          <div className={styles.continuitySteps} aria-hidden>
            <span><strong>01</strong> Start on desktop</span>
            <span><strong>02</strong> Pod runs 24/7</span>
            <span><strong>03</strong> Continue on phone</span>
          </div>
        </div>
      </section>

      <section className={styles.reasonsBand} id="why">
        <div className={styles.shell}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>More than remote access</p>
              <h2>Run the whole project. See the result.</h2>
            </div>
            <p>A pod gives Claude a complete environment to build, run, and test your project.</p>
          </div>
          <div className={styles.reasons}>
            <article>
              <Boxes aria-hidden />
              <h3>Run more than code</h3>
              <p>Development servers, databases, workers, scheduled jobs, monitors, and project skills stay together and keep running.</p>
            </article>
            <article>
              <Eye aria-hidden />
              <h3>Verify the real app</h3>
              <p>Claude can open the live application, click through real flows, use its database, and verify behavior where it made the change.</p>
            </article>
            <article>
              <Globe2 aria-hidden />
              <h3>Develop or run in production</h3>
              <p>Use the pod for development with a live preview, or run your production server directly from the pod.</p>
            </article>
          </div>
          <LandingPodNetwork />
        </div>
      </section>

      <section className={styles.trustBand} id="trust">
        <div className={`${styles.shell} ${styles.trust}`}>
          <div>
            <p className={styles.eyebrow}>A boundary for agent work</p>
            <h2>Powerful inside the pod. Guarded at the edges.</h2>
          </div>
          <div className={styles.trustGrid}>
            <article>
              <ShieldCheck aria-hidden />
              <h3>Project-scoped machine</h3>
              <p>The pod gets this project&rsquo;s code and services, not your personal files, browser sessions, or local network.</p>
            </article>
            <article>
              <KeyRound aria-hidden />
              <h3>Project secrets, outside chat</h3>
              <p>Add project credentials in the dashboard instead of pasting secret values into a conversation.</p>
            </article>
            <article>
              <ShieldCheck aria-hidden />
              <h3>Official CLI, your account</h3>
              <p>Claude runs through the official CLI with your subscription. Podbay does not proxy model authentication or add token markup.</p>
            </article>
            <article>
              <Wrench aria-hidden />
              <h3>You keep full access</h3>
              <p>Open the browser terminal whenever you want to inspect, debug, or recover the workspace.</p>
            </article>
          </div>
        </div>
      </section>

      <section className={`${styles.shell} ${styles.finalCta}`}>
        <p className={styles.eyebrow}>Private alpha</p>
        <h2>Give your <span className={styles.noWrap}>Claude Code</span> a permanent home</h2>
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
