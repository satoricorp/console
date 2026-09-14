import Lenis from "lenis";
import { WHEEL_STEP_DEG, WORD_COUNT } from "@/components/landing-v2/text-wheel";

/**
 * The landing wheel's motion, driven by Lenis.
 *
 * Lenis only knows how to move a scroll position, so the wheel borrows one: a
 * 1×1 offscreen scroller whose content is exactly one lap tall. Lenis scrolls
 * it, `infinite` wraps it at the lap boundary, and the rotation is read back
 * off `lenis.scroll`.
 *
 * The gesture itself is Lenis's own: the wheel tracks the hand with low lerp
 * so momentum coasts, and a hard throw carries through many pockets. When the
 * hand lets go the wheel is re-aimed at whichever pocket the throw reached —
 * a light nudge may not leave the starting pocket at all; a firm flick can
 * skip several slides before the lerp eases into the snap.
 *
 * The post-throw nudge onto the landing pocket uses the same lerp as the
 * gesture, not a separate duration-based ease, so deceleration stays smooth.
 */

/** Virtual pixels per pocket. Lower = more rotation per scroll pixel (longer
 * visual travel per flick). Kept above one pocket per mouse notch so the
 * post-throw landing correction stays within a single notch — the titles repeat
 * every `SLIDE_COUNT` pockets, so the furthest re-aim is one notch's worth. */
const PX_PER_STEP = 18;
/** One visual turn of the ring, in virtual pixels. */
const LAP_PX = PX_PER_STEP * WORD_COUNT;
/** Turns of the ring the borrowed scroller holds before `infinite` wraps it.
 *
 * The wrap point has to sit far away from any real gesture. Lenis routes a
 * scroll the short way round its track, so a throw that covers more than half
 * the track arrives by going *backwards* — on a one-turn track that is only a
 * few notches, and a firm flick would visibly spin the wrong way. A whole
 * number of turns keeps the seam invisible and every pocket's title unchanged,
 * so the track can simply be made long enough that nothing reaches halfway.
 * At this length a single frame would have to swallow ~360 notches to get
 * there, which no real input does. */
const WRAP_LAPS = 60;
const TRACK_PX = LAP_PX * WRAP_LAPS;

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
  // makes the scrollable range exactly the track.
  content.style.cssText = `width:1px;height:${TRACK_PX + 1}px;`;

  wrapper.appendChild(content);
  document.body.appendChild(wrapper);
  return { wrapper, content };
}

/** Scroll position → wheel rotation. Scrolling down (scroll up in px) spins
 * words forward, which is negative rotation. */
function rotationFor(scroll: number): number {
  return -(scroll / PX_PER_STEP) * WHEEL_STEP_DEG;
}

/**
 * The pocket a throw should come to rest in. Travel is proportional to how
 * far the gesture carried the virtual scroll: a light nudge that does not clear
 * `POCKET_THRESHOLD` stays put; anything past that lands on the nearest whole
 * pocket at or beyond the throw, in the thrown direction.
 */
const POCKET_THRESHOLD = 0.42;

function landingPocket(
  startPocket: number,
  raw: number,
  dir: 1 | -1,
): number {
  const drift = dir === 1 ? raw - startPocket : startPocket - raw;
  if (drift < POCKET_THRESHOLD) return startPocket;
  return dir === 1 ? Math.ceil(raw) : Math.floor(raw);
}

/** How long after the last notch the wheel counts as let go of. A trackpad's
 * momentum tail arrives as a steady stream of small deltas, so this has to
 * outlast the gaps between those and leave room for the lerp coast to run down
 * before the pocket nudge. */
const IDLE_MS = 300;
/** Lerp intensity for gesture tracking and coast-down. Low = heavy wheel with a
 * long glide; ~0.023 lands near 40% of the 0.014 coast duration. */
