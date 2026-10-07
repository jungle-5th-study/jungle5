import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MarkdownRenderer from "./MarkdownRenderer";

function renderMd(source: string) {
  return render(<MarkdownRenderer source={source} />).container;
}

describe("MarkdownRenderer (TD-12, TD-18, C-09)", () => {
  it("never renders raw HTML such as <script>", () => {
    const c = renderMd('Hello <script>alert(1)</script>\n\n<img src="https://x.test/a.png" onerror="alert(1)">\n\n<b>bold</b>');
    expect(c.querySelector("script")).toBeNull();
    expect(c.querySelector("[onerror]")).toBeNull();
    expect(c.querySelector("b")).toBeNull();
    expect(c.innerHTML).not.toContain("alert(1)</script>");
  });

  it("drops javascript: and other non-http(s) links", () => {
    const c = renderMd(
      "[js](javascript:alert(1)) [js2](JAVASCRIPT:alert(1)) [data](data:text/html,hi) [mail](mailto:a@b.c) [rel](/x)",
    );
    for (const a of c.querySelectorAll("a")) {
      const href = a.getAttribute("href") ?? "";
      expect(href).toMatch(/^(https?:|#)/);
    }
    expect(c.innerHTML.toLowerCase()).not.toContain("javascript:");
    expect(c.innerHTML).not.toContain("data:text/html");
    expect(c.textContent).toContain("js");
  });

  it("adds target and rel to external links", () => {
    const c = renderMd("[ext](https://example.com/page) and https://example.org autolink");
    const links = c.querySelectorAll("a");
    expect(links.length).toBe(2);
    for (const a of links) {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", "noopener noreferrer nofollow");
    }
    expect(links[0]).toHaveAttribute("href", "https://example.com/page");
  });

  it("shows https images with no-referrer and lazy loading, drops other images", () => {
    const c = renderMd(
      "![ok](https://img.test/a.png) ![plain](http://img.test/b.png) ![rel](/c.png) ![js](javascript:alert(1)) ![data](data:image/png;base64,AAAA)",
    );
    const imgs = c.querySelectorAll("img");
    expect(imgs.length).toBe(1);
    expect(imgs[0]).toHaveAttribute("src", "https://img.test/a.png");
    expect(imgs[0]).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(imgs[0]).toHaveAttribute("loading", "lazy");
    expect(c.textContent).toContain("[이미지: plain]");
  });

  it("renders GFM (tables, task lists, strikethrough)", () => {
    const c = renderMd("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~");
    expect(c.querySelector("table")).not.toBeNull();
    expect(c.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(c.querySelector("del")).not.toBeNull();
  });
});
