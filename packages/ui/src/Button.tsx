import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonTone = "primary" | "secondary" | "outline" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly tone?: ButtonTone;
  readonly children: ReactNode;
}

function getButtonClassName(tone: ButtonTone): string {
  switch (tone) {
    case "primary":
      return "t3-button t3-button-primary";
    case "secondary":
      return "t3-button t3-button-secondary";
    case "outline":
      return "t3-button t3-button-outline";
    case "ghost":
      return "t3-button t3-button-ghost";
    case "danger":
      return "t3-button t3-button-danger";
  }
}

export function Button({ tone = "primary", className, children, ...props }: ButtonProps) {
  const classes = [getButtonClassName(tone), className].filter(Boolean).join(" ");
  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}
