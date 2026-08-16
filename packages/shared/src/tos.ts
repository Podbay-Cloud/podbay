/**
 * ToS guardrails, encoded as executable checks (docs/strategy/analysis.md).
 * The environment format must NEVER carry model credentials or any value that
 * changes how the official CLI authenticates. These are hard failures.
 */

/** Field names (case-insensitive) that must never appear anywhere in podbay.yaml. */
const FORBIDDEN_FIELD_NAMES = [
  "apikey",
  "api_key",
  "anthropicapikey",
  "anthropic_api_key",
  "authtoken",
  "auth_token",
  "anthropic_auth_token",
  "oauthtoken",
  "oauth_token",
  "claude_code_oauth_token",
  "openai_api_key",
  "credential",
  "credentials",
  "apikeyhelper",
  "anthropic_base_url",
  "baseurl",
  "base_url",
];

/** env var names that would override official-CLI auth or carry secrets. */
const FORBIDDEN_ENV_KEY = /(^|_)(TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS?)$/i;
const FORBIDDEN_ENV_EXACT = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
]);

const norm = (k: string) => k.toLowerCase().replace(/-/g, "_");

/**
 * Returns a list of ToS-violation error messages (empty = clean).
 * Scans structural field names recursively (skipping the user-data `env` map,
 * whose keys are checked separately with the secret-name rule).
 */
export function findTosViolations(raw: unknown): string[] {
  const errors: string[] = [];

  const scan = (value: unknown, path: string, insideEnv: boolean) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => scan(v, `${path}[${i}]`, insideEnv));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        const here = path ? `${path}.${key}` : key;
        if (insideEnv) {
          // key is an env var NAME (user data)
          if (FORBIDDEN_ENV_EXACT.has(key) || FORBIDDEN_ENV_KEY.test(key)) {
            errors.push(
              `env var "${key}" looks secret-bearing or overrides CLI auth; the environment format cannot store secrets — use pod-level secrets instead`,
            );
          }
          continue; // do not descend into env values
        }
        if (FORBIDDEN_FIELD_NAMES.includes(norm(key))) {
          errors.push(
            `field "${here}" is not allowed: the environment format must not carry credentials or auth overrides`,
          );
        }
        scan(v, here, key === "env");
      }
    }
  };

  scan(raw, "", false);
  return errors;
}
