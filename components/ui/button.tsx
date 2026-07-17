import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "icon"
  | "toggle";

type ButtonClassNameOptions = {
  className?: string;
  selected?: boolean;
  variant?: ButtonVariant;
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonClassNameOptions;

export function getButtonClassName({
  className,
  selected = false,
  variant = "secondary"
}: ButtonClassNameOptions = {}) {
  const classes = ["button", `button-${variant}`];

  if (selected) {
    classes.push("button-selected");
  }

  if (className) {
    classes.push(className);
  }

  return classes.join(" ");
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, selected = false, type = "button", variant = "secondary", ...props },
  ref
) {
  return (
    <button
      {...props}
      className={getButtonClassName({ className, selected, variant })}
      ref={ref}
      type={type}
    />
  );
});
