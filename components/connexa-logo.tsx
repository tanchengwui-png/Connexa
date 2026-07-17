import Image from "next/image";
import lightThemeLogo from "@/Logo-LightTheme.png";

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
          className="public-logo-image public-logo-image-dark"
          height={512}
          priority={priority}
          src="/recurvos_connexa_transparent.png"
          width={1024}
        />
        <Image
          alt="Connexa logo"
          className="public-logo-image public-logo-image-light"
          height={lightThemeLogo.height}
          priority={priority}
          src={lightThemeLogo}
          width={lightThemeLogo.width}
        />
      </span>
    </a>
  );
}
