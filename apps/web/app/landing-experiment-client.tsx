"use client";

import { useEffect } from "react";
import { sendLandingExperimentEvent } from "@/lib/landing-analytics";

export default function LandingExperimentExposure() {
  useEffect(() => {
    sendLandingExperimentEvent("landing_exposure");
  }, []);
  return null;
}
