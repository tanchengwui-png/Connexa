import { ReactNode } from "react";

type HelpNoticeProps = {
  children: ReactNode;
  title: string;
  tone?: "default" | "accent";
};

export function HelpNotice({
  children,
  title,
  tone = "default"
}: HelpNoticeProps) {
  return (
    <div className={`wa-help-notice${tone === "accent" ? " accent" : ""}`}>
      <strong>{title}</strong>
      <div>{children}</div>
    </div>
  );
}
