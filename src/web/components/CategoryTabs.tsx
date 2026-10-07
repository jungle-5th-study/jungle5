// Category tabs for the knowledge list (UD-14): "전체 N" + top 6 + "더 보기 N ▾".
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import type { CategoryTab, CategoryTabsModel } from "../lib/categoryTabs";
import { ChevronDownIcon, SearchIcon } from "./icons";

export function CategoryTabs({
  model,
  selectedId,
  hrefFor,
  onSelect,
}: {
  model: CategoryTabsModel;
  selectedId: string | null;
  hrefFor: (id: string | null) => string;
  onSelect: (id: string) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const selectedRef = useRef<HTMLAnchorElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  // Fade whichever edge has more tabs behind it, so a cut label reads as "scroll for more".
  const updateFade = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const left = nav.scrollLeft > 1;
    const right = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1;
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    updateFade();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateFade);
    ro?.observe(nav);
    return () => ro?.disconnect();
  }, [updateFade, model]);

  // Keep the selected tab in view (horizontal only; never scrolls the page).
  useEffect(() => {
    const nav = navRef.current;
    const tab = selectedRef.current;
    if (!nav || !tab) return;
    const start = tab.offsetLeft;
    const end = start + tab.offsetWidth;
    if (start < nav.scrollLeft || end > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = Math.max(0, start - (nav.clientWidth - tab.offsetWidth) / 2);
      updateFade();
    }
  }, [selectedId, model, updateFade]);

  return (
    <div className="relative flex items-stretch border-b border-border">
      <nav
        ref={navRef}
        aria-label="카테고리"
        onScroll={updateFade}
        className={`tabs-scroll relative -mb-px flex min-w-0 flex-1 snap-x gap-1 overflow-x-auto overscroll-x-contain ${
          fade.left ? "tabs-fade-left" : ""
        } ${fade.right ? "tabs-fade-right" : ""}`}
      >
        {model.tabs.map((t) => {
          const current = t.id === selectedId;
          return (
            <Link
              key={t.id ?? "all"}
              ref={current ? selectedRef : undefined}
              to={hrefFor(t.id)}
              aria-current={current ? "page" : undefined}
              className={`flex h-11 shrink-0 snap-start items-center rounded-t-md border-b-2 px-3 text-[15px] whitespace-nowrap lg:h-10 ${
                current ? "border-accent font-semibold text-text" : "border-transparent text-muted hover:text-text"
              }`}
            >
              {t.name}
              <span className="ml-1 text-xs font-normal text-muted">{t.count}</span>
            </Link>
          );
        })}
      </nav>
      {model.more.length > 0 && <MoreCategories items={model.more} onSelect={onSelect} />}
    </div>
  );
}

/**
 * "더 보기 N ▾" popover with a search box and the remaining categories in the
 * same order. Keyboard: ↑/↓ move, Enter picks, Escape closes and returns focus
 * to the trigger.
 */
export function MoreCategories({ items, onSelect }: { items: CategoryTab[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = { pop: useId(), list: useId(), opt: useId() };

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((c) => c.name.toLowerCase().includes(q)) : items;
  const activeIndex = Math.min(active, Math.max(shown.length - 1, 0));

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
    triggerRef.current?.focus();
  };

  const pick = (id: string) => {
    close();
    onSelect(id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(shown.length ? (activeIndex + 1) % shown.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(shown.length ? (activeIndex - 1 + shown.length) % shown.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = shown[activeIndex];
      if (c?.id) pick(c.id);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? ids.pop : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-11 shrink-0 items-center gap-1 bg-bg pr-1 pl-3 text-[15px] font-semibold whitespace-nowrap text-text lg:h-10 lg:pr-3"
      >
        더 보기 {items.length}
        <ChevronDownIcon />
      </button>
      {open && (
        <div
          ref={popRef}
          id={ids.pop}
          role="dialog"
          aria-label="다른 카테고리"
          onKeyDown={onKeyDown}
          className="absolute top-full right-0 z-30 mt-1.5 flex w-[min(280px,calc(100vw-2rem))] flex-col gap-1 rounded-xl border border-border bg-bg p-2"
        >
          <label className="flex h-10 items-center gap-2 rounded-lg border border-border px-2.5 text-muted focus-within:outline-2 focus-within:outline-accent">
            <SearchIcon size={14} />
            <span className="sr-only">카테고리 검색</span>
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-expanded="true"
              aria-controls={ids.list}
              aria-autocomplete="list"
              aria-activedescendant={shown.length ? `${ids.opt}-${activeIndex}` : undefined}
              placeholder="카테고리 검색"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              className="min-w-0 flex-1 bg-transparent text-base text-text outline-none sm:text-sm"
            />
          </label>
          <ul id={ids.list} role="listbox" aria-label="카테고리" className="max-h-72 overflow-y-auto">
            {shown.map((c, i) => (
              <li
                key={c.id}
                id={`${ids.opt}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => c.id && pick(c.id)}
                onPointerMove={() => setActive(i)}
                className={`flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 text-[15px] text-text lg:min-h-[34px] ${
                  i === activeIndex ? "bg-surface" : ""
                }`}
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-xs text-muted">글 {c.count}</span>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="px-2.5 py-2 text-sm text-muted">일치하는 카테고리가 없습니다</p>}
          <p className="border-t border-border px-2.5 pt-1.5 text-xs text-muted">탭과 목록은 글이 많은 순서예요</p>
        </div>
      )}
    </>
  );
}
