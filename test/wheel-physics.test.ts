import { describe, expect, test } from "bun:test";
import { WHEEL_STEP_DEG } from "../src/components/landing-v2/text-wheel";
import {
  FRICTION_DEG_S2,
  IMPULSE_DEG_PER_DELTA,
  MAX_SPEED_DEG_S,
  SETTLE_SPEED_DEG_S,
  applyImpulse,
  flickVelocityFor,
  restingState,
  stepWheel,
  type WheelState,
} from "../src/components/landing-v2/wheel-physics";

/**
 * The landing wheel is a physics simulation, not a canned animation: scroll
 * impulses become angular velocity, constant friction spins it down, and a
 * critically damped spring drops it into a pocket. These tests pin the
 * physical properties that make it feel like a real wheel of fortune —
 * harder flicks travel farther, speed bleeds off linearly, and it always
 * comes to rest with a word exactly on the horizontal.
 */

const NOTCH = 120; // one mouse-wheel click's worth of deltaY

function runToRest(
  state: WheelState,
  dt = 1 / 120,
): { state: WheelState; trace: WheelState[] } {
  const trace: WheelState[] = [state];
  for (let i = 0; i < 10_000 && state.mode !== "rest"; i++) {
    state = stepWheel(state, dt);
    trace.push(state);
  }
  expect(state.mode).toBe("rest");
  return { state, trace };
}

function onDetent(rotation: number) {
  expect(
    Math.abs(rotation / WHEEL_STEP_DEG - Math.round(rotation / WHEEL_STEP_DEG)),
  ).toBeLessThan(1e-9);
}

describe("scroll impulses", () => {
  test("one notch advances exactly one pocket, in the scroll direction", () => {
    const down = runToRest(applyImpulse(restingState(), NOTCH)).state;
    expect(down.rotation).toBeCloseTo(-WHEEL_STEP_DEG, 6);

    const up = runToRest(applyImpulse(restingState(), -NOTCH)).state;
    expect(up.rotation).toBeCloseTo(WHEEL_STEP_DEG, 6);
  });

  test("harder flicks travel strictly farther", () => {
    const travels = [NOTCH, 400, 900, 1600, 4000].map((delta) =>
      Math.abs(runToRest(applyImpulse(restingState(), delta)).state.rotation),
    );
    for (let i = 1; i < travels.length; i++) {
      expect(travels[i]).toBeGreaterThan(travels[i - 1]);
    }
  });

  test("travel matches the friction prediction v²/(2a) to within a pocket", () => {
    const delta = 1600;
    const v0 = delta * IMPULSE_DEG_PER_DELTA;
    const predicted = v0 ** 2 / (2 * FRICTION_DEG_S2);
    const { state } = runToRest(applyImpulse(restingState(), delta));
    expect(Math.abs(-state.rotation - predicted)).toBeLessThanOrEqual(
      WHEEL_STEP_DEG,
    );
  });

  test("velocity is capped so a violent fling cannot spin forever", () => {
    const flung = applyImpulse(restingState(), 1e9);
    expect(Math.abs(flung.velocity)).toBe(MAX_SPEED_DEG_S);
  });

  test("scrolling again mid-spin adds speed and extends the travel", () => {
    const single = runToRest(applyImpulse(restingState(), 300)).state;

    let boosted = applyImpulse(restingState(), 300);
    for (let i = 0; i < 10; i++) boosted = stepWheel(boosted, 1 / 120);
    boosted = applyImpulse(boosted, 300);
    const double = runToRest(boosted).state;

    expect(Math.abs(double.rotation)).toBeGreaterThan(
      Math.abs(single.rotation),
    );
  });

  test("scrolling the opposite way brakes the wheel", () => {
    let state = applyImpulse(restingState(), 1200);
    for (let i = 0; i < 10; i++) state = stepWheel(state, 1 / 120);
    const before = Math.abs(state.velocity);
    const after = Math.abs(applyImpulse(state, -600).velocity);
    expect(after).toBeLessThan(before);
  });
});

describe("spinning down", () => {
  test("speed bleeds off linearly under constant friction", () => {
    let state = applyImpulse(restingState(), 1600);
    const dt = 1 / 120;
    for (let i = 0; i < 50; i++) {
      const next = stepWheel(state, dt);
      if (next.mode !== "spin") break;
      expect(Math.abs(state.velocity) - Math.abs(next.velocity)).toBeCloseTo(
        FRICTION_DEG_S2 * dt,
        6,
      );
      state = next;
    }
  });

  test("every landing is exactly on a pocket", () => {
    for (const delta of [37, NOTCH, 250, 777, 1500, 3200, -90, -2000]) {
      const { state } = runToRest(applyImpulse(restingState(), delta));
      onDetent(state.rotation);
      expect(state.velocity).toBe(0);
    }
  });

  test("the landing pocket does not depend on frame rate", () => {
    for (const delta of [NOTCH, 500, 1500]) {
      const landings = [1 / 30, 1 / 60, 1 / 144].map(
        (dt) => runToRest(applyImpulse(restingState(), delta), dt).state.rotation,
      );
      expect(landings[1]).toBeCloseTo(landings[0], 6);
      expect(landings[2]).toBeCloseTo(landings[0], 6);
    }
  });

  test("a wheel braked to a dead stop between pockets still falls into one", () => {
    const stalled: WheelState = {
      mode: "spin",
      rotation: -2.9,
      velocity: 0,
      target: 0,
    };
    const { state } = runToRest(stalled);
    onDetent(state.rotation);
  });

  test("a hidden-tab frame gap cannot teleport the wheel", () => {
    const state = stepWheel(applyImpulse(restingState(), 2400), 5);
    // 5s of real decel would end the spin outright; the clamp means at most
    // 50ms worth of travel happens in the one frame.
    expect(Math.abs(state.rotation)).toBeLessThanOrEqual(
      MAX_SPEED_DEG_S * 0.05,
    );
  });
});

describe("click-to-navigate flicks", () => {
  test("the computed flick speed lands exactly on the requested pocket", () => {
    for (const steps of [1, -1, 7, -13, 30]) {
      const travel = -steps * WHEEL_STEP_DEG;
      const flicked: WheelState = {
        mode: "spin",
        rotation: 0,
        velocity: flickVelocityFor(travel),
        target: travel,
      };
      const { state } = runToRest(flicked);
      expect(state.rotation).toBeCloseTo(travel, 6);
    }
  });

  test("a one-pocket flick still starts above settle speed", () => {
    expect(Math.abs(flickVelocityFor(WHEEL_STEP_DEG))).toBeGreaterThan(
      SETTLE_SPEED_DEG_S,
    );
  });
});
