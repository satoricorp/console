import Lenis from "lenis";
import {
  WHEEL_STEP_DEG,
  WORD_COUNT,
  slideIndexFor,
} from "@/components/landing-v2/text-wheel";

/**
 * The landing wheel's motion, driven by Lenis.
 *
 * Lenis only knows how to move a scroll position, so the wheel borrows one: a
 * 1×1 offscreen scroller whose content is exactly one lap tall. Lenis scrolls
 * it, `infinite` wraps it at the lap boundary, and the rotation is read back
 * off `lenis.scroll`.
 *
 * The gesture itself is Lenis's own, untouched: the wheel tracks the hand, and
 * a hard throw spins past a whole stretch of words. Only the landing is ours.
 * When the hand lets go the wheel is re-aimed at the first pocket bearing the
 * *next* title — never two along, never back the way it came.
 *
 * Two things keep that from feeling like a catch. The pocket is small enough
 * that the furthest the wheel is ever re-aimed is one notch's worth of scroll
 * (see `PX_PER_STEP`). And the re-aim is timed off the speed the wheel is
 * already carrying, so it leaves at exactly that speed and eases to a stop —
 * a continuation of the throw rather than a second animation played after it.
 */

/** Virtual pixels per pocket. One mouse notch (~120 delta) turns the ring a
 * whole deck — five words — which is what keeps the landing smooth: the titles
 * repeat every `SLIDE_COUNT` pockets, so the furthest the wheel ever has to
 * roll on past where the throw was heading is one notch's worth of scroll. At
 * one pocket per notch that correction was five notches, and a gentle scroll
 * lurched several times further than the hand had moved. */
const PX_PER_STEP = 24;
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
 * The pocket a throw should come to rest in: the first one bearing the next
 * title along, at or beyond `raw`, going the way the wheel was thrown. Never
 * behind `raw`, so the wheel finishes rolling forwards instead of doubling
 * back into the gesture.
 *
 * `raw` may be a wrapped scroll position — that is fine, because `WORD_COUNT`
 * is a whole number of decks, so wrapping the ring leaves each pocket's title
 * unchanged.
 */
function landingPocket(fromSlide: number, raw: number, dir: 1 | -1): number {
  const want = slideIndexFor(fromSlide + dir);
  // First whole pocket at or beyond the throw, never behind it.
  let pocket = dir === 1 ? Math.ceil(raw) : Math.floor(raw);
  // At most a deck's worth of steps: each title appears once per deck.
  while (slideIndexFor(pocket) !== want) pocket += dir;
  return pocket;
}

/** How long after the last notch the wheel counts as let go of. A trackpad's
 * momentum tail arrives as a steady stream of small deltas, so this has to
 * outlast the gaps between those without feeling sticky. */
const IDLE_MS = 140;
/** Rate the gesture itself decays at — Lenis's own tracking. */
const ROLL_LERP = 0.1;
/** Crossing the wheel to a clicked word — a longer, deliberate travel. */
const CLICK_DURATION_S = 0.9;
/** Bounds on the roll-on. Its length is set by the wheel's own speed so the
 * handoff is seamless; these only stop the extremes — a crawl when the wheel
 * has almost stopped, a snap when it is still flying. */
const MIN_ROLL_S = 0.18;
const MAX_ROLL_S = 0.8;

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
  /** Slide the current gesture was thrown from, or null when none is in
   * flight. The landing is measured against this, not against wherever the
   * throw drifted to, which is what pins it to exactly one slide along. */
  let fromSlide: number | null = null;
  /** Net virtual pixels the gesture has asked for. Read from the raw input
   * rather than off `lenis.targetScroll`, which `infinite` wraps at the lap
   * boundary — a throw across that seam would otherwise look like a throw
   * backwards, and roll the wrong way. */
  let gestureDelta = 0;
  /** True once the wheel has been re-aimed at its landing pocket, so the aim
   * is taken once per gesture rather than every frame. */
  let rolling = false;
  /** Wheel speed in pixels per frame, wrap-corrected. The roll-on is timed off
   * this so it leaves at exactly the speed the wheel is already going. */
  let velocity = 0;
  let prevScroll = 0;

  const settle = () => {
    fromSlide = null;
    gestureDelta = 0;
    rolling = false;
    if (!moving) return;
    moving = false;
    onSettled(Math.round(lenis.scroll / PX_PER_STEP));
  };

  const atRest = () =>
    !lenis.isScrolling &&
    Math.abs(lenis.animatedScroll - lenis.targetScroll) < 0.01;

  const unsubscribeInput = lenis.on("virtual-scroll", ({ deltaY }) => {
    // The first notch after a rest fixes the slide the throw is measured from;
    // the rest of the gesture, momentum tail included, keeps that origin.
    if (fromSlide === null) {
      fromSlide = slideIndexFor(Math.round(lenis.scroll / PX_PER_STEP));
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

    // Track speed across the wrap seam so the roll-on can match it.
    let step = lenis.animatedScroll - prevScroll;
    if (step > TRACK_PX / 2) step -= TRACK_PX;
    if (step < -TRACK_PX / 2) step += TRACK_PX;
    velocity = step;
    prevScroll = lenis.animatedScroll;

    const idle = time - lastInputAt > IDLE_MS;

    if (moving && idle && !rolling && fromSlide !== null && gestureDelta !== 0) {
      rolling = true;
      const dir = gestureDelta > 0 ? 1 : -1;
      const raw = lenis.targetScroll / PX_PER_STEP;
      const extra = (landingPocket(fromSlide, raw, dir) - raw) * PX_PER_STEP;
      if (Math.abs(extra) > 0.5) {
        const target = lenis.targetScroll + extra;
        // Everything still to travel — the tail of the gesture plus the hop
        // onto the landing pocket — covered as one movement.
        let distance = target - lenis.animatedScroll;
        if (distance > TRACK_PX / 2) distance -= TRACK_PX;
        if (distance < -TRACK_PX / 2) distance += TRACK_PX;
        // Under `1 - (1-t)²` the opening speed is 2·distance/duration, so
        // timing the roll at 2·distance/speed launches it at exactly the speed
        // the wheel is already doing. No step in velocity, no catch — it just
        // keeps rolling and eases to a stop on the pocket.
        const speed = Math.abs(velocity) * 60;
        const duration = Math.min(
          MAX_ROLL_S,
          Math.max(MIN_ROLL_S, (2 * Math.abs(distance)) / Math.max(speed, 1)),
        );
        lenis.scrollTo(target, {
          duration,
          easing: (t) => 1 - (1 - t) * (1 - t),
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
    fromSlide = null;
    gestureDelta = 0;
    rolling = true;
    // `infinite` wraps the target itself, so an out-of-range value is fine and
    // keeps the spin going the short way across the lap boundary.
    lenis.scrollTo(lenis.scroll + diff * PX_PER_STEP, {
      duration: CLICK_DURATION_S,
      easing: (t) => 1 - Math.pow(1 - t, 3),
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
