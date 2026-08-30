import * as React from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Check,
  Clock3,
  Code2,
  Database,
  FolderGit2,
  Globe2,
  KeyRound,
  LockKeyhole,
  ServerCog,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import LandingAccountLink from "@/components/landing-account-link";
import LandingFooter from "@/components/landing-footer";
import { TrackedLink } from "./landing-examples";
import styles from "./landing-home.module.css";

const capabilities = [
  {
    number: "01",
    icon: FolderGit2,
    title: "The project",
    copy: "Your repo, conventions, skills, and durable working notes live together. The agent returns to the same project, not a blank chat.",
    detail: "Persistent home · project context",
  },
  {
    number: "02",
    icon: Database,
    title: "The services",
    copy: "Postgres and long-running processes sit beside the application, ready for the agent to configure, use, and verify locally.",
    detail: "Local Postgres · real processes",
  },
  {
    number: "03",
    icon: Clock3,
    title: "Recurring work",
    copy: "Prepared automation can turn a schedule into an agent task, keep a run history, and surface work that needs attention.",
    detail: "Prepared jobs · durable run history",
  },
  {
    number: "04",
    icon: Globe2,
    title: "An address",
    copy: "A running app gets a live URL. Keep it owner-only while you work or explicitly make it public when it is ready to share.",
    detail: "Private by default · share on approval",
  },
] as const;

const ownership = [
  {
    icon: KeyRound,
    title: "Your subscription",
    copy: "The official Claude Code CLI is signed into the account you already use. Podbay does not resell or mark up tokens.",
  },
  {
    icon: TerminalSquare,
    title: "Your power surface",
    copy: "Open the full terminal and filesystem whenever you want to inspect, change, or take over the work yourself.",
  },
  {
    icon: ShieldCheck,
    title: "Your approval",
    copy: "The agent works freely inside its pod, but asks before publishing, pushing, spending, or changing the outside world.",
  },
] as const;

