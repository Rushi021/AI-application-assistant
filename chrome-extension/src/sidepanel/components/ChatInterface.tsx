import { useState, useEffect, useRef } from "react";
import { chatSection, getSectionHistory } from "../services/api";
import type { ChatMessage } from "@/shared/types";
import SectionContentBlock from "./SectionContentBlock";

interface ChatInterfaceProps {
  draftId: number;
  sectionId: string;
  sectionTitle: string;
  onProposedText: (text: string) => void;
  onClose: () => void;
}

export default function ChatInterface({
  draftId,
  sectionId,
  sectionTitle,
  onProposedText,
  onClose,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const history = await getSectionHistory(draftId, sectionId);
        setMessages(history);
      } catch {
        // fresh chat
      } finally {
        setHistoryLoaded(true);
      }
    })();
  }, [draftId, sectionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const result = await chatSection(draftId, sectionId, userMsg);
      setMessages((prev) => [...prev, { role: "assistant", content: result.proposed_text }]);
      onProposedText(result.proposed_text);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error: Failed to get response. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-wf-bg border-l border-wf-border">
      <div className="px-3 py-2.5 border-b border-wf-border bg-wf-surface flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-wf-text truncate">Refine: {sectionTitle}</p>
          <p className="text-[10px] text-wf-muted">Ask the AI to adjust this section</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 hover:bg-wf-surfaceHover rounded-lg text-wf-muted hover:text-wf-text"
          aria-label="Close chat"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {!historyLoaded ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-wf-border border-t-primary-500" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-xs text-wf-muted text-center py-4">Send a message to refine this section.</p>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 text-xs leading-relaxed max-w-[90%] ${
                msg.role === "user"
                  ? "bg-primary-500 text-white ml-auto"
                  : "bg-wf-surface border border-wf-border text-wf-text"
              }`}
            >
              {msg.role === "assistant" ? (
                <SectionContentBlock text={msg.content} headerLabel="Header" contentLabel="Content" />
              ) : (
                <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              )}
            </div>
          ))
        )}
        {loading && (
          <div className="bg-wf-surface border border-wf-border rounded-lg px-3 py-2 max-w-[90%]">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-wf-muted rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-wf-muted rounded-full animate-bounce [animation-delay:0.1s]" />
              <span className="w-1.5 h-1.5 bg-wf-muted rounded-full animate-bounce [animation-delay:0.2s]" />
            </div>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-wf-border bg-wf-surface shrink-0">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Add metrics, match JD keywords…"
            rows={2}
            className="flex-1 rounded-[10px] border border-wf-border bg-wf-bg px-2.5 py-2 text-xs text-wf-text placeholder:text-wf-dim resize-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30 outline-none"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim() || loading}
            className="self-end p-2.5 bg-primary-500 text-white rounded-[10px] hover:bg-primary-600 disabled:opacity-50 transition-colors shrink-0"
            aria-label="Send"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {["More concise", "Add metrics", "Match JD keywords"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setInput(s)}
              className="text-[10px] text-wf-muted bg-wf-bg border border-wf-border px-2 py-1 rounded-md hover:border-wf-borderBright"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
