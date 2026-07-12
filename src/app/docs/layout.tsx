import "./docs.css";
import { DocsSidebar } from "./sidebar";
import { docNav } from "@/lib/docs-content";

export default function DocsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="docs-shell">
      <aside className="docs-sidebar">
        <DocsSidebar entries={docNav()} />
      </aside>
      <main className="docs-main">{children}</main>
    </div>
  );
}
