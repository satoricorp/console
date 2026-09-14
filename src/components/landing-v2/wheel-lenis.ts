import Lenis from "lenis";
import {
  SLIDE_COUNT,
  WHEEL_STEP_DEG,
  WORD_COUNT,
  slideIndexFor,
} from "@/components/landing-v2/text-wheel";

/**
 * Lenis drives rotation only through our scrollTo calls. The `virtualScroll`
 * option returns false so Lenis never free-scrolls from the wheel.
 *
 * Each gesture advances exactly one slide (±1 pocket). Fortune-wheel spin is
 * visual-only (extra turns on the tick ring) so page content never passes
 * through intermediate slides.
 */

const PX_PER_STEP = 18;
const LAP_PX = PX_PER_STEP * WORD_COUNT;
const WRAP_LAPS = 60;
const TRACK_PX = LAP_PX * WRAP_LAPS;
/** Extra full rotations of the tick wheel during a one-step page change. */
const VISUAL_EXTRA_TURNS = 2;

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

function createVirtualScroller(): { wrapper: HTMLElement; content: HTMLElement } {
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
  let rolling = false;
  let landingSlide: number | null = null;
  let coastStartDistance = 0;
  let coastDir: 1 | -1 = 1;
  /** Baked-in visual spin from completed coasts (degrees). */
  let visualSpinOffset = 0;

  const emitRotation = (lenis: Lenis, progress: number) => {
    const base = rotationFor(lenis.scroll) + visualSpinOffset;
    if (!rolling || coastStartDistance <= 0) {
      onRotation(base);
      return;
    }
    // Ease extra turns across the coast; baked into visualSpinOffset on settle.
    const eased = 1 - Math.pow(1 - progress, 2);
    onRotation(base - coastDir * VISUAL_EXTRA_TURNS * 360 * eased);
  };

  const settle = () => {
    if (committedLandingPocket !== null) {
      settledPocket = committedLandingPocket;
    }
    if (rolling) {
      visualSpinOffset -= coastDir * VISUAL_EXTRA_TURNS * 360;
    }
    rolling = false;
    landingSlide = null;
    committedLandingPocket = null;
    coastStartDistance = 0;
    onSettleProgress(1);
    emitRotation(lenis, 1);
    if (!moving) return;
    moving = false;
    onSettled(settledPocket);
  };

  const atRest = (instance: Lenis) =>
    !instance.isScrolling &&
    Math.abs(instance.animatedScroll - instance.targetScroll) < REST_EPSILON_PX;

  let lenis: Lenis;

  const beginCoast = (dir: 1 | -1, pocketDelta: number, duration: number) => {
    if (rolling || committedLandingPocket !== null) return;
    rolling = true;
    coastDir = dir;
    const landing = settledPocket + pocketDelta;
    committedLandingPocket = landing;
    landingSlide = slideIndexFor(landing);
    if (!moving) {
      moving = true;
      onMoving();
    }
    onSettleProgress(0);
    onLandingCommitted(landingSlide);
    const target = lenis.animatedScroll + pocketDelta * PX_PER_STEP;
    coastStartDistance = Math.max(Math.abs(pocketDelta) * PX_PER_STEP, PX_PER_STEP);
    lenis.scrollTo(target, {
      duration,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      force: true,
    });
  };

  const commitDir = (dir: 1 | -1) => {
    // Exactly one slide — no intermediate pages.
    beginCoast(dir, dir, COAST_DURATION_S);
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
      commitDir(deltaY > 0 ? 1 : -1);
      return false;
    },
  });

  (window as Window & { __wheelLenis?: Lenis }).__wheelLenis = lenis;

  const unsubscribeScroll = lenis.on("scroll", () => {
    const remaining = Math.abs(lenis.animatedScroll - lenis.targetScroll);
    const progress =
      rolling && coastStartDistance > 0
        ? Math.min(1, Math.max(0, 1 - remaining / coastStartDistance))
        : 1;
    emitRotation(lenis, progress);
  });

  let frame = requestAnimationFrame(function raf(time: number) {
    lenis.raf(time);

    if (rolling && landingSlide !== null && coastStartDistance > 0) {
      const remaining = Math.abs(lenis.animatedScroll - lenis.targetScroll);
      const progress = Math.min(
        1,
        Math.max(0, 1 - remaining / coastStartDistance),
      );
      onSettleProgress(progress);
      emitRotation(lenis, progress);
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
    beginCoast(dir, diff, CLICK_DURATION_S);
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
