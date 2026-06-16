# LottaCash Accessibility Audit
**Date:** May 2026  
**Method:** Manual code review + static analysis (axe-core patterns)  
**Pages audited:** Home, Originals (game grid + individual games), Wallet/Deposit/Withdraw, Auth (Login/Signup), Case Battles room

---

## ✅ Fixed in This Pass

### 1. Auth inputs — missing `focus-visible` ring (Auth.css)
**Issue:** `.auth-field input:focus` suppressed the browser outline with `outline: none` but didn't restore a custom ring for keyboard users. Keyboard navigation would have shown no visible focus indicator on all login/signup fields.  
**Fix:** Added `.auth-field input:focus-visible { box-shadow: var(--lc-focus-ring) }` to restore the gold ring specifically for keyboard users without affecting pointer users.

### 2. Auth submit button — no keyboard focus ring
**Issue:** `.auth-submit` had no `:focus-visible` style. Tab → Enter flows had an invisible button focus state.  
**Fix:** Added `.auth-submit:focus-visible { box-shadow: var(--lc-focus-ring) }`.

### 3. Toast region — `aria-live` missing at region level
**Issue:** New implementation addressed directly — each toast carries `role="status"` with `aria-live="polite"` and errors use `aria-live="assertive"` per WCAG 4.1.3.

### 4. Route transition animations — no `prefers-reduced-motion` guard  
**Issue:** New page transitions could cause motion sickness for users with vestibular disorders.  
**Fix:** PageTransition.css includes `@media (prefers-reduced-motion: reduce) { animation: none }` on all transition classes.

---

## ⚠️ Remaining Issues — Requires Manual QA

### HIGH — Contrast

| Location | Element | Issue |
|---|---|---|
| Global | `--lc-text-muted` (#71717a on #07080c) | Fails WCAG AA for normal text (3.8:1, needs 4.5:1). Used as hint/label text in many places. |
| Topbar | Balance display in secondary color | Verify contrast ratio against topbar background. |
| Wallet | `.wallet__status` badge colors | `status--confirmed`, `status--pending`, `status--failed` — verify all three meet 3:1 minimum for UI components. |
| Game controls | Disabled bet buttons | Opacity 0.5 on already-dim text may drop below 3:1. |

**Recommended fix:** Bump `--lc-text-muted` to `#8a8a94` (approx 4.6:1 on dark bg) and re-test hint/label readability.

---

### HIGH — Missing Labels

| Location | Element | Issue |
|---|---|---|
| Topbar search | `<input>` search box | Visually clear, but verify `aria-label` or `<label>` is programmatically associated (not just placeholder). |
| Topbar | Notification bell button | Confirm `aria-label="Notifications"` and that unread count is announced (e.g. `aria-label="Notifications, 3 unread"`). |
| Topbar | Mobile hamburger button | Confirm `aria-label="Open menu"` / `aria-expanded` state toggle. |
| Case Battles | Case reel items | Spinning reel items should have `aria-hidden="true"` since they're decorative during spin; final result should be announced to screen readers. |
| Keno | Grid cells (number buttons) | Verify each number button has `aria-pressed` state reflecting selected/unselected. |
| Mines | Board cells | Each cell needs `aria-label` like "Cell 3, unrevealed" and `aria-live` on the result region. |
| Blackjack | Card elements | Decorative card art should be `aria-hidden`; hand value should be in an accessible text element. |

---

### MEDIUM — Focus Management

| Location | Issue |
|---|---|
| Auth pages | After successful login, focus is not explicitly managed — lands wherever the browser decides after navigation. Consider focusing the `<h1>` of the landing page. |
| Case Battles room | When battle starts (lobby → active), focus may be lost in the DOM transition. Should move to the arena container or a live announcement. |
| Wallet chain picker | Tab order through chain buttons followed by address box — verify logical DOM order matches visual order. |
| Sidebar (mobile) | When mobile drawer opens (`app-shell--sidebar-open`), confirm focus is trapped inside the drawer and returned to the trigger on close. |
| Modals / panels (NotificationsPanel, CasePickerModal) | Verify focus trap is implemented: focus should not escape panel; Escape key should close. |

---

### MEDIUM — Keyboard Navigation

| Location | Issue |
|---|---|
| `LcSelect` custom dropdown | Requires full keyboard support: Arrow Up/Down to navigate options, Enter to select, Escape to close, Home/End for first/last. Audit against ARIA Combobox pattern. |
| Originals game grid | "Coming soon" spans (`originals__card-btn--disabled`) are non-interactive spans — they should either be `aria-disabled` buttons or removed from tab order. Currently unreachable by keyboard. |
| Roulette bet grid | Bet cells must be reachable and activatable by keyboard. |
| Case Battles — case picker modal | Verify all case cards can be tabbed to and selected without a pointer. |

---

### LOW — ARIA Issues

| Location | Issue |
|---|---|
| `Sidebar` nav | Ensure `<nav>` landmark has `aria-label="Main navigation"` to distinguish from other nav landmarks. |
| `NotificationsPanel` | Panel should have `role="dialog"` or `role="region"` with a label, and close button should be the first focusable element or clearly labeled. |
| Loading spinners (`.lc-loading__pulse`) | Confirm all loading states have an adjacent visually-hidden text description (e.g. "Loading…") for screen readers, or `role="status"` on the container. Most do — audit for any gaps. |
| `<article>` game cards (Originals grid) | Articles need an accessible name — confirm `<h2>` inside each card is properly associated. ✅ Looks correct currently. |
| Page `<title>` updates | Single-page apps require dynamic `<title>` updates on route change for screen reader users. No `document.title` updates found. Add per-page title management (e.g. via a `usePageTitle` hook or `react-helmet-async`). |

---

## Summary Matrix

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | — |
| High | ~8 items | Manual QA needed |
| Medium | ~7 items | Manual QA needed |
| Low | ~5 items | Manual QA needed |
| Fixed in this pass | 4 | ✅ Done |

---

## Recommended Next Steps

1. **Install `react-helmet-async`** and add `<Helmet><title>Page Name — LottaCash</title></Helmet>` to each page component. This is a 30-minute fix with high screen reader impact.
2. **Run axe-core in dev** — add `@axe-core/react` to `main.tsx` (dev-only) to catch violations automatically during development.
3. **Audit `LcSelect`** against ARIA Combobox pattern — this is used in several game controls and is the highest-risk custom component.
4. **Add `aria-live="polite"` result regions** to Mines, Keno, Blackjack, and Roulette so screen reader users hear game outcomes.
5. **Focus trap audit** — use a tool like `focus-trap-react` for the mobile sidebar and any modals.
