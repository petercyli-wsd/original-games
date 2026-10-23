import { describe, expect, it } from 'vitest';
import { codeHashOf } from './game-evidence';

describe('codeHashOf', () => {
  it('ignores line endings, so Windows and Linux checkouts agree', () => {
    const lf = [{ path: 'Game.tsx', content: 'a\nb\n' }];
    const crlf = [{ path: 'Game.tsx', content: 'a\r\nb\r\n' }];
    expect(codeHashOf(crlf)).toBe(codeHashOf(lf));
  });

  it('changes when the code changes', () => {
    expect(codeHashOf([{ path: 'Game.tsx', content: 'a' }])).not.toBe(codeHashOf([{ path: 'Game.tsx', content: 'b' }]));
  });
});
