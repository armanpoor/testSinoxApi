import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextDelay, CooldownTracker, detectSoftBlockText, type ThrottleConfig } from './throttleEngine';

const baseCfg: ThrottleConfig = {
  minDelayMs: 2000,
  maxDelayMs: 7000,
  burstMin: 3,
  burstMax: 7,
  burstPauseMinMs: 8000,
  burstPauseMaxMs: 25000,
  nightMultiplier: 2.5,
  cooldownSec: 60,
  detectSoftBlock: true,
};

test('computeNextDelay returns zero wait for first request and applies jitter on immediate follow-up', () => {
  const first = computeNextDelay(baseCfg, { burstCount: 0, burstLimit: 4, lastRequestAt: 0 }, 10000, 14, () => 0.5);
  assert.equal(first.waitMs, 0);
  assert.equal(first.isBurstPause, false);

  const second = computeNextDelay(baseCfg, first.nextState, 10500, 14, () => 0.5);
  assert.ok(second.waitMs >= 3000 && second.waitMs <= 5000);
  assert.equal(second.isNight, false);
});

test('computeNextDelay applies burst pause and deep-night multiplier between 1am and 6am', () => {
  const state = { burstCount: 3, burstLimit: 4, lastRequestAt: 10000 };
  const nightBurst = computeNextDelay(baseCfg, state, 10000, 3, () => 0);
  assert.equal(nightBurst.isBurstPause, true);
  assert.equal(nightBurst.isNight, true);
  assert.equal(nightBurst.waitMs, Math.round(8000 * 2.5));
  assert.equal(nightBurst.nextState.burstCount, 0);
});

test('detectSoftBlockText catches HTTP 200 refusal strings from Google risk-control waves', () => {
  assert.equal(detectSoftBlockText("I'm having a hard time fulfilling your request right now."), true);
  assert.equal(detectSoftBlockText('Sorry, something went wrong. Please try again.'), true);
  assert.equal(detectSoftBlockText('Here is your TypeScript function implementation.'), false);
});

test('CooldownTracker isolates per-model cooldowns while respecting global cooldown', () => {
  const tracker = new CooldownTracker();
  tracker.trigger('gemini-4-carbon', 60, 'HTTP 502', 1000);
  assert.equal(tracker.check('gemini-4-carbon', 5000).blocked, true);
  assert.equal(tracker.check('gemini-4-hydrogen', 5000).blocked, false);

  tracker.trigger('global', 30, 'HTTP 429', 5000);
  assert.equal(tracker.check('gemini-4-hydrogen', 10000).blocked, true);
  assert.equal(tracker.check('gemini-4-hydrogen', 40000).blocked, false);
});
