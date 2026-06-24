import { Outlet } from "react-router-dom";

import { AppSidebar } from "@/components/operator-ui";
import { RenderQueueLauncher } from "@/components/render-queue/RenderQueueSheet";
import { useAvatarState } from "@/hooks/useAvatarState";

export function AppShell() {
  const { avatars, selectedAvatarId, setSelectedAvatarId } = useAvatarState();

  return (
    <div className="app">
      <AppSidebar
        avatars={avatars}
        onSelectAvatar={setSelectedAvatarId}
        selectedAvatarId={selectedAvatarId}
      />
      <main className="main">
        <Outlet />
      </main>
      <RenderQueueLauncher />
    </div>
  );
}
