import React from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export default function Button({ variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={
        "kb-btn " +
        `kb-btn-${variant} ` +
        (size === "sm" ? "kb-btn-sm " : "") +
        (className ? className : "")
      }
    />
  );
}
