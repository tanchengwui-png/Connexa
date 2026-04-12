import Image from "next/image";

type ConnexaLogoProps = {
  href?: string;
  centered?: boolean;
  priority?: boolean;
  dark?: boolean;
};

export function ConnexaLogo({
  href = "/",
  centered = false,
  priority = false,
  dark = false
}: ConnexaLogoProps) {
  return (
    <a className={`public-logo-link${centered ? " centered" : ""}${dark ? " dark" : ""}`} href={href}>
      <span className="public-logo-frame">
        <Image
          alt="Connexa logo"
          className="public-logo-image"
          height={120}
          priority={priority}
          src="/recurvos_connexa_transparent.png"
          width={360}
        />
      </span>
    </a>
  );
}
