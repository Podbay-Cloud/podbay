import { describe, it, expect } from "vitest";
import { classifyEvent, SEVERITY_RANK } from "../src/incidents.js";

describe("classifying pod events into incidents", () => {
  it("an OOM that killed the agent is critical, restart-causing, and recommends resize", () => {
    const inc = classifyEvent("oom_killed", { victim: "claude", victimIsAgent: true });
    expect(inc.severity).toBe("critical");
    expect(inc.unplanned).toBe(true);
    expect(inc.restartCausing).toBe(true);
    expect(inc.action?.kind).toBe("resize");
    expect(inc.title).toMatch(/ran out of memory/i);
  });

  it("an OOM that killed a child (agent survived) is a calm warning, not restart-causing", () => {
    const inc = classifyEvent("oom_killed", { victim: "session-c6.scope", victimIsAgent: false });
    expect(inc.severity).toBe("warn");
    expect(inc.restartCausing).toBe(false);
    // Calm wording that reassures nothing was lost; the raw cgroup/victim name is NOT
    // surfaced to the owner (it's noise, not a process they'd recognize).
    expect(inc.title).toMatch(/background process.*memory|kept running/i);
    expect(inc.title).not.toContain("session-c6.scope");
    expect(inc.action?.kind).toBe("resize");
  });

  it("a repair caused by OOM is critical + restart-causing + resize; a plain crash is a warning", () => {
    expect(classifyEvent("pod_repaired", { cause: "oom" })).toMatchObject({
      severity: "critical",
      restartCausing: true,
      action: { kind: "resize" },
    });
    const crash = classifyEvent("pod_repaired", { cause: "crash" });
    expect(crash.severity).toBe("warn");
    expect(crash.restartCausing).toBe(true);
    expect(crash.action).toBeUndefined();
  });

  it("a supervised startup-process repair is calm (agent kept running) and names the owner's slug", () => {
    const oom = classifyEvent("pod_repaired", { target: "startup:preview-3000", cause: "oom" });
    expect(oom.severity).toBe("warn");
    expect(oom.restartCausing).toBe(false); // the AGENT did not restart
    expect(oom.title).toContain("'preview-3000'");
    expect(oom.title).toMatch(/ran out of memory.*restarted automatically/i);
    expect(oom.action?.kind).toBe("resize");

    const crash = classifyEvent("pod_repaired", { target: "startup:worker" });
    expect(crash.severity).toBe("warn");
    expect(crash.restartCausing).toBe(false);
    expect(crash.title).toMatch(/stopped and was restarted automatically/i);
    expect(crash.action).toBeUndefined();
  });

  it("the dev server gets its own wording, not a raw slug", () => {
    const inc = classifyEvent("pod_repaired", { target: "startup:dev-server", cause: "oom" });
    expect(inc.title).toMatch(/^Your dev server /);
    expect(inc.title).not.toContain("'dev-server'");
  });

  it("agent stuck (repair gave up) and failures are critical", () => {
    expect(classifyEvent("repair_gave_up").severity).toBe("critical");
    expect(classifyEvent("error").severity).toBe("critical");
    expect(classifyEvent("update_failed").severity).toBe("critical");
    expect(classifyEvent("resize_failed").severity).toBe("critical");
  });

  it("a planned admin update is info but STILL restart-causing (must be explained)", () => {
    const inc = classifyEvent("updated");
    expect(inc.severity).toBe("info");
    expect(inc.unplanned).toBe(false);
    expect(inc.restartCausing).toBe(true);
    expect(inc.title).toMatch(/you updated this pod/i);
  });

  it("normal lifecycle is quiet info, not an alarm", () => {
    for (const t of ["running", "suspended", "created", "destroyed"] as const) {
      const inc = classifyEvent(t);
      expect(inc.severity).toBe("info");
      expect(inc.unplanned).toBe(false);
      expect(inc.restartCausing).toBe(false);
    }
  });

  it("an unknown event type degrades to a quiet info row, de-underscored, never throws", () => {
    const inc = classifyEvent("some_future_event" as never);
    expect(inc.severity).toBe("info");
    // Read as English, not a raw slug — a new type shows awkwardly, never as "some_future_event".
    expect(inc.title).toBe("Some future event");
  });

  it("a viewed secret names the variable in plain English", () => {
    const inc = classifyEvent("secret_revealed", { key: "TELEGRAM_BOT_TOKEN" });
    expect(inc.severity).toBe("info");
    expect(inc.title).toBe("Viewed TELEGRAM_BOT_TOKEN");
  });

  it("agent_added names which agent", () => {
    expect(classifyEvent("agent_added", { agent: "codex" }).title).toBe("Codex was added to this pod");
    expect(classifyEvent("agent_added", { agent: "claude-code" }).title).toBe("Claude was added to this pod");
    expect(classifyEvent("agent_added", {}).title).toBe("An agent was added to this pod");
  });

  it("codex_rc_toggled says on or off, not just 'toggled'", () => {
    expect(classifyEvent("codex_rc_toggled", { on: true }).title).toBe("Codex remote control turned on");
    expect(classifyEvent("codex_rc_toggled", { on: false }).title).toBe("Codex remote control turned off");
  });

  it("severity ranks worst-first", () => {
    expect(SEVERITY_RANK.critical).toBeGreaterThan(SEVERITY_RANK.warn);
    expect(SEVERITY_RANK.warn).toBeGreaterThan(SEVERITY_RANK.info);
  });
});
