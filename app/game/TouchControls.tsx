'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ChevronsUp } from 'lucide-react';
import type { DrivingControl } from './input';

export const TOUCH_CONTROLS_QUERY = '(any-pointer: coarse), (max-width: 900px)';

interface ControlCallbacks {
  readonly onPress: (control: DrivingControl, source: string) => void;
  readonly onRelease: (source: string) => void;
}

function TouchButton({
  control,
  label,
  hint,
  children,
  onPress,
  onRelease,
}: ControlCallbacks & {
  readonly control: DrivingControl;
  readonly label: string;
  readonly hint: string;
  readonly children: ReactNode;
}) {
  const sources = useRef(new Set<string>());
  const [pressed, setPressed] = useState(false);

  const press = (source: string) => {
    sources.current.add(source);
    setPressed(true);
    onPress(control, source);
  };
  const release = (source: string) => {
    if (!sources.current.delete(source)) return;
    onRelease(source);
    setPressed(sources.current.size > 0);
  };

  useEffect(() => {
    const held = sources.current;
    return () => {
      for (const source of held) onRelease(source);
      held.clear();
    };
  }, [onRelease]);

  return (
    <button
      type="button"
      className={`touch-button touch-${control}`}
      aria-label={hint}
      aria-pressed={pressed}
      data-pressed={pressed}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        press(`pointer:${event.pointerId}`);
      }}
      onPointerUp={(event) => release(`pointer:${event.pointerId}`)}
      onPointerCancel={(event) => release(`pointer:${event.pointerId}`)}
      onLostPointerCapture={(event) => release(`pointer:${event.pointerId}`)}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.code !== 'Space' && event.code !== 'Enter') return;
        event.preventDefault();
        if (!event.repeat) press(`button:${control}:${event.code}`);
      }}
      onKeyUp={(event) => {
        if (event.code !== 'Space' && event.code !== 'Enter') return;
        event.preventDefault();
        release(`button:${control}:${event.code}`);
      }}
      onBlur={() => {
        release(`button:${control}:Space`);
        release(`button:${control}:Enter`);
      }}
      onClick={(event) => {
        // Assistive-technology clicks have no preceding pointer/key press.
        if (event.detail !== 0) return;
        const source = `activation:${control}`;
        onPress(control, source);
        onRelease(source);
      }}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export function TouchControls({
  onPress,
  onRelease,
  hasMoved,
}: ControlCallbacks & {
  readonly hasMoved: boolean;
}) {
  const callbacks = { onPress, onRelease };
  return (
    <fieldset className="touch-controls" aria-label="Driving controls">
      <p className="touch-drive-hint">
        {hasMoved ? 'AUTO-DRIVE ON' : 'AUTO-DRIVE ON · LET’S GO!'}
      </p>
      <div className="touch-steering">
        <TouchButton
          control="left"
          label="LEFT"
          hint="Steer left"
          {...callbacks}
        >
          <ArrowLeft aria-hidden="true" />
        </TouchButton>
        <TouchButton
          control="right"
          label="RIGHT"
          hint="Steer right"
          {...callbacks}
        >
          <ArrowRight aria-hidden="true" />
        </TouchButton>
      </div>
      <TouchButton
        control="jump"
        label="JUMP"
        hint="Jump. Hold to keep hopping"
        {...callbacks}
      >
        <ChevronsUp aria-hidden="true" />
        <small>HOLD TO HOP</small>
      </TouchButton>
    </fieldset>
  );
}
