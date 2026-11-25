import { expect, test } from 'bun:test';
import { server } from '../config';
import { capDecision, startOfLocalDay } from './caps';

const caps = { ownerTurns: 500, receptionistReplies: 200 };

test('below both caps is ok', () => {
  expect(
    capDecision({ counts: { ownerTurns: 499, receptionistReplies: 199 }, caps })
  ).toEqual({ status: 'ok' });
});

test('at or over a cap is exceeded, and the caps are independent', () => {
  expect(
    capDecision({ counts: { ownerTurns: 500, receptionistReplies: 0 }, caps })
  ).toEqual({ status: 'exceeded', cap: 'ownerTurns', count: 500, limit: 500 });
  expect(
    capDecision({ counts: { ownerTurns: 1, receptionistReplies: 250 }, caps })
  ).toEqual({
    status: 'exceeded',
    cap: 'receptionistReplies',
    count: 250,
    limit: 200,
  });
});

test('local midnight is computed in America/Chicago', () => {
  expect(
    startOfLocalDay({ now: new Date('2026-07-10T03:00:00Z') }).toISOString()
  ).toBe('2026-07-09T05:00:00.000Z');
  expect(
    startOfLocalDay({ now: new Date('2026-01-10T05:59:59Z') }).toISOString()
  ).toBe('2026-01-09T06:00:00.000Z');
  expect(
    startOfLocalDay({ now: new Date('2026-01-10T06:00:00Z') }).toISOString()
  ).toBe('2026-01-10T06:00:00.000Z');
});

test('midnight is right on the DST-change days', () => {
  expect(
    startOfLocalDay({ now: new Date('2026-03-08T20:00:00Z') }).toISOString()
  ).toBe('2026-03-08T06:00:00.000Z');
  expect(
    startOfLocalDay({ now: new Date('2026-03-09T01:00:00Z') }).toISOString()
  ).toBe('2026-03-08T06:00:00.000Z');
  expect(
    startOfLocalDay({ now: new Date('2026-11-01T20:00:00Z') }).toISOString()
  ).toBe('2026-11-01T05:00:00.000Z');
  expect(
    startOfLocalDay({ now: new Date('2026-11-02T05:30:00Z') }).toISOString()
  ).toBe('2026-11-01T05:00:00.000Z');
});

test('the HTTP server binds loopback only', () => {
  expect(server.host).toBe('127.0.0.1');
});