export default async function AgentHomeLanding({
  user: suppliedUser,
}: {
  user?: Awaited<ReturnType<typeof getCurrentUser>>;
}) {
  const user = suppliedUser === undefined ? await getCurrentUser() : suppliedUser;
  const primaryHref = user ? "/dashboard" : "/signin";
  const primaryLabel = user ? "Open dashboard" : "Give my agent a home";

  return (
    <main className={styles.landing}>
      <header className={`${styles.shell} ${styles.header}`}>
        <Link className={styles.brand} href={user ? "/dashboard" : "/"} aria-label="Podbay home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.brandMark} src="/podbay-mark.svg" alt="" />
          <span className={styles.wordmark}><span>pod</span>bay</span>
        </Link>
        <nav className={styles.nav} aria-label="Primary navigation">
          <a href="#inside">What&rsquo;s inside</a>
          <a href="#difference">Why it works</a>
          <a href="#ownership">Ownership</a>
          <Link href="/docs">Docs</Link>
          {user ? <LandingAccountLink user={user} /> : <Link href="/signin">Sign in</Link>}
        </nav>
      </header>

      <section className={`${styles.shell} ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><Sparkles aria-hidden /> One workspace. The whole project.</p>
          <h1>A home your agent knows how to use.</h1>
          <p className={styles.heroText}>
            Podbay gives Claude Code a private workspace with your project, local Postgres,
            prepared recurring work, secrets, and a live URL. Ask for the outcome; your agent
            handles the machinery.
          </p>
          <div className={styles.heroActions}>
            <TrackedLink className={styles.primaryCta} href={primaryHref} eventName="landing_primary_cta" item="agent-home-hero">
              {primaryLabel} <ArrowRight aria-hidden />
            </TrackedLink>
            <a className={styles.secondaryCta} href="#inside">
              See what&rsquo;s inside <ArrowDown aria-hidden />
            </a>
          </div>
          <div className={styles.reassurance} aria-label="Access details">
            <span><LockKeyhole aria-hidden /> Private alpha · GitHub sign-in</span>
            <span><Check aria-hidden /> Your subscription</span>
            <span><Check aria-hidden /> Official CLI</span>
          </div>
        </div>

        <div className={styles.heroProof} aria-label="Example of an agent configuring its workspace">
          <div className={styles.requestCard}>
            <span>You ask</span>
            <p>Add a weekly customer report. Keep every run in a database and give me a private dashboard.</p>
          </div>

          <div className={styles.workspaceFrame}>
            <div className={styles.workspaceBar}>
              <span className={styles.workspaceName}><i /> customer-report</span>
              <span>agent home</span>
              <span className={styles.online}>online</span>
            </div>
            <div className={styles.workspaceGrid}>
              <div className={styles.workspaceRoom}>
                <span className={styles.roomIcon}><Code2 aria-hidden /></span>
                <small>Application</small>
                <strong>Dashboard running</strong>
                <span className={styles.roomStatus}><i /> port 3000 ready</span>
              </div>
              <div className={styles.workspaceRoom}>
                <span className={styles.roomIcon}><Database aria-hidden /></span>
                <small>Data</small>
                <strong>Postgres ready</strong>
                <span className={styles.roomStatus}><i /> migration applied</span>
              </div>
              <div className={styles.workspaceRoom}>
                <span className={styles.roomIcon}><Clock3 aria-hidden /></span>
                <small>Prepared job</small>
                <strong>Monday · 08:00</strong>
                <span className={styles.roomStatus}><i /> recurring work on</span>
              </div>
              <div className={styles.workspaceRoom}>
                <span className={styles.roomIcon}><LockKeyhole aria-hidden /></span>
                <small>Live address</small>
                <strong>Owner-only</strong>
                <span className={styles.roomUrl}>customer-report.preview.podbay.cloud</span>
              </div>
            </div>
            <div className={styles.agentResult}>
              <span className={styles.resultCheck}><Check aria-hidden /></span>
              <p><strong>Done.</strong> The first report is ready. I&rsquo;ll run it every Monday and keep the history in Postgres.</p>
            </div>
          </div>
          <p className={styles.simulated}>Product walkthrough · simulated project data</p>
        </div>
      </section>

      <section className={styles.capabilityBand} id="inside">
        <div className={styles.shell}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Under one roof</p>
              <h2>One place. Four jobs handled.</h2>
            </div>
            <p>
              The point isn&rsquo;t merely that software can be installed. Your agent knows where it
              is, what survives, and how to turn the pieces into a working project.
            </p>
          </div>
          <div className={styles.capabilityGrid}>
            {capabilities.map(({ number, icon: Icon, title, copy, detail }) => (
              <article className={styles.capabilityCard} key={title}>
                <div className={styles.capabilityTop}>
                  <span>{number}</span>
                  <Icon aria-hidden />
                </div>
                <h3>{title}</h3>
                <p>{copy}</p>
                <small>{detail}</small>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.shell} ${styles.loopSection}`}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>The operating loop</p>
            <h2>One request becomes a running system.</h2>
          </div>
          <p>You stay at the level of intent. The agent works through the implementation and verifies the result in the same place.</p>
        </div>
        <ol className={styles.loop}>
          <li>
            <span>01</span>
            <div><small>You ask for the outcome</small><strong>&ldquo;Track every run and brief me on Mondays.&rdquo;</strong></div>
          </li>
          <li>
            <span>02</span>
            <div><small>The agent changes its home</small><strong>Edits · configures · migrates · schedules · tests</strong></div>
          </li>
          <li>
            <span>03</span>
            <div><small>You receive the working result</small><strong>Live URL · persistent data · next run scheduled</strong></div>
          </li>
        </ol>
      </section>

      <section className={styles.differenceBand} id="difference">
        <div className={`${styles.shell} ${styles.difference}`}>
          <div className={styles.differenceCopy}>
            <p className={styles.eyebrow}>Start with the computer</p>
            <h2>Reach for another service when the project needs one.</h2>
            <p>
              Early projects often need a database, a process, a schedule, and somewhere to open
              the result, not four new vendor decisions. Start with what is already in the
              workspace. Add external infrastructure when scale, compliance, or independence calls
              for it.
            </p>
          </div>
          <div className={styles.comparison} aria-label="Workflow comparison">
            <div className={styles.comparisonMuted}>
              <span>Agent without a home</span>
              <ul>
                <li><i /> Writes the code</li>
                <li><i /> You choose and wire the database</li>
                <li><i /> You configure scheduling and hosting</li>
                <li><i /> You explain the setup again later</li>
              </ul>
            </div>
            <div className={styles.comparisonArrow}><ArrowRight aria-hidden /></div>
            <div className={styles.comparisonHome}>
              <span>Agent in Podbay</span>
              <div className={styles.homeCore}><ServerCog aria-hidden /><strong>One known workspace</strong></div>
              <p>Project + services + schedule + address</p>
              <b><Check aria-hidden /> Running result</b>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.shell} ${styles.ownership}`} id="ownership">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>A home, not a black box</p>
            <h2>Your agent gets the space. You keep control.</h2>
          </div>
          <p>Podbay removes setup work without hiding the computer or taking ownership away from you.</p>
        </div>
        <div className={styles.ownershipGrid}>
          {ownership.map(({ icon: Icon, title, copy }) => (
            <article key={title}>
              <Icon aria-hidden />
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.finalBand}>
        <div className={`${styles.shell} ${styles.finalCta}`}>
          <p className={styles.eyebrow}>Private alpha</p>
          <h2>Give your agent somewhere it can do real work.</h2>
          <p>One project. One capable home. Ready when you return.</p>
          <TrackedLink className={styles.primaryCta} href={primaryHref} eventName="landing_primary_cta" item="agent-home-footer">
            {primaryLabel} <ArrowRight aria-hidden />
          </TrackedLink>
        </div>
      </section>

      <LandingFooter
        className={`${styles.shell} ${styles.footer}`}
        wordmarkClassName={styles.wordmark}
      />
    </main>
  );
}
