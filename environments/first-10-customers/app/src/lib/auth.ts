// A password-derived token so the /crm cookie can't be forged without the password.
// Web Crypto works in both the edge middleware and node route handlers.
export async function pwToken(pw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const CRM_COOKIE = "crm_auth";
