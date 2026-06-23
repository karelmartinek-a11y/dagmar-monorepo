import React from "react";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={"kb-card" + (className ? ` ${className}` : "")} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={"kb-card-head" + (className ? ` ${className}` : "")} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={"kb-card-pad" + (className ? ` ${className}` : "")} />;
}
