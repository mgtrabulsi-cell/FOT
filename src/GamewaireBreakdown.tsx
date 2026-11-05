export default function GamewaireBreakdown({ text }: { text: string }) {
  const paragraphs = text.split('\n\n');
  const structured = paragraphs.length === 4 && paragraphs[3].startsWith('GamewAIre Verdict: ');
  return <>{paragraphs.map((paragraph, index) => <p key={index}>{structured && (index === 0 || index === 3)
    ? <strong>{paragraph}</strong> : paragraph}</p>)}</>;
}
