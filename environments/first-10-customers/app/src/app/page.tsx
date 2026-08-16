import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

// Landing shell — PUBLIC (the shareable URL). The agent fills in real copy,
// brand, and design here (ask the founder first). Keep the pipeline at /crm.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
        Replace this with your product
      </span>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        Your landing page starts here
      </h1>
      <p className="max-w-prose text-lg text-muted-foreground">
        This is the public page prospects will see. Tell your agent who it&rsquo;s for and what you&rsquo;re
        building, and it will shape the copy, design, and call to action around your ICP.
      </p>
      <div className="flex gap-3">
        <Button size="lg">Primary call to action</Button>
        <Link href="/crm" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Open pipeline
        </Link>
      </div>
    </main>
  );
}
