import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store";
import {
  companySlugFromJobText,
  tailoredResumeFilename,
  triggerBlobDownload,
} from "../utils/filename";
import { patchSection, applySection, applyAllSections, generateCoverLetter, getDraft, ApiError } from "../services/api";
import type { DraftSection } from "@/shared/types";
import SectionCard from "../components/SectionCard";
import ChatInterface from "../components/ChatInterface";
import WorkflowLayout from "../components/WorkflowLayout";

const OTHER_GROUP = "Other";

function groupSectionsByGroup(sections: DraftSection[]): { groupTitle: string; sections: DraftSection[] }[] {
  const sorted = [...sections].sort((a, b) => a.order_index - b.order_index);
  const byGroup = new Map<string, DraftSection[]>();
  for (const s of sorted) {
    const key = s.section_group ?? OTHER_GROUP;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(s);
  }
  const entries = Array.from(byGroup.entries()).sort((a, b) => {
    const orderA = a[1][0]?.order_index ?? 0;
    const orderB = b[1][0]?.order_index ?? 0;
    return orderA - orderB;
  });
  return entries.map(([groupTitle, secs]) => ({ groupTitle, sections: secs }));
}

export default function SectionEditorPage() {
  const { draft, jobDescription, setDraft, updateSection, setCoverLetter, setPage } = useAppStore();
  const [chatSectionId, setChatSectionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasEdits, setHasEdits] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHasEdits(false);
  }, [draft?.id]);

  if (!draft) {
    return (
      <div className="flex items-center justify-center h-screen bg-wf-bg px-4">
        <p className="text-sm text-wf-muted text-center">No draft loaded. Go back and select a resume.</p>
      </div>
    );
  }

  const chatSectionData = draft.sections.find((s: DraftSection) => s.section_id === chatSectionId);

  const handleEdit = async (sectionId: string, newText: string) => {
    try {
      await patchSection(draft.id, sectionId, newText);
      updateSection(sectionId, { current_text: newText });
      setHasEdits(true);
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
        setHasEdits(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept changes");
    }
  };

  const handleRejectProposed = (sectionId: string) => {
    updateSection(sectionId, { proposed_text: null, last_feedback: "disliked" });
    setHasEdits(true);
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
      const jd = draft.job_description ?? jobDescription;
      const companySlug = companySlugFromJobText(jd);
      triggerBlobDownload(blob, tailoredResumeFilename(companySlug));
      setPage("autofill");
      generateCoverLetter(draft.id)
        .then((res) => {
          setCoverLetter(res.cover_letter);
          return getDraft(draft.id);
        })
        .then((updated) => setDraft(updated))
        .catch(() => {});
    } catch (err) {
      if (err instanceof ApiError && err.status === 500) {
        try {
          const parsed = JSON.parse(err.body) as { detail?: string };
          setError(parsed.detail ?? err.message);
        } catch {
          setError(err.message);
        }
      } else {
        setError(err instanceof Error ? err.message : "Failed to apply changes");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleStartAutofillShortcut = () => {
    setError(null);
    setPage("autofill");
    generateCoverLetter(draft.id)
      .then((res) => {
        setCoverLetter(res.cover_letter);
        return getDraft(draft.id);
      })
      .then((updated) => setDraft(updated))
      .catch(() => {});
  };

  const sectionGroups = useMemo(
    () => groupSectionsByGroup(draft.sections),
    [draft.sections]
  );
  const canShowStartAutofillShortcut = draft.starting_source === "base" && !hasEdits;

  return (
    <WorkflowLayout
      title="Edit sections"
      subtitle="Review and refine each section. Use Refine with AI for targeted edits."
    >
      <div className="flex flex-1 min-h-0 w-full min-w-0">
        <div className={`flex flex-col min-w-0 min-h-0 transition-all ${chatSectionId ? "w-1/2" : "w-full"}`}>
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4 min-h-0">
            {sectionGroups.map(({ groupTitle, sections: groupSections }) => (
              <div key={groupTitle} className="space-y-2">
                <h2 className="text-[10px] font-bold text-wf-dim tracking-widest uppercase sticky top-0 bg-wf-bg/95 backdrop-blur-sm py-2 -mx-1 px-1 z-[1]">
                  {groupTitle}
                </h2>
                <div className="space-y-2">
                  {groupSections.map((section: DraftSection) => (
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
              </div>
            ))}
          </div>

          <div className="shrink-0 px-4 py-3 border-t border-wf-border bg-wf-bg space-y-2">
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage("resume-select")}
                className="px-4 py-2.5 text-sm font-medium text-wf-text border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover shrink-0"
              >
                ← Back
              </button>
              {canShowStartAutofillShortcut && (
                <button
                  type="button"
                  onClick={handleStartAutofillShortcut}
                  className="px-3 py-2.5 text-sm font-medium text-primary-400 border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover"
                >
                  Skip to autofill
                </button>
              )}
              <button
                type="button"
                onClick={handleApplyAll}
                disabled={saving}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-[10px] hover:bg-primary-600 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save & continue →"}
              </button>
            </div>
          </div>
        </div>

        {chatSectionId && chatSectionData && (
          <div className="w-1/2 min-w-0 border-l border-wf-border flex flex-col min-h-0">
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
    </WorkflowLayout>
  );
}
