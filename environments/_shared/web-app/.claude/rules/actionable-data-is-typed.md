# If the user will act on it, it's a field — not prose

The most expensive UI bug is a **data-model** bug wearing a UI costume.

Learned the hard way (first-10-customers dogfood, 2026-07-29): research had found every
prospect's contact channels — email, X, GitHub, personal site — and wrote them into a
free-text `fitNotes` blob ("CONTACT: reebz.com · X @reebz · github.com/Reebz"). Nothing
was missing. But the founder still had to **dig through notes to find out how to email
someone** — in a CRM, the one thing that must never be work. No amount of UI polish fixes
that, because the data isn't there to render.

## The rule

When you extract or capture a fact, ask: **will someone click it, filter it, sort it, or
export it?**

- **Yes → a typed field** on the entity, with a shape (`{ type, label, url, primary?, note? }`
  beats `string`). Then the UI can be good, exports stay clean, and later features are cheap.
- **No → prose is fine.** Notes are for the "why", written for a human to read.

Corollaries worth stating:

- **Free text is where information goes to die.** It survives, it's just unusable. "We
  captured it" is not the same as "the user can act on it".
- **Structure at capture time, not later.** Backfilling structure out of prose costs an
  extraction pass over every record and is lossy. Cheap when written, expensive when mined.
- **Keep the caveat with the datum.** "verify handle", "thread may be closed by automod" —
  attach it to the field (`note`) so the UI can warn at the point of action, instead of
  burying it in notes the user reads only if they think to.
- **Re-export after a schema change.** Any local backup/export written before the change no
  longer round-trips; refresh it in the same session.

## Applies to any playbook

The shape recurs: leads→contacts, docs→sources, jobs→targets, papers→authors. Whenever the
agent researches an entity and finds *ways to act on it*, those ways are structured data on
the entity — never a sentence about them.
