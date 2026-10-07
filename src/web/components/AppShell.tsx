// App layout (docs/ui.md 4): fixed sidebar on desktop (≥1024px), top bar +
// drawer + floating write button on mobile. Sidebar and drawer share NavContent.
import { useQuery } from "@tanstack/react-query";
import {
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import type { Me } from "../../shared/api";
import { LIMITS } from "../../shared/constants";
import { preloadEditor } from "../lazyPages";
import { api, queryKeys } from "../lib/endpoints";
import { SessionContext } from "../lib/session";
import { useLogout } from "../lib/useLeave";
import { CloseIcon, MenuIcon, PlusIcon, SearchIcon } from "./icons";
import { preloadMarkdown } from "./Markdown";
import { ThemeToggle } from "./ThemeToggle";
import { ToastProvider } from "./toast";
import { Avatar, btn, ErrorState, focusables, SkeletonList, Spinner, trapTab } from "./ui";

/** Scroll to the top on route changes (no inline-script ScrollRestoration under the CSP). */
function useScrollTopOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [pathname]);
}

export function Wordmark({ className = "text-xl" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-[-0.02em] text-text ${className}`}>
      정글
      <span aria-hidden className="wordmark-dot" />5
    </span>
  );
}

/** Current item: bg + 3px accent bar on the left (docs/ui.md 4.1). */
const currentBar =
  "bg-bg font-semibold text-text before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-l-md before:bg-accent";

const navItem = ({ isActive }: { isActive: boolean }) =>
  `relative flex h-11 items-center rounded-md px-3 text-[15px] lg:h-9 ${
    isActive ? currentBar : "text-muted hover:bg-bg hover:text-text"
  }`;

const studyItem = ({ isActive }: { isActive: boolean }) =>
  `relative flex h-10 items-center gap-2 rounded-md pr-3 pl-7 text-sm lg:h-8 ${
    isActive ? currentBar : "text-text hover:bg-bg"
  }`;

/** Menu: 홈 / 지식 / 스터디 + my active studies under 스터디 (UD-13). No categories. */
function NavContent({ me, onNavigate }: { me: Me | undefined; onNavigate?: () => void }) {
  const studies = (me?.studies ?? []).filter((s) => s.status === "active");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <Link to="/" aria-label="정글5 홈" className="rounded px-3 py-1" onClick={onNavigate}>
        <Wordmark />
      </Link>
      <nav aria-label="주요 메뉴" className="flex flex-col gap-0.5">
        <NavLink to="/" end className={navItem} onClick={onNavigate}>
          홈
        </NavLink>
        <NavLink to="/posts" className={navItem} onClick={onNavigate}>
          지식
        </NavLink>
        <NavLink to="/studies" end className={navItem} onClick={onNavigate}>
          스터디
        </NavLink>
        {studies.length > 0 && (
          <ul aria-label="내 스터디" className="flex flex-col gap-0.5">
            {studies.map((s) => (
              <li key={s.id}>
                <NavLink to={`/studies/${s.id}`} className={studyItem} onClick={onNavigate}>
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
                  <span className="truncate">{s.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="flex-1" />
      <Link to="/posts/new" className={`${btn.primary} h-11`} onClick={onNavigate}>
        <PlusIcon />
        글쓰기
      </Link>
    </div>
  );
}

/** Top-bar search: goes to the knowledge list with ?q= (keeps the list's other filters). */
function SearchBox({ inputRef, onDone }: { inputRef: RefObject<HTMLInputElement | null>; onDone?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const onList = location.pathname === "/posts";
  const urlQ = onList ? (new URLSearchParams(location.search).get("q") ?? "") : "";
  const [value, setValue] = useState(urlQ);
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);
  if (urlQ !== prevUrlQ) {
    setPrevUrlQ(urlQ);
    setValue(urlQ);
  }
  const hintId = useId();
  const [invalid, setInvalid] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q.length > 0 && q.length < LIMITS.searchMin) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const params = new URLSearchParams(onList ? location.search : "");
    if (q) params.set("q", q);
    else params.delete("q");
    const qs = params.toString();
    void navigate(`/posts${qs ? `?${qs}` : ""}`);
    onDone?.();
  };

  return (
    <form role="search" onSubmit={onSubmit} className="relative w-full max-w-[480px]">
      <label className="flex h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent lg:h-[38px]">
        <SearchIcon size={16} />
        <span className="sr-only">지식 검색</span>
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          placeholder="지식 검색"
          className="min-w-0 flex-1 bg-transparent text-base text-text outline-none lg:text-[15px]"
          value={value}
          maxLength={LIMITS.searchMax}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? hintId : undefined}
        />
        <kbd aria-hidden className="hidden rounded border border-border px-1.5 text-xs lg:inline">
          /
        </kbd>
      </label>
      {invalid && (
        <p id={hintId} role="alert" className="absolute top-full left-0 mt-1 rounded-md border border-border bg-bg px-2 py-1 text-xs text-danger">
          검색어는 {LIMITS.searchMin}자 이상 입력하세요
        </p>
      )}
    </form>
  );
}

/** Avatar button + menu: 내 정보, 카테고리 관리 (admin), 로그아웃. */
function AvatarMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const logout = useLogout(me.id);

  useEffect(() => {
    if (!open) return;
    focusables(menuRef.current!)[0]?.focus();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKey = (e: ReactKeyboardEvent) => {
    const items = focusables(menuRef.current!);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const item = "flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm text-text hover:bg-surface lg:min-h-9";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex size-11 items-center justify-center rounded-full lg:size-10"
        aria-label="내 계정 메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Avatar name={me.displayName} url={me.avatarUrl} size="md" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="내 계정"
          onKeyDown={onMenuKey}
          className="absolute top-full right-0 z-50 mt-2 w-56 rounded-xl border border-border bg-bg p-1.5"
        >
          <p className="truncate px-3 py-2 text-sm font-semibold text-text" role="presentation">
            {me.displayName ?? "(이름 없음)"}
            <span className="block text-xs font-normal text-muted">{me.isAdmin ? "운영자" : "커뮤니티 멤버"}</span>
          </p>
          <div role="separator" className="my-1 border-t border-border" />
          <Link role="menuitem" to="/me" className={item} onClick={() => close(false)}>
            내 정보
          </Link>
          {me.isAdmin && (
            <Link role="menuitem" to="/admin/categories" className={item} onClick={() => close(false)}>
              카테고리 관리
            </Link>
          )}
          <button
            role="menuitem"
            type="button"
            className={item}
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            {logout.isPending ? "로그아웃 중…" : "로그아웃"}
          </button>
          {logout.isError && (
            <p role="alert" className="px-3 py-1 text-xs text-danger">
              로그아웃하지 못했습니다. 다시 시도하세요.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Left drawer for <1024px: ESC / outside click close, focus trapped, focus returns to the menu button. */
export function MobileDrawer({
  open,
  onClose,
  me,
  id,
}: {
  open: boolean;
  onClose: () => void;
  me: Me | undefined;
  id: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    const prevOverflow = document.body.classList.contains("overflow-hidden");
    document.body.classList.add("overflow-hidden");
    return () => {
      if (!prevOverflow) document.body.classList.remove("overflow-hidden");
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-scrim" data-testid="drawer-scrim" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label="메뉴"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          } else if (panel.current) trapTab(e, panel.current);
        }}
        className="anim-drawer absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col border-r border-border bg-surface px-3 pt-3 pb-5 outline-none"
      >
        <div className="mb-2 flex justify-end gap-1">
          <ThemeToggle />
          <button type="button" className={btn.icon} aria-label="메뉴 닫기" onClick={onClose}>
            <CloseIcon size={20} />
          </button>
        </div>
        <NavContent me={me} onNavigate={onClose} />
      </div>
    </div>
  );
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

export function AppShell() {
  useScrollTopOnNavigate();
  useEffect(() => {
    const t = setTimeout(() => {
      preloadMarkdown();
      preloadEditor();
    }, 1000);
    return () => clearTimeout(t);
  }, []);
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, staleTime: 5 * 60_000 });
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const drawerId = useId();
  const desktopSearch = useRef<HTMLInputElement>(null);
  const mobileSearchInput = useRef<HTMLInputElement>(null);

  // Close the drawer / mobile search on navigation.
  const [prevPath, setPrevPath] = useState(location.pathname);
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname);
    setDrawerOpen(false);
  }

  // "/" focuses the search (the only shortcut, docs/ui.md 8).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      if (window.matchMedia?.("(min-width: 1024px)").matches) desktopSearch.current?.focus();
      else if (mobileSearchInput.current) mobileSearchInput.current.focus();
      else setMobileSearch(true); // focused by the effect below once rendered
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (mobileSearch) mobileSearchInput.current?.focus();
  }, [mobileSearch]);

  // Forms have their own sticky action bar; no floating write button there.
  const onEditor = /\/(new|edit)$/.test(location.pathname);

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-bg text-text">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:border focus:border-border focus:bg-bg focus:p-2"
        >
          본문으로 건너뛰기
        </a>

        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface px-3 pt-5 pb-5 lg:flex">
          <NavContent me={me.data} />
        </aside>

        <div className="lg:pl-60">
          <header className="sticky top-0 z-40 border-b border-border bg-bg">
            {/* Desktop top bar */}
            <div className="hidden h-16 items-center gap-3 px-8 lg:flex">
              <SearchBox inputRef={desktopSearch} />
              <div className="flex-1" />
              <ThemeToggle />
              {me.data && <AvatarMenu me={me.data} />}
            </div>
            {/* Mobile top bar */}
            <div className="flex h-14 items-center gap-1 px-2 lg:hidden">
              <button
                type="button"
                className={btn.icon.replace("text-muted", "text-text")}
                aria-label="메뉴 열기"
                aria-expanded={drawerOpen}
                aria-controls={drawerOpen ? drawerId : undefined}
                onClick={() => setDrawerOpen(true)}
              >
                <MenuIcon />
              </button>
              <Link to="/" aria-label="정글5 홈" className="rounded px-1">
                <Wordmark className="text-lg" />
              </Link>
              <div className="flex-1" />
              <button
                type="button"
                className={btn.icon}
                aria-label={mobileSearch ? "검색 닫기" : "검색"}
                aria-expanded={mobileSearch}
                onClick={() => setMobileSearch((s) => !s)}
              >
                {mobileSearch ? <CloseIcon size={20} /> : <SearchIcon size={20} />}
              </button>
              {me.data && <AvatarMenu me={me.data} />}
            </div>
            {mobileSearch && (
              <div className="border-t border-border px-4 py-2 lg:hidden">
                <SearchBox inputRef={mobileSearchInput} onDone={() => setMobileSearch(false)} />
              </div>
            )}
          </header>

          <MobileDrawer id={drawerId} open={drawerOpen} onClose={() => setDrawerOpen(false)} me={me.data} />

          <main id="main" tabIndex={-1} className="mx-auto max-w-3xl has-[[data-wide]]:max-w-[1024px] px-4 pt-6 pb-28 outline-none lg:px-8 lg:pt-10 lg:pb-16">
            {me.isPending ? (
              <div className="py-10 text-center">
                <Spinner />
              </div>
            ) : me.isError ? (
              // 401 is handled globally (redirect to /login); show anything else.
              <ErrorState what="내 정보를 불러오지 못했습니다." error={me.error} onRetry={() => void me.refetch()} />
            ) : (
              <SessionContext.Provider value={me.data}>
                <Suspense fallback={<SkeletonList rows={3} />}>
                  <Outlet />
                </Suspense>
              </SessionContext.Provider>
            )}
          </main>

          {!onEditor && (
            <Link
              to="/posts/new"
              aria-label="글쓰기"
              className="fixed right-4 bottom-6 z-30 inline-flex size-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-fab hover:bg-primary-hover lg:hidden"
            >
              <PlusIcon size={24} />
            </Link>
          )}
        </div>
      </div>
    </ToastProvider>
  );
}
