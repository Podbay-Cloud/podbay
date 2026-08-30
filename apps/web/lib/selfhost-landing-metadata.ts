import type { Metadata } from "next";

const title = "Self-host without becoming the sysadmin";
const socialTitle = `Podbay — ${title}`;
const description =
  "Self-host supported open-source tools with an AI admin you work with through the official Claude apps.";

export function selfhostLandingMetadata(url: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: socialTitle,
      description,
      url,
      siteName: "Podbay",
      type: "website",
    },
    twitter: { card: "summary_large_image", title: socialTitle, description },
  };
}
