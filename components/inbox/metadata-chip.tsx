import { TagChip } from "@/components/inbox/tag-chip";

type MetadataChipProps = {
  children: string;
  onRemove?: () => void;
  tone?: "default" | "hot" | "owner" | "channel" | "unassigned";
};

export function MetadataChip({ children, onRemove, tone = "default" }: MetadataChipProps) {
  return (
    <TagChip onRemove={onRemove} tone={tone}>
      {children}
    </TagChip>
  );
}
