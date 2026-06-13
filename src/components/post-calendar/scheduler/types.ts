export type ScheduleItem =
  | { kind: "rendered_job"; jobId: string; label: string; thumbPath?: string }
  | { kind: "library"; sourceVideoId: string; label: string; storagePath?: string }
  | { kind: "url"; url: string; label: string; thumbnailUrl?: string | null };

export type ReactConfig = {
  reactionIds: string[];
  overlayPhrases: string[];
  captions: string[];
  hashtags: string;
};

export type ScheduleConfig = {
  weekdays: number[];
  times: string[];
};

export type WizardState = {
  items: ScheduleItem[];
  reactConfig: ReactConfig;
  scheduleConfig: ScheduleConfig;
};
