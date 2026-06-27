import React from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      className={
        "kb-btn " +
        `kb-btn-${variant} ` +
        (size === "sm" ? "kb-btn-sm " : "") +
        (className ? className : "")
      }
    />
  );
});

export default Button;
