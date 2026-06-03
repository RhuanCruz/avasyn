import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function LoginPage() {
  const { loading, session, signIn, signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && session) {
    return <Navigate replace to="/" />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "sign-up") {
        await signUp(email, password);
        toast.success("Conta criada");
      } else {
        await signIn(email, password);
        toast.success("Login realizado");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : mode === "sign-up"
            ? "Falha ao criar conta"
            : "Falha no login",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Avasyn</CardTitle>
          <CardDescription>
            {mode === "sign-up"
              ? "Crie uma conta para acessar o painel."
              : "Acesse o painel de geração e postagem de Reels."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  autoComplete="email"
                  id="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Senha</FieldLabel>
                <Input
                  autoComplete="current-password"
                  id="password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </Field>
              <Button disabled={submitting} type="submit">
                {submitting
                  ? mode === "sign-up"
                    ? "Criando..."
                    : "Entrando..."
                  : mode === "sign-up"
                    ? "Criar conta"
                    : "Entrar"}
              </Button>
              <Button
                disabled={submitting}
                onClick={() =>
                  setMode((current) =>
                    current === "sign-in" ? "sign-up" : "sign-in",
                  )
                }
                type="button"
                variant="ghost"
              >
                {mode === "sign-up"
                  ? "Já tenho conta"
                  : "Criar uma nova conta"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
