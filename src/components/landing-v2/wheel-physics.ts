import { WHEEL_STEP_DEG } from "@/components/landing-v2/text-wheel";

/**
 * Wheel-of-fortune physics for the landing wheel. Scroll gestures are
 * impulses: each one adds angular velocity immediately, so the wheel starts
 * turning the moment you touch it and a harder flick spins farther. Constant
 * friction bleeds the speed off (linear deceleration, like a real wheel's
 * bearing plus flapper), and once it drops below walking pace a critically
 * damped spring pulls it into the nearest pocket so a word always comes to
 * rest exactly horizontal.
 */

export type WheelMode = "rest" | "spin" | "settle";

export type WheelState = {
  mode: WheelMode;
  /** Rotation in degrees. Unbounded — full laps accumulate. */
  rotation: number;
  /** Angular velocity in deg/s. Negative spins words forward (scroll down). */
  velocity: number;
  /** Pocket the settle spring is easing into (deg). Valid in "settle" mode. */
  target: number;
};

/** Scroll delta → velocity. One mouse-wheel notch (~120 delta) becomes
 * 60 deg/s, which friction carries exactly one pocket over. */
export const IMPULSE_DEG_PER_DELTA = 0.5;
/** Constant frictional deceleration in deg/s². A flick at speed v coasts
 * roughly v²/(2·FRICTION) degrees before falling into a pocket. */
export const FRICTION_DEG_S2 = 300;
/** Speed ceiling — keeps a violent trackpad fling under ~4s of spin-down. */
export const MAX_SPEED_DEG_S = 1200;
/** Below this speed friction hands the wheel off to the settle spring. */
export const SETTLE_SPEED_DEG_S = 40;
/** Settle spring stiffness (s⁻²); damping is critical, so it never bounces. */
export const SETTLE_STIFFNESS = 180;
const SETTLE_OMEGA = Math.sqrt(SETTLE_STIFFNESS);
const SETTLE_DAMPING = 2 * SETTLE_OMEGA;
/** How far the spring lets handoff momentum coast past the handoff point —
 * used to pick the pocket the wheel is leaning into, not the one behind it. */
const SETTLE_COAST_DEG = SETTLE_SPEED_DEG_S / SETTLE_OMEGA;
/** Beneath these the motion is invisible — snap to the pocket and stop. */
const REST_EPSILON_DEG = 0.01;
const REST_EPSILON_DEG_S = 0.5;
/** rAF gaps longer than this (hidden tab, GC pause) integrate as this. */
export const MAX_FRAME_DT_S = 0.05;

export function restingState(rotation = 0): WheelState {
  return { mode: "rest", rotation, velocity: 0, target: rotation };
}

/** The pocket angle nearest to `rotation`. */
export function nearestDetent(rotation: number): number {
  return Math.round(rotation / WHEEL_STEP_DEG) * WHEEL_STEP_DEG;
}

/** A scroll event's contribution: velocity in, no waiting. Scroll down
 * (positive delta) drives rotation negative, which steps words forward. */
export function applyImpulse(state: WheelState, wheelDelta: number): WheelState {
  const velocity = Math.max(
    -MAX_SPEED_DEG_S,
    Math.min(MAX_SPEED_DEG_S, state.velocity - wheelDelta * IMPULSE_DEG_PER_DELTA),
  );
  return { ...state, mode: "spin", velocity };
}

/** The flick speed at which friction lands the wheel exactly `travelDeg`
 * away — how hard a click on a word has to spin the wheel to reach it. */
export function flickVelocityFor(travelDeg: number): number {
  const spinDistance = Math.max(0, Math.abs(travelDeg) - SETTLE_COAST_DEG);
  return (
    Math.sign(travelDeg) *
    Math.sqrt(SETTLE_SPEED_DEG_S ** 2 + 2 * FRICTION_DEG_S2 * spinDistance)
  );
}

function settleStep(state: WheelState, dt: number): WheelState {
  const accel =
    -SETTLE_STIFFNESS * (state.rotation - state.target) -
    SETTLE_DAMPING * state.velocity;
  const velocity = state.velocity + accel * dt;
  const rotation = state.rotation + velocity * dt;
  if (
    Math.abs(rotation - state.target) < REST_EPSILON_DEG &&
    Math.abs(velocity) < REST_EPSILON_DEG_S
  ) {
    return restingState(state.target);
  }
  return { ...state, rotation, velocity };
}

/** Advance the simulation by one frame of `dt` seconds. */
export function stepWheel(state: WheelState, dt: number): WheelState {
  if (state.mode === "rest") return state;
  dt = Math.min(dt, MAX_FRAME_DT_S);
  if (state.mode === "settle") return settleStep(state, dt);

  const speed = Math.abs(state.velocity);
  const speedAfter = speed - FRICTION_DEG_S2 * dt;
  if (speedAfter > SETTLE_SPEED_DEG_S) {
    // Trapezoid integration is exact under constant deceleration, so the
    // path — and the pocket it leads to — is the same at any frame rate.
    const velocity = Math.sign(state.velocity) * speedAfter;
    const rotation = state.rotation + ((state.velocity + velocity) / 2) * dt;
    return { ...state, rotation, velocity };
  }

  // The wheel crosses settle speed inside this frame: solve for the exact
  // crossing, hand off to the spring there, and aim at the pocket the
  // remaining momentum is leaning into. Sub-frame precision keeps the
  // landing pocket independent of frame rate.
  const dir = Math.sign(state.velocity);
  const handoffSpeed = Math.min(speed, SETTLE_SPEED_DEG_S);
  const tCross = Math.max(0, (speed - handoffSpeed) / FRICTION_DEG_S2);
  const rotation =
    state.rotation + dir * ((speed + handoffSpeed) / 2) * tCross;
  const velocity = dir * handoffSpeed;
  return settleStep(
    {
      mode: "settle",
      rotation,
      velocity,
      target: nearestDetent(rotation + velocity / SETTLE_OMEGA),
    },
    dt - tCross,
  );
}
