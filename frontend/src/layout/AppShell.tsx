import React from "react";
import { useLocation } from "react-router-dom";
import { APP_NAME_LONG } from "../brand/brand";
import SystemBar from "./SystemBar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isPrintPreview = location.pathname === "/admin/tisky/preview";

  if (isPrintPreview) {
    return <>{children}</>;
  }

  return (
    <div className="kb-app">
      <SystemBar />
      <div className="kb-shell" aria-label={APP_NAME_LONG}>
        {children}
      </div>
    </div>
  );
}
