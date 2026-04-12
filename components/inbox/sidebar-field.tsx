type SidebarFieldProps = {
  label: string;
  value: string;
};

export function SidebarField({ label, value }: SidebarFieldProps) {
  return (
    <div className="inbox-detail-kv">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
