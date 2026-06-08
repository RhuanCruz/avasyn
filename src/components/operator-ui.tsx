import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getJobStatusLabel, getPostStatusLabel } from "@/lib/status";
import type {
  Avatar,
  AvatarStatus,
  JobStatus,
  PostStatus,
  ReactionVideo,
  SourceVideo,
} from "@/lib/types";

const AVATAR_COLORS = [
  ["#f59e0b", "#fbbf24"],
  ["#8b5cf6", "#a78bfa"],
  ["#38bdf8", "#7dd3fc"],
  ["#f43f5e", "#fb7185"],
  ["#22c55e", "#4ade80"],
  ["#eab308", "#facc15"],
  ["#06b6d4", "#22d3ee"],
];

type IconProps = {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
};

export function Icon({ className, name, size = 14, style }: IconProps) {
  const base = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: cn("icon", className),
    style: { width: size, height: size, ...style },
  };

  switch (name) {
    case "home":
      return <svg {...base}><path d="M3 11.5L12 4l9 7.5" /><path d="M5 10v10h14V10" /></svg>;
    case "users":
      return <svg {...base}><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" /><path d="M16 6.5a3 3 0 0 1 0 5.5" /><path d="M20.5 19c0-2.4-1.7-4.3-4-4.8" /></svg>;
    case "library":
      return <svg {...base}><rect x="3" y="4" width="6" height="16" rx="1.2" /><rect x="11" y="4" width="6" height="16" rx="1.2" /><path d="M19 5l2.5 14.5" /></svg>;
    case "wand":
      return <svg {...base}><path d="M4 20l11-11" /><path d="M14 4l1.5 2.5L18 8l-2.5 1.5L14 12l-1.5-2.5L10 8l2.5-1.5z" /><path d="M19 14l.8 1.5L21 16l-1.2.5L19 18l-.8-1.5L17 16l1.2-.5z" /></svg>;
    case "play":
      return <svg {...base}><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>;
    case "plus":
      return <svg {...base}><path d="M12 5v14M5 12h14" /></svg>;
    case "search":
      return <svg {...base}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-3.5-3.5" /></svg>;
    case "chevron-down":
      return <svg {...base}><path d="M6 9l6 6 6-6" /></svg>;
    case "chevron-right":
      return <svg {...base}><path d="M9 6l6 6-6 6" /></svg>;
    case "check":
      return <svg {...base}><path d="M4 12l5 5L20 6" /></svg>;
    case "x":
      return <svg {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    case "dots":
      return <svg {...base}><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></svg>;
    case "film":
      return <svg {...base}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 15h18M8 4v16M16 4v16" /></svg>;
    case "reaction":
      return <svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="M8 14c1 1.5 2.4 2.3 4 2.3s3-.8 4-2.3" /><circle cx="9" cy="10" r=".8" fill="currentColor" /><circle cx="15" cy="10" r=".8" fill="currentColor" /></svg>;
    case "calendar":
      return <svg {...base}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>;
    case "clock":
      return <svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></svg>;
    case "upload":
      return <svg {...base}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>;
    case "link":
      return <svg {...base}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7L12.5 17.2" /></svg>;
    case "instagram":
      return <svg {...base}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" /></svg>;
    case "tiktok":
      return <svg {...base}><path d="M16 4v8.5a4.5 4.5 0 1 1-4.5-4.5" /><path d="M16 4c.5 2.4 2.3 4.2 4.5 4.5" /></svg>;
    case "settings":
      return <svg {...base}><circle cx="12" cy="12" r="2.8" /><path d="M19.4 14.5l1.5.9-1.7 3-1.7-.7a7.4 7.4 0 0 1-2 1.2l-.3 1.8H11l-.3-1.8a7.4 7.4 0 0 1-2-1.2l-1.7.7-1.7-3 1.5-.9a7.4 7.4 0 0 1 0-2.3l-1.5-.9 1.7-3 1.7.7a7.4 7.4 0 0 1 2-1.2L11 4h2.2l.3 1.8a7.4 7.4 0 0 1 2 1.2l1.7-.7 1.7 3-1.5.9a7.4 7.4 0 0 1 0 2.3z" /></svg>;
    case "send":
      return <svg {...base}><path d="M4 12l16-8-6 18-2-7-8-3z" /></svg>;
    case "refresh":
      return <svg {...base}><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 21v-5h5" /></svg>;
    case "arrow-right":
      return <svg {...base}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "trash":
      return <svg {...base}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" /></svg>;
    case "edit":
      return <svg {...base}><path d="M4 20h4l10.5-10.5a2 2 0 0 0-2.8-2.8L5.2 17.2z" /><path d="M14 6l4 4" /></svg>;
    case "eye":
      return <svg {...base}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
    case "bell":
      return <svg {...base}><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>;
    case "check-circle":
      return <svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.5l2.5 2.5L16 9.5" /></svg>;
    case "alert":
      return <svg {...base}><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18.5v.5" /></svg>;
    case "pause":
      return <svg {...base}><rect x="7" y="5" width="3" height="14" /><rect x="14" y="5" width="3" height="14" /></svg>;
    case "image":
      return <svg {...base}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M3 17l5-5 5 5 3-3 5 5" /></svg>;
    case "download":
      return <svg {...base}><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>;
    case "list":
      return <svg {...base}><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></svg>;
    case "grid":
      return <svg {...base}><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></svg>;
    case "zap":
      return <svg {...base}><path d="M13 3L4 14h7l-1 7 9-11h-7z" /></svg>;
    case "flame":
      return <svg {...base}><path d="M12 3c0 4-5 5-5 10a5 5 0 0 0 10 0c0-2-1-3-2-4 0 2-1 3-2 3 .5-3-1-6-1-9z" /></svg>;
    default:
      return <svg {...base} />;
  }
}

