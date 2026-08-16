# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for a vulnerability.

- Use **GitHub's private vulnerability reporting** ("Report a vulnerability" under the Security tab), or
- email the maintainer at **security@podbay.cloud**.

Include enough to reproduce: affected version/commit, steps, and impact. We'll acknowledge within a few
business days, work with you on a fix and disclosure timeline, and credit you (unless you prefer not).

## Scope

In scope: the podbay runtime and application code in this repository (pod-agent, control-plane, gateway,
providers, pod-base image, self-host install).

Out of scope: the managed hosted service's infrastructure (report those directly to the maintainer), and
third-party components bundled at build time (report upstream, and tell us so we can pin/patch).

## Handling of secrets

podbay never bakes secrets into images or commits them to source; app secrets are provided at runtime.
If you believe a secret was exposed in the repo or an image, treat it as a vulnerability and report it
privately so it can be rotated.

## Supported versions

Until a formal release cadence is published, security fixes target the latest `main` and the most recent
tagged release.
