import Lenis from "lenis";
import { WHEEL_STEP_DEG, WORD_COUNT } from "@/components/landing-v2/text-wheel";

/**
 * The landing wheel's motion, driven by Lenis.
 *
 * Lenis only knows how to move a scroll position, so the wheel borrows one: a
 * 1×1 offscreen scroller whose content is exactly one lap tall. Lenis scrolls
 * it, `infinite` wraps it at the lap boundary, and the rotation is read back
 * off `lenis.scroll`. When the gesture stops, the wheel eases into the nearest
 * pocket so a word always comes to rest exactly horizontal.
 *
 * Lenis eases toward a target rather than carrying momentum, so the wheel
 * tracks the hand closely and stops where the gesture stopped, instead of
 * coasting on after it like a flywheel.
 */

/** Virtual pixels per pocket — one mouse notch (~120 delta) moves one pocket. */
const PX_PER_STEP = 120;
/** One lap of the wheel in virtual pixels. */
const LAP_PX = PX_PER_STEP * WORD_COUNT;

export type LenisWheelCallbacks = {
  /** Called every frame the wheel moves, with the rotation in degrees. */
  onRotation: (rotation: number) => void;
  /** Called once the wheel comes to rest, with the pocket it landed in. */
  onSettled: (step: number) => void;
  /** Called when the wheel starts moving again. */
  onMoving: () => void;
};

export type LenisWheel = {
  destroy: () => void;
  /** Spin to `index`, taking whichever direction is the shorter way round. */
  spinToIndex: (index: number) => void;
};

/** The offscreen scroller Lenis drives. Kept in the document (a detached node
 * measures as zero, which would leave Lenis with nothing to scroll) but sized
 * to a pixel and hidden from layout, paint, and the accessibility tree.
 *
 * `overflow-y` has to stay scrollable: Lenis calls `internalStop()` on any
 * wrapper computing to `hidden` or `clip`, which silently parks the whole
 * instance. Invisibility comes from the size and opacity instead. */
function createVirtualScroller(): { wrapper: HTMLElement; content: HTMLElement } {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;overflow-y:auto;" +
    "overflow-x:hidden;scrollbar-width:none;opacity:0;pointer-events:none;" +
    "z-index:-1;";

  const content = document.createElement("div");
  // limit = content height - wrapper height, so one extra pixel of content
  // makes the scrollable range exactly one lap.
  content.style.cssText = `width:1px;height:${LAP_PX + 1}px;`;

  wrapper.appendChild(content);
  document.body.appendChild(wrapper);
  return { wrapper, content };
}

/** Scroll position → wheel rotation. Scrolling down (scroll up in px) spins
 * words forward, which is negative rotation. */
function rotationFor(scroll: number): number {
  return -(scroll / PX_PER_STEP) * WHEEL_STEP_DEG;
}

export function createLenisWheel({
  onRotation,
  onSettled,
  onMoving,
}: LenisWheelCallbacks): LenisWheel {
  const { wrapper, content } = createVirtualScroller();

  const lenis = new Lenis({
    wrapper,
    content,
    // The scroller is offscreen, so gestures have to be picked up page-wide.
    eventsTarget: window,
    infinite: true,
    lerp: 0.1,
    smoothWheel: true,
    syncTouch: false,
    // The page itself never scrolls; swallow the gesture so the browser's
    // elastic overscroll doesn't bump the viewport.
    prevent: () => false,
  });

  // Same QA affordance as LandingLenis on the home page — lets the wheel be
  // inspected and tuned from the console.
  (window as Window & { __wheelLenis?: Lenis }).__wheelLenis = lenis;

  let moving = false;
  let snapping = false;
  /** Invalidates the in-flight snap's completion when a new gesture lands. */
  let snapToken = 0;
  /** Timestamp of the last gesture, so the snap waits for the hand to stop. */
  let lastInputAt = 0;

  const settle = () => {
    snapping = false;
    if (!moving) return;
    moving = false;
    onSettled(Math.round(lenis.scroll / PX_PER_STEP));
  };

  /** Ease into `pocket` and rest there, claiming the wheel for the duration so
   * the idle check below leaves the animation alone.
   *
   * `lenis/snap` is the obvious tool for the pocket-finding and the wrong one:
   * it recomputes its target from `scroll + raw wheel delta` on its own
   * debounce and orders candidates by `Math.abs(value)`, neither of which
   * survives an infinite ring whose viewport is one pixel tall. Rounding to a
   * pocket directly is both shorter and exact. */
  const easeToPocket = (pocket: number, duration: number) => {
    snapping = true;
    const token = ++snapToken;
    lenis.scrollTo(pocket, {
      duration,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      force: true,
      onComplete: () => {
        if (token === snapToken) settle();
      },
    });
  };

  const unsubscribeScroll = lenis.on("scroll", () => {
    if (!moving) {
      moving = true;
      onMoving();
    }
    onRotation(rotationFor(lenis.scroll));
  });

  const unsubscribeInput = lenis.on("virtual-scroll", () => {
    lastInputAt = performance.now();
    // A fresh gesture overrides a snap already in flight, and its completion
    // must not settle the wheel out from under the new one.
    snapping = false;
    snapToken++;
  });

  /** How long after the last notch the wheel counts as let go of. A trackpad's
   * momentum tail arrives as a steady stream of small deltas, so this has to
   * outlast the gaps between those without feeling sticky. */
  const IDLE_MS = 140;
  /** Settling into a pocket after a gesture. */
  const SNAP_DURATION_S = 0.5;
  /** Crossing the wheel to a clicked word — a longer, deliberate travel. */
  const CLICK_DURATION_S = 0.9;

  let frame = requestAnimationFrame(function raf(time: number) {
    lenis.raf(time);
    if (moving && !snapping && time - lastInputAt > IDLE_MS) {
      // Round the gesture's destination, not the current position — mid-lerp
      // the wheel is still short of where the scroll was aimed, and snapping
      // from there would swallow most of the travel.
      const pocket = Math.round(lenis.targetScroll / PX_PER_STEP) * PX_PER_STEP;
      if (!lenis.isScrolling && Math.abs(lenis.animatedScroll - pocket) < 0.01) {
        // Already parked on a pocket — rest without a zero-length scroll.
        settle();
      } else {
        easeToPocket(pocket, SNAP_DURATION_S);
      }
    }
    frame = requestAnimationFrame(raf);
  });

  const spinToIndex = (index: number) => {
    const current = Math.round(lenis.scroll / PX_PER_STEP);
    const currentIndex = ((current % WORD_COUNT) + WORD_COUNT) % WORD_COUNT;
    let diff = index - currentIndex;
    if (diff > WORD_COUNT / 2) diff -= WORD_COUNT;
    if (diff < -WORD_COUNT / 2) diff += WORD_COUNT;
    if (diff === 0) return;
    // `infinite` wraps the target itself, so an out-of-range value is fine and
    // keeps the spin going the short way across the lap boundary.
    easeToPocket(lenis.scroll + diff * PX_PER_STEP, CLICK_DURATION_S);
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
}