export function colorForAvatar(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function avatarInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((token) => token[0])
    .join("")
    .toUpperCase();
}

export function AvatarBubble({
  avatar,
  size = "md",
}: {
  avatar: Pick<Avatar, "id" | "name"> | null | undefined;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const [c1, c2] = colorForAvatar(avatar?.id ?? "default");
  return (
    <div
      className={cn(
        "av-bubble",
        size === "sm" && "sm",
        size === "lg" && "lg",
        size === "xl" && "xl",
      )}
      style={{ background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)` }}
      title={avatar?.name ?? "Avatar"}
    >
      {avatar ? avatarInitials(avatar.name) : "?"}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
  withDot = false,
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "base" | "reaction" | "ok" | "warn" | "err" | "info" | "violet";
  withDot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("pill", tone, className)}>
      {withDot ? <span className="dot" /> : null}
      {children}
    </span>
  );
}

export function StatusPill({
  status,
  kind = "job",
}: {
  status: AvatarStatus | JobStatus | PostStatus;
  kind?: "avatar" | "job" | "post";
}) {
  if (kind === "avatar") {
    const map: Record<AvatarStatus, { label: string; tone: PillTone }> = {
      active: { label: "Ativo", tone: "ok" },
      paused: { label: "Pausado", tone: "warn" },
      draft: { label: "Rascunho", tone: "neutral" },
    };
    const current = map[status as AvatarStatus];
    return <Pill tone={current.tone} withDot>{current.label}</Pill>;
  }

  const tone = getStatusTone(status as JobStatus | PostStatus);
  const label =
    kind === "post"
      ? getPostStatusLabel(status as PostStatus)
      : getJobStatusLabel(status as JobStatus);

  return <Pill tone={tone} withDot>{label}</Pill>;
}

type PillTone = "neutral" | "base" | "reaction" | "ok" | "warn" | "err" | "info" | "violet";

function getStatusTone(status: JobStatus | PostStatus): PillTone {
  if (status === "posted" || status === "published") return "ok";
  if (status === "error" || status === "failed" || status === "cancelled") return "err";
  if (status === "processing") return "info";
  if (status === "posting" || status === "scheduled") return "violet";
  if (status === "rendered") return "ok";
  return "neutral";
}

export function AppTopbar({
  actions,
  crumbs,
}: {
  actions?: React.ReactNode;
  crumbs: Array<{ label: string; icon?: string; href?: string }>;
}) {
  return (
    <div className="topbar">
      <div className="crumbs">
        {crumbs.map((crumb, index) => (
          <span className="flex items-center gap-1.5" key={`${crumb.label}-${index}`}>
            {index > 0 ? <span className="sep">/</span> : null}
            {crumb.href ? (
              <Link className={cn("crumb", index === crumbs.length - 1 && "current")} to={crumb.href}>
                {crumb.icon ? <Icon name={crumb.icon} size={12} style={{ marginRight: 4, verticalAlign: "middle" }} /> : null}
                {crumb.label}
              </Link>
            ) : (
              <span className={cn("crumb", index === crumbs.length - 1 && "current")}>
                {crumb.icon ? <Icon name={crumb.icon} size={12} style={{ marginRight: 4, verticalAlign: "middle" }} /> : null}
                {crumb.label}
              </span>
            )}
          </span>
        ))}
      </div>
      <div className="topbar-actions">{actions}</div>
    </div>
  );
}

export function AvatarSwitcher({
  avatars,
  includeAll = true,
  onChange,
  selectedAvatarId,
}: {
  avatars: Avatar[];
  includeAll?: boolean;
  onChange: (avatarId: string | null) => void;
  selectedAvatarId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const selected = selectedAvatarId ? avatars.find((avatar) => avatar.id === selectedAvatarId) : null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn" onClick={() => setOpen((current) => !current)} style={{ paddingLeft: 6 }}>
        {selected ? (
          <AvatarBubble avatar={selected} size="sm" />
        ) : (
          <div className="av-bubble sm" style={{ background: "var(--surface-3)", color: "var(--text-muted)" }}>★</div>
        )}
        <span>{selected ? selected.name : "Todos os avatares"}</span>
        <Icon name="chevron-down" size={12} style={{ color: "var(--text-muted)" }} />
      </button>
      {open ? (
        <div className="panel" style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, width: 240, padding: 5, zIndex: 50 }}>
          {includeAll ? (
            <button
              className={cn("nav-item", !selectedAvatarId && "active")}
              style={{ width: "100%" }}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <div className="av-bubble sm" style={{ background: "var(--surface-3)", color: "var(--text-muted)" }}>★</div>
              <span>Todos os avatares</span>
            </button>
          ) : null}
          {includeAll ? <div className="divider" style={{ margin: "4px 0" }} /> : null}
          {avatars.map((avatar) => (
            <button
              className={cn("nav-item", selectedAvatarId === avatar.id && "active")}
              key={avatar.id}
              onClick={() => {
                onChange(avatar.id);
                setOpen(false);
              }}
              style={{ width: "100%" }}
            >
              <AvatarBubble avatar={avatar} size="sm" />
              <span className="truncate">{avatar.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function KpiCard({
  icon,
  label,
  sub,
  tone = "neutral",
  value,
}: {
  icon: string;
  label: string;
  sub: string;
  tone?: PillTone;
  value: number | string;
}) {
  return (
    <div className="card card-pad" style={{ padding: 16 }}>
      <div className="flex items-center gap-2 mb-3">
        <Icon name={icon} size={13} style={{ color: toneToColor(tone) }} />
        <span className="text-xs muted">{label}</span>
      </div>
      <div className="num" style={{ fontSize: 28, lineHeight: 1, fontWeight: 500, letterSpacing: "-0.02em" }}>
        {value}
      </div>
      <div className="text-xs muted mt-2">{sub}</div>
    </div>
  );
}

export function MediaTonePill({ kind }: { kind: "base" | "reaction" }) {
  return <Pill tone={kind} withDot>{kind === "base" ? "base" : "reaction"}</Pill>;
}

function toneToColor(tone: PillTone) {
  if (tone === "base") return "var(--base-color)";
  if (tone === "reaction") return "var(--reaction-color)";
  if (tone === "ok") return "var(--ok)";
  if (tone === "warn") return "var(--warn)";
  if (tone === "err") return "var(--err)";
  if (tone === "info") return "var(--info)";
  if (tone === "violet") return "var(--accent-hover)";
  return "var(--text-muted)";
}

export function MediaThumb({
  item,
  selected,
  tone,
}: {
  item: SourceVideo | ReactionVideo;
  selected?: boolean;
  tone: "base" | "reaction";
}) {
  const [c1] = colorForAvatar(item.id);
  const label = tone === "reaction" ? "REACTION" : "BASE";

  return (
    <div
      className="thumb"
      style={{
        borderColor: selected
          ? tone === "reaction"
            ? "var(--reaction-color)"
            : "var(--base-color)"
          : "var(--border)",
        boxShadow: selected
          ? `0 0 0 3px ${tone === "reaction" ? "var(--reaction-bg)" : "var(--base-bg)"}`
          : "none",
      }}
    >
      <div
        className="thumb-art"
        style={{
          background:
            tone === "reaction"
              ? `radial-gradient(120% 100% at 30% 30%, ${c1}33 0%, #0a0a0b 70%)`
              : `radial-gradient(120% 100% at 60% 40%, ${c1}22 0%, #0a0a0b 70%)`,
        }}
      >
        <span style={{ color: tone === "reaction" ? "var(--reaction-color)" : "var(--base-color)", opacity: 0.5, fontSize: 10 }}>
          {label}
        </span>
      </div>
      <span className={cn("pill", tone, "tag-corner")}><span className="dot" />{tone}</span>
      <div className="thumb-play"><Icon name="play" size={24} style={{ color: "white" }} /></div>
      {"duration_s" in item && item.duration_s ? (
        <div className="thumb-duration">{formatDuration(item.duration_s)}</div>
      ) : null}
    </div>
  );
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNumber(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(value);
}

export function AppSidebar({ avatars }: { avatars: Avatar[] }) {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const navItems = [
    { href: "/", label: "Dashboard", icon: "home" },
    { href: "/avatars", label: "Avatares", icon: "users" },
    { href: "/library", label: "Biblioteca", icon: "library" },
    { href: "/bulk-editor", label: "Editor em massa", icon: "wand" },
  ];
  const activeAvatars = avatars.filter((avatar) => avatar.status === "active").slice(0, 5);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">A</div>
        <div className="brand-name">Avasyn</div>
        <span className="pill neutral" style={{ marginLeft: "auto", fontSize: 10 }}>v1</span>
      </div>

      <button className="input" style={{ width: "100%", cursor: "pointer", background: "var(--surface)", color: "var(--text-muted)", justifyContent: "flex-start" }}>
        <Icon name="search" size={13} />
        <span>Buscar</span>
        <span className="kbd" style={{ marginLeft: "auto" }}>⌘K</span>
      </button>

      <div className="sidebar-section">Workspace</div>
      <div className="col" style={{ gap: 1 }}>
        {navItems.map((item) => (
          <NavLink
            className={({ isActive }) => cn("nav-item", isActive && "active")}
            end={item.href === "/"}
            key={item.href}
            to={item.href}
          >
            <Icon className="nav-item-icon" name={item.icon} size={14} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>

      <div className="sidebar-section">Avatares ativos</div>
      <div className="col" style={{ gap: 1 }}>
        {activeAvatars.map((avatar) => (
          <button className="nav-item" key={avatar.id} onClick={() => navigate(`/avatars/${avatar.id}`)}>
            <AvatarBubble avatar={avatar} size="sm" />
            <span className="truncate" style={{ fontSize: 12.5 }}>{avatar.name}</span>
          </button>
        ))}
        <button className="nav-item" onClick={() => navigate("/avatars")} style={{ color: "var(--text-muted)", fontSize: 12 }}>
          <Icon className="nav-item-icon" name="plus" size={13} />
          <span>Novo avatar</span>
        </button>
      </div>

      <div className="sidebar-spacer" />

      <div className="sidebar-foot">
        <div className="sidebar-user">
          <div className="av-bubble sm" style={{ background: "linear-gradient(135deg, #7c6cff, #38bdf8)" }}>VO</div>
          <div className="col" style={{ gap: 0, flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name truncate">Você</div>
            <div className="sidebar-user-sub truncate">{user?.email ?? "operador@avasyn"}</div>
          </div>
          <button
            className={buttonVariants({ size: "sm", variant: "ghost", className: "h-auto px-2 py-1.5" })}
            onClick={() => void signOut()}
          >
            Sair
          </button>
        </div>
      </div>
    </aside>
  );
}
