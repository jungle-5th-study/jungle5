import { describe, expect, it } from "vitest";
import type { Round } from "../../shared/api";
import { roundToValues, valuesToRoundFields, type RoundFormValues } from "./RoundFormPage";

const v = (over: Partial<RoundFormValues>): RoundFormValues => ({
  title: "t",
  goal: "g",
  scope: "s",
  periodStart: "",
  periodEnd: "",
  meetingDate: "",
  meetingTime: "",
  location: "",
  materials: "",
  ...over,
});

describe("round form values (KST)", () => {
  it("turns a KST date + time into meetingAt epoch ms", () => {
    const { fields, errors } = valuesToRoundFields(v({ meetingDate: "2026-10-09", meetingTime: "00:30" }));
    expect(errors).toEqual({});
    expect(fields.meetingAt).toBe(Date.parse("2026-10-08T15:30:00Z"));
  });

  it("requires both date and time, and clears empty optionals to null", () => {
    expect(valuesToRoundFields(v({ meetingDate: "2026-10-09" })).errors.meetingAt).toBeDefined();
    const { fields } = valuesToRoundFields(v({ location: "  ", materials: "" }));
    expect(fields).toMatchObject({ meetingAt: null, location: null, materials: null, periodStart: null, periodEnd: null });
  });

  it("round-trips a stored round through the form", () => {
    const round = {
      title: "t",
      goal: "g",
      scope: "s",
      periodStart: "2026-10-03",
      periodEnd: "2026-10-09",
      meetingAt: Date.parse("2026-10-08T15:00:00Z"), // 10/9 00:00 KST
      location: "강남",
      materials: null,
    } as Round;
    const values = roundToValues(round);
    expect(values).toMatchObject({ meetingDate: "2026-10-09", meetingTime: "00:00", periodStart: "2026-10-03" });
    expect(valuesToRoundFields(values).fields).toMatchObject({
      meetingAt: round.meetingAt,
      periodStart: "2026-10-03",
      periodEnd: "2026-10-09",
      location: "강남",
      materials: null,
    });
  });
});
