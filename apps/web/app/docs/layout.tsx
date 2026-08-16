import type { ReactNode } from "react";
import Image from "next/image";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { docsSource } from "@/lib/docs-source";
import "fumadocs-ui/style.css";
import "./podbay-docs.css";

function DocsWordmark() {
  return (
    <span className="podbay-docs-wordmark">
      <Image src="/podbay-mark.svg" alt="" width={24} height={24} aria-hidden />
      <span>
        <strong>podbay</strong>
        <small>docs</small>
      </span>
    </span>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      theme={{ forcedTheme: "dark", enableSystem: false }}
      search={{ options: { defaultTag: undefined } }}
    >
      <DocsLayout
        tree={docsSource.pageTree}
        nav={{ title: <DocsWordmark />, url: "/docs" }}
        themeSwitch={{ enabled: false }}
        githubUrl="https://github.com/Podbay-Cloud/install"
        links={[
          { text: "Product", url: "/", active: "none" },
          { text: "Dashboard", url: "/dashboard", type: "button" },
        ]}
        sidebar={{ defaultOpenLevel: 1 }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
