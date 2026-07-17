import assert from "node:assert/strict";
import test from "node:test";
import {
  areWeeklyAvailabilityTimeInputsDisabled,
  createWeeklyAvailabilityRule,
  getWeeklyAvailabilityRuleLabel,
  isWeeklyAvailabilityAllDayDisabled,
  serializeWeeklyAvailabilityRuleForSave,
  toggleWeeklyAvailabilityAllDay
} from "../lib/availability-weekly-rules";

test("normal hours stay timed and save the entered range", () => {
  const rule = createWeeklyAvailabilityRule({
    dayOfWeek: 2,
    label: "Tuesday",
    enabled: true,
    startTime: "09:00",
    endTime: "18:00",
    allDay: false
  });

  assert.equal(getWeeklyAvailabilityRuleLabel(rule), "09:00 - 18:00");
  assert.equal(areWeeklyAvailabilityTimeInputsDisabled(rule), false);
  assert.deepEqual(serializeWeeklyAvailabilityRuleForSave(rule), {
    dayOfWeek: 2,
    enabled: true,
    allDay: false,
    startTime: "09:00",
    endTime: "18:00"
  });
});

test("all-day availability disables timed entry and saves the all-day flag", () => {
  const rule = createWeeklyAvailabilityRule({
    dayOfWeek: 3,
    label: "Wednesday",
    enabled: true,
    startTime: "10:00",
    endTime: "16:00",
    allDay: true
  });

  assert.equal(getWeeklyAvailabilityRuleLabel(rule), "All day");
  assert.equal(areWeeklyAvailabilityTimeInputsDisabled(rule), true);
  assert.deepEqual(serializeWeeklyAvailabilityRuleForSave(rule), {
    dayOfWeek: 3,
    enabled: true,
    allDay: true,
    startTime: "10:00",
    endTime: "16:00"
  });
});

test("disabled days stay out of the working schedule controls", () => {
  const rule = createWeeklyAvailabilityRule({
    dayOfWeek: 0,
    label: "Sunday",
    enabled: false,
    startTime: "09:00",
    endTime: "18:00",
    allDay: true
  });

  assert.equal(getWeeklyAvailabilityRuleLabel(rule), "Off day");
  assert.equal(areWeeklyAvailabilityTimeInputsDisabled(rule), true);
  assert.equal(isWeeklyAvailabilityAllDayDisabled(rule), true);
});

test("loading saved all-day values preserves the backend flag and stored times", () => {
  const rule = createWeeklyAvailabilityRule({
    dayOfWeek: 4,
    label: "Thursday",
    enabled: true,
    startTime: "08:30",
    endTime: "17:30",
    allDay: true
  });

  assert.equal(rule.allDay, true);
  assert.equal(rule.startTime, "08:30");
  assert.equal(rule.endTime, "17:30");
});

test("switching between all-day and timed availability preserves the previous times", () => {
  const original = createWeeklyAvailabilityRule({
    dayOfWeek: 5,
    label: "Friday",
    enabled: true,
    startTime: "11:00",
    endTime: "19:00",
    allDay: false
  });

  const allDay = toggleWeeklyAvailabilityAllDay(original, true);
  const restored = toggleWeeklyAvailabilityAllDay(allDay, false);

  assert.equal(allDay.allDay, true);
  assert.equal(allDay.startTime, "11:00");
  assert.equal(allDay.endTime, "19:00");
  assert.equal(restored.allDay, false);
  assert.equal(restored.startTime, "11:00");
  assert.equal(restored.endTime, "19:00");
});
