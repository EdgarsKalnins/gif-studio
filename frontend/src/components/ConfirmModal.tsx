"use client";

import React, { useEffect } from "react";
import { Warning, X } from "@/components/StudioIcons";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 dark:bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="studio-panel-radius w-full max-w-sm overflow-hidden bg-[#fbfaf8] text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.35),0_0_0_1px_rgba(20,20,22,0.08)] dark:shadow-[0_24px_60px_-15px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/12 text-red-600 dark:bg-red-500/15 dark:text-red-400">
              <Warning className="h-4 w-4" />
            </div>
            <h3
              id="confirm-modal-title"
              className="studio-display-font text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
            >
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel delete"
            className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            {description}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-zinc-200 dark:border-zinc-800 px-5 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            className="studio-accent-ring rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
