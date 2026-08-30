import type { CSSProperties } from "react";
import Link from "next/link";
import {
  CloudUpload,
  MessageCircleQuestion,
  MessageSquare,
  Radar,
  RotateCcw,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import GithubMark from "@/components/github-mark";
import LandingAccountLink from "@/components/landing-account-link";
import type { getCurrentUser } from "@/lib/session";
import styles from "./selfhost-landing.module.css";

const apps = [
  {
    name: "n8n",
    logo: "/selfhost-apps/n8n.svg",
    color: "#ea4b71",
    category: "Automation.",
    outcome: "Run automations without paying for every task.",
  },
  {
    name: "Ghost",
    logo: "/selfhost-apps/ghost.svg",
    color: "#424a55",
    category: "Paid newsletters.",
    outcome: "Own your publication and subscriber relationship.",
  },
  {
    name: "Cal.com",
    logo: "/selfhost-apps/caldotcom.svg",
    color: "#4a5568",
    category: "Scheduling.",
    outcome: "Offer bookings without another per-seat subscription.",
  },
  {
    name: "Umami",
    logo: "/selfhost-apps/umami.svg",
    color: "#5b5bd6",
    category: "Analytics.",
    outcome: "See useful analytics without feeding visitor data to an ad platform.",
  },
  {
    name: "Uptime Kuma",
    logo: "/selfhost-apps/uptimekuma.svg",
    color: "#41b883",
    category: "Status & monitoring.",
    outcome: "Know when a service needs attention.",
  },
  {
    name: "Listmonk",
    logo: "/selfhost-apps/listmonk.svg",
    color: "#7f5af0",
    category: "Newsletters at cost.",
    outcome: "Send newsletters without pricing that grows with your list.",
  },
] as const;

const maintenanceReports = [
  {
    platform: "reddit",
    author: "valko2",
    avatar: "v",
    context: "r/n8n · comment",
    quote: "Time-based workflows randomly stopped running after a version update.",
    href: "https://www.reddit.com/r/n8n/comments/1oaf96w/guide_how_im_selfhosting_n8n_for_0_publicly/",
    sourceLabel: "View thread",
  },
  {
    platform: "github",
    author: "castaway",
    avatar: "c",
    context: "tryghost/ghost · issue #27433",
    quote: "Upgrade from 6.25.0 to 6.30.0, migration fails.",
    href: "https://github.com/tryghost/ghost/issues/27433",
    sourceLabel: "View issue",
  },
  {
    platform: "github",
    author: "Novapixel1010",
    avatar: "N",
    context: "calcom/cal.diy · issue #23294",
    quote: "When upgrading Cal.com from v5.5.2 to v5.6.2, the application fails at runtime.",
    href: "https://github.com/calcom/cal.diy/issues/23294",
    sourceLabel: "View issue",
  },
  {
    platform: "github",
    author: "eszpee",
    avatar: "e",
    context: "umami-software/umami · issue #2651",
    quote: "Can't start Umami on Docker since 2.11.0.",
    href: "https://github.com/umami-software/umami/issues/2651",
    sourceLabel: "View issue",
  },
  {
    platform: "github",
    author: "Epy",
    avatar: "E",
    context: "louislam/uptime-kuma · issue #7017",
    quote: "ERR_REQUIRE_ESM loops at startup after update.",
    href: "https://github.com/louislam/uptime-kuma/issues/7017",
    sourceLabel: "View issue",
  },
  {
    platform: "github",
    author: "fullpwemium",
    avatar: "f",
    context: "knadh/listmonk · issue #2438",
    quote: "Upgrade to v5.0.0 broken. Can't open listmonk anymore.",
    href: "https://github.com/knadh/listmonk/issues/2438",
    sourceLabel: "View issue",
  },
] as const;

const faqs = [
  {
    question: "What happens after an app is installed?",
    answer:
      "Your AI admin watches supported apps for upstream changes, handles routine updates and investigates problems. Risky changes wait for your approval.",
  },
  {
    question: "Can I use my existing Claude subscription?",
    answer:
      "Yes. Sign in with Claude Pro or Max, then continue the same pod session from the official desktop or mobile app.",
  },
  {
    question: "Will my apps keep running when I close my laptop?",
    answer:
      "Yes on Podbay Cloud. A self-hosted pod stays available as long as your server stays online.",
  },
  {
    question: "How do I give Claude passwords or API credentials?",
    answer:
      "Add them in Podbay settings. Claude can use them without you pasting sensitive values into the conversation.",
  },
  {
    question: "Can I run Podbay on my own server?",
    answer:
      "Yes. The self-hosted edition runs with Docker on your hardware, while you continue working through Claude.",
  },
  {
    question: "How mature is Podbay?",
    answer:
      "Podbay is in early alpha. The supported app catalog is tested, but early adopters should still expect rough edges and fast changes.",
  },
] as const;

export default function SelfhostLanding({
  user,
}: {
  user: Awaited<ReturnType<typeof getCurrentUser>>;
}) {
  const primaryHref = user ? "/dashboard" : "/selfhost/signin";
  const primaryLabel = user ? "Open dashboard" : "Request alpha access";

  return (
    <div className={styles.landing}>
      <header className={styles.siteHeader}>
        <div className={`${styles.shell} ${styles.headerInner}`}>
          <Link className={styles.brand} href="/" aria-label="Podbay home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.brandMark} src="/podbay-mark.svg" alt="" />
            <span className={styles.wordmark}><span>pod</span>bay</span>
          </Link>
          <nav className={styles.nav} aria-label="Main navigation">
            <a href="#how">How it works</a>
            <a href="#apps">Supported apps</a>
            <a href="#hosting">Hosting</a>
            <Link href="/docs">Docs</Link>
            {user ? <LandingAccountLink user={user} /> : <Link href={primaryHref}>Sign in</Link>}
            <a
              className={styles.navCta}
              href="https://github.com/podbay-cloud/podbay"
              target="_blank"
              rel="noopener"
            >
              <GithubMark />
              <span>Self host it</span>
            </a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className={`${styles.shell} ${styles.hero}`}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Self-hosted software · without the ops work</p>
            <h1>Self-host the tools you need.<span>Your AI admin runs them.</span></h1>
            <p className={styles.heroText}>
              Manage it through the Claude app with your existing Pro or Max subscription.
            </p>
            <div className={styles.actions}>
              <Link className={`${styles.button} ${styles.buttonPrimary}`} href={primaryHref}>
                {primaryLabel}
              </Link>
              <a className={`${styles.button} ${styles.buttonSecondary}`} href="#apps">
                View supported apps
              </a>
            </div>
          </div>

          <div className={styles.visualColumn}>
            <div className={styles.proofFrame} aria-label="A Podbay session in the Claude app">
              <section className={`${styles.surface} ${styles.claudeSurface}`}>
                <div className={styles.surfaceHead}>
                  <span className={`${styles.surfaceIcon} ${styles.claudeIcon}`}>C</span>
                  Claude
                  <span className={styles.surfaceMeta}>DESKTOP · MOBILE</span>
                </div>
                <div className={styles.claudeBody}>
                  <div className={`${styles.chatBubble} ${styles.chatUser}`}>
                    Set up n8n for our client-intake workflow.
                  </div>
                  <div className={`${styles.chatBubble} ${styles.chatClaude}`}>
                    n8n is ready. I verified the login, database, and a sample workflow. What
                    should we do next?
                  </div>
                  <div className={styles.replyRow}>
                    <span>Build client intake</span><span>Connect Slack</span><span>Show me n8n</span>
                  </div>
                </div>
                <div className={styles.claudeStatus}>
                  <span className={styles.liveDot} />Podbay session online · client-ops
                </div>
              </section>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.sectionTint}`} id="how">
          <div className={styles.shell}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>From request to running software</p>
                <h2 className={styles.stackedHeading}>
                  <span>You ask.</span>
                  <span>Claude operates.</span>
                  <span>Podbay keeps the computer ready.</span>
                </h2>
              </div>
              <p>Start with what you want running. Claude handles the technical work while Podbay keeps the computer ready.</p>
            </div>
            <div className={styles.steps}>
              <article className={styles.step}>
                <span className={styles.stepNumber}>01 · YOU</span>
                <span className={styles.stepVisual}><MessageSquare aria-hidden /></span>
                <h3>Ask in Claude</h3>
                <p>Describe the app or outcome from the official Claude desktop or mobile app.</p>
              </article>
              <article className={styles.step}>
                <span className={styles.stepNumber}>02 · CLAUDE</span>
                <span className={styles.stepVisual}><Sparkles aria-hidden /></span>
                <h3>Your admin does the work</h3>
                <p>Claude installs the software, configures what it needs, checks the result, and explains what changed.</p>
              </article>
              <article className={styles.step}>
                <span className={styles.stepNumber}>03 · PODBAY</span>
                <span className={styles.stepVisual}><Server aria-hidden /></span>
                <h3>The computer stays available</h3>
                <p>Your workspace, running services, schedules, and project access remain there between conversations.</p>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.section} id="apps">
          <div className={styles.shell}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Supported from day one</p>
                <h2 className={styles.stackedHeading}>
                  <span>Start with software</span>
                  <span>worth owning.</span>
                </h2>
              </div>
              <p>Each app comes with tested setup and operating guidance for your AI admin.</p>
            </div>
            <div className={styles.appsGrid}>
              {apps.map((app) => (
                <article
                  className={styles.appCard}
                  key={app.name}
                  style={{ "--app-color": app.color } as CSSProperties}
                >
                  <div className={styles.appTop}>
                    <span className={styles.appLogo}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={app.logo} alt={`${app.name} logo`} />
                    </span>
                    <span className={styles.appName}>{app.name}</span>
                  </div>
                  <p className={styles.appOutcome}>{app.category} <strong>{app.outcome}</strong></p>
                </article>
              ))}
            </div>
            <p className={styles.catalogNote}>
              <span aria-hidden>+</span>
              We&rsquo;re preparing more open-source software for your AI admin.
            </p>
          </div>
        </section>

        <section className={`${styles.section} ${styles.sectionTint}`} id="trust">
          <div className={styles.shell}>
            <div className={styles.trustHeading}>
              <div>
                <p className={styles.eyebrow}>The trust part</p>
                <h2>It never breaks your stack.</h2>
              </div>
              <p className={styles.trustLead}>
                An AI with access to production only earns trust one way—by being careful on
                purpose. Here&rsquo;s the contract.
              </p>
            </div>
            <div className={styles.trustGrid}>
              <article className={styles.trustCard}>
                <span className={styles.trustIcon}><Radar aria-hidden /></span>
                <h3>Watches upstream</h3>
                <p>Monitors every app&rsquo;s repo for releases, bug fixes, and security advisories—so you don&rsquo;t have to.</p>
              </article>
              <article className={styles.trustCard}>
                <span className={styles.trustIcon}><ShieldCheck aria-hidden /></span>
                <h3>Patches the safe stuff</h3>
                <p>Routine + security updates get tested on a clone and applied automatically.</p>
              </article>
              <article className={styles.trustCard}>
                <span className={styles.trustIcon}><MessageCircleQuestion aria-hidden /></span>
                <h3>Asks before anything risky</h3>
                <p>Breaking changes, major versions, data migrations—it proposes, you approve.</p>
              </article>
              <article className={styles.trustCard}>
                <span className={styles.trustIcon}><RotateCcw aria-hidden /></span>
                <h3>One-click rollback</h3>
                <p>Every change is reversible. If something&rsquo;s off, you&rsquo;re back to the last-good state instantly.</p>
              </article>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.maintenanceSection}`} id="maintenance">
          <div className={styles.shell}>
            <div className={styles.maintenanceHeading}>
              <div>
                <p className={styles.eyebrow}>The tax on self-hosting</p>
                <h2 className={styles.stackedHeading}>
                  <span>Self-hosting is cheap.</span>
                  <span>Keeping it alive is a second job.</span>
                </h2>
              </div>
              <p>
                Real reports from people running these apps themselves. This is the part the
                price pages don&rsquo;t mention.
              </p>
            </div>
          </div>
          <div
            className={styles.maintenanceViewport}
            aria-label="Reports from people who self-host"
          >
            <div className={styles.maintenanceTrack}>
              {[false, true].map((duplicate) => (
                <div
                  className={styles.maintenanceSet}
                  key={duplicate ? "duplicate" : "original"}
                  aria-hidden={duplicate || undefined}
                >
                  {maintenanceReports.map((report) => (
                    <a
                      className={`${styles.reportCard} ${
                        report.platform === "github"
                          ? styles.reportGithub
                          : styles.reportReddit
                      }`}
                      href={report.href}
                      key={`${duplicate ? "duplicate" : "original"}-${report.author}`}
                      target="_blank"
                      rel="noopener"
                      tabIndex={duplicate ? -1 : undefined}
                    >
                      <div className={styles.reportHead}>
                        <span className={styles.reportAvatar}>{report.avatar}</span>
                        <span className={styles.reportIdentity}>
                          <strong>{report.author}</strong>
                          <span>{report.context}</span>
                        </span>
                        <span className={styles.reportPlatform}>
                          {report.platform === "github" ? <GithubMark /> : <span>r/</span>}
                          {report.platform === "github" ? "GitHub" : "Reddit"}
                        </span>
                      </div>
                      <blockquote>&ldquo;{report.quote}&rdquo;</blockquote>
                      <span className={styles.reportSource}>{report.sourceLabel} ↗</span>
                    </a>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.sectionTint}`} id="hosting">
          <div className={styles.shell}>
            <div className={styles.sectionHeading}>
              <div><p className={styles.eyebrow}>Choose where it runs</p><h2>Our cloud or your server.</h2></div>
              <p>The admin experience stays familiar. You choose who operates the underlying computer.</p>
            </div>
            <div className={styles.hostingGrid}>
              <article className={`${styles.hostingCard} ${styles.featured}`}>
                <span className={styles.hostingVisual}><CloudUpload aria-hidden /></span>
                <span className={styles.hostingLabel}>Fastest path</span>
                <h3>Podbay Cloud</h3>
                <p>We keep the computer online and ready. You choose an app and work with Claude.</p>
                <Link className={styles.textLink} href={primaryHref}>{primaryLabel} <span>→</span></Link>
              </article>
              <article className={styles.hostingCard}>
                <span className={styles.hostingVisual}><Server aria-hidden /></span>
                <span className={styles.hostingLabel}>Maximum control</span>
                <h3>Self-hosted edition</h3>
                <p>Run Podbay on your server. Your apps and data stay on infrastructure you control.</p>
                <a className={styles.textLink} href="https://github.com/podbay-cloud/podbay" target="_blank" rel="noopener">
                  View the self-hosted edition <span>↗</span>
                </a>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.section} id="faq">
          <div className={styles.shell}>
            <div className={styles.compactHeading}>
              <p className={styles.eyebrow}>Before you hand over the chores</p>
              <h2>What you&rsquo;re probably wondering.</h2>
            </div>
            <div className={styles.faqList}>
              {faqs.map((faq, index) => (
                <details key={faq.question} open={index === 0}>
                  <summary>{faq.question}</summary><p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.shell} ${styles.finalSection}`}>
          <div className={styles.finalPanel}>
            <h2 className={styles.stackedHeading}>
              <span>Own the software.</span>
              <span>Skip the server chores.</span>
            </h2>
            <div className={styles.actions}>
              <Link className={`${styles.button} ${styles.buttonPrimary}`} href={primaryHref}>{primaryLabel}</Link>
              <a className={`${styles.button} ${styles.buttonSecondary}`} href="https://github.com/podbay-cloud/podbay" target="_blank" rel="noopener">
                View self-hosted edition
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.siteFooter}>
        <div className={`${styles.shell} ${styles.footerInner}`}>
          <span>© 2026 Podbay · Your AI admin&rsquo;s computer.</span>
          <nav className={styles.footerLinks} aria-label="Footer navigation">
            <a href="#apps">Apps</a><a href="#faq">FAQ</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href="https://github.com/podbay-cloud/podbay">GitHub</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
