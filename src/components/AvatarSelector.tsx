import { Link } from "react-router-dom";

import { buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { Avatar } from "@/lib/types";

export function AvatarSelector({
  avatars,
  selectedAvatarId,
  onChange,
  label = "Avatar",
  manageHref = "/avatars",
}: {
  avatars: Avatar[];
  selectedAvatarId: string | null;
  onChange: (avatarId: string | null) => void;
  label?: string;
  manageHref?: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field className="sm:min-w-72">
        <FieldLabel htmlFor="avatar-selector">{label}</FieldLabel>
        <Select
          id="avatar-selector"
          onChange={(event) => onChange(event.target.value || null)}
          value={selectedAvatarId ?? ""}
        >
          <option value="">Selecione um avatar</option>
          {avatars.map((avatar) => (
            <option key={avatar.id} value={avatar.id}>
              {avatar.name}
            </option>
          ))}
        </Select>
      </Field>
      <Link className={buttonVariants({ className: "sm:w-auto", variant: "outline" })} to={manageHref}>
        Avatares
      </Link>
    </div>
  );
}
