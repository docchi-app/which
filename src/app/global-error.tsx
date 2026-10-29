"use client";

import { Oops } from "@/components/Oops";
import "./globals.css";

// When the root layout itself fails: the whole page, so it brings its own html and body.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <Oops error={error} retry={retry} />
      </body>
    </html>
  );
}
