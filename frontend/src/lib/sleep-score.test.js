import { describe, it, expect } from 'vitest'
import { calculateSleepScore } from './sleep-score.js'

// Translated from fit-app's utils/__tests__/sleepScore.test.ts (fork OG-021): TypeScript
// annotations removed, nothing else changed.

// ---------------------------------------------------------------------------
// Faithfulness check
//
// `calculateSleepScore` is a direct port of the inline algorithm that used to
// live in `services/healthConnect.ts` (see FIT-004). To prove the port is
// faithful rather than merely asserting it, this file also carries an
// independently hand-typed copy of the original algorithm (`referenceSleepScore`
// below) written straight from the pre-refactor source, not by copy-pasting
// `../sleepScore.ts`. A property test then runs both implementations across a
// wide range of generated inputs and requires them to agree on every field.
// If the extraction had introduced a typo (wrong ratio, wrong cap, wrong
// operator), this comparison would catch it even where the seven named
// scenarios below happen not to exercise that exact code path.
// ---------------------------------------------------------------------------

function referenceSleepScore(records) {
  let totalDeepMins = 0;
  let totalRemMins = 0;
  let totalLightMins = 0;
  let totalAwakeMins = 0;

  for (const record of records) {
    if (record.stages && record.stages.length > 0) {
      for (const stage of record.stages) {
        const durationMins = stage.durationMins;
        switch (stage.stage) {
          case 1: // AWAKE
          case 3: // OUT_OF_BED
          case 7: // AWAKE_IN_BED
            totalAwakeMins += durationMins;
            break;
          case 2: // SLEEPING (generic/undifferentiated sleep)
            totalLightMins += durationMins * 0.58;
            totalDeepMins += durationMins * 0.23;
            totalRemMins += durationMins * 0.19;
            break;
          case 4: // LIGHT
            totalLightMins += durationMins;
            break;
          case 5: // DEEP
            totalDeepMins += durationMins;
            break;
          case 6: // REM
            totalRemMins += durationMins;
            break;
          default:
            totalLightMins += durationMins;
            break;
        }
      }
    } else {
      const durationMins = record.totalDurationMins ?? 0;
      totalLightMins += durationMins * 0.58;
      totalDeepMins += durationMins * 0.23;
      totalRemMins += durationMins * 0.19;
    }
  }

  const totalSleepMins = totalDeepMins + totalRemMins + totalLightMins;
  const totalTimeInBed = totalSleepMins + totalAwakeMins;

  if (!(totalSleepMins > 0)) {
    return {
      sleepScore: null,
      durationScore: 0,
      qualityScore: 0,
      restorationScore: 0,
      totalSleepMins,
      totalAwakeMins,
    };
  }

  const targetMins = 480;
  const durationScore = Math.min(50, (totalSleepMins / targetMins) * 50);
  const qualityPercent = ((totalDeepMins + totalRemMins) / totalSleepMins) * 100;
  const qualityScore = Math.min(25, (qualityPercent / 50) * 25);
  const awakePercentage = totalTimeInBed > 0 ? totalAwakeMins / totalTimeInBed : 0;
  const restorationScore = Math.max(0, Math.min(25, 25 * (1 - awakePercentage * 2.5)));
  const totalScore = Math.round(durationScore + qualityScore + restorationScore);

  return {
    sleepScore: Math.max(0, Math.min(100, totalScore)),
    durationScore,
    qualityScore,
    restorationScore,
    totalSleepMins,
    totalAwakeMins,
  };
}

