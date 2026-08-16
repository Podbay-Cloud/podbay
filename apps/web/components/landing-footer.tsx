import * as React from "react";
import Link from "next/link";
import styles from "./landing-footer.module.css";

export default function LandingFooter({
  className,
  wordmarkClassName,
}: {
  className: string;
  wordmarkClassName: string;
}) {
  return (
    <footer className={className}>
      <span className={wordmarkClassName}><span>pod</span>bay</span>
      <nav className={styles.links} aria-label="Legal and support">
        <Link href="/docs">Docs</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/cookies">Cookies</Link>
        <a href="mailto:support@podbay.cloud">Support</a>
      </nav>
      <span className={styles.meta}>podbay.cloud · © {new Date().getFullYear()}</span>
    </footer>
  );
}
