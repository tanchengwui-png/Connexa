import { ConnexaLogo } from "@/components/connexa-logo";

type PublicPageIntroProps = {
  badge: string;
  title: string;
  description: string;
  dark?: boolean;
};

export function PublicPageIntro({
  badge,
  title,
  description,
  dark = false
}: PublicPageIntroProps) {
  return (
    <>
      <ConnexaLogo centered dark={dark} priority />

      <div className={`auth-top-copy auth-top-copy-balanced${dark ? " connexa-public-intro" : ""}`}>
        <span className={`badge auth-badge${dark ? " connexa-public-badge" : ""}`}>{badge}</span>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
    </>
  );
}
