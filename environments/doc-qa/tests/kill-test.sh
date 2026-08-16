#!/usr/bin/env bash
# ai-chat env kill-test — run inside a FRESH ai-chat pod. Verifies the prebuilt,
# already-working chat is in place so the user can talk to it immediately and the
# agent can customize (not rebuild) it.
set -euo pipefail
cd ~/work

echo "1. Next.js app present"; test -f package.json && grep -q '"next"' package.json
# The AI SDK packages are ESM-only, so check the installed dirs (require.resolve
# is CJS and fails on them) — they're pnpm symlinks into node_modules.
echo "2. AI SDK installed"; for p in ai @ai-sdk/react @ai-sdk/anthropic; do test -e "node_modules/$p" || { echo "MISSING: $p"; exit 1; }; done
echo "3. prebuilt chat in place"; \
  test -f src/app/page.tsx || { echo "MISSING: src/app/page.tsx"; exit 1; }; \
  test -f src/app/api/chat/route.ts || { echo "MISSING: src/app/api/chat/route.ts"; exit 1; }; \
  grep -q "useChat" src/app/page.tsx || { echo "page.tsx is not the chat UI"; exit 1; }; \
  grep -q "streamText" src/app/api/chat/route.ts || { echo "route.ts is not the streaming API"; exit 1; }
echo "4. preview origin allowed (no cross-origin hydration block)"; grep -q "allowedDevOrigins" next.config.ts
echo "5. pnpm present"; command -v pnpm >/dev/null
echo "6. deps in place (no install needed)"; test -d node_modules
echo "7. app builds"; pnpm build >/tmp/ai-chat-build.log 2>&1 || { echo "BUILD FAILED:"; tail -20 /tmp/ai-chat-build.log; exit 1; }

echo "PASS: ai-chat ships a working chat, ready to run and customize."
