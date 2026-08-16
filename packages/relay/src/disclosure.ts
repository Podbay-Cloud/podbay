/**
 * The one thing the owner must read before the relay serves a single request.
 *
 * Shown at first `serve`, and consent is recorded. It is not a EULA wall for its own
 * sake — it states the two facts that are easy to not realise: the relay acts AS the
 * owner, and the account that gets banned is theirs.
 */
export const DISCLOSURE = `
  relay lets a Podbay pod fetch web pages THROUGH THIS MACHINE — from your network,
  so a site sees your home address, not a datacenter.

  What that means, plainly:
   • By default every fetch is CLEAN: your residential IP, but no cookies. The pod
     cannot read anything you are signed into.
   • 'relay login <site>' is the one step that lets THAT site be fetched as you.
     Until you do it, no account of yours is exposed. Automating a signed-in session
     may breach a site's terms, and the account at risk is YOURS.
   • The relay never fetches your private network (localhost, your LAN) and never
     sends a cookie or session back to a pod — only page content.
   • It uses a SEPARATE browser profile it owns; your everyday browser is untouched.
   • Watch what it does any time with 'relay dashboard'.
`.trim();
