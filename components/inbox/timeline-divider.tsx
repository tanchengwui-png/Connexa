type TimelineDividerProps = {
  label: string;
};

export function TimelineDivider({ label }: TimelineDividerProps) {
  return (
    <div className="timeline-separator">
      <span>{label}</span>
    </div>
  );
}
