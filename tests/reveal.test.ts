import test from 'node:test';
import assert from 'node:assert/strict';
import {createRevealController,REVEAL_DURATION_MS} from '../lib/reveal.ts';
test('envelope finishes once after the complete letter reveal, ignoring repeated taps',t=>{t.mock.timers.enable({apis:['setTimeout']});let count=0;const c=createRevealController(()=>count++);c.start();c.start();t.mock.timers.tick(REVEAL_DURATION_MS-1);assert.equal(count,0);t.mock.timers.tick(1);assert.equal(count,1);c.dispose();});
test('skip cancels the pending reveal callback instead of opening the gift twice',t=>{t.mock.timers.enable({apis:['setTimeout']});let count=0;const c=createRevealController(()=>count++);c.start();t.mock.timers.tick(400);c.skip();assert.equal(count,1);t.mock.timers.tick(2000);assert.equal(count,1);});
test('reduced motion opens immediately, and leaving the view cancels an unfinished sequence',t=>{t.mock.timers.enable({apis:['setTimeout']});let count=0;const c=createRevealController(()=>count++);c.start(true);assert.equal(count,1);c.start();c.dispose();t.mock.timers.tick(2000);assert.equal(count,1);});
