import { Outlet } from "react-router-dom";

import { AppSidebar } from "@/components/operator-ui";
import { useAvatarState } from "@/hooks/useAvatarState";

export function AppShell() {
  const { avatars } = useAvatarState();

  return (
    <div className="app">
      <AppSidebar avatars={avatars} />
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
