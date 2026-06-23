import React from "react";
import SignageKajovo from "../brand/SignageKajovo";

import { APP_NAME_LONG, BRAND_ASSETS } from "../brand/brand";
const KEY = "kajovo_intro_seen";

export default function IntroGate({ children }: { children: React.ReactNode }) {
  const [show, setShow] = React.useState(() => {
    try {
      return sessionStorage.getItem(KEY) !== "1";
    } catch {
      return true;
    }
  });

  React.useEffect(() => {
    if (!show) return;
    const t = window.setTimeout(() => {
      try {
        sessionStorage.setItem(KEY, "1");
      } catch (error) {
        // V privatnim modu muze byt sessionStorage nedostupny; nic dalsiho nedelame.
        console.warn("IntroGate: nepodarilo se zapsat flag do sessionStorage", error);
      }
      setShow(false);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [show]);

  if (!show) return <>{children}</>;

  return (
    <div className="kb-intro" role="status" aria-label="Intro">
      <div className="kb-intro-card">
        <div className="kb-intro-top">
          <SignageKajovo />
          <img src={BRAND_ASSETS.logoMark} alt="" className="kb-intro-logo" />
        </div>
        <div>
          <div className="kb-intro-title">{APP_NAME_LONG}</div>
          <div className="kb-intro-sub">Načítám…</div>
        </div>
        <div className="kb-spinner" aria-hidden="true" />
      </div>
    </div>
  );
}
