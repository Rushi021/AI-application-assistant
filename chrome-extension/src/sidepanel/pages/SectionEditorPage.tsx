import { useState } from "react";
import { useAppStore } from "../store";
import { patchSection, applySection, applyAllSections } from "../services/api";
import type { DraftSection } from "@/shared/types";
import SectionCard from "../components/SectionCard";
import ChatInterface from "../components/ChatInterface";

export default function SectionEditorPage() {
  const { draft, setDraft, updateSection, coverLetter, setPage } = useAppStore();
  const [chatSectionId, setChatSectionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!draft) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-sm text-gray-500">No draft loaded. Go back and select a resume.</p>
      </div>
    );
  }

  const chatSectionData = draft.sections.find((s: DraftSection) => s.section_id === chatSectionId);

  const handleEdit = async (sectionId: string, newText: string) => {
    try {
      await patchSection(draft.id, sectionId, newText);
      updateSection(sectionId, { current_text: newText });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save edit");
    }
  };

  const handleAcceptProposed = async (sectionId: string) => {
    try {
      await applySection(draft.id, sectionId);
      const section = draft.sections.find((s: DraftSection) => s.section_id === sectionId);
      if (section?.proposed_text) {
        updateSection(sectionId, {
          current_text: section.proposed_text,
          proposed_text: null,
          last_feedback: "liked",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept changes");
    }
  };

  const handleRejectProposed = (sectionId: string) => {
    updateSection(sectionId, { proposed_text: null, last_feedback: "disliked" });
  };

  const handleProposedText = (text: string) => {
    if (chatSectionId) {
      updateSection(chatSectionId, { proposed_text: text });
    }
  };

  const handleApplyAll = async () => {
    setSaving(true);
    setError(null);
    try {
      const blob = await applyAllSections(draft.id);
      // Save the blob for later download / auto-fill file upload
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tailored_resume_${draft.id}.docx`;
      // Don't trigger download automatically - just save the state
      // User can download from the cover letter page
      setPage("cover-letter");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen">
      {/* Sections panel */}
      <div className={`flex flex-col ${chatSectionId ? "w-1/2" : "w-full"} transition-all`}>
        {/* Header */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">Edit Sections</h1>
            <span className="text-xs text-gray-400 font-medium">Step 3/5</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Review and refine each section. Use the chat to ask AI for changes.
          </p>
        </div>

        {/* Section list */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {draft.sections
            .sort((a: DraftSection, b: DraftSection) => a.order_index - b.order_index)
            .map((section: DraftSection) => (
              <SectionCard
                key={section.section_id}
                section={section}
                chatOpen={chatSectionId === section.section_id}
                onEdit={(text) => handleEdit(section.section_id, text)}
                onOpenChat={() =>
                  setChatSectionId(
                    chatSectionId === section.section_id ? null : section.section_id
                  )
                }
                onAcceptProposed={() => handleAcceptProposed(section.section_id)}
                onRejectProposed={() => handleRejectProposed(section.section_id)}
              />
            ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t bg-white space-y-2">
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setPage("resume-select")}
              className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={handleApplyAll}
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Applying..." : "Apply / Save Changes"}
            </button>
          </div>
        </div>
      </div>

      {/* Chat panel (slides in from right) */}
      {chatSectionId && chatSectionData && (
        <div className="w-1/2 border-l">
          <ChatInterface
            draftId={draft.id}
            sectionId={chatSectionId}
            sectionTitle={chatSectionData.section_title}
            onProposedText={handleProposedText}
            onClose={() => setChatSectionId(null)}
          />
        </div>
      )}
    </div>
  );
}
