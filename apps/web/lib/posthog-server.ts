import { PostHog } from "posthog-node";

let client: PostHog | null = null;

export function getPostHogClient(): PostHog | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  if (!token || !host) {
    if (process.env.NODE_ENV !== "production") {
      const missing = !token ? "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN" : "NEXT_PUBLIC_POSTHOG_HOST";
      console.error(
        `${missing} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missing} is configured`,
      );
    }
    return null;
  }

  if (!client) {
    client = new PostHog(token, {
      host,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}
