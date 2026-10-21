// A small "?" that reveals a one-line explanation on hover, focus or tap.
export default function Tip({ text }: { text: string }) {
  return (
    <span className="tip">
      <button type="button" className="tip-btn" aria-label={text}>
        ?
      </button>
      <span className="tip-pop" role="tooltip">
        {text}
      </span>
    </span>
  );
}
