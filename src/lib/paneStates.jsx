/* HotelOps · Shared pane state visuals
 * =================================================================
 * Two tiny presentation components. Same visual language across
 * every pane that needs an empty- or loading-state placeholder.
 * No business logic — purely visual cohesion.
 */

import { Inbox, Loader2 } from "lucide-react";

export function EmptyState({ title, message, icon: IconRaw, action }) {
  const Icon = IconRaw || Inbox;
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6 text-stone-500">
      <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mb-3">
        <Icon size={20} className="text-stone-400" />
      </div>
      {title && <div className="font-display text-base text-stone-700 mb-1">{title}</div>}
      {message && <div className="text-sm max-w-md leading-relaxed">{message}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-stone-500">
      <Loader2 size={16} className="animate-spin" />
      <span>{label}</span>
    </div>
  );
}
