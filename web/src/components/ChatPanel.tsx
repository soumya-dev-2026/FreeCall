import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { CloseIcon, SendIcon } from "./Icons";
import { formatClockTime } from "../lib/utils";
import type { ChatMessage } from "../shared/types";

interface Props {
  messages: ChatMessage[];
  selfId: string;
  open: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
}

/**
 * In-call chat. Slides in as a right-hand panel on desktop and a bottom sheet
 * on phones, so it never covers the video on small screens for longer than it
 * has to.
 */
export function ChatPanel({
  messages,
  selfId,
  open,
  onClose,
  onSend,
}: Props) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (open) {
      // Delay slightly so the panel transition doesn't fight the keyboard.
      const t = setTimeout(() => inputRef.current?.focus(), 180);
      return () => clearTimeout(t);
    }
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <aside
      aria-label="In-call chat"
      className={[
        "z-30 flex flex-col border-white/10 bg-ink-900/95 backdrop-blur-xl transition-transform duration-300 ease-out",
        // phones: bottom sheet
        "fixed inset-x-0 bottom-0 h-[62vh] rounded-t-2xl border-t",
        // desktop: right rail
        "sm:static sm:h-auto sm:w-[22rem] sm:shrink-0 sm:rounded-none sm:border-l sm:border-t-0",
        open
          ? "translate-y-0 sm:translate-x-0"
          : "translate-y-full sm:hidden sm:translate-y-0",
      ].join(" ")}
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold">Chat</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          aria-label="Close chat"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>

      <div
        ref={listRef}
        className="scroll-slim flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-slate-500">
            No messages yet.
            <br />
            Say something — it stays inside this call.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.from.id === selfId;
            return (
              <div
                key={m.id}
                className={`flex items-end gap-2 ${
                  mine ? "flex-row-reverse" : ""
                }`}
              >
                {!mine && (
                  <Avatar
                    src={m.from.avatarUrl}
                    name={m.from.displayName}
                    id={m.from.id}
                    size="h-7 w-7"
                  />
                )}
                <div className={`max-w-[78%] ${mine ? "items-end" : ""}`}>
                  {!mine && (
                    <p className="mb-1 px-1 text-[11px] font-medium text-slate-400">
                      {m.from.displayName}
                    </p>
                  )}
                  <div
                    className={[
                      "rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words",
                      mine
                        ? "rounded-br-md bg-accent-500 text-white"
                        : "rounded-bl-md bg-white/10 text-slate-100",
                    ].join(" ")}
                  >
                    {m.text}
                  </div>
                  <p
                    className={`mt-1 px-1 text-[10px] text-slate-500 ${
                      mine ? "text-right" : ""
                    }`}
                  >
                    {formatClockTime(m.ts)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-white/10 p-3 safe-bottom"
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message…"
          maxLength={2000}
          className="field !py-2.5 !text-sm"
          aria-label="Message"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="btn-primary !px-3 !py-2.5"
          aria-label="Send message"
        >
          <SendIcon className="h-5 w-5" />
        </button>
      </form>
    </aside>
  );
}
