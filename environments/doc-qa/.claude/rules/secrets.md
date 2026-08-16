# Secrets

- The chat app's model key is `process.env.ANTHROPIC_API_KEY`, set by the user in the dashboard.
  Read it from the environment. Never hardcode it, echo it, log it, or write it into a file under
  `~/work` (that persists and gets shared).
- If a model call fails with a missing or invalid key, tell the user to set `ANTHROPIC_API_KEY` in
  the dashboard for this pod. Do not ask them to paste a key into the chat or the terminal.
