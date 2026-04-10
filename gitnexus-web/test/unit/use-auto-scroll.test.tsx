import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoScroll } from '../../src/hooks/useAutoScroll';

interface HarnessProps {
  messages: unknown[];
  isChatLoading: boolean;
}

function AutoScrollHarness({ messages, isChatLoading }: HarnessProps) {
  const { scrollContainerRef, messagesEndRef, isAtBottom, scrollToBottom } = useAutoScroll(
    messages,
    isChatLoading,
  );

  return (
    <>
      <div data-testid="is-at-bottom">{String(isAtBottom)}</div>
      <div data-testid="container" ref={scrollContainerRef}>
        <div ref={messagesEndRef} />
      </div>
      <button type="button" onClick={scrollToBottom}>
        Scroll to bottom
      </button>
    </>
  );
}

function setScrollMetrics(
  element: HTMLDivElement,
  metrics: { scrollTop?: number; scrollHeight?: number; clientHeight?: number },
) {
  if (metrics.scrollTop !== undefined) {
    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      writable: true,
      value: metrics.scrollTop,
    });
  }

  if (metrics.scrollHeight !== undefined) {
    Object.defineProperty(element, 'scrollHeight', {
      configurable: true,
      value: metrics.scrollHeight,
    });
  }

  if (metrics.clientHeight !== undefined) {
    Object.defineProperty(element, 'clientHeight', {
      configurable: true,
      value: metrics.clientHeight,
    });
  }
}

async function flushAnimationFrame() {
  await act(async () => {
    vi.runAllTimers();
  });
}

async function scrollContainer(element: HTMLDivElement, scrollTop: number) {
  setScrollMetrics(element, { scrollTop });
  fireEvent.scroll(element);
  await flushAnimationFrame();
}

describe('useAutoScroll', () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        return window.setTimeout(() => callback(performance.now()), 0);
      }),
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((frameId: number) => {
        clearTimeout(frameId);
      }),
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
    });
  });

  it('follows streaming updates while the view stays pinned to the bottom', () => {
    const { rerender } = render(<AutoScrollHarness messages={[{ id: 1 }]} isChatLoading={false} />);
    const container = screen.getByTestId('container') as HTMLDivElement;

    setScrollMetrics(container, {
      scrollTop: 700,
      scrollHeight: 1000,
      clientHeight: 200,
    });

    rerender(<AutoScrollHarness messages={[{ id: 1 }]} isChatLoading={true} />);

    expect(container.scrollTop).toBe(1000);
    expect(screen.getByTestId('is-at-bottom')).toHaveTextContent('true');
  });

  it('stops auto-scroll after the user scrolls up', async () => {
    const { rerender } = render(<AutoScrollHarness messages={[{ id: 1 }]} isChatLoading={false} />);
    const container = screen.getByTestId('container') as HTMLDivElement;

    setScrollMetrics(container, {
      scrollTop: 700,
      scrollHeight: 1000,
      clientHeight: 200,
    });
    await scrollContainer(container, 700);

    await scrollContainer(container, 250);

    expect(screen.getByTestId('is-at-bottom')).toHaveTextContent('false');

    setScrollMetrics(container, {
      scrollTop: 250,
      scrollHeight: 1400,
      clientHeight: 200,
    });
    rerender(<AutoScrollHarness messages={[{ id: 1 }, { id: 2 }]} isChatLoading={true} />);

    expect(container.scrollTop).toBe(250);
  });

  it('re-enables auto-scroll once the user returns near the bottom', async () => {
    const { rerender } = render(<AutoScrollHarness messages={[{ id: 1 }]} isChatLoading={false} />);
    const container = screen.getByTestId('container') as HTMLDivElement;

    setScrollMetrics(container, {
      scrollTop: 700,
      scrollHeight: 1000,
      clientHeight: 200,
    });
    await scrollContainer(container, 700);
    await scrollContainer(container, 250);

    setScrollMetrics(container, {
      scrollTop: 1120,
      scrollHeight: 1400,
      clientHeight: 200,
    });
    await scrollContainer(container, 1120);

    expect(screen.getByTestId('is-at-bottom')).toHaveTextContent('true');

    setScrollMetrics(container, {
      scrollTop: 1120,
      scrollHeight: 1800,
      clientHeight: 200,
    });
    rerender(<AutoScrollHarness messages={[{ id: 1 }, { id: 2 }]} isChatLoading={true} />);

    expect(container.scrollTop).toBe(1800);
  });

  it('scrollToBottom re-engages auto-scroll and uses the sentinel element', async () => {
    const { rerender } = render(<AutoScrollHarness messages={[{ id: 1 }]} isChatLoading={false} />);
    const container = screen.getByTestId('container') as HTMLDivElement;
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);

    setScrollMetrics(container, {
      scrollTop: 700,
      scrollHeight: 1000,
      clientHeight: 200,
    });
    await scrollContainer(container, 700);
    await scrollContainer(container, 250);

    fireEvent.click(screen.getByRole('button', { name: 'Scroll to bottom' }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' });
    expect(screen.getByTestId('is-at-bottom')).toHaveTextContent('true');

    setScrollMetrics(container, {
      scrollTop: 250,
      scrollHeight: 1600,
      clientHeight: 200,
    });
    rerender(<AutoScrollHarness messages={[{ id: 1 }, { id: 2 }]} isChatLoading={true} />);

    expect(container.scrollTop).toBe(1600);
  });
});
