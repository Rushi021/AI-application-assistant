import { parseSectionText } from "../utils/sectionText";

interface SectionContentBlockProps {
  text: string;
  headerLabel?: string;
  contentLabel?: string;
  className?: string;
}

export default function SectionContentBlock({
  text,
  headerLabel = "Header",
  contentLabel = "Content",
  className,
}: SectionContentBlockProps) {
  const { header, bullets, body } = parseSectionText(text);
  const hasContent = Boolean(header || bullets.length > 0 || body.length > 0);

  if (!hasContent) {
    return <p className="text-xs text-gray-400">No content</p>;
  }

  return (
    <div className={`space-y-2 ${className ?? ""}`.trim()}>
      {header && (
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
            {headerLabel}
          </p>
          <div className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800">
            {header}
          </div>
        </div>
      )}
      {(bullets.length > 0 || body.length > 0) && (
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
            {contentLabel}
          </p>
          <div className="mt-1 space-y-2">
            {bullets.length > 0 && (
              <ul className="list-disc pl-5 space-y-1 text-xs text-gray-700 marker:text-gray-400">
                {bullets.map((bullet, index) => (
                  <li key={`${bullet}-${index}`} className="leading-relaxed">
                    {bullet}
                  </li>
                ))}
              </ul>
            )}
            {body.length > 0 && (
              <div className="space-y-1 text-xs text-gray-700">
                {body.map((line, index) => (
                  <p key={`${line}-${index}`} className="leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
