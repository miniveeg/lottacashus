import { useEffect, useId, useRef } from "react";
import "./ConfirmDialog.css";

/**
 * LottaCash — Cracked Obsidian Confirm Dialog
 *
 * Reusable in-app replacement for `window.confirm` (H11 — UI/UX audit). The
 * native browser dialog breaks the visual design language, is blocked by
 * some iframe / extension configurations, and doesn't support a destructive
 * button variant. This component mirrors the GameAuthOverlay pattern:
 * full-screen backdrop + centered glass card + focus trap + restore focus.
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog
 *     open={open}
 *     title="Self-exclude?"
 *     body="You will be excluded for 30 days. This cannot be undone."
 *     confirmLabel="Self-exclude"
 *     destructive
 *     onConfirm={() => { doIt(); setOpen(false); }}
 *     onClose={() => setOpen(false)}
 *   />
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  /** When true, the dialog is mounted as a modal with focus trap. */
  open: boolean;
  /** Heading shown at the top of the card. Required for accessibility
   *  (the card is `aria-labelledby` this title's generated id). */
  title: string;
  /** Body copy shown under the title. */
  body?: string;
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Renders the confirm button in the destructive (crimson) variant for
   *  irreversible actions (self-exclusion, revoke admin, etc.). */
  destructive?: boolean;
  /** Disables the confirm button while an async action is in flight. */
  busy?: boolean;
  /** Called when the user confirms (clicks the confirm button or presses
   *  Enter while focused inside the dialog). */
  onConfirm: () => void;
  /** Called when the user dismisses (Esc, backdrop click, or
   *  Cancel button). */
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: Props) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onConfirmRef = useRef(onConfirm);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
  }, [onConfirm]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Modal lifecycle: focus the dialog on mount, trap Tab, restore focus on
  // unmount. Mirrors GameAuthOverlay.tsx's pattern.
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = (document.activeElement as HTMLElement) ?? null;

    const dialog = dialogRef.current;
    if (dialog) {
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      // Default focus to the Cancel button (the safer choice for a
      // confirmation dialog) so an accidental Enter doesn't fire the
      // destructive action.
      (focusables[1] ?? focusables[0] ?? dialog).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Enter") {
        // Only fire confirm if focus is inside the dialog (not on body).
        const root = dialogRef.current;
        if (root && root.contains(document.activeElement)) {
          e.preventDefault();
          onConfirmRef.current();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusables.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === "function") {
        prev.focus();
      }
      previouslyFocused.current = null;
    };
  }, [open]);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCloseRef.current();
  };

  return (
    <div
      className="confirm-dialog confirm-dialog--modal"
      onClick={handleBackdropClick}
    >
      <div
        className="confirm-dialog__card"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        tabIndex={-1}
      >
        <h2 id={titleId} className="confirm-dialog__title">
          {title}
        </h2>
        {body && (
          <p id={bodyId} className="confirm-dialog__body">
            {body}
          </p>
        )}
        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--outline"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-dialog__btn confirm-dialog__btn--primary${
              destructive ? " confirm-dialog__btn--destructive" : ""
            }`}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