// Deterministic PRNG (LCG) so the property test is reproducible across runs.
function makeRng(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function randomRecords(rng) {
  const stageCodes = [1, 2, 3, 4, 5, 6, 7, 99]; // includes an unrecognised code (99) to hit the default branch
  const recordCount = 1 + Math.floor(rng() * 3); // 1-3 records
  const records = [];

  for (let r = 0; r < recordCount; r++) {
    if (rng() < 0.5) {
      const stageCount = Math.floor(rng() * 5); // 0-4 stages (0 => falls back to totalDurationMins path)
      const stages = Array.from({ length: stageCount }, () => ({
        stage: stageCodes[Math.floor(rng() * stageCodes.length)],
        durationMins: rng() * 300,
      }));
      records.push(stageCount > 0 ? { stages } : { totalDurationMins: rng() * 300 });
    } else {
      records.push({ totalDurationMins: rng() * 300 });
    }
  }

  return records;
}

function expectWithinScoreRange(result) {
  if (result.sleepScore !== null) {
    expect(result.sleepScore).toBeGreaterThanOrEqual(0);
    expect(result.sleepScore).toBeLessThanOrEqual(100);
  }
}

describe('calculateSleepScore — faithfulness to the original inline algorithm', () => {
  it('agrees with an independently-typed copy of the original algorithm across 200 generated inputs', () => {
    const rng = makeRng(42);
    for (let i = 0; i < 200; i++) {
      const records = randomRecords(rng);
      const actual = calculateSleepScore(records);
      const expected = referenceSleepScore(records);
      expect(actual).toEqual(expected);
      expectWithinScoreRange(actual);
    }
  });
});

describe('calculateSleepScore', () => {
  it('scores a full 8h night with a normal stage mix', () => {
    // 5h light + 1.5h deep + 1.5h REM = 480 min sleep, no awake time.
    const result = calculateSleepScore([
      {
        stages: [
          { stage: 4, durationMins: 300 },
          { stage: 5, durationMins: 90 },
          { stage: 6, durationMins: 90 },
        ],
      },
    ]);

    expect(result.totalSleepMins).toBeCloseTo(480, 5);
    expect(result.durationScore).toBeCloseTo(50, 5); // (480/480)*50 = 50, capped at 50
    expect(result.qualityScore).toBeCloseTo(18.75, 5); // ((90+90)/480*100)/50*25 = 18.75
    expect(result.restorationScore).toBeCloseTo(25, 5); // no awake time
    expect(result.sleepScore).toBe(94); // round(50 + 18.75 + 25) = round(93.75)
    expectWithinScoreRange(result);
  });

  it('scores a short night where the duration cap is not reached', () => {
    // 3h light + 40min deep + 20min rem = 240 min sleep, no awake time.
    const result = calculateSleepScore([
      {
        stages: [
          { stage: 4, durationMins: 180 },
          { stage: 5, durationMins: 40 },
          { stage: 6, durationMins: 20 },
        ],
      },
    ]);

    expect(result.totalSleepMins).toBeCloseTo(240, 5);
    expect(result.durationScore).toBeCloseTo(25, 5); // (240/480)*50 = 25, well under the 50 cap
    expect(result.qualityScore).toBeCloseTo(12.5, 5); // ((40+20)/240*100)/50*25 = 12.5
    expect(result.restorationScore).toBeCloseTo(25, 5);
    expect(result.sleepScore).toBe(63); // round(25 + 12.5 + 25) = round(62.5)
    expectWithinScoreRange(result);
  });

  it('caps the duration score at 50 for a night at or above 8h', () => {
    // 400min light + 100min deep + 100min rem = 600 min sleep (10h), no awake time.
    const result = calculateSleepScore([
      {
        stages: [
          { stage: 4, durationMins: 400 },
          { stage: 5, durationMins: 100 },
          { stage: 6, durationMins: 100 },
        ],
      },
    ]);

    expect(result.totalSleepMins).toBeCloseTo(600, 5);
    // Uncapped this would be (600/480)*50 = 62.5 — must clamp to 50.
    expect(result.durationScore).toBe(50);
    expect(result.qualityScore).toBeCloseTo(16.666667, 5);
    expect(result.restorationScore).toBeCloseTo(25, 5);
    expect(result.sleepScore).toBe(92); // round(50 + 16.666667 + 25) = round(91.666667)
    expectWithinScoreRange(result);
  });

  it('floors the restoration score at 0 for high awake time', () => {
    // 200min asleep (all light), 300min awake -> 500min total time in bed.
    // awakePercentage = 0.6 -> 25*(1 - 0.6*2.5) = 25*-0.5 = -12.5, must floor to 0.
    const result = calculateSleepScore([
      {
        stages: [
          { stage: 4, durationMins: 200 },
          { stage: 1, durationMins: 300 },
        ],
      },
    ]);

    expect(result.totalSleepMins).toBeCloseTo(200, 5);
    expect(result.durationScore).toBeCloseTo(20.833333, 5); // (200/480)*50
    expect(result.qualityScore).toBe(0); // no deep or REM at all
    expect(result.restorationScore).toBe(0); // floored, would otherwise be negative
    expect(result.sleepScore).toBe(21); // round(20.833333 + 0 + 0)
    expectWithinScoreRange(result);
  });

  it('applies the 58/23/19 fallback split when stage data is absent', () => {
    // A single 8h (480min) record with no stage breakdown at all.
    const result = calculateSleepScore([{ totalDurationMins: 480 }]);

    // light = 480*0.58 = 278.4, deep = 480*0.23 = 110.4, rem = 480*0.19 = 91.2
    expect(result.totalSleepMins).toBeCloseTo(480, 5);
    expect(result.durationScore).toBeCloseTo(50, 5);
    // qualityPercent = (110.4+91.2)/480*100 = 42 -> qualityScore = 42/50*25 = 21
    expect(result.qualityScore).toBeCloseTo(21, 5);
    expect(result.restorationScore).toBeCloseTo(25, 5);
    expect(result.sleepScore).toBe(96); // round(50 + 21 + 25)
    expectWithinScoreRange(result);
  });

  it('aggregates a night split across multiple records, one with stages and one without', () => {
    const result = calculateSleepScore([
      {
        stages: [
          { stage: 4, durationMins: 100 },
          { stage: 5, durationMins: 50 },
          { stage: 6, durationMins: 30 },
          { stage: 1, durationMins: 20 },
        ],
      },
      { totalDurationMins: 120 }, // falls back to 58/23/19: light 69.6, deep 27.6, rem 22.8
    ]);

    // Combined: light 169.6, deep 77.6, rem 52.8, awake 20 -> totalSleep 300, timeInBed 320.
    expect(result.totalSleepMins).toBeCloseTo(300, 5);
    expect(result.totalAwakeMins).toBeCloseTo(20, 5);
    expect(result.durationScore).toBeCloseTo(31.25, 5); // (300/480)*50
    expect(result.qualityScore).toBeCloseTo(21.733333, 4); // ((77.6+52.8)/300*100)/50*25
    expect(result.restorationScore).toBeCloseTo(21.09375, 4); // 25*(1 - (20/320)*2.5)
    expect(result.sleepScore).toBe(74); // round(31.25 + 21.733333 + 21.09375) = round(74.077083)
    expectWithinScoreRange(result);
  });

  it('returns a null score for zero total sleep duration, with no records at all', () => {
    const result = calculateSleepScore([]);

    expect(result.sleepScore).toBeNull();
    expect(result.durationScore).toBe(0);
    expect(result.qualityScore).toBe(0);
    expect(result.restorationScore).toBe(0);
    expect(result.totalSleepMins).toBe(0);
    expectWithinScoreRange(result);
  });

  it('returns a null score for zero total sleep duration, with records present but all-zero durations', () => {
    const result = calculateSleepScore([
      { stages: [{ stage: 4, durationMins: 0 }] },
      { totalDurationMins: 0 },
    ]);

    expect(result.sleepScore).toBeNull();
    expect(result.durationScore).toBe(0);
    expect(result.qualityScore).toBe(0);
    expect(result.restorationScore).toBe(0);
    expect(result.totalSleepMins).toBe(0);
    expectWithinScoreRange(result);
  });
});
