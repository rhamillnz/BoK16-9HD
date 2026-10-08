import { describe, expect, it } from 'vitest';
import { GameDataError, backendNote, describeStartupError } from '../src/ui/bootScreen';

describe('describeStartupError', () => {
  it('explains missing game data', () => {
    const e = describeStartupError(new GameDataError('KRONDOR.RMF', 404));
    expect(e.title).toBe('Game data not found');
    expect(e.hint).toContain('BAK_DIR');
    expect(e.detail).toContain('KRONDOR.RMF');
  });

  it('recognises the legacy missing-data message', () => {
    expect(describeStartupError(new Error('Game data not found: set BAK_DIR')).title).toBe('Game data not found');
  });

  it('reports no graphics when neither WebGPU nor WebGL2 exists', () => {
    const e = describeStartupError(new Error('boom'), { webgpu: false, webgl2: false });
    expect(e.title).toBe('Graphics not available');
    expect(e.message).toContain('neither WebGPU nor WebGL2');
  });

  it('reports graphics failures from the renderer', () => {
    expect(describeStartupError(new Error('Unable to create WebGL2 context')).title).toBe('Graphics not available');
  });

  it('flags unreadable data', () => {
    expect(describeStartupError(new RangeError('Offset is outside the bounds of the DataView')).title).toBe(
      'Game data looks wrong',
    );
  });

  it('falls back to a generic message', () => {
    const e = describeStartupError('weird');
    expect(e.title).toBe('Something went wrong');
    expect(e.detail).toBe('weird');
  });
});

describe('backendNote', () => {
  it('mentions the WebGL2 fallback only when WebGPU is missing', () => {
    expect(backendNote('WebGL2')).toContain('WebGL2 fallback');
    expect(backendNote('WebGPU')).toBeUndefined();
  });
});
