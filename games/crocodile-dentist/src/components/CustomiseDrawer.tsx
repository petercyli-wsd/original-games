import { useState } from 'react';
import type { CrocConfig } from '../config';

interface Props {
  config: CrocConfig;
  onClose: () => void;
}

// The maths is fixed in src/config.ts (see withFixedMaths): the drawer shows it but can't change it.
export default function CustomiseDrawer({ config, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="drawer">
      <div className="drawer-head">
        <h2>Customise</h2>
        <button className="ghost" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>
      <div className="drawer-body">
        <h3>Maths</h3>
        <p className="cfg-note">
          Fixed: RTP {(config.rtp * 100).toFixed(0)}%, {config.teeth} teeth, bad-teeth options {config.badTeethOptions.join(', ')}. Change them in
          src/config.ts.
        </p>
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
      </div>
    </div>
  );
}
