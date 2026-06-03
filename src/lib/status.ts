import type { JobStatus, PostStatus } from "@/lib/types";

export function getJobStatusLabel(status: JobStatus): string {
  const labels: Record<JobStatus, string> = {
    pending: "Pendente",
    processing: "Processando",
    rendered: "Renderizado",
    posting: "Postando",
    posted: "Publicado",
    error: "Erro",
  };

  return labels[status];
}

export function getPostStatusLabel(status: PostStatus): string {
  const labels: Record<PostStatus, string> = {
    scheduled: "Agendado",
    published: "Publicado",
    failed: "Falhou",
    partial: "Parcial",
    cancelled: "Cancelado",
  };

  return labels[status];
}

export function getStatusVariant(status: JobStatus | PostStatus) {
  if (status === "posted" || status === "published") {
    return "success" as const;
  }

  if (status === "error" || status === "failed" || status === "cancelled") {
    return "destructive" as const;
  }

  if (status === "processing" || status === "posting" || status === "scheduled") {
    return "warning" as const;
  }

  return "secondary" as const;
}
