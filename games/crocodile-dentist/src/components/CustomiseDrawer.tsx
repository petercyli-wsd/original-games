import { useState } from 'react';
import { DEFAULT_CONFIG, type CrocColors, type CrocConfig } from '../config';

interface Props {
  config: CrocConfig;
  onChange: (cfg: CrocConfig) => void;
  onClose: () => void;
}

const COLOR_LABELS: Record<keyof CrocColors, string> = {
  bg: 'Page background',
  panel: 'Panel',
  accent: 'Primary button',
  croc: 'Croc skin',
  crocShade: 'Croc shading',
  belly: 'Croc belly',
  mouth: 'Mouth',
  tongue: 'Tongue',
  tooth: 'Teeth',
  you: 'You',
  house: 'House',
  bite: 'Bite / loss',
  win: 'Win',
};

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
          ✕
        </button>
      </div>
      <div className="drawer-body" key={version}>
        <h3>Maths</h3>
        <NumberRow label="RTP (0–1)" step={0.001} value={config.rtp} onChange={(rtp) => set({ rtp: Math.min(1, Math.max(0.5, rtp)) })} />
        <ListRow label="Teeth options" value={config.teethOptions} onChange={(teethOptions) => set({ teethOptions })} />
        <ListRow label="Bad-teeth options" value={config.badTeethOptions} onChange={(badTeethOptions) => set({ badTeethOptions })} />
        <NumberRow label="Bite Bonus min" step={0.1} value={config.biteBonusMin} onChange={(biteBonusMin) => set({ biteBonusMin: Math.max(1, biteBonusMin) })} />
        <NumberRow label="Bite Bonus max" step={0.1} value={config.biteBonusMax} onChange={(biteBonusMax) => set({ biteBonusMax: Math.max(config.biteBonusMin, biteBonusMax) })} />
        <p className="cfg-note">Maths changes apply from the next bet. Bite Bonus above 2× makes the cash-out value fall each round.</p>

        <h3>Pace (ms)</h3>
        <NumberRow label="House thinking time" step={50} value={config.houseDelay} onChange={(houseDelay) => set({ houseDelay: Math.max(0, houseDelay) })} />
        <NumberRow label="Turbo thinking time" step={50} value={config.turboHouseDelay} onChange={(turboHouseDelay) => set({ turboHouseDelay: Math.max(0, turboHouseDelay) })} />

        <h3>Colours</h3>
        {(Object.keys(COLOR_LABELS) as (keyof CrocColors)[]).map((key) => (
          <label className="cfg-row" key={key}>
            <span>{COLOR_LABELS[key]}</span>
            <input type="color" value={config.colors[key]} onChange={(e) => set({ colors: { ...config.colors, [key]: e.target.value } })} />
          </label>
        ))}
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
