import { clsx, type ClassValue } from "clsx";

/**
 * className combiner. Previously delegated to `tailwind-merge` for Tailwind
 * class conflict resolution, but Tailwind was never wired into the build
 * (removed in audit #1.5). `clsx` alone is sufficient for this codebase's
 * usage pattern — joining conditional class strings.
 *
 * If you re-introduce Tailwind in the future, swap this back to
 * `twMerge(clsx(inputs))` and reinstall `tailwind-merge`.
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
