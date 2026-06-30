import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider } from "@/auth/AuthContext";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { RenderQueueProvider } from "@/components/render-queue/RenderQueueContext";
import { AvatarDetailPage } from "@/pages/AvatarDetailPage";
import { AvatarsPage } from "@/pages/AvatarsPage";
import { BulkEditorPage } from "@/pages/BulkEditorPage";
import { ContentSearchPage } from "@/pages/ContentSearchPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { LibraryPage } from "@/pages/LibraryPage";
import { PresenterAvatarWizardPage } from "@/pages/PresenterAvatarWizardPage";
import { ScriptedVideoEditorPage } from "@/pages/ScriptedVideoEditorPage";
import "@/index.css";

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <ContentSearchPage /> },
          { path: "/dashboard", element: <DashboardPage /> },
          { path: "/library", element: <LibraryPage /> },
          { path: "/bulk-editor", element: <BulkEditorPage /> },
          { path: "/avatars", element: <AvatarsPage /> },
          { path: "/avatars/new", element: <PresenterAvatarWizardPage /> },
          { path: "/avatars/new/presenter", element: <PresenterAvatarWizardPage /> },
          { path: "/avatars/:avatarId/videos/new", element: <ScriptedVideoEditorPage /> },
          { path: "/avatars/:avatarId/videos/:projectId", element: <ScriptedVideoEditorPage /> },
          { path: "/avatars/:avatarId", element: <AvatarDetailPage /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <RenderQueueProvider>
        <RouterProvider router={router} />
      </RenderQueueProvider>
      <Toaster richColors />
    </AuthProvider>
  </StrictMode>,
);
