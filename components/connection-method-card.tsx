type ConnectionMethodCardProps = {
  badge: string;
  description: string;
  benefits: readonly string[];
  disabled?: boolean;
  isSelected: boolean;
  onSelect: () => void;
  subtitle: string;
  title: string;
};

export function ConnectionMethodCard({
  badge,
  description,
  benefits,
  disabled = false,
  isSelected,
  onSelect,
  subtitle,
  title
}: ConnectionMethodCardProps) {
  return (
    <button
      aria-disabled={disabled}
      className={`wa-method-card${isSelected ? " selected" : ""}${disabled ? " disabled" : ""}`}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <div className="wa-method-card-head">
        <div>
          <div className="wa-method-card-topline">
            <h3>{title}</h3>
            <span className="wa-method-badge">{badge}</span>
          </div>
          <p className="wa-method-subtitle">{subtitle}</p>
        </div>
        <span className="wa-method-radio" aria-hidden="true" />
      </div>

      <p className="wa-method-description">{description}</p>

      <div className="wa-method-benefits">
        {benefits.map((item) => (
          <div className="wa-method-benefit" key={item}>
            <span className="wa-method-benefit-icon" aria-hidden="true">
              +
            </span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </button>
  );
}
