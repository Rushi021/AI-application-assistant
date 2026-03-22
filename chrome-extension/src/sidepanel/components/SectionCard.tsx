import { useState } from "react";
import type { DraftSection } from "@/shared/types";
import SectionContentBlock from "./SectionContentBlock";

interface SectionCardProps {
  section: DraftSection;
  onEdit: (text: string) => void;
  onOpenChat: () => void;
  onAcceptProposed: () => void;
  onRejectProposed: () => void;
  chatOpen: boolean;
}

export default function SectionCard({
  section,
  onEdit,
  onOpenChat,
  onAcceptProposed,
  onRejectProposed,
  chatOpen,
}: SectionCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(section.current_text);

  const handleSaveEdit = () => {
    onEdit(editText);
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setEditText(section.current_text);
    setEditing(false);
  };

  return (
    <div
      className={`rounded-xl border overflow-hidden ${
        chatOpen ? "border-primary-500 ring-1 ring-primary-500/25 bg-[#141414]" : "border-wf-border bg-wf-surface"
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-wf-surfaceHover/80 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-wf-dim text-xs">{expanded ? "▾" : "▸"}</span>
          <span className="text-sm font-semibold text-wf-text truncate">{section.section_title}</span>
          {section.proposed_text && (
            <span className="text-[10px] text-primary-400 bg-primary-950/50 border border-primary-800/40 px-1.5 py-0.5 rounded-full shrink-0">
              AI draft
            </span>
          )}
        </div>
        {!section.editable && (
          <span className="text-[10px] text-wf-dim bg-wf-bg px-1.5 py-0.5 rounded shrink-0">Header</span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {section.proposed_text && !editing && (
            <div className="bg-[#1c1208] border border-primary-900/40 rounded-xl p-2.5">
              <p className="text-[10px] font-semibold text-primary-400 mb-1.5 uppercase tracking-wide">Proposed changes</p>
              <SectionContentBlock
                text={section.proposed_text}
                headerLabel="Header"
                contentLabel="Content"
                className="bg-wf-bg rounded-lg p-2 border border-wf-border"
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={onAcceptProposed}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-green-400 bg-wf-tagGreen border border-green-800/50 rounded-lg hover:opacity-90"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={onRejectProposed}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-red-400 bg-wf-tagRed border border-red-900/40 rounded-lg hover:opacity-90"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {editing ? (
            <div>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={6}
                className="w-full rounded-[10px] border border-wf-border bg-wf-bg px-2.5 py-2 text-xs text-wf-text resize-y focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30 outline-none font-mono leading-relaxed"
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 text-[10px] font-semibold text-white bg-primary-500 rounded-lg hover:bg-primary-600"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-[10px] text-wf-muted hover:text-wf-text"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-wf-bg rounded-[10px] p-2.5 border border-wf-border">
              <SectionContentBlock text={section.current_text} />
            </div>
          )}

          {section.editable && !editing && (
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setEditText(section.current_text);
                  setEditing(true);
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-wf-text border border-wf-border rounded-lg hover:bg-wf-surfaceHover"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onOpenChat}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold rounded-lg transition-colors ${
                  chatOpen
                    ? "text-primary-400 bg-primary-950/50 border border-primary-800/50"
                    : "text-primary-400 border border-wf-border hover:bg-wf-surfaceHover"
                }`}
              >
                <span aria-hidden>✦</span> Refine with AI
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
