import { TagChip } from "@/components/inbox/tag-chip";

type StatusChipProps = {
  children: string;
};

export function StatusChip({ children }: StatusChipProps) {
  return <TagChip tone="status">{children}</TagChip>;
}
