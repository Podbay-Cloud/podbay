const SIGNIN_ORIGIN = "https://podbay.invalid";

export function resolveSignInCallback(next?: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/dashboard";
  }

  try {
    const url = new URL(next, SIGNIN_ORIGIN);
    if (url.origin !== SIGNIN_ORIGIN) return "/dashboard";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}
