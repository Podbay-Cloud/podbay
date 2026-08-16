import Link from "next/link";

/**
 * The signed-in nav entry on the landing page: the user's avatar beside
 * "Dashboard".
 *
 * A returning signed-in visitor lands on the marketing page and has to hunt for
 * the way back into their own machines — a plain "Dashboard" text link reads as
 * navigation, not as *their* account. A face (or their initial) is the thing the
 * eye catches, so it doubles as the signal that they are already signed in.
 *
 * One component for both landing variants rather than two copies: they have
 * separate CSS modules at slightly different type scales, and duplicated markup
 * across an A/B pair drifts on the first edit that only touches one leg.
 *
 * The mark is deliberately the one bright thing in the nav: the rest of the row is
 * muted text, so a filled accent circle (or a ringed photo) is what the eye lands
 * on. `--blue-soft` is declared on each landing root and inherits down here, so
 * both variants get their OWN accent without either module being imported.
 */
export default function LandingAccountLink({
  user,
}: {
  user: { name?: string | null; email?: string | null; image?: string | null };
}) {
  const label = user.name?.trim() || user.email?.trim() || "";
  const initial = label.charAt(0).toUpperCase() || "?";

  return (
    <Link
      href="/dashboard"
      // Vertical padding + a negative margin: the tap target stays comfortable on
      // a phone without the avatar making the nav row taller than its siblings.
      style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: "-4px 0" }}
    >
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.image}
          alt=""
          aria-hidden
          width={24}
          height={24}
          style={{
            width: 24,
            height: 24,
            borderRadius: 999,
            objectFit: "cover",
            // A ring, so a dark photo still reads as a distinct object against a
            // near-black header rather than dissolving into it.
            boxShadow: "0 0 0 1.5px var(--blue-soft, #8bacff)",
          }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            display: "grid",
            placeItems: "center",
            width: 24,
            height: 24,
            borderRadius: 999,
            background: "var(--blue-soft, #8bacff)",
            color: "#0b1120",
            fontSize: 11,
            fontWeight: 800,
            lineHeight: 1,
          }}
        >
          {initial}
        </span>
      )}
      Dashboard
    </Link>
  );
}
