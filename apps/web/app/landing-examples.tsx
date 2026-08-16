"use client";

import Image from "next/image";
import Link from "next/link";
import * as React from "react";
import { useEffect, useState, type ReactNode } from "react";
import { trackLandingEvent, type LandingEventName } from "@/lib/landing-analytics";
import styles from "./landing.module.css";

const examples = [
  {
    id: "app",
    label: "Useful app",
    prompt: "a client portal that keeps every request in one place.",
    image: "/landing/client-portal.webp",
    alt: "Conceptual client request portal with a request queue, activity chart, and detail panel",
  },
  {
    id: "automation",
    label: "Automation",
    prompt: "a morning brief that researches new leads for me.",
    image: "/landing/morning-brief.webp",
    alt: "Conceptual scheduled morning brief with research, leads, sources, and email delivery",
  },
  {
    id: "bot",
    label: "Bot",
    prompt: "a bot that answers questions from my documents.",
    image: "/landing/knowledge-bot.webp",
    alt: "Conceptual knowledge bot answering a question from connected documents",
  },
] as const;

export default function LandingExamples() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [typedLength, setTypedLength] = useState(examples[0].prompt.length);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const active = examples[activeIndex];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setTypedLength(active.prompt.length);
      return;
    }
    setTypedLength(0);
    const timer = window.setInterval(() => {
      setTypedLength((length) => {
        if (length >= active.prompt.length) {
          window.clearInterval(timer);
          return length;
        }
        return length + 1;
      });
    }, 32);
    return () => window.clearInterval(timer);
  }, [active.prompt, reducedMotion]);

  useEffect(() => {
    if (reducedMotion || paused || typedLength < active.prompt.length) return;
    const timer = window.setTimeout(() => {
      setActiveIndex((index) => (index + 1) % examples.length);
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [active.prompt.length, paused, reducedMotion, typedLength]);

  function selectExample(index: number) {
    setPaused(true);
    setActiveIndex(index);
    trackLandingEvent("landing_example_select", examples[index].id);
  }

  return (
    <div
      className={styles.example}
      onPointerEnter={() => setPaused(true)}
      onFocusCapture={() => setPaused(true)}
    >
      <div className={styles.examplePrompt} aria-hidden="true">
        <span className={styles.examplePromptLabel}>Example direction to your agent</span>
        <p><span>&gt;</span> I want to build {active.prompt.slice(0, typedLength)}<i /></p>
      </div>
      <p className={styles.screenReader}>
        Example project: I want to build {active.prompt}
      </p>
      <div
        className={styles.exampleFrame}
        id="landing-example-panel"
        role="tabpanel"
        aria-labelledby={`landing-example-tab-${active.id}`}
      >
        <Image
          key={active.image}
          className={styles.exampleImage}
          src={active.image}
          alt={active.alt}
          fill
          priority={activeIndex === 0}
          sizes="(max-width: 980px) 100vw, 56vw"
        />
        <span className={styles.exampleBadge}>Example project</span>
        <span className={styles.exampleStatus}><i /> Concept preview</span>
      </div>
      <div className={styles.exampleTabs} role="tablist" aria-label="Example project type">
        {examples.map((example, index) => (
          <button
            key={example.id}
            id={`landing-example-tab-${example.id}`}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            aria-controls="landing-example-panel"
            onClick={() => selectExample(index)}
          >
            {example.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TrackedLink({
  href,
  className,
  eventName,
  item,
  children,
}: {
  href: string;
  className: string;
  eventName: LandingEventName;
  item: string;
  children: ReactNode;
}) {
  return (
    <Link
      className={className}
      href={href}
      onClick={() => {
        if (!window.location.pathname.startsWith("/preview/landing/")) {
          trackLandingEvent(eventName, item);
        }
      }}
    >
      {children}
    </Link>
  );
}
