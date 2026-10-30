import type { Redis } from "ioredis";

export const HOUR_MS = 3600000;
export function hourlyWindow(now: Date) {
  const start = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  return { start: new Date(start), end: new Date(start + HOUR_MS) };
}
export const gateKey = (namespace: string, identity: string) =>
  `${namespace}:${identity}`;

const reserveScript = `
local owner = redis.call('GET', KEYS[1])
if owner and owner ~= ARGV[1] then return {0, tonumber(ARGV[2]) + math.max(1, redis.call('PTTL', KEYS[1])), 'SENDER_BUSY', 0, 0} end
local now = tonumber(ARGV[2])
local nextAt = math.max(tonumber(redis.call('GET', KEYS[2]) or '0'), tonumber(ARGV[7]))
local senderUsed = math.max(tonumber(redis.call('GET', KEYS[3]) or '0'), tonumber(ARGV[5]))
local batchUsed = math.max(tonumber(redis.call('GET', KEYS[4]) or '0'), tonumber(ARGV[6]))
if senderUsed >= tonumber(ARGV[8]) then return {0, tonumber(ARGV[10]), 'SENDER_HOURLY_LIMIT', senderUsed, batchUsed} end
if batchUsed >= tonumber(ARGV[9]) then return {0, tonumber(ARGV[10]), 'BATCH_HOURLY_LIMIT', senderUsed, batchUsed} end
if nextAt > now then return {0, nextAt, 'SENDER_SPACING', senderUsed, batchUsed} end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
redis.call('SET', KEYS[2], now + tonumber(ARGV[4]), 'PX', 604800000)
redis.call('SET', KEYS[3], senderUsed + 1, 'PX', math.max(1, tonumber(ARGV[10]) - now + 3600000))
redis.call('SET', KEYS[4], batchUsed + 1, 'PX', math.max(1, tonumber(ARGV[10]) - now + 3600000))
return {1, now, '', senderUsed + 1, batchUsed + 1}
`;
const releaseScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

export type Reservation = {
  now: Date;
  namespace: string;
  identity: string;
  batchId: string;
  token: string;
  leaseMs: number;
  spacingMs: number;
  senderUsed: number;
  batchUsed: number;
  nextAllowedAt: Date;
  senderLimit: number;
  batchLimit: number;
};
export function createSenderGate(redis: Redis) {
  return {
    async reserve(input: Reservation) {
      const root = `${input.namespace}:sender:{${input.identity}}`,
        window = hourlyWindow(input.now);
      const result = (await redis.eval(
        reserveScript,
        4,
        `${root}:lease`,
        `${root}:next`,
        `${root}:hour:${window.start.getTime()}`,
        `${root}:batch:${input.batchId}:hour:${window.start.getTime()}`,
        input.token,
        input.now.getTime(),
        input.leaseMs,
        input.spacingMs,
        input.senderUsed,
        input.batchUsed,
        input.nextAllowedAt.getTime(),
        input.senderLimit,
        input.batchLimit,
        window.end.getTime(),
      )) as [number, number, string, number, number];
      return {
        allowed: result[0] === 1,
        eligibleAt: new Date(result[1]),
        reason: result[2],
        senderUsed: result[3],
        batchUsed: result[4],
      };
    },
    async release(namespace: string, identity: string, token: string) {
      await redis.eval(
        releaseScript,
        1,
        `${namespace}:sender:{${identity}}:lease`,
        token,
      );
    },
  };
}
export type SenderGate = ReturnType<typeof createSenderGate>;
