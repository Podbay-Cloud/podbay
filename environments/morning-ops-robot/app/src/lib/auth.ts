// A password-derived token so the dashboard cookie can't be forged without the
// password. Web Crypto works in both the proxy (edge) and node route handlers.
export async function pwToken(pw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const DASH_COOKIE = "dash_auth";
