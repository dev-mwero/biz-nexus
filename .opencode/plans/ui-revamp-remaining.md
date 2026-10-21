# UI Revamp - Remaining Work Plan

**Created:** 2026-10-21  
**Status:** In Progress  
**Branch:** feat/stage-2-sales

## Overview
This plan tracks remaining work from the comprehensive UI/UX redesign. Items completed in previous commits (5923cbf, 986a437, 90c7cbc, abc08bd):
- ✅ Shell layout & sidebar positioning
- ✅ Dark/light mode toggle in header  
- ✅ Design tokens (control-border, brand, nav-active)
- ✅ Focus states updated to use info color
- ✅ Sidebar active state accent bar
- ✅ Partial dead class cleanup

## P0 - Critical (Blocking/A11y/Data Issues) - COMPLETE

### 1. Token Contrast Failures (WCAG 1.4.3) ✅
**Files:** `src/app/globals.css`

| Pair | Was | Now |
|------|-----|-----|
| `--bn-attention` on `--bn-attention-surface` | 3.76:1 | `#965709` (5.10:1) |
| `--bn-attention` on `--bn-canvas` | 3.91:1 | `#965709` |
| `--bn-ink-400` on `--bn-canvas` | 4.36:1 | `#666f7e` (4.69:1) |
| `--bn-attention-border` | too light | darkened in both modes |

**Done:** `--bn-attention` (light `#965709`, dark `#f59e0b`), `--bn-attention-border`, `--bn-ink-400`. Attention badges inherit the fix; no per-component overrides.

### 2. Mobile Drawer Not a Proper Dialog ✅
**Files:** `src/components/app-shell/sidebar.tsx`, `index.tsx`, `header.tsx`

**Done:**
- `role="dialog"` + `aria-modal` while overlaying (gated on `isCompact && isOpen`, so the desktop sidebar is not a modal)
- Focus trap over the drawer's focusable elements
- Escape closes, overlay click closes, body scroll locked
- Closed drawer is `inert` below `lg` — a transform does not remove it from the tab order
- Focus returns to the element that opened the drawer
- `SidebarTrigger` wired into the header with a truthful `aria-expanded`
- Covered by `tests/components/sidebar.test.tsx`

### 3. ListPage Has No Error State ✅
**Files:** `src/components/records/ListPage.tsx`

**Done:** dedicated error state with `role="alert"` and a "Try again" that re-runs the request. A failed request no longer renders "No records found". Covered in `tests/components/list-page.test.tsx`.

### 4. Dead Shadcn Classes Still Rendering as No-Ops ✅
**Files:** Multiple

**Done:** `bg-muted`, `text-foreground`, `bg-background`, `text-primary`, `bg-primary*`, `ring-primary`, `border-primary`, `text-muted-foreground`, `text-red-600`, `bg-red-50`, `text-blue-600`, `border-gray-300`, `ring-blue-500` eliminated repo-wide.

## P1 - Important (A11y & Consistency)

### 5-8. ListPage Improvements ✅
**Files:** `src/components/records/ListPage.tsx`

- ✅ **5.** Sortable headers are real `<button>`s inside `<th>`, with `aria-sort`
- ✅ **6.** Search input has an `sr-only` label + `aria-label`
- ✅ **7.** Debounce rewritten as a `useEffect` with cleanup (the old version returned a cleanup the handler discarded)
- ✅ **8.** Filtered-empty is distinguished from truly-empty: "No matching records" + "Clear filters" vs "No records found" + "Create"

### 9. Hardcoded Tailwind Palette Colors ✅
**Files:** ~20 files

- ✅ Task status/priority chips → `Badge` with semantic tones (`STATUS_TONES` / `PRIORITY_TONES` / `STATUS_SURFACES`)
- ✅ `text-red-600` → `text-critical`, `bg-red-50` → `bg-critical-surface`
- ✅ `text-blue-600` → `text-info`, `ring-blue-500` → `ring-info`, `border-gray-300` → `border-control-border`
- ✅ Pipeline/stage swatches gained `dark:` variants
- ✅ "Default" pipeline chip → `<Badge tone="positive">`

The pipeline and stage **swatch** maps keep the Tailwind palette on purpose: the
colour value is user data, and mapping it onto four semantic tones would erase
the distinction the user chose. They only needed dark-mode counterparts.

### 10. Checkbox Focus/Border Contrast ✅
**Files:** `src/components/ui/checkbox.tsx`

- ✅ Border → `border-control-border`
- ✅ Focus ring → `ring-info/40`

### 11. Permission Denials Styling ✅
**Files:** `src/app/(app)/products/new/page.tsx`, `src/app/(app)/products/[id]/edit/page.tsx`

- ✅ `text-ink-500` → `text-critical`, `role="alert"` in place

### 12. Shell Boundaries (Loading/Error) ✅
**Files:** `src/app/(app)/loading.tsx`, `src/app/(app)/error.tsx`

- ✅ Loading skeleton no longer draws a second top bar — the shell already renders the real one
- ✅ Error state carries `role="alert"`
- ✅ `min-h-screen` dropped from both (the shell provides the height)

## P2 - Polish

### 13. Migrate Remaining Screens
**Effort:** 4h | **Files:** tasks, activities, notifications, audit-logs, search, settings panels

Move these onto the shared list patterns (`ListPage`, `EmptyState`, `Badge`
tones) so they stop diverging from the rest of the app.

### 14-22. Various Polish Items
**Effort:** 8h

- [x] Dead code cleanup (`SidebarTrigger` — now used by the header, not deleted)
- [x] Skip link focus ring (was `ring-info` on `bg-info`, i.e. invisible)
- [ ] Theme toggle announcements
- [ ] Dev UI gating
- [ ] Breadcrumb links
- [ ] ListPage skeleton loading
- [ ] Page size control
- [ ] URL state for filters/search
- [ ] Control border review

## Total Remaining: ~14 hours

## Implementation Strategy
1. ~~Start with P0~~ — P0 complete
2. ~~Move to P1~~ — P1 complete
3. **Test after each item** — typecheck plus the relevant component suite
4. **Commit frequently** — small, focused commits
5. P2 items are independent and can be taken in any order

## Progress Tracking
- [x] P0.1 - Token contrast failures
- [x] P0.2 - Mobile drawer dialog
- [x] P0.3 - ListPage error state
- [x] P0.4 - Dead shadcn classes
- [x] P1.5-8 - ListPage a11y, debounce, empty states
- [x] P1.9 - Hardcoded palette colours
- [x] P1.10 - Checkbox contrast
- [x] P1.11 - Permission denials
- [x] P1.12 - Shell boundaries
- [x] P2.16 - Dead code cleanup
- [x] P2.17 - Skip link focus ring
- [ ] P2.13 - Migrate remaining screens
- [ ] P2 remaining polish
