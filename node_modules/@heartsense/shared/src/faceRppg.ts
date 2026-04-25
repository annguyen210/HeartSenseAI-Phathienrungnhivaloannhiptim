import type { MeasurementInput, MeasurementResult } from "./types";
import { analyzeFingerPpg } from "./fingerPpg";

export type FaceRppgFrame = {
  r: number;
  g: number;
  b: number;
  timestampMs: number;
};

export function extractPosSignal(frames: FaceRppgFrame[]): number[] {
  if (!frames.length) {
    return [];
  }
  const means = frames.reduce(
    (accumulator, frame) => {
      accumulator.r += frame.r;
      accumulator.g += frame.g;
      accumulator.b += frame.b;
      return accumulator;
    },
    { r: 0, g: 0, b: 0 },
  );
  const avgR = means.r / frames.length;
  const avgG = means.g / frames.length;
  const avgB = means.b / frames.length;

  return frames.map((frame) => {
    const rn = frame.r / Math.max(avgR, 1);
    const gn = frame.g / Math.max(avgG, 1);
    const bn = frame.b / Math.max(avgB, 1);
    const xs = 3 * rn - 2 * gn;
    const ys = 1.5 * rn + gn - 1.5 * bn;
    return xs - ys;
  });
}

export function analyzeFaceRppg(frames: FaceRppgFrame[], input: Omit<MeasurementInput, "rgbSignal" | "timestampsMs">): MeasurementResult {
  const posSignal = extractPosSignal(frames);
  return analyzeFingerPpg({
    ...input,
    kind: "face",
    rgbSignal: posSignal,
    timestampsMs: frames.map((frame) => frame.timestampMs),
  });
}

export async function warmupFaceModel(): Promise<{ model: string; backend: string }> {
  return {
    model: "@tensorflow-models/face-landmarks-detection",
    backend: "webgl",
  };
}
