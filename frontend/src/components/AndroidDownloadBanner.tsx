import { useMemo, useState } from "react";

type Props = {
  downloadUrl: string;
  appName: string;
};

export function AndroidDownloadBanner({ downloadUrl, appName }: Props) {
  const isAndroid = useMemo(() => typeof navigator !== "undefined" && /android/i.test(navigator.userAgent), []);
  const [visible, setVisible] = useState<boolean>(() => {
    if (!isAndroid) return false;
    try {
      return sessionStorage.getItem("dagmar_android_banner_dismissed") !== "1";
    } catch {
      return true;
    }
  });

  if (!visible || !isAndroid) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      sessionStorage.setItem("dagmar_android_banner_dismissed", "1");
    } catch {
      // ignore
    }
  };

  return (
    <div className="kb-banner" role="note" aria-label="Android instalace">
      <div className="kb-banner-text">
        Android: aplikaci <span className="kb-banner-app">{appName}</span> můžete nainstalovat jako APK.
      </div>
      <a href={downloadUrl} className="kb-btn kb-btn-primary" style={{ textDecoration: "none" }}>
        Stáhnout APK
      </a>
      <button type="button" onClick={dismiss} aria-label="Zavřít" title="Zavřít" className="kb-btn kb-btn-ghost kb-btn-sm">
        Zavřít
      </button>
    </div>
  );
}
