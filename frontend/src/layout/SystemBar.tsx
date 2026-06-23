import React from "react";
import SignageKajovo from "../brand/SignageKajovo";

type Props = {
  left?: React.ReactNode;
  right?: React.ReactNode;
};

export default function SystemBar({ left, right }: Props) {
  return (
    <div className="kb-systembar" aria-label="Systémová lišta">
      <div className="kb-systembar-left">
        <SignageKajovo />
        {left ? <div className="kb-systembar-slot">{left}</div> : null}
      </div>
      <div className="kb-systembar-right">{right}</div>
    </div>
  );
}
