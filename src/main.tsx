import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider } from "@/auth/AuthContext";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { AccountsPage } from "@/pages/AccountsPage";
import { AutomationsPage } from "@/pages/AutomationsPage";
import { CuratePage } from "@/pages/CuratePage";
import { DashboardPage } from "@/pages/DashboardPage";
import { GeneratePage } from "@/pages/GeneratePage";
import { LoginPage } from "@/pages/LoginPage";
import { ReactionsPage } from "@/pages/ReactionsPage";
import "@/index.css";

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <DashboardPage /> },
          { path: "/reactions", element: <ReactionsPage /> },
          { path: "/accounts", element: <AccountsPage /> },
          { path: "/generate", element: <GeneratePage /> },
          { path: "/curate", element: <CuratePage /> },
          { path: "/automations", element: <AutomationsPage /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster richColors />
    </AuthProvider>
  </StrictMode>,
);
