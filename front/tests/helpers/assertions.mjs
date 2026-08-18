import assert from "node:assert/strict";
import { expect } from "vitest";

export const equal = (...cases) =>
  cases.forEach(([actual, expected]) => assert.equal(actual, expected));
export const deepEqual = (...cases) =>
  cases.forEach(([actual, expected]) => assert.deepEqual(actual, expected));
export const same = (...cases) =>
  cases.forEach(([actual, expected]) => expect(actual).toBe(expected));
export const sameDeep = (...cases) =>
  cases.forEach(([actual, expected]) => expect(actual).toEqual(expected));
export const called = (...mocks) => mocks.forEach((mock) => expect(mock).toHaveBeenCalled());
export const notCalled = (...mocks) => mocks.forEach((mock) => expect(mock).not.toHaveBeenCalled());
export const calledTimes = (...cases) =>
  cases.forEach(([mock, times]) => expect(mock).toHaveBeenCalledTimes(times));
export const calledWith = (...cases) =>
  cases.forEach(([mock, args]) => expect(mock).toHaveBeenCalledWith(...args));
export const verify = (...cases) =>
  cases.forEach(([actual, matcher, ...args]) => {
    const negated = matcher.startsWith("not.");
    const name = negated ? matcher.slice(4) : matcher;
    (negated ? expect(actual).not : expect(actual))[name](...args);
  });
