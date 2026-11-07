import { renderHook } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

import type { DiffResponse } from '../../types/diff';
import { getFileElementId } from '../utils/domUtils';

import { useLazyDiffRendering } from './useLazyDiffRendering';

function renderLazyDiffRendering(container: HTMLElement | null) {
  return renderHook(() =>
    useLazyDiffRendering({
      diffData: null,
      diffScrollContainerRef: { current: container },
      setDiffData: () => {},
    }),
  );
}

function stubRect(element: HTMLElement, top: number) {
  element.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + 100,
      left: 0,
      right: 0,
      width: 0,
      height: 100,
    }) as DOMRect;
}

describe('useLazyDiffRendering', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('isFileScrolledPastContainerTop', () => {
    const filePath = 'src/example.ts';

    function setup(containerTop: number, targetTop: number) {
      const container = document.createElement('div');
      stubRect(container, containerTop);
      const target = document.createElement('div');
      target.id = getFileElementId(filePath);
      stubRect(target, targetTop);
      document.body.appendChild(target);

      return renderLazyDiffRendering(container);
    }

    it('returns true when the file header is scrolled above the container top', () => {
      const { result } = setup(50, 20);
      expect(result.current.isFileScrolledPastContainerTop(filePath)).toBe(true);
    });

    it('returns false when the file header is visible below the container top', () => {
      const { result } = setup(50, 120);
      expect(result.current.isFileScrolledPastContainerTop(filePath)).toBe(false);
    });

    it('returns false when the file header is aligned with the container top', () => {
      const { result } = setup(50, 50);
      expect(result.current.isFileScrolledPastContainerTop(filePath)).toBe(false);
    });

    it('returns false when the scroll container is not available', () => {
      const target = document.createElement('div');
      target.id = getFileElementId(filePath);
      stubRect(target, 0);
      document.body.appendChild(target);

      const { result } = renderLazyDiffRendering(null);
      expect(result.current.isFileScrolledPastContainerTop(filePath)).toBe(false);
    });

    it('returns false when the file element does not exist', () => {
      const container = document.createElement('div');
      stubRect(container, 0);

      const { result } = renderLazyDiffRendering(container);
      expect(result.current.isFileScrolledPastContainerTop('missing/file.ts')).toBe(false);
    });
  });

  describe('scrollToFileRestoringPosition', () => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

    function place(element: HTMLElement, top: number, height: number) {
      element.getBoundingClientRect = () =>
        ({ top, bottom: top + height, left: 0, right: 0, width: 0, height }) as DOMRect;
      Object.defineProperty(element, 'offsetHeight', { value: height, configurable: true });
    }

    // Two 1000px files in a 500px container scrolled to `scrollTop`
    async function setup() {
      const container = document.createElement('div');
      place(container, 0, 500);
      const scrollTo = vi.fn();
      container.scrollTo = scrollTo as typeof container.scrollTo;
      document.body.appendChild(container);

      const sections = ['a.ts', 'b.ts'].map((path) => {
        const section = document.createElement('div');
        section.id = getFileElementId(path);
        section.dataset.rendered = 'true';
        container.appendChild(section);
        return section;
      });
      const diffData = { files: [{ path: 'a.ts' }, { path: 'b.ts' }] } as DiffResponse;
      const { result } = renderHook(() =>
        useLazyDiffRendering({
          diffData,
          diffScrollContainerRef: { current: container },
          setDiffData: () => {},
        }),
      );

      const scrollToTop = async (scrollTop: number) => {
        Object.defineProperty(container, 'scrollTop', { value: scrollTop, configurable: true });
        sections.forEach((section, index) => place(section, index * 1000 - scrollTop, 1000));
        container.dispatchEvent(new Event('scroll'));
        await nextFrame();
      };
      const jumpTo = async (path: string) => {
        scrollTo.mockClear();
        result.current.scrollToFileRestoringPosition(path);
        await nextFrame();
        return scrollTo.mock.calls[0]?.[0];
      };
      return { scrollToTop, jumpTo };
    }

    it('returns to where the reader left a file', async () => {
      const { scrollToTop, jumpTo } = await setup();
      await scrollToTop(300);
      await scrollToTop(1000); // jumped to b.ts
      expect(await jumpTo('a.ts')).toEqual({ top: 300 });
    });

    it('starts at the header of a file read to its end', async () => {
      const { scrollToTop, jumpTo } = await setup();
      await scrollToTop(600);
      await scrollToTop(1000); // scrolled on into b.ts
      expect(await jumpTo('a.ts')).toEqual({ top: 0 });
    });

    it('goes to the header when the file is already at the top', async () => {
      const { scrollToTop, jumpTo } = await setup();
      await scrollToTop(300);
      expect(await jumpTo('a.ts')).toEqual({ top: 0 });
    });
  });
});
