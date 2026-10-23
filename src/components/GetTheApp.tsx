"use client";

import { useEffect, useState } from "react";
import { installPlatform } from "@/lib/install";
import { InstallSheet } from "./InstallSheet";

/** Profile row on Android browsers: put Docchi on the Home Screen (iPhone gets this via Notifications). */
export function GetTheApp() {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // The platform is only known in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(installPlatform() === "android");
  }, []);

  if (!show) return null;
  return (
    <>
      <section className="notif-card install-row">
        <div className="notif-top">
          <span className="notif-bell" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" width={40} height={40} style={{ borderRadius: 10 }} />
          </span>
          <div className="notif-copy">
            <h2 className="notif-title">Get the app</h2>
            <p className="notif-text">Docchi on your Home Screen: one tap to open, full screen.</p>
          </div>
        </div>
        <button type="button" className="post-btn post-btn-light press" onClick={() => setOpen(true)}>
          Install Docchi
        </button>
      </section>
      {open && <InstallSheet reason="app" onClose={() => setOpen(false)} />}
    </>
  );
}
