import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import SiteFooter from "@/components/site-footer";
import { getAllPosts, getPost, type BlogPost } from "@/lib/blog";

export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Not found" };
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      url: `/blog/${post.slug}`,
      publishedTime: post.date,
    },
  };
}

/** Render the markdown-lite body: blank-line paragraphs, `## ` headings, `- ` list items. */
function BlogBody({ body }: { body: string }) {
  const blocks = body.trim().split(/\n\n+/);
  return (
    <article className="legal-prose mt-8">
      {blocks.map((block, i) => {
        if (block.startsWith("## ")) return <h2 key={i}>{block.slice(3)}</h2>;
        if (block.split("\n").every((l) => l.startsWith("- "))) {
          return (
            <ul key={i}>
              {block.split("\n").map((l, j) => (
                <li key={j}>{l.slice(2)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{block}</p>;
      })}
    </article>
  );
}

function articleJsonLd(post: BlogPost) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    url: `https://podbay.cloud/blog/${post.slug}`,
    author: { "@type": "Organization", name: "Podbay" },
    publisher: { "@type": "Organization", name: "Podbay", url: "https://podbay.cloud" },
    keywords: post.tags.join(", "),
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd(post)) }}
      />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <Link href="/blog" className="text-[13px] font-medium text-[var(--accent-light)] hover:underline">
          ← Blog
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-balance">{post.title}</h1>
        <time className="mt-1 block text-[13px] text-muted-foreground" dateTime={post.date}>
          {new Date(post.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </time>
        <BlogBody body={post.body} />
      </main>
      <SiteFooter />
    </>
  );
}
