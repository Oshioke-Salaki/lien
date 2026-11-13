"use client";

import { useEffect, useState } from "react";
import { readGuestCapacity, type GuestCapacity } from "@/lib/guestCapacity";

/** Whether free test accounts (and the business deposit) can be covered right now. Unknown until read. */
export function useGuestCapacity(): GuestCapacity | null {
  const [capacity, setCapacity] = useState<GuestCapacity | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => readGuestCapacity().then((value) => { if (alive) setCapacity(value); });
    void read();
    const timer = setInterval(read, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return capacity;
}
