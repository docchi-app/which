"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { installErrorCatcher, notePath } from "@/lib/errors";

/** Starts reporting errors to Admin → Errors, and remembers the screen before this one. */
export function ErrorCatcher() {
  const path = usePathname();
  useEffect(() => installErrorCatcher(), []);
  useEffect(() => notePath(path), [path]);
  return null;
}
