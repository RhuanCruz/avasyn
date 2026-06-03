import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/reactions", label: "Reactions" },
  { href: "/accounts", label: "Contas" },
  { href: "/generate", label: "Gerar agora" },
  { href: "/automations", label: "Automações" },
];

export function AppShell() {
  const { signOut, user } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-border bg-card px-4 py-5 md:flex md:flex-col">
        <div className="mb-7 px-2">
          <p className="text-base font-semibold leading-none">Avasyn</p>
          <p className="mt-1 text-xs text-muted-foreground">Instagram Reels ops</p>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              className={({ isActive }) =>
                cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                  isActive && "bg-accent text-accent-foreground",
                )
              }
              end={item.href === "/"}
              key={item.href}
              to={item.href}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border pt-4">
          <p className="truncate px-2 text-xs text-muted-foreground">{user?.email}</p>
          <Button
            className="mt-3 w-full justify-start"
            onClick={() => void signOut()}
            variant="ghost"
          >
            Sair
          </Button>
        </div>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-10 border-b border-border bg-card/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Avasyn</span>
            <Button onClick={() => void signOut()} size="sm" variant="outline">
              Sair
            </Button>
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {navItems.map((item) => (
              <NavLink
                className={({ isActive }) =>
                  cn(
                    "whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium text-muted-foreground",
                    isActive && "bg-accent text-accent-foreground",
                  )
                }
                end={item.href === "/"}
                key={item.href}
                to={item.href}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
