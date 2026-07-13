type AuthStatusIconName = "shield" | "key" | "info" | "keyboard" | "offline" | "lock";

export default function AuthStatusIcon({ name }: { name: AuthStatusIconName }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "shield") {
    return <svg {...common}><path d="M12 3 19 6v5.4c0 4.2-2.7 7.8-7 9.6-4.3-1.8-7-5.4-7-9.6V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
  }
  if (name === "key") {
    return <svg {...common}><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></svg>;
  }
  if (name === "keyboard") {
    return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M18 10h.01M7 14h8M17 14h.01" /></svg>;
  }
  if (name === "offline") {
    return <svg {...common}><path d="M5 12.6a10.2 10.2 0 0 1 9.7-2.7M8.5 16a5.2 5.2 0 0 1 5.8-.8M12 20h.01M3 3l18 18" /><path d="M17.7 12.1A10.5 10.5 0 0 1 19 13.2M7.1 7.8A15.1 15.1 0 0 1 21 9" /></svg>;
  }
  if (name === "lock") {
    return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
}
