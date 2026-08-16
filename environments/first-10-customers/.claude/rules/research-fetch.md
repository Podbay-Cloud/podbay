# Research fetching — use the `web-fetch` skill as your substrate

The research skills in this env (`customer-research`, `prospecting`, `seo-audit`, `cro`,
`copywriting`) tell you to look at prospects' sites, forums, reviews, and competitors' pages. They
assume a fetch that "just works" — which is true on a laptop and **not** true here.

**This pod egresses from a datacenter IP.** Some sites refuse that at the network edge, and some sit
behind bot-management that challenges anything non-human. So when any of those skills says to
research, read, visit, or scrape something, **do it through the `web-fetch` skill** — it walks the
ladder (the source's own API → direct fetch → published archive → a third-party reader service →
your own browser) and knows how to recognize a block for what it is.

Two things this prevents, both of which waste the founder's time:

1. **Debugging the wrong thing.** A 403 or an empty page here usually means "datacenter IP refused",
   not "my parser is broken" and not "the company has no website". `web-fetch` names the failure.
2. **Reporting a challenge page as findings.** A Cloudflare interstitial often arrives as a *200*
   with `Just a moment...` in it. Never fold that into a prospect brief — it isn't data.

**When a source is genuinely fortified, say so and substitute the source.** The company's own site
instead of the aggregator; the registry instead of the reseller; the changelog instead of the
paywalled write-up. A brief that says "G2 is bot-protected, so this is from their own site and two
customer forum threads" is honest and useful. A brief padded with content you couldn't actually read
is neither.

The vendored skills' own limits still stand and are not softened by any of this: assisted research
for THIS founder's pipeline, never bulk harvesting, no breached or unprovenanced data, and no
scraping around a site that said no.
