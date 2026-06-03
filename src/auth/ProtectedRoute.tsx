import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";

export function ProtectedRoute() {
  const { loading, session } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Carregando sessão...
      </div>
    );
  }

  if (!session) {
    return <Navigate replace to="/login" />;
  }

  return <Outlet />;
}
