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
    <div className={`rounded-lg border ${chatOpen ? "border-primary-300 ring-1 ring-primary-200" : "border-gray-200"} bg-white overflow-hidden`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-medium text-gray-900 truncate">{section.section_title}</span>
        </div>
        {!section.editable && (
          <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">header</span>
        )}
        {section.proposed_text && (
          <span className="text-[10px] text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded ml-1">
            proposed
          </span>
        )}
      </button>

      {/* Content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Proposed text banner */}
          {section.proposed_text && !editing && (
            <div className="bg-primary-50 border border-primary-200 rounded-lg p-2">
              <p className="text-[10px] font-medium text-primary-700 mb-1">AI Proposed Changes:</p>
              <SectionContentBlock
                text={section.proposed_text}
                headerLabel="Header"
                contentLabel="Content"
                className="bg-white rounded-md p-2"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={onAcceptProposed}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-green-700 bg-green-50 rounded hover:bg-green-100"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Accept
                </button>
                <button
                  onClick={onRejectProposed}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-red-700 bg-red-50 rounded hover:bg-red-100"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* Current text */}
          {editing ? (
            <div>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={6}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs resize-y focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none font-mono"
              />
              <div className="flex gap-2 mt-1">
                <button onClick={handleSaveEdit} className="px-2 py-1 text-[10px] font-medium text-white bg-primary-600 rounded hover:bg-primary-700">
                  Save
                </button>
                <button onClick={handleCancelEdit} className="px-2 py-1 text-[10px] text-gray-600 hover:text-gray-800">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-2">
              <SectionContentBlock text={section.current_text} />
            </div>
          )}

          {/* Actions */}
          {section.editable && !editing && (
            <div className="flex gap-2">
              <button
                onClick={() => { setEditText(section.current_text); setEditing(true); }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-600 border rounded hover:bg-gray-50"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit
              </button>
              <button
                onClick={onOpenChat}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                  chatOpen
                    ? "text-primary-700 bg-primary-100"
                    : "text-primary-600 border border-primary-300 hover:bg-primary-50"
                }`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Chat for refinement
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
