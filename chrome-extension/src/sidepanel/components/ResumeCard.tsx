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

export default function ResumeCard({
  resume,
  score,
  selected,
  onSelect,
  onUse,
  onTailor,
  onRemove,
  tailoring,
}: ResumeCardProps) {
  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      className={`relative rounded-xl border p-3.5 cursor-pointer transition-all ${
        selected
          ? "border-primary-500 bg-[#1c1208] ring-1 ring-primary-500/30"
          : "border-wf-border bg-wf-surface hover:border-wf-borderBright"
      }`}
    >
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-2.5 right-2.5 w-8 h-8 flex items-center justify-center rounded-lg text-wf-muted hover:text-red-400 hover:bg-red-950/40 transition-colors"
          aria-label="Remove resume"
        >
          <span className="text-sm" aria-hidden>
            🗑
          </span>
        </button>
      )}
      <div className="flex items-start justify-between gap-3 pr-8">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-wf-bg flex items-center justify-center shrink-0 text-base" aria-hidden>
            📄
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-wf-text truncate">{resume.original_filename}</div>
            <p className="text-[11px] text-wf-muted mt-0.5">{(resume.size_bytes / 1024).toFixed(0)} KB</p>
          </div>
        </div>
        {score && <ScoreBadge score={score.score} />}
      </div>

      {score && selected && (
        <div className="mt-3 pt-3 border-t border-wf-border space-y-2">
          {score.matched_keywords.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-wf-dim tracking-wide uppercase mb-1.5">Matching keywords</div>
              <div className="flex flex-wrap gap-1">
                {score.matched_keywords.slice(0, 10).map((kw: string) => (
                  <span key={kw} className="px-2 py-0.5 text-[10px] rounded-md bg-wf-tagGreen text-green-400">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
          {score.missing_keywords.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-wf-dim tracking-wide uppercase mb-1.5">Missing from resume</div>
              <div className="flex flex-wrap gap-1">
                {score.missing_keywords.slice(0, 8).map((kw: string) => (
                  <span key={kw} className="px-2 py-0.5 text-[10px] rounded-md bg-wf-tagRed text-red-400">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
          {score.rationale && <p className="text-[10px] text-wf-muted italic leading-snug">{score.rationale}</p>}
        </div>
      )}

      {selected && (
        <div className="mt-3 flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTailor();
            }}
            disabled={tailoring}
            className="flex-1 min-w-[100px] py-2 text-xs font-semibold text-white bg-primary-500 rounded-[10px] hover:bg-primary-600 disabled:opacity-50"
          >
            {tailoring ? "…" : "Tailor with AI"}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUse();
            }}
            disabled={tailoring}
            className="flex-1 min-w-[100px] py-2 text-xs font-medium text-wf-text border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover disabled:opacity-50"
          >
            Use as-is
          </button>
        </div>
      )}
    </div>
  );
}
