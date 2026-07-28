import assert from 'node:assert/strict';
import test from 'node:test';
import { isPointerInPlayerControlsHoverZone } from '../src/playerControls.ts';

test('detects the bottom player controls hover zone', () => {
  const playerBounds = {
    top: 100,
    bottom: 600,
  };

  assert.equal(
    isPointerInPlayerControlsHoverZone({ clientY: 580, ...playerBounds }),
    true,
  );
  assert.equal(
    isPointerInPlayerControlsHoverZone({ clientY: 320, ...playerBounds }),
    false,
  );
});

test('keeps controls hover zone bounded on small and large players', () => {
  assert.equal(
    isPointerInPlayerControlsHoverZone({
      clientY: 345,
      top: 100,
      bottom: 360,
    }),
    true,
  );
  assert.equal(
    isPointerInPlayerControlsHoverZone({
      clientY: 230,
      top: 100,
      bottom: 360,
    }),
    false,
  );

  assert.equal(
    isPointerInPlayerControlsHoverZone({
      clientY: 690,
      top: 100,
      bottom: 800,
    }),
    true,
  );
  assert.equal(
    isPointerInPlayerControlsHoverZone({
      clientY: 680,
      top: 100,
      bottom: 800,
    }),
    false,
  );
});
