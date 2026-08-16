import { describe, expect, it } from "vitest";
import { IncusApi, IncusApiError } from "../src/incus/http-client.js";

/**
 * Regression guard for the error-body parsing (the provider tests use a FAKE
 * IncusApi, so `req`'s error handling was never exercised — that's how the
 * error_code/status_code mixup shipped and broke every dashboard launch).
 *
 * Incus error responses set `status_code: 0` and carry the real code in
 * `error_code`. If we read status_code, 404-tolerance in getInstance/
 * instanceState silently fails and createPod throws on its idempotency probe.
 */

// The exact body a live daemon returns for GET /1.0/instances/<missing>.
const NOT_FOUND_BODY = JSON.stringify({
  type: "error",
  status: "",
  status_code: 0,
  operation: "",
  error_code: 404,
  error: 'Failed to fetch instance "x" in project "default": Instance not found',
  metadata: null,
});

function apiReturning(body: string): IncusApi {
  const api = new IncusApi({
    baseUrl: "https://10.77.0.1:8443",
    clientCertPem: "x",
    clientKeyPem: "x",
    project: "default",
  });
  // Stub the private transport so req() parses a canned daemon response.
  (api as unknown as { raw: () => Promise<{ status: number; body: Buffer }> }).raw = async () => ({
    status: 200,
    body: Buffer.from(body),
  });
  return api;
}

describe("IncusApi error-body parsing", () => {
  it("getInstance tolerates a 404 carried in error_code (returns null, not throw)", async () => {
    expect(await apiReturning(NOT_FOUND_BODY).getInstance("x")).toBeNull();
  });

  it("instanceState tolerates the same 404", async () => {
    expect(await apiReturning(NOT_FOUND_BODY).instanceState("x")).toBeNull();
  });

  it("a non-404 error still throws, with the code from error_code", async () => {
    const body = JSON.stringify({
      type: "error",
      status_code: 0,
      error_code: 500,
      error: "boom",
      metadata: null,
    });
    await expect(apiReturning(body).getInstance("x")).rejects.toMatchObject({
      name: "IncusApiError",
      statusCode: 500,
    });
    // sanity: it's the typed error
    await apiReturning(body)
      .listInstances()
      .catch((e) => expect(e).toBeInstanceOf(IncusApiError));
  });
});
