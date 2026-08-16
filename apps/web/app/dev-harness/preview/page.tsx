// Dev-only visual harness for the cockpit's preview card. Not linked from anywhere
// and returns 404 in production; it exists so layout regressions (truncation,
// wrapping, mobile balance) can be caught at real viewport widths without needing a
// live pod and an owner session. NOTE: it cannot live under `_harness` — Next treats
// an underscore-prefixed folder as PRIVATE and excludes it from routing (404).
import { notFound } from "next/navigation";
import PreviewCard from "@/components/preview-card";

export const dynamic = "force-static";

export default function Harness() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <PreviewCard
        slug="demo-pod"
        url="https://correct-jackal-c6bf.preview.podbay.cloud"
        isPublic
        running={false}
      />
    </main>
  );
}
