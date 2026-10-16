// Ported from the frozen predecessor (Visual Climate Watch, components/
// movement/explosion-motion.ts) under the 2026-10-16 owner decision permitting
// direct porting of visual/scene code. Pure timing math: chapter windows,
// reveals, the desk interlude and the one-by-one homecoming. The predecessor's
// BTR narration strings were stripped (R1/copy-as-data); socket labels arrive
// from the page as data.
export const clamp01 = (value) => Math.max(0, Math.min(1, value));

// Minimum-jerk interpolation: zero velocity and acceleration at both ends.
export function reveal(amount, start, end) {
  const t = clamp01((amount - start) / (end - start));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export const LAYER_WINDOWS = [[.08, .19], [.21, .34], [.36, .49], [.51, .60], [.91, 1]];
export const LAYER_LIFTS = [.42, 1.50, 3.15, 4.60, 6.80];

export const btrReveal = (amount, index) => reveal(amount, .615 + index * .034, .641 + index * .034);
export const btrStepAt = (amount) =>
  amount < .615 || amount >= .91 ? -1 : Math.min(7, Math.floor((amount - .615) / .034));

export function storyPhase(amount) {
  return amount < .08 ? 0 : amount < .21 ? 1 : amount < .36 ? 2 : amount < .51 ? 3 : amount < .91 ? 4 : 5;
}

/** The original model's Z axis is the common spindle. No inventory / XY packing.
 *  `lift` compresses that spindle for a stage too short to frame it. */
export function verticalOffset(amount, layer, shell = null, lift = 1) {
  if (shell === 'upper') return reveal(amount, 0, .11) * 12 * lift;
  if (shell === 'lower') return -reveal(amount, 0, .11) * .22 * lift;
  const [start, end] = LAYER_WINDOWS[Math.min(4, layer)];
  return LAYER_LIFTS[Math.min(4, layer)] * reveal(amount, start, end) * lift;
}

export const narrativeAmount = (progress) => clamp01(progress / .65);
export const deskAmount = (progress) => reveal(progress, .70, .80);
export const returnAmount = (progress, layer, shell = null) => {
  const slot = shell === 'upper' ? 6 : shell === 'lower' ? 5 : Math.min(4, layer);
  return reveal(progress, .84 + slot * .022, .868 + slot * .022);
};

export function cyclePhase(progress) {
  return progress < .70 ? storyPhase(narrativeAmount(progress)) : progress < .84 ? 6 : progress < 1 ? 7 : 8;
}

/** The progress at which chapter n begins: the inverse of cyclePhase. */
export const chapterStart = (chapter) =>
  chapter <= 0 ? 0
    : chapter <= 5 ? LAYER_WINDOWS[chapter - 1][0] * .65 + .005
      : chapter === 6 ? .705
        : chapter === 7 ? .845
          : 1;

/** Vertical chapters → a short inventory interlude → one-by-one homecoming. */
export function cycleOffset(progress, layer, center, cell, shell = null, lift = 1) {
  const vertical = verticalOffset(narrativeAmount(progress), layer, shell, lift);
  const desk = deskAmount(progress), home = returnAmount(progress, layer, shell);
  return {
    x: (cell.x - center.x) * desk * (1 - home),
    y: (cell.y - center.y) * desk * (1 - home),
    z: (vertical * (1 - desk) - center.z * desk) * (1 - home) + Math.sin(home * Math.PI) * .65,
  };
}
