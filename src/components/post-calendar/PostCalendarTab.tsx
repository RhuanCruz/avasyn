import { Skeleton } from "@/components/ui/skeleton";
import { usePostCalendar } from "@/hooks/usePostCalendar";
import { ConnectInstagramEmptyState } from "./ConnectInstagramEmptyState";
import { PostCalendarView } from "./PostCalendarView";

type Props = {
  avatarId: string;
};

export function PostCalendarTab({ avatarId }: Props) {
  const { data, loading, refresh } = usePostCalendar(avatarId);

  if (loading) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton className="aspect-square rounded" key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!data.hasConnectedAccount) {
    return (
      <div className="mt-4">
        <ConnectInstagramEmptyState avatarId={avatarId} onSynced={refresh} />
      </div>
    );
  }

  return (
    <div className="mt-4">
      <PostCalendarView
        accounts={data.accounts}
        avatarId={avatarId}
        onRefresh={refresh}
        posts={data.posts}
      />
    </div>
  );
}