const ROLL_LERP = 0.023;
/** Amplifies wheel delta before it hits the virtual scroller — harder flicks
 * carry more virtual distance without changing pocket geometry. */
const WHEEL_MULTIPLIER = 1.35;
/** Crossing the wheel to a clicked slide — a longer, deliberate travel. */
const CLICK_DURATION_S = 1.1;
/** How close animated scroll must be to target before we call the wheel at
 * rest. Loose enough that the long lerp tail can end once motion is
 * imperceptible without waiting on asymptotic creep. */
const REST_EPSILON_PX = 0.65;

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
    lerp: ROLL_LERP,
    smoothWheel: true,
    wheelMultiplier: WHEEL_MULTIPLIER,
    syncTouch: false,
    // The page itself never scrolls; swallow the gesture so the browser's
    // elastic overscroll doesn't bump the viewport.
    prevent: () => false,
  });

  // A QA affordance — lets the wheel be inspected and tuned from the console.
  (window as Window & { __wheelLenis?: Lenis }).__wheelLenis = lenis;

  let moving = false;
  /** Timestamp of the last gesture, so the roll waits for the hand to stop. */
  let lastInputAt = 0;
  /** Pocket the current gesture started from, or null when none is in flight.
   * Landing distance is measured from here so a light nudge can stay put. */
  let startPocket: number | null = null;
  /** Net virtual pixels the gesture has asked for. Read from the raw input
   * rather than off `lenis.targetScroll`, which `infinite` wraps at the lap
   * boundary — a throw across that seam would otherwise look like a throw
   * backwards, and roll the wrong way. */
  let gestureDelta = 0;
  /** True once the wheel has been re-aimed at its landing pocket, so the aim
   * is taken once per gesture rather than every frame. */
  let rolling = false;
  const settle = () => {
    startPocket = null;
    gestureDelta = 0;
    rolling = false;
    if (!moving) return;
    moving = false;
    onSettled(Math.round(lenis.scroll / PX_PER_STEP));
  };

  const atRest = () =>
    !lenis.isScrolling &&
    Math.abs(lenis.animatedScroll - lenis.targetScroll) < REST_EPSILON_PX;

  const unsubscribeInput = lenis.on("virtual-scroll", ({ deltaY }) => {
    // The first notch after a rest fixes the pocket the throw is measured from;
    // the rest of the gesture, momentum tail included, keeps that origin.
    if (startPocket === null) {
      startPocket = Math.round(lenis.scroll / PX_PER_STEP);
      gestureDelta = 0;
    }
    gestureDelta += deltaY;
    lastInputAt = performance.now();
    // More input means the throw is still running: let it, and re-aim later.
    rolling = false;
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

    if (moving && idle && !rolling && startPocket !== null && gestureDelta !== 0) {
      rolling = true;
      const dir = gestureDelta > 0 ? 1 : -1;
      const raw = lenis.targetScroll / PX_PER_STEP;
      const extra = (landingPocket(startPocket, raw, dir) - raw) * PX_PER_STEP;
      if (Math.abs(extra) > 0.5) {
        const target = lenis.targetScroll + extra;
        // Nudge the target onto the landing pocket and let the same lerp that
        // carried the throw coast the wheel in — no second duration-based ease
        // that would interrupt velocity and feel like a catch.
        lenis.scrollTo(target, {
          programmatic: false,
          lerp: ROLL_LERP,
          force: true,
        });
      }
    }

    // Rest only once the wheel has arrived *and* the hand has stopped. Arrival
    // is judged by position rather than a completion callback: Lenis can emit a
    // trailing scroll after that fires, which would flip `moving` back on with
    // nothing left to switch it off, stranding the slide mid-fade.
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
    // A click is its own destination, not a throw to be rolled on from.
    startPocket = null;
    gestureDelta = 0;
    rolling = true;
    // `infinite` wraps the target itself, so an out-of-range value is fine and
    // keeps the spin going the short way across the lap boundary.
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
}
