import { useState } from 'react';
import { DEFAULT_CONFIG, type CrocConfig } from '../config';

interface Props {
  config: CrocConfig;
  onChange: (cfg: CrocConfig) => void;
  onClose: () => void;
}

const parseList = (s: string) =>
  s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((x) => Number.isFinite(x) && x > 0);

function NumberRow({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="cfg-row">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

function ListRow({ label, value, onChange }: { label: string; value: number[]; onChange: (v: number[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <label className="cfg-row">
      <span>{label}</span>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const list = parseList(text);
          if (list.length) onChange(list);
          setText((list.length ? list : value).join(', '));
        }}
      />
    </label>
  );
}

export default function CustomiseDrawer({ config, onChange, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  // Bumped on restore so the text inputs re-read their values.
  const [version, setVersion] = useState(0);
  const set = (patch: Partial<CrocConfig>) => onChange({ ...config, ...patch });

  return (
    <div className="drawer">
      <div className="drawer-head">
        <h2>Customise</h2>
        <button className="ghost" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>
      <div className="drawer-body" key={version}>
        <h3>Maths</h3>
        <NumberRow label="RTP (0–1)" step={0.001} value={config.rtp} onChange={(rtp) => set({ rtp: Math.min(1, Math.max(0.5, rtp)) })} />
        <NumberRow label="Teeth" step={1} value={config.teeth} onChange={(teeth) => set({ teeth: Math.min(24, Math.max(4, Math.round(teeth))) })} />
        <ListRow label="Bad-teeth options" value={config.badTeethOptions} onChange={(badTeethOptions) => set({ badTeethOptions })} />
        <p className="cfg-note">Maths changes apply from the next bet.</p>

      </div>
      <div className="drawer-foot">
        <button
          className="secondary"
          onClick={() => {
            navigator.clipboard
              ?.writeText(JSON.stringify(config, null, 2))
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => {});
          }}
        >
          {copied ? 'Copied!' : 'Copy config JSON'}
        </button>
        <button
          className="ghost"
          onClick={() => {
            onChange(DEFAULT_CONFIG);
            setVersion((v) => v + 1);
          }}
        >
          Restore defaults
        </button>
      </div>
    </div>
  );
}
