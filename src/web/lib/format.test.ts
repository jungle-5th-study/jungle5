import { describe, expect, it } from "vitest";
import { formatWeekRange, plainExcerpt } from "./format";

// Instants in KST (UTC+9).
const kst = (iso: string) => Date.parse(`${iso}+09:00`);

describe("formatWeekRange (Monday–Sunday, KST)", () => {
  it("a Monday starts its own week", () => {
    expect(formatWeekRange(kst("2026-10-05T00:00:00"))).toBe("10월 5일 – 10월 11일");
    expect(formatWeekRange(kst("2026-10-12T09:00:00"))).toBe("10월 12일 – 10월 18일");
  });

  it("a Sunday belongs to the week that started the Monday before", () => {
    expect(formatWeekRange(kst("2026-10-11T23:59:00"))).toBe("10월 5일 – 10월 11일");
    expect(formatWeekRange(kst("2026-10-04T12:00:00"))).toBe("9월 28일 – 10월 4일");
  });

  it("midweek (Wed 2026-10-07) and the UTC/KST day boundary", () => {
    expect(formatWeekRange(kst("2026-10-07T10:00:00"))).toBe("10월 5일 – 10월 11일");
    // Sunday 23:30 UTC is already Monday 08:30 in KST.
    expect(formatWeekRange(Date.parse("2026-10-11T23:30:00Z"))).toBe("10월 12일 – 10월 18일");
  });

  it("crosses month and year ends", () => {
    expect(formatWeekRange(kst("2026-12-31T12:00:00"))).toBe("12월 28일 – 1월 3일");
  });
});

describe("plainExcerpt", () => {
  it("keeps link and image text, drops Markdown syntax", () => {
    expect(
      plainExcerpt("Discord에서 올린 HTML입니다. [원래 메시지](https://discord.com/channels/1/2/3)"),
    ).toBe("Discord에서 올린 HTML입니다. 원래 메시지");
    expect(plainExcerpt("## 핵심\n\n- **키 범위** 파티셔닝\n- `해시` ![도식](a.png)")).toBe("핵심 키 범위 파티셔닝 해시 도식");
    expect(plainExcerpt("> 인용\n\n| a | b |\n|---|---|\n| 1 | 2 |")).toBe("인용 a b 1 2");
  });

  it("shortens bare long URLs and handles a cut-off link at the 200-char boundary", () => {
    expect(plainExcerpt("참고 https://example.com/a/very/long/path/that/keeps/going/on")).toBe(
      "참고 https://example.com/a/very/long/path/…",
    );
    expect(plainExcerpt("끝 [원래 메시지](https://disc")).toBe("끝 원래 메시지");
  });
});
