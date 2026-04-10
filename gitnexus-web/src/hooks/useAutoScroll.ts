import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD = 100;

export interface UseAutoScrollResult {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  isAtBottom: boolean;
  scrollToBottom: () => void;
}

function isNearBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD;
}

export function useAutoScroll(
  chatMessages: unknown[],
  isChatLoading: boolean,
): UseAutoScrollResult {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const shouldStickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const frameIdRef = useRef<number | null>(null);

  const syncScrollState = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element) return;

    const nearBottom = isNearBottom(element);

    if (nearBottom) {
      shouldStickToBottomRef.current = true;
    } else if (element.scrollTop < lastScrollTopRef.current) {
      shouldStickToBottomRef.current = false;
    }

    lastScrollTopRef.current = element.scrollTop;
    setIsAtBottom(nearBottom);
  }, []);

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return;

    lastScrollTopRef.current = element.scrollTop;

    const handleScroll = () => {
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
      }

      frameIdRef.current = requestAnimationFrame(() => {
        frameIdRef.current = null;
        syncScrollState();
      });
    };

    element.addEventListener('scroll', handleScroll, { passive: true });
    syncScrollState();

    return () => {
      element.removeEventListener('scroll', handleScroll);
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
    };
  }, [syncScrollState]);

  const jumpToBottom = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element) return;

    element.scrollTop = element.scrollHeight;
    lastScrollTopRef.current = element.scrollTop;
  }, []);

  useLayoutEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    jumpToBottom();
    setIsAtBottom(true);
  }, [chatMessages, isChatLoading, jumpToBottom]);

  const scrollToBottom = useCallback(() => {
    shouldStickToBottomRef.current = true;
    setIsAtBottom(true);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  return { scrollContainerRef, messagesEndRef, isAtBottom, scrollToBottom };
}
