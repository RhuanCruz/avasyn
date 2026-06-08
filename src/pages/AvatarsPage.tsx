import { FormEvent, type CSSProperties, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "@/auth/AuthContext";
import {
  AppTopbar,
  AvatarBubble,
  Icon,
  Pill,
  StatusPill,
  avatarInitials,
  colorForAvatar,
} from "@/components/operator-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAvatarState } from "@/hooks/useAvatarState";
import { createAvatarPhotoUrl, removeAvatarPhoto, uploadAvatarPhoto } from "@/lib/avatar-photo";
import { slugifyAvatarName } from "@/lib/avatar-utils";
import { supabase } from "@/lib/supabase";
import type { Avatar, AvatarStatus } from "@/lib/types";

type ViewMode = "grid" | "list";
type FilterMode = "all" | AvatarStatus;

export function AvatarsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    avatars,
    loading,
    error,
    refresh,
    selectedAvatarId,
    setSelectedAvatarId,
  } = useAvatarState();
  const [view, setView] = useState<ViewMode>("grid");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [personaSummary, setPersonaSummary] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [status, setStatus] = useState<AvatarStatus>("active");
  const [submitting, setSubmitting] = useState(false);
  const photoPreviewUrl = useMemo(
    () => (photoFile ? URL.createObjectURL(photoFile) : null),
    [photoFile],
  );

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  const visibleAvatars = useMemo(() => {
    if (filter === "all") return avatars;
    return avatars.filter((avatar) => avatar.status === filter);
  }, [avatars, filter]);

  async function handleCreateAvatar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    setSubmitting(true);
    let uploadedPhotoPath: string | null = null;
    try {
      const slug = buildUniqueAvatarSlug(avatars, name);
      uploadedPhotoPath = photoFile ? await uploadAvatarPhoto(user.id, photoFile) : null;
      const { data, error: insertError } = await supabase
        .from("avatars")
        .insert({
          user_id: user.id,
          name: name.trim(),
          slug,
          status,
          primary_platform: "manual",
          persona_summary: personaSummary.trim() || null,
          photo_path: uploadedPhotoPath,
        })
        .select("*")
        .single();

      if (insertError || !data) {
        throw insertError ?? new Error("Falha ao criar avatar");
      }

      await refresh();
      setSelectedAvatarId(data.id);
      setShowCreate(false);
      setName("");
      setPersonaSummary("");
      setPhotoFile(null);
      setStatus("active");
      toast.success("Avatar criado");
      navigate(`/avatars/${data.id}`);
    } catch (submitError) {
      if (uploadedPhotoPath) {
        try {
          await removeAvatarPhoto(uploadedPhotoPath);
        } catch {
          // Best-effort cleanup; keep the original create error visible to the user.
        }
      }
      toast.error(submitError instanceof Error ? submitError.message : "Falha ao criar avatar");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <AppTopbar
        actions={
          <>
            <div className="segmented">
              {[
                ["grid", "grid"],
                ["list", "list"],
              ].map(([mode, icon]) => (
                <button
                  className={view === mode ? "active" : undefined}
                  key={mode}
                  onClick={() => setView(mode as ViewMode)}
                  type="button"
                >
                  <Icon name={icon} />
                </button>
              ))}
            </div>
            <Button onClick={() => setShowCreate(true)} size="sm">
              <Icon name="plus" />
              Novo avatar
            </Button>
          </>
        }
        crumbs={[
          { label: "Workspace", icon: "home", href: "/" },
          { label: "Avatares", icon: "users" },
        ]}
      />

      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Avatares</h1>
            <p className="page-subtitle">
              Cada avatar concentra persona, biblioteca de mídia e formatos de produção.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link className={buttonVariants({ variant: "outline" })} to="/bulk-editor">
              Ir para editor
            </Link>
            <Button onClick={() => setShowCreate(true)}>
              <Icon name="plus" />
              Criar avatar
            </Button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {[
            { key: "all", label: "Todos", count: avatars.length },
            {
              key: "active",
              label: "Ativos",
              count: avatars.filter((avatar) => avatar.status === "active").length,
            },
            {
              key: "paused",
              label: "Pausados",
              count: avatars.filter((avatar) => avatar.status === "paused").length,
            },
            {
              key: "draft",
              label: "Rascunhos",
              count: avatars.filter((avatar) => avatar.status === "draft").length,
            },
          ].map((tab) => (
            <button
              className={`tab ${filter === tab.key ? "active" : ""}`}
              key={tab.key}
              onClick={() => setFilter(tab.key as FilterMode)}
              type="button"
            >
              {tab.label}
              <span className="count">{tab.count}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="panel empty">
            <div>
              <h3>Carregando avatares</h3>
              <p>Buscando os contextos editoriais do workspace.</p>
            </div>
          </div>
        ) : error ? (
          <div className="panel empty">
            <div>
              <h3>Falha ao carregar</h3>
              <p>{error}</p>
            </div>
          </div>
        ) : visibleAvatars.length === 0 ? (
          <div className="panel empty">
            <div>
              <h3>Nenhum avatar neste filtro</h3>
              <p>Crie um avatar para abrir um novo contexto editorial.</p>
            </div>
          </div>
        ) : view === "grid" ? (
          <div className="avatar-card-grid">
            {visibleAvatars.map((avatar) => (
              <AvatarCard
                avatar={avatar}
                key={avatar.id}
                selected={selectedAvatarId === avatar.id}
                onSelect={setSelectedAvatarId}
              />
            ))}
            <button
              className="avatar-create-card"
              onClick={() => setShowCreate(true)}
              type="button"
            >
              <div className="col" style={{ alignItems: "center", gap: 8 }}>
                <div className="av-bubble lg" style={{ background: "var(--surface-3)", color: "var(--text-muted)" }}>
                  +
                </div>
                <span className="text-md">Criar avatar</span>
                <span className="text-sm muted">Novo contexto editorial</span>
              </div>
            </button>
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <table className="table">
              <thead>
                <tr>
                  <th>Avatar</th>
                  <th>Persona</th>
                  <th>Status</th>
                  <th>Criado</th>
                  <th>Acao</th>
                </tr>
              </thead>
              <tbody>
                {visibleAvatars.map((avatar) => (
                  <tr key={avatar.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <AvatarBubble avatar={avatar} />
                        <div className="col" style={{ gap: 3 }}>
                          <span>{avatar.name}</span>
                          <span className="text-xs mono muted">{avatar.slug}</span>
                        </div>
                      </div>
                    </td>
                    <td className="muted" style={{ maxWidth: 340 }}>
                      <span className="truncate">{avatar.persona_summary ?? "Sem resumo editorial"}</span>
                    </td>
                    <td><StatusPill kind="avatar" status={avatar.status} /></td>
                    <td className="mono">{new Date(avatar.created_at).toLocaleDateString("pt-BR")}</td>
                    <td>
                      <Link className={buttonVariants({ size: "sm", variant: "outline" })} to={`/avatars/${avatar.id}`}>
                        Abrir hub
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="panel"
            onClick={(event) => event.stopPropagation()}
            style={{ width: "100%", maxWidth: 560, padding: 20 }}
          >
            <div className="page-header" style={{ marginBottom: 18 }}>
              <div>
                <h2 className="text-lg">Novo avatar</h2>
                <p className="page-subtitle">Crie uma unidade editorial para organizar mídia e produção.</p>
              </div>
              <Button onClick={() => setShowCreate(false)} size="sm" variant="outline">
                <Icon name="x" />
              </Button>
            </div>

            <form onSubmit={handleCreateAvatar}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="avatar-name">Nome</FieldLabel>
                  <Input
                    id="avatar-name"
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex.: React Neymar"
                    required
                    value={name}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="avatar-summary">Persona resumida</FieldLabel>
                  <Textarea
                    id="avatar-summary"
                    onChange={(event) => setPersonaSummary(event.target.value)}
                    placeholder="Tom, nicho, recorte e objetivo editorial."
                    rows={4}
                    value={personaSummary}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="avatar-photo">Foto do perfil</FieldLabel>
                  <div className="avatar-photo-field">
                    <div className="avatar-photo-preview">
                      {photoPreviewUrl ? (
                        <img alt="Preview da foto do avatar" src={photoPreviewUrl} />
                      ) : (
                        <Icon name="image" size={22} />
                      )}
                    </div>
                    <Input
                      accept="image/jpeg,image/png,image/webp"
                      id="avatar-photo"
                      onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
                      type="file"
                    />
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="avatar-status">Status inicial</FieldLabel>
                  <Select
                    id="avatar-status"
                    onChange={(event) => setStatus(event.target.value as AvatarStatus)}
                    value={status}
                  >
                    <option value="active">Ativo</option>
                    <option value="paused">Pausado</option>
                    <option value="draft">Rascunho</option>
                  </Select>
                </Field>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button onClick={() => setShowCreate(false)} type="button" variant="outline">
                    Cancelar
                  </Button>
                  <Button disabled={submitting || !name.trim()} type="submit">
                    {submitting ? "Criando..." : "Criar avatar"}
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AvatarCard({
  avatar,
  onSelect,
  selected,
}: {
  avatar: Avatar;
  onSelect: (avatarId: string | null) => void;
  selected: boolean;
}) {
  const [colorStart, colorEnd] = colorForAvatar(avatar.id);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void createAvatarPhotoUrl(avatar.photo_path)
      .then((url) => {
        if (!cancelled) setPhotoUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPhotoUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [avatar.photo_path]);

  return (
    <article className="avatar-visual-card">
      <Link
        aria-label={`Abrir avatar ${avatar.name}`}
        className="avatar-visual-link"
        to={`/avatars/${avatar.id}`}
      >
        <div
          className="avatar-visual-cover"
          style={{
            "--avatar-color-start": colorStart,
            "--avatar-color-end": colorEnd,
          } as CSSProperties}
        >
          {photoUrl ? (
            <img alt={`Foto de perfil de ${avatar.name}`} className="avatar-cover-photo" src={photoUrl} />
          ) : null}
          <div className="avatar-cover-pattern" />
          {!photoUrl ? <div className="avatar-cover-initials">{avatarInitials(avatar.name)}</div> : null}
          <div className="avatar-cover-top">
            <span className="avatar-mini-badge">{avatarInitials(avatar.name).slice(0, 2)}</span>
            <span className="avatar-handle">@{avatar.slug}</span>
            <span className="avatar-cover-menu">
              <Icon name="dots" size={14} />
            </span>
          </div>
          <div className="avatar-cover-bottom">
            <div className="avatar-cover-copy">
              <h2>{avatar.name}</h2>
              <p>{avatar.persona_summary ?? "Sem resumo editorial."}</p>
            </div>
            <StatusPill kind="avatar" status={avatar.status} />
          </div>
        </div>
      </Link>

      <div className="avatar-card-footer">
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <span className="mono text-xs muted truncate">react()</span>
          {selected ? <Pill tone="violet">ativo no filtro</Pill> : null}
        </div>
        <Button onClick={() => onSelect(avatar.id)} size="sm" variant={selected ? "default" : "outline"}>
          {selected ? "Selecionado" : "Usar"}
        </Button>
        <Link className={buttonVariants({ size: "sm", variant: "outline" })} to={`/avatars/${avatar.id}`}>
          Abrir hub
        </Link>
      </div>
    </article>
  );
}

function buildUniqueAvatarSlug(avatars: Avatar[], name: string) {
  const base = slugifyAvatarName(name);
  const existing = new Set(avatars.map((avatar) => avatar.slug));

  if (!existing.has(base)) return base;

  for (let index = 2; index <= 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }

  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
