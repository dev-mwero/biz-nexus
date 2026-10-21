# UI Revamp - Remaining Work Plan

**Created:** 2026-10-21  
**Status:** In Progress  
**Branch:** feat/stage-2-sales

## Overview
This plan tracks remaining work from the comprehensive UI/UX redesign. Items completed in previous commits (5923cbf, 986a437):
- ✅ Shell layout & sidebar positioning
- ✅ Dark/light mode toggle in header  
- ✅ Design tokens (control-border, brand, nav-active)
- ✅ Focus states updated to use info color
- ✅ Sidebar active state accent bar
- ✅ Partial dead class cleanup

## P0 - Critical (Blocking/A11y/Data Issues) - START HERE

### 1. Token Contrast Failures (WCAG 1.4.3) 
**Effort:** 1h | **Priority:** Critical | **Files:** `src/app/globals.css`

Current issues:
| Pair | Ratio | Required | Fix |
|------|-------|----------|-----|
| `--bn-attention` on `--bn-attention-surface` | 3.76:1 | 4.5:1 | Darken to `#965709` (5.10:1) |
| `--bn-attention` on `--bn-canvas` | 3.91:1 | 4.5:1 | Same fix |
| `--bn-ink-400` on `--bn-canvas` | 4.36:1 | 4.5:1 | Adjust to `#666f7e` (4.69:1) |
| `--bn-ink-300` on `--bn-canvas` | 2.08:1 | 4.5:1 | Review usage or darken |

**Tasks:**
- [ ] Update `--bn-attention` in `:root` and `dark`
- [ ] Update `--bn-attention-border` to match
- [ ] Adjust `--bn-ink-400` in `:root`
- [ ] Verify all attention badge usages still look good
- [ ] Test contrast ratios

### 2. Mobile Drawer Not a Proper Dialog
**Effort:** 2h | **Priority:** Critical | **Files:** `src/components/app-shell/sidebar.tsx`, `src/components/app-shell/index.tsx`

Issues:
- No `role="dialog"` or `aria-modal="true"` on mobile
- No focus trap
- No Escape key handling
- No body scroll lock
- Closed drawer remains focusable (translate doesn't remove from tab order)
- No focus restoration

**Tasks:**
- [ ] Add `role="dialog" aria-modal="true"` when open on mobile
- [ ] Implement focus trap (or use Base UI Dialog)
- [ ] Add Escape key listener
- [ ] Lock body scroll when open
- [ ] Add `inert` attribute or `tabindex="-1"` handling for closed state
- [ ] Restore focus to trigger button on close
- [ ] Add overlay click to close (already exists but needs refinement)

### 3. ListPage Has No Error State
**Effort:** 1h | **Priority:** Critical | **Files:** `src/components/records/ListPage.tsx`

Affects all 9 list screens (companies, contacts, leads, etc.)

**Tasks:**
- [ ] Add `error` state to component
- [ ] Display error UI with message and Retry button
- [ ] Don't show "No records found" when there's an error
- [ ] Add `role="alert"` to error message
- [ ] Ensure error doesn't persist on retry

### 4. Dead Shadcn Classes Still Rendering as No-Ops
**Effort:** 2h | **Priority:** Critical | **Files:** Multiple

Classes not defined in theme: `bg-muted`, `text-foreground`, `bg-background`

Affected files:
- `src/app/(app)/tasks/[id]/page.tsx` (lines ~174,175,179,341,374,458)
- `src/app/(app)/crm/custom-fields/page.tsx:26`
- `src/components/activities/ActivityTimeline.tsx` (135,140,152,165,201)
- `src/components/tasks/TaskList.tsx` (87-96,131,147,156,184,209)
- `src/components/tasks/TaskBoard.tsx` (112,117,135,153,209)
- `src/components/deals/KanbanBoard.tsx` (436,570,580,626)

**Tasks:**
- [ ] Replace `bg-muted` with `bg-surface-sunken` or `bg-surface-hover`
- [ ] Replace `text-foreground` with `text-ink-900 dark:text-ink-50`
- [ ] Replace `bg-background` with `bg-canvas` or `bg-surface`
- [ ] Replace `text-red-600` with `text-critical`
- [ ] Replace `bg-red-50` with `bg-critical-surface`
- [ ] Test dark mode for all affected components

**P0 Total:** 6 hours

## P1 - Important (A11y & Consistency)

### 5-8. ListPage Improvements
**Effort:** 4h | **Priority:** High | **Files:** `src/components/records/ListPage.tsx`

**Tasks:**
- [ ] **5.** Make sortable headers keyboard-accessible: wrap in `<button>`, add `aria-sort`
- [ ] **6.** Add accessible label to search input (visually-hidden), add results count live region
- [ ] **7.** Fix debounce - use `useEffect` with cleanup, prevent stale results
- [ ] **8.** Distinguish empty vs no-results states, add "Clear filters" button

### 9. Hardcoded Tailwind Palette Colors
**Effort:** 5h | **Priority:** High | **Files:** ~20 files

**Tasks:**
- [ ] Migrate task status/priority chips to use `Badge` component with semantic tones
- [ ] Replace `text-red-600` with `text-critical` across codebase
- [ ] Replace `bg-red-50` with `bg-critical-surface`
- [ ] Replace gray/blue/green/yellow/orange chips with semantic tones
- [ ] Update pipeline color swatches to be token-aware
- [ ] Test all in dark mode

### 10. Checkbox Focus/Border Contrast
**Effort:** 0.5h | **Priority:** High | **Files:** `src/components/ui/checkbox.tsx`

**Tasks:**
- [ ] Change border from `border-line-strong` to `border-control-border`
- [ ] Update focus ring to `ring-info/40`

### 11. Permission Denials Styling
**Effort:** 0.5h | **Priority:** High | **Files:** `src/app/(app)/products/new/page.tsx`, `src/app/(app)/products/[id]/edit/page.tsx`

**Tasks:**
- [ ] Change denial messages from `text-ink-500` to `text-critical`
- [ ] Ensure proper `role="alert"`

### 12. Shell Boundaries (Loading/Error)
**Effort:** 2h | **Priority:** High | **Files:** `src/app/(app)/loading.tsx`, `src/app/(app)/error.tsx`

**Tasks:**
- [ ] Fix loading.tsx to not duplicate header (use content-area skeletons)
- [ ] Add `role="alert"` to error.tsx
- [ ] Remove `min-h-screen` from error state (use shell chrome)
- [ ] Improve error messaging

**P1 Total:** 12 hours

## P2 - Polish

### 13. Migrate Remaining Screens
**Effort:** 4h | **Files:** tasks, activities, notifications, audit-logs, search, settings panels

### 14-22. Various Polish Items
**Effort:** 8h

- Theme toggle announcements
- Dev UI gating
- Dead code cleanup (SidebarTrigger)
- Skip link focus ring
- Breadcrumb links
- ListPage skeleton loading
- Page size control
- URL state for filters/search
- Control border review

**P2 Total:** 12 hours

## Total Remaining: ~30 hours

## Implementation Strategy
1. **Start with P0** - Do all items in order (1 → 2 → 3 → 4)
2. **Test after each item** - Run typecheck and visual check
3. **Commit frequently** - Small, focused commits
4. **Move to P1 after P0 complete** - Can parallelize some P1 items

## Progress Tracking
- [x] P0.1 - Token contrast failures
- [x] P0.2 - Mobile drawer dialog
- [x] P0.3 - ListPage error state
- [x] P0.4 - Dead shadcn classes
- [ ] P1 items...
- [ ] P2 items...
