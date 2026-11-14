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
    // The Copy button sits in its own bar above the code, so it never covers a line.
    <div className="w-full max-w-full min-w-0 overflow-hidden rounded-[12px] bg-[var(--surface)]">
      <div className="flex justify-end border-b border-[var(--line)] px-2 py-1.5">
        <button type="button" onClick={copy} className="btn btn-secondary btn-sm" aria-live="polite">
          {copied === "copied" ? "Copied" : copied === "failed" ? "Select to copy" : "Copy"}
        </button>
      </div>
      <pre className="w-full max-w-full min-w-0 overflow-x-auto p-4 text-[12.5px] leading-relaxed text-[var(--ink-2)] sm:p-5 sm:text-[13.5px]"><code>{children}</code></pre>
    </div>
  );
}
