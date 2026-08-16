import "server-only";

import { cookies } from "next/headers";
import { ACTIVE_LANDING_EXPERIMENT } from "./landing-experiment-config";
import { linkLandingAttribution } from "./landing-experiment-store";

export async function linkCurrentLandingAttribution(userId: string): Promise<void> {
  const jar = await cookies();
  await linkLandingAttribution(
    userId,
    jar.get(ACTIVE_LANDING_EXPERIMENT.cookie.visitor)?.value ?? null,
    jar.get(ACTIVE_LANDING_EXPERIMENT.cookie.variant)?.value ?? null,
  );
}
