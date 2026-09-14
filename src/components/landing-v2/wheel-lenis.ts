import Lenis from "lenis";
import {
  SLIDE_COUNT,
  WHEEL_STEP_DEG,
  WORD_COUNT,
  slideIndexFor,
} from "@/components/landing-v2/text-wheel";

/**
 * Lenis moves the tick wheel. Free wheel scrolling is disabled.
 * Each gesture commits exactly one adjacent slide for page content, while the
 * tick ring may coast through extra laps for fortune-wheel feel.
 */

const PX_PER_STEP = 18;
const LAP_PX = PX_PER_STEP * WORD_COUNT;
const WRAP_LAPS = 60;
const TRACK_PX = LAP_PX * WRAP_LAPS;
const COAST_LAPS = 2;

export type LenisWheelCallbacks = {
  onRotation: (rotation: number) => void;
  onSettled: (step: number) => void;
  onMoving: () => void;
  onLandingCommitted: (slideIndex: number) => void;
  onSettleProgress: (progress: number) => void;
};

export type LenisWheel = {
  destroy: () => void;
  spinToIndex: (index: number) => void;
};

function createVirtualScroller(): {
  wrapper: HTMLElement;
  content: HTMLElement;
} {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;overflow-y:auto;" +
    "overflow-x:hidden;scrollbar-width:none;opacity:0;pointer-events:none;" +
    "z-index:-1;";
  const content = document.createElement("div");
  content.style.cssText = `width:1px;height:${TRACK_PX + 1}px;`;
  wrapper.appendChild(content);
  document.body.appendChild(wrapper);
  return { wrapper, content };
}

function rotationFor(scroll: number): number {
  return -(scroll / PX_PER_STEP) * WHEEL_STEP_DEG;
}

const ROLL_LERP = 0.023;
const COAST_DURATION_S = 1.35;
const CLICK_DURATION_S = 1.1;
const REST_EPSILON_PX = 1.25;

export function createLenisWheel({
  onRotation,
  onSettled,
  onMoving,
  onLandingCommitted,
  onSettleProgress,
}: LenisWheelCallbacks): LenisWheel {
  const { wrapper, content } = createVirtualScroller();

  let moving = false;
  let settledPocket = 0;
  let committedLandingPocket: number | null = null;
  /** Adjacent slide locked for this gesture — content only ever sees this. */
  let committedSlide: number | null = null;
  let rolling = false;
  let coastStartDistance = 0;

  const settle = () => {
    if (committedLandingPocket !== null) {
      settledPocket = committedLandingPocket;
    }
    // Report the adjacent slide index (0..SLIDE_COUNT-1), not a lap pocket.
    const slide =
      committedSlide !== null ? committedSlide : slideIndexFor(settledPocket);
    rolling = false;
    committedLandingPocket = null;
    committedSlide = null;
    coastStartDistance = 0;
    onSettleProgress(1);
    if (!moving) return;
    moving = false;
    onSettled(slide);
  };

  const atRest = (instance: Lenis) =>
    !instance.isScrolling &&
    Math.abs(instance.animatedScroll - instance.targetScroll) < REST_EPSILON_PX;

  let lenis: Lenis;

  const beginAdjacent = (dir: 1 | -1, duration: number) => {
    if (rolling || committedLandingPocket !== null) return;

    const fromSlide = slideIndexFor(settledPocket);
    const toSlide = slideIndexFor(fromSlide + dir);
    const pocketDelta = dir * (1 + SLIDE_COUNT * COAST_LAPS);

    rolling = true;
    committedLandingPocket = settledPocket + pocketDelta;
    committedSlide = toSlide;
    if (!moving) {
      moving = true;
      onMoving();
    }
    onSettleProgress(0);
    onLandingCommitted(toSlide);

    const target = lenis.animatedScroll + pocketDelta * PX_PER_STEP;
    coastStartDistance = Math.max(
      Math.abs(pocketDelta) * PX_PER_STEP,
      PX_PER_STEP,
    );
    lenis.scrollTo(target, {
      duration,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      force: true,
    });
  };

  lenis = new Lenis({
    wrapper,
    content,
    eventsTarget: window,
    infinite: true,
    lerp: ROLL_LERP,
    smoothWheel: true,
    syncTouch: false,
    prevent: () => false,
    virtualScroll: ({ deltaY }) => {
      if (rolling || committedLandingPocket !== null) return false;
      if (deltaY === 0) return false;
      beginAdjacent(deltaY > 0 ? 1 : -1, COAST_DURATION_S);
      return false;
    },
  });

  (window as Window & { __wheelLenis?: Lenis }).__wheelLenis = lenis;

  const unsubscribeScroll = lenis.on("scroll", () => {
    onRotation(rotationFor(lenis.scroll));
  });

  let frame = requestAnimationFrame(function raf(time: number) {
    lenis.raf(time);

    if (rolling && committedSlide !== null && coastStartDistance > 0) {
      const remaining = Math.abs(lenis.animatedScroll - lenis.targetScroll);
      const progress = Math.min(
        1,
        Math.max(0, 1 - remaining / coastStartDistance),
      );
      onSettleProgress(progress);
    }

    if (
      moving &&
      rolling &&
      (atRest(lenis) ||
        (coastStartDistance > 0 &&
          Math.abs(lenis.animatedScroll - lenis.targetScroll) /
            coastStartDistance <
            0.02))
    ) {
      settle();
    }

    frame = requestAnimationFrame(raf);
  });

  const spinToIndex = (index: number) => {
    if (rolling || committedLandingPocket !== null) return;
    const currentSlide = slideIndexFor(settledPocket);
    let diff = index - currentSlide;
    if (diff > SLIDE_COUNT / 2) diff -= SLIDE_COUNT;
    if (diff < -SLIDE_COUNT / 2) diff += SLIDE_COUNT;
    if (diff === 0) return;
    const dir: 1 | -1 = diff > 0 ? 1 : -1;
    // Direct jump still only exposes from→to in the UI.
    rolling = true;
    const pocketDelta = diff + dir * SLIDE_COUNT * COAST_LAPS;
    committedLandingPocket = settledPocket + pocketDelta;
    committedSlide = index;
    if (!moving) {
      moving = true;
      onMoving();
    }
    onSettleProgress(0);
    onLandingCommitted(index);
    coastStartDistance = Math.max(
      Math.abs(pocketDelta) * PX_PER_STEP,
      PX_PER_STEP,
    );
    lenis.scrollTo(lenis.animatedScroll + pocketDelta * PX_PER_STEP, {
      duration: CLICK_DURATION_S,
      easing: (t) => 1 - Math.pow(1 - t, 4),
      force: true,
    });
  };

  return {
    spinToIndex,
    destroy: () => {
      cancelAnimationFrame(frame);
      unsubscribeScroll();
      lenis.destroy();
      delete (window as Window & { __wheelLenis?: Lenis }).__wheelLenis;
      wrapper.remove();
    },
  };
};
