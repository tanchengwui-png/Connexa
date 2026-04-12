import { Sidebar } from "@/components/sidebar";
import { requireCurrentAgent } from "@/lib/auth/current-user";

type DashboardShellProps = {
  currentPath: string;
  children: React.ReactNode;
};

export async function DashboardShell({
  currentPath,
  children
}: DashboardShellProps) {
  await requireCurrentAgent();
  const isInboxLayout = currentPath === "/inbox";

  return (
    <div className={`shell${isInboxLayout ? " shell-inbox" : ""}`}>
      <Sidebar currentPath={currentPath} />
      <main className={`app-main${isInboxLayout ? " app-main-inbox" : ""}`}>{children}</main>
    </div>
  );
}
