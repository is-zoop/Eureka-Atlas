"use client";

import { useEffect, useRef } from "react";

export function attachConversationScroll(viewport: HTMLDivElement, content: HTMLDivElement) {
  let following = true;
  let previousTop = viewport.scrollTop;
  let frame: number | null = null;

  const schedule = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!following) return;
      viewport.scrollTop = viewport.scrollHeight;
      previousTop = viewport.scrollTop;
    });
  };
  const onScroll = () => {
    const top = viewport.scrollTop;
    const nearBottom = viewport.scrollHeight - viewport.clientHeight - top <= 32;
    // Content growth can emit scroll events without moving scrollTop. Only an
    // actual upward scroll should stop following, not a newly taller answer.
    if (top < previousTop && !nearBottom) following = false;
    else if (nearBottom) following = true;
    previousTop = top;
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(content);
  observer.observe(viewport);
  viewport.addEventListener("scroll", onScroll, { passive: true });
  schedule();

  return {
    followLatest() { following = true; schedule(); },
    dispose() {
      observer.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    },
  };
}

export function useConversationScroll(sessionId: string | undefined) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof attachConversationScroll> | null>(null);

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLDivElement>("[data-radix-scroll-area-viewport]");
    const content = contentRef.current;
    if (!viewport || !content) return;
    const next = attachConversationScroll(viewport, content);
    controller.current = next;
    return () => {
      next.dispose();
      controller.current = null;
    };
  }, [sessionId]);

  return { scrollRef, contentRef, followLatest: () => controller.current?.followLatest() };
}
