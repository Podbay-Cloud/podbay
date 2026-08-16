# Vendored skill
source: obra/superpowers@requesting-code-review
commit: 3cd2db9f8aa48cf7907c55adfaef2db540702209
license: MIT
vendored: 2026-07-23
skillPath: skills/requesting-code-review/
survey: skills/registry.yaml
notes: |
  Self-review gate before merge. Ships an extra code-reviewer.md subagent prompt.
  Pin recorded 2026-07-23: our copy was verified BYTE-IDENTICAL (sha256) to upstream
  main, and 3cd2db9f8aa48cf7907c55adfaef2db540702209 is the last upstream commit
  touching skills/requesting-code-review/ (2026-06-16). License MIT verified from the upstream repo metadata.
  NOTE: the "computedHash" in environments/byo-project/skills-lock.json is npx-skills'
  own internal digest, NOT a sha256 of SKILL.md — do not compare the two.
