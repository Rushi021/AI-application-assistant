import { useState, useEffect, useRef } from "react";
import { chatSection, getSectionHistory } from "../services/api";
import type { ChatMessage } from "@/shared/types";

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

  // Load chat history on mount
  useEffect(() => {
    (async () => {
      try {
        const history = await getSectionHistory(draftId, sectionId);
        setMessages(history);
      } catch {
        // Ignore - fresh chat
      } finally {
        setHistoryLoaded(true);
      }
    })();
  }, [draftId, sectionId]);

  // Auto-scroll to bottom
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
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.proposed_text },
      ]);
      onProposedText(result.proposed_text);
    } catch (err) {
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
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 border-l">
      {/* Chat header */}
      <div className="px-3 py-2 border-b bg-white flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-900 truncate">Chat: {sectionTitle}</p>
          <p className="text-[10px] text-gray-500">Ask the AI to refine this section</p>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {!historyLoaded ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">
            Send a message to start refining this section.
          </p>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 text-xs leading-relaxed max-w-[90%] ${
                msg.role === "user"
                  ? "bg-primary-600 text-white ml-auto"
                  : "bg-white border text-gray-800"
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
            </div>
          ))
        )}
        {loading && (
          <div className="bg-white border rounded-lg px-3 py-2 max-w-[90%]">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.1s]" />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t bg-white">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Make the bullet points more quantitative..."
            rows={2}
            className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs resize-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="self-end p-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
