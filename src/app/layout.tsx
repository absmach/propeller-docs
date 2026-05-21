import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { Rubik } from "next/font/google";
import { Provider } from "@/components/provider";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import "./global.css";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/geo-constants";

const rubik = Rubik({
  subsets: ["latin"],
  style: "normal",
  display: "swap",
  preload: true,
  variable: "--font-rubik",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: "%s — Propeller Docs",
    default: "Documentation — Propeller WebAssembly Orchestrator",
  },
  description:
    "Propeller is an open-source WebAssembly orchestrator for Cloud-Edge computing — deploy Wasm workloads from cloud servers to microcontrollers with near-instant boot, OCI registry support, and sandboxed isolation.",
};

export default function Layout({ children }: LayoutProps<"/">) {
  const base = baseOptions();
  return (
    <html lang="en" className={rubik.variable} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen font-(family-name:--font-rubik)">
        <Provider>
          <DocsLayout
            {...base}
            tree={source.getPageTree()}
            links={base.links?.filter((item) => item.type === "icon")}
            nav={{ ...base.nav }}
          >
            {children}
          </DocsLayout>
        </Provider>
      </body>
    </html>
  );
}
