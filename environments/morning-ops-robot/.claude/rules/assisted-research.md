# Reaching data sources (this pod is a datacenter)

The routine pulls from real sources. This pod's network identity is a **datacenter** — some sites
refuse it outright (Reddit and others block datacenter IP ranges + non-browser agents at the edge).
The same fetch that "works on a laptop" only does so because a home IP sails through.

- **Use the `web-fetch` skill for every job that reads or watches the web.** It distinguishes
  search/read/watch/bulk, prefers feeds and webhooks, and walks the legitimate ladder: official API
  → direct fetch → published archive → third-party reader service → the founder's own relay when
  that rung ships.
- **When a source refuses this pod, name the failure correctly** in the run and digest
  (`source-blocked`, `egress-blocked`, `missing-credential`, or `no-rung`) rather than debugging the
  parser or retrying forever. A Cloudflare/CAPTCHA interstitial is a block, even when it returns 200.
- **Never evade a block** — no spoofed identity, rotating proxy, CAPTCHA-solving, or agent/IP
  rotation. A sanctioned reader service or the founder's future fetch-only relay is a distinct,
  consented rung; neither authorizes defeating a site's controls.
- **Assisted, not bulk scraping.** Gather what the routine needs for a useful digest, not everything
  that exists. Quality of signal beats volume.
