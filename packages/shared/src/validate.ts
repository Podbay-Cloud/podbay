import { parse as parseYaml } from "yaml";
import {
  EnvironmentSchema,
  KNOWN_TOP_LEVEL_KEYS,
  type Environment,
} from "./schema.js";
import { findTosViolations } from "./tos.js";

export interface ValidationResult {
  ok: boolean;
  value?: Environment;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a podbay.yaml. ToS violations and schema errors are hard failures;
 * unknown top-level fields are warnings (forward compatibility).
 */
export function validateEnvironment(yamlString: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let raw: unknown;
  try {
    raw = parseYaml(yamlString);
  } catch (e) {
    return { ok: false, errors: [`invalid YAML: ${(e as Error).message}`], warnings };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["podbay.yaml must be a mapping"], warnings };
  }

  // ToS denylist runs first and independently of the schema — always hard-fails.
  errors.push(...findTosViolations(raw));

  // Unknown top-level keys → warnings.
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (!(KNOWN_TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      warnings.push(`unknown field "${key}" ignored (not part of podbay/v0)`);
    }
  }

  const parsed = EnvironmentSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "(root)";
      errors.push(`${path}: ${issue.message}`);
    }
    return { ok: false, errors, warnings };
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, value: parsed.data, errors, warnings };
}
