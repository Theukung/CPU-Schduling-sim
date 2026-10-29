// test.js — assert-based self-check for the scheduling engine.
// Run: node test.js
const E = require('./engine.js');

let failures = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) { failures++; console.error('FAIL', msg, '\n  got     ', a, '\n  expected', b); }
}

const P = [
  { pid: 'P1', arrival: 0, burst: 7, priority: 2 },
  { pid: 'P2', arrival: 2, burst: 4, priority: 1 },
  { pid: 'P3', arrival: 4, burst: 1, priority: 3 },
  { pid: 'P4', arrival: 5, burst: 4, priority: 2 }
];
const base = { processes: P, quantum: 2, ctxSwitch: 0 };

// --- FCFS: classic Galvin example. Order P1(0-7) P2(7-11) P3(11-12) P4(12-16)
let r = E.simulate({ ...base, algorithm: 'fcfs' });
eq(r.segments.filter(s => s.kind === 'run').map(s => s.pid + ':' + s.start + '-' + s.end),
   ['P1:0-7', 'P2:7-11', 'P3:11-12', 'P4:12-16'], 'fcfs order');
eq(r.results.map(x => x.waiting), [0, 5, 7, 7], 'fcfs waiting');
eq(r.results.map(x => x.start), [0, 7, 11, 12], 'fcfs start times');
eq(Math.round(r.summary.avgWaiting * 100) / 100, 4.75, 'fcfs avg waiting');

// --- SJF (non-preemptive): P1 runs (only one ready at t=0), then P3(1), P2(4), P4(4)
r = E.simulate({ ...base, algorithm: 'sjf' });
eq(r.segments.filter(s => s.kind === 'run').map(s => s.pid + ':' + s.start + '-' + s.end),
   ['P1:0-7', 'P3:7-8', 'P2:8-12', 'P4:12-16'], 'sjf order');
eq(r.results.map(x => x.turnaround), [7, 10, 4, 11], 'sjf turnaround');

// --- SRTF: P2 preempts P1 at t=2; P3 preempts P2 at t=4; then P2 (rem 2),
// then P4 (rem 4 < P1 rem 5), then P1 to the end.
r = E.simulate({ ...base, algorithm: 'srtf' });
eq(r.segments.filter(s => s.kind === 'run').map(s => s.pid + ':' + s.start + '-' + s.end),
   ['P1:0-2', 'P2:2-4', 'P3:4-5', 'P2:5-7', 'P4:7-11', 'P1:11-16'], 'srtf order');
eq(r.summary.switches, 5, 'srtf switches');
eq(r.results.map(x => x.response), [0, 0, 0, 2], 'srtf response');

// --- RR q=2, no ctx cost. Hand-traced queue: after each slice, arrivals that
// landed during it enter ahead of the preempted job.
r = E.simulate({ ...base, algorithm: 'rr' });
eq(r.segments.filter(s => s.kind === 'run').map(s => s.pid + ':' + s.start + '-' + s.end),
   ['P1:0-2', 'P2:2-4', 'P1:4-6', 'P3:6-7', 'P2:7-9', 'P4:9-11', 'P1:11-13', 'P4:13-15', 'P1:15-16'], 'rr q2 order');
eq(r.summary.utilization, 1, 'rr utilization');

// --- RR idle gap: nothing ready at t=0
r = E.simulate({ processes: [{ pid: 'A', arrival: 3, burst: 2, priority: 1 }], algorithm: 'rr', quantum: 4, ctxSwitch: 0 });
eq(r.segments.map(s => s.kind + ':' + s.start + '-' + s.end), ['idle:0-3', 'run:3-5'], 'rr idle gap');
eq(r.results[0].waiting, 0, 'rr idle waiting');

// --- Priority preemptive: P2 (prio 1) preempts P1 at t=2; after P2, ties among
// prio-2 jobs break by arrival (P1 before P4); P3 (prio 3) runs last.
r = E.simulate({ ...base, algorithm: 'prio', preemptive: true });
eq(r.segments.filter(s => s.kind === 'run').map(s => s.pid + ':' + s.start + '-' + s.end),
   ['P1:0-2', 'P2:2-6', 'P1:6-11', 'P4:11-15', 'P3:15-16'], 'prio preemptive order');

// --- Priority non-preemptive: P1 finishes its burst, then P2, then P4 (prio 2,
// arrived earlier than P3? no — P3 arrived earlier but P4 has better prio; by prio then arrival)
r = E.simulate({ ...base, algorithm: 'prio', preemptive: false });
eq(r.segments.filter(s => s.kind === 'run').map(s => s.pid + ':' + s.start + '-' + s.end),
   ['P1:0-7', 'P2:7-11', 'P4:11-15', 'P3:15-16'], 'prio non-preemptive order');

// --- context switch cost: RR q=4 on two jobs; every handoff charges 1
r = E.simulate({ processes: [
    { pid: 'A', arrival: 0, burst: 5, priority: 1 },
    { pid: 'B', arrival: 0, burst: 3, priority: 1 }
  ], algorithm: 'rr', quantum: 4, ctxSwitch: 1 });
eq(r.segments.map(s => (s.pid || s.kind) + ':' + s.start + '-' + s.end),
   ['A:0-4', 'ctx:4-5', 'B:5-8', 'ctx:8-9', 'A:9-10'], 'ctx switch charging');
eq(r.summary.ctxTime, 2, 'ctx total');

// --- idle between runs is free (no ctx charge)
r = E.simulate({ processes: [
    { pid: 'A', arrival: 0, burst: 2, priority: 1 },
    { pid: 'B', arrival: 10, burst: 2, priority: 1 }
  ], algorithm: 'fcfs', ctxSwitch: 1 });
eq(r.segments.map(s => s.kind + ':' + s.start + '-' + s.end), ['run:0-2', 'idle:2-10', 'run:10-12'], 'idle not charged');

// --- ties: equal burst at same time -> arrival order, then input order
r = E.simulate({ processes: [
    { pid: 'X', arrival: 0, burst: 2, priority: 1 },
    { pid: 'Y', arrival: 0, burst: 2, priority: 1 }
  ], algorithm: 'sjf' });
eq(r.segments.filter(s => s.kind === 'run').map(s => s.pid), ['X', 'Y'], 'tie-break');

// --- compare() covers all six variants without throwing, with segments for the gantt view
const cmp = E.compare({ processes: P, quantum: 2, ctxSwitch: 0 });
eq(cmp.length, 6, 'compare variants');
eq(cmp.every(x => Array.isArray(x.segments) && x.segments.length > 0), true, 'compare segments');

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('all engine tests passed');
