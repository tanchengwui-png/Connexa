type MetadataRowProps = {
  label: string;
  value: string;
};

export function MetadataRow({ label, value }: MetadataRowProps) {
  return (
    <div className="inbox-detail-list-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
