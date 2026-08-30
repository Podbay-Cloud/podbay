import {
  CalendarClock,
  Code2,
  RadioTower,
  Search,
} from "lucide-react";
import styles from "./landing-agent.module.css";

const PODS = [
  {
    id: "research",
    number: "01",
    title: "Research & PMF",
    description: "Market research, interviews, source notes, and validated briefs.",
    status: "working",
    icon: Search,
    tags: ["sources", "briefs"],
  },
  {
    id: "development",
    number: "02",
    title: "Development",
    description: "Application code, databases, development servers, and E2E tests.",
    status: "testing",
    icon: Code2,
    tags: ["app", "e2e"],
  },
  {
    id: "automation",
    number: "03",
    title: "Scheduled work",
    description: "Regular scraping, database operations, reports, and automations.",
    status: "scheduled",
    icon: CalendarClock,
    tags: ["06:00", "daily"],
  },
  {
    id: "production",
    number: "04",
    title: "Production",
    description: "A live service with its workers, monitors, and operational context.",
    status: "serving",
    icon: RadioTower,
    tags: ["live", "monitored"],
  },
] as const;

const MESSAGE_ROUTES = [
  {
    className: styles.networkPacketBlue,
    delay: "0s",
    path: "M 310 105 C 405 105 420 210 480 250 C 535 285 585 105 690 105",
  },
  {
    className: styles.networkPacketGreen,
    delay: "1.7s",
    path: "M 690 105 C 600 105 590 210 520 250 C 585 290 600 415 690 415",
  },
  {
    className: styles.networkPacketYellow,
    delay: "3.4s",
    path: "M 310 415 C 410 415 420 310 480 270 C 425 235 410 105 310 105",
  },
] as const;

export default function LandingPodNetwork() {
  return (
    <figure className={styles.podNetwork} aria-labelledby="pod-network-title">
      <div className={styles.podNetworkHeading}>
        <div>
          <span className={styles.networkIndex}>One fleet, separate jobs</span>
          <h3 id="pod-network-title">Give each kind of work its own pod.</h3>
        </div>
        <p>
          Keep research, development, scheduled work, and production in focused workspaces. Your
          pods can hand results to one another when the next job is ready.
        </p>
      </div>

      <div className={styles.podNetworkCanvas}>
        <svg
          aria-hidden="true"
          className={styles.networkConnections}
          preserveAspectRatio="xMidYMid meet"
          viewBox="0 0 1000 520"
        >
          <path d="M 310 105 C 410 105 420 220 480 250" />
          <path d="M 690 105 C 590 105 580 220 520 250" />
          <path d="M 310 415 C 410 415 420 300 480 270" />
          <path d="M 690 415 C 590 415 580 300 520 270" />
          {MESSAGE_ROUTES.map((route) => (
            <circle className={`${styles.networkPacket} ${route.className}`} key={route.delay} r="5">
              <animateMotion
                begin={route.delay}
                dur="5.1s"
                path={route.path}
                repeatCount="indefinite"
              />
            </circle>
          ))}
        </svg>
        <div className={styles.mobileNetworkRail} aria-hidden="true">
          <i />
        </div>

        {PODS.map(({ description, icon: Icon, id, number, status, tags, title }) => (
          <article className={`${styles.podNode} ${styles[`podNode${id}`]}`} key={id}>
            <div className={styles.podNodeTopline}>
              <span className={styles.podNodeIcon}><Icon aria-hidden /></span>
              <span>pod {number}</span>
              <i>{status}</i>
            </div>
            <h4>{title}</h4>
            <p>{description}</p>
            <div className={styles.podNodeTags} aria-hidden="true">
              {tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          </article>
        ))}

        <div className={styles.messageRelay}>
          <div className={styles.messageRelayBrand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/podbay-mark.svg" alt="" />
            <span>Podbay</span>
          </div>
          <div className={styles.messageRelayCopy}>
            <strong>Pods can message each other.</strong>
          </div>
          <div aria-hidden="true" className={styles.messageRelayRoute}>
            <span>Development</span>
            <i>Message</i>
            <span>Scheduled work</span>
          </div>
        </div>
      </div>
    </figure>
  );
}
