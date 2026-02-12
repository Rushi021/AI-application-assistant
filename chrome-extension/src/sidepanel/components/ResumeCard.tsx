import type { Resume, ResumeScore } from "@/shared/types";
import ScoreBadge from "./ScoreBadge";

interface ResumeCardProps {
  resume: Resume;
  score?: ResumeScore;
  selected: boolean;
  onSelect: () => void;
  onUse: () => void;
  onTailor: () => void;
  onRemove?: () => void;
  tailoring: boolean;
}

export default function ResumeCard({ resume, score, selected, onSelect, onUse, onTailor, onRemove, tailoring }: ResumeCardProps) {
  return (
    <div
      onClick={onSelect}
      className={`relative rounded-lg border-2 p-3 cursor-pointer transition-all ${
        selected ? "border-primary-500 bg-primary-50" : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          aria-label="Remove resume"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      <div className="flex items-start justify-between pr-8">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm font-medium text-gray-900 truncate">{resume.original_filename}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1 ml-6">
            {(resume.size_bytes / 1024).toFixed(0)} KB
          </p>
        </div>
        {score && <ScoreBadge score={score.score} />}
      </div>

      {/* Keywords (only when score exists and card is selected) */}
      {score && selected && (
        <div className="mt-2 ml-6 space-y-1">
          {score.matched_keywords.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {score.matched_keywords.slice(0, 8).map((kw: string) => (
                <span key={kw} className="px-1.5 py-0.5 text-[10px] bg-green-50 text-green-700 rounded">
                  {kw}
                </span>
              ))}
            </div>
          )}
          {score.missing_keywords.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {score.missing_keywords.slice(0, 6).map((kw: string) => (
                <span key={kw} className="px-1.5 py-0.5 text-[10px] bg-red-50 text-red-600 rounded">
                  {kw}
                </span>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-500 italic">{score.rationale}</p>
        </div>
      )}

      {/* Actions */}
      {selected && (
        <div className="mt-3 ml-6 flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onUse(); }}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Use
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onTailor(); }}
            disabled={tailoring}
            className="px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {tailoring ? "Tailoring..." : "Tailor"}
          </button>
        </div>
      )}
    </div>
  );
}
