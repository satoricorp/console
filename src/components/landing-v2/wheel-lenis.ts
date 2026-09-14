import Lenis from "lenis";
import {
  WHEEL_STEP_DEG,
  WORD_COUNT,
  slideIndexFor,
} from "@/components/landing-v2/text-wheel";

/**
 * The landing wheel's motion, driven by Lenis.
 *
 * Lenis scrolls a hidden 1×1 track; rotation is read from `lenis.scroll`.
 * Each wheel/trackpad gesture commits to exactly one adjacent slide (±1).
 * The wheel may coast through many tick marks visually, then eases into the
 * single next/prev pocket on deceleration.
 */

/** Virtual pixels per pocket on the Lenis track. */
const PX_PER_STEP = 18;
const LAP_PX = PX_PER_STEP * WORD_COUNT;
const WRAP_LAPS = 60;
const TRACK_PX = LAP_PX * WRAP_LAPS;

export type LenisWheelCallbacks = {
  onRotation: (rotation: number) => void;
  /** Wheel fully at rest on a pocket. */
  onSettled: (step: number) => void;
  /** First frame of motion after rest. */
  onMoving: () => void;
  /** Landing slide locked when input ends — start of deceleration / early fade-in. */
  onLandingCommitted: (slideIndex: number) => void;
  /** 0→1 while easing into the landing pocket after commit. */
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

/** Exactly one slide forward/back from `startSlide`, in the thrown direction. */
function landingPocketOneStep(
  startSlide: number,
  startPocket: number,
  dir: 1 | -1,
): number {
  const wantSlide = slideIndexFor(startSlide + dir);
  let pocket = startPocket + dir;
  while (slideIndexFor(pocket) !== wantSlide) pocket += dir;
  return pocket;
}

/** Shortest pocket delta from `fromPocket` to `toPocket`. */
function shortestPocketDelta(fromPocket: number, toPocket: number): number {
  let diff = toPocket - fromPocket;
  if (diff > WORD_COUNT / 2) diff -= WORD_COUNT;
  if (diff < -WORD_COUNT / 2) diff += WORD_COUNT;
  return diff;
}

const IDLE_MS = 300;
const ROLL_LERP = 0.023;
const WHEEL_MULTIPLIER = 1.35;
const CLICK_DURATION_S = 1.1;
const REST_EPSILON_PX = 0.65;

export function createLenisWheel({
  onRotation,
  onSettled,
  onMoving,
  onLandingCommitted,
  onSettleProgress,
}: LenisWheelCallbacks): LenisWheel {
  const { wrapper, content } = createVirtualScroller();

  const lenis = new Lenis({
    wrapper,
    content,
    eventsTarget: window,
    infinite: true,
    lerp: ROLL_LERP,
    smoothWheel: true,
    wheelMultiplier: WHEEL_MULTIPLIER,
    syncTouch: false,
    prevent: () => false,
  });

  (window as Window & { __wheelLenis?: Lenis }).__wheelLenis = lenis;

  let moving = false;
  let lastInputAt = 0;
  let startPocket: number | null = null;
  let startSlide: number | null = null;
  let gestureDelta = 0;
  let rolling = false;
  let landingSlide: number | null = null;
  let coastStartDistance = 0;

  const settle = () => {
    startPocket = null;
    startSlide = null;
    gestureDelta = 0;
    rolling = false;
    landingSlide = null;
    coastStartDistance = 0;
    onSettleProgress(1);
    if (!moving) return;
    moving = false;
    onSettled(Math.round(lenis.scroll / PX_PER_STEP));
  };

  const atRest = () =>
    !lenis.isScrolling &&
    Math.abs(lenis.animatedScroll - lenis.targetScroll) < REST_EPSILON_PX;

  const unsubscribeInput = lenis.on("virtual-scroll", ({ deltaY }) => {
    if (startPocket === null) {
      startPocket = Math.round(lenis.scroll / PX_PER_STEP);
      startSlide = slideIndexFor(startPocket);
      gestureDelta = 0;
    }
    gestureDelta += deltaY;
    lastInputAt = performance.now();
    rolling = false;
    landingSlide = null;
    coastStartDistance = 0;
    onSettleProgress(0);
  });

  const unsubscribeScroll = lenis.on("scroll", () => {
    if (!moving) {
      moving = true;
      onMoving();
    }
    onRotation(rotationFor(lenis.scroll));
  });

  let frame = requestAnimationFrame(function raf(time: number) {
    lenis.raf(time);

    const idle = time - lastInputAt > IDLE_MS;

    if (
      moving &&
      idle &&
      !rolling &&
      startPocket !== null &&
      startSlide !== null &&
      gestureDelta !== 0
    ) {
      rolling = true;
      const dir = gestureDelta > 0 ? 1 : -1;
      const landing = landingPocketOneStep(startSlide, startPocket, dir);
      landingSlide = slideIndexFor(landing);
      onLandingCommitted(landingSlide);

      const currentPocket = lenis.animatedScroll / PX_PER_STEP;
      const pocketDelta = shortestPocketDelta(
        Math.round(currentPocket),
        landing,
      );
      const target = lenis.animatedScroll + pocketDelta * PX_PER_STEP;
      coastStartDistance = Math.max(
        Math.abs(pocketDelta) * PX_PER_STEP,
        PX_PER_STEP,
      );

      lenis.scrollTo(target, {
        programmatic: false,
        lerp: ROLL_LERP,
        force: true,
      });
    }

    if (rolling && landingSlide !== null) {
      const remaining = Math.abs(lenis.animatedScroll - lenis.targetScroll);
      const progress = Math.min(
        1,
        Math.max(0, 1 - remaining / coastStartDistance),
      );
      onSettleProgress(progress);
    }

    if (moving && idle && atRest()) settle();

    frame = requestAnimationFrame(raf);
  });

  const spinToIndex = (index: number) => {
    const current = Math.round(lenis.scroll / PX_PER_STEP);
    const currentIndex = ((current % WORD_COUNT) + WORD_COUNT) % WORD_COUNT;
    let diff = index - currentIndex;
    if (diff > WORD_COUNT / 2) diff -= WORD_COUNT;
    if (diff < -WORD_COUNT / 2) diff += WORD_COUNT;
    if (diff === 0) return;
    startPocket = null;
    startSlide = null;
    gestureDelta = 0;
    rolling = true;
    landingSlide = slideIndexFor(index);
    onLandingCommitted(landingSlide);
    coastStartDistance = Math.abs(diff) * PX_PER_STEP;
    lenis.scrollTo(lenis.scroll + diff * PX_PER_STEP, {
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
      unsubscribeInput();
      lenis.destroy();
      delete (window as Window & { __wheelLenis?: Lenis }).__wheelLenis;
      wrapper.remove();
    },
  };
};
