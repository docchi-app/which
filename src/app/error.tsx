"use client";

import { Oops } from "@/components/Oops";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <Oops error={error} retry={retry} />;
}
