"use client";

import { useState } from "react";

/** Code that keeps its lines, scrolls inside its own box on a phone, and copies in one click. */
export function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2_000);
  };
  return (
    <div className="relative w-full max-w-full min-w-0">
      <pre className="w-full max-w-full min-w-0 overflow-x-auto rounded-[12px] bg-[var(--surface)] p-4 pr-20 text-[12.5px] leading-relaxed text-[var(--ink-2)] sm:p-5 sm:pr-24 sm:text-[13.5px]"><code>{children}</code></pre>
      <button type="button" onClick={copy} className="btn btn-secondary btn-sm absolute top-2 right-2" aria-live="polite">
        {copied === "copied" ? "Copied" : copied === "failed" ? "Select to copy" : "Copy"}
      </button>
    </div>
  );
}
