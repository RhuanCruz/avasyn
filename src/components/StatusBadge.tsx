import { Badge } from "@/components/ui/badge";
import { getJobStatusLabel, getPostStatusLabel, getStatusVariant } from "@/lib/status";
import type { JobStatus, PostStatus } from "@/lib/types";

type StatusBadgeProps = {
  status: JobStatus | PostStatus;
  type?: "job" | "post";
};

export function StatusBadge({ status, type = "job" }: StatusBadgeProps) {
  const label =
    type === "post"
      ? getPostStatusLabel(status as PostStatus)
      : getJobStatusLabel(status as JobStatus);

  return <Badge variant={getStatusVariant(status)}>{label}</Badge>;
}
