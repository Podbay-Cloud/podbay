import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/site-footer";
import { getAllPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Notes on running coding agents in the cloud — persistent workspaces, reaching your agent from anywhere, and getting more out of the subscription you already pay for.",
  alternates: { canonical: "/blog" },
};

export default function BlogIndex() {
  const posts = getAllPosts();
  return (
    <>
      <main className="mx-auto max-w-3xl px-4 py-12">
        <Link href="/" className="text-[13px] font-medium text-[var(--accent-light)] hover:underline">
          ← Podbay
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Blog</h1>
        <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-muted-foreground">
          Notes on running coding agents in the cloud.
        </p>

        <ul className="mt-8 flex flex-col gap-7">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link href={`/blog/${post.slug}`} className="group block">
                <time className="text-[12px] uppercase tracking-wide text-muted-foreground/70" dateTime={post.date}>
                  {new Date(post.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                </time>
                <h2 className="mt-1 text-lg font-semibold tracking-tight group-hover:text-[var(--accent-light)]">
                  {post.title}
                </h2>
                <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-muted-foreground">
                  {post.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
