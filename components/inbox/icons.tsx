import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="16"
      {...props}
    />
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </BaseIcon>
  );
}

export function AttachmentIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M21.4 11.1 12 20.5a6 6 0 1 1-8.5-8.5l9.9-9.9a4 4 0 0 1 5.7 5.7L9.5 17.4a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </BaseIcon>
  );
}

export function EmojiIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 15a5 5 0 0 0 7 0" />
      <path d="M9 10h.01" />
      <path d="M15 10h.01" />
    </BaseIcon>
  );
}

export function TemplateIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect height="14" rx="2" width="16" x="4" y="5" />
      <path d="M8 9h8M8 13h5" />
    </BaseIcon>
  );
}

export function ButtonsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="5" width="16" height="4" rx="1.5" />
      <rect x="4" y="11" width="16" height="4" rx="1.5" />
      <rect x="4" y="17" width="10" height="3" rx="1.5" />
    </BaseIcon>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M9 7h10M9 12h10M9 17h10" />
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
    </BaseIcon>
  );
}

export function SnoozeIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 1.5" />
      <path d="M8 3h8" />
    </BaseIcon>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 5h.01M12 12h.01M12 19h.01" />
    </BaseIcon>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m20 10-8.6 8.6a2 2 0 0 1-2.8 0L3 13V4h9l8 8a2 2 0 0 1 0 2.8Z" />
      <path d="M7.5 8.5h.01" />
    </BaseIcon>
  );
}

export function StatusIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M7 12.5 10 15l7-7" />
      <circle cx="12" cy="12" r="9" />
    </BaseIcon>
  );
}

export function AssignIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </BaseIcon>
  );
}

export function NoteIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M8 3h8l5 5v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v6h6M9 13h6M9 17h6" />
    </BaseIcon>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </BaseIcon>
  );
}

export function LightningIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </BaseIcon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m15 18-6-6 6-6" />
    </BaseIcon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m9 18 6-6-6-6" />
    </BaseIcon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </BaseIcon>
  );
}
