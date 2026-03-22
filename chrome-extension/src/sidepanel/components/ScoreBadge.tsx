export default function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 60
      ? "text-green-400 bg-wf-tagGreen border border-green-800/50"
      : score >= 40
        ? "text-primary-400 bg-primary-950/40 border border-primary-800/50"
        : "text-red-400 bg-wf-tagRed border border-red-900/40";

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-bold ${color}`}>{score}%</span>
  );
}
