'use client';

import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ArrowLeft, ArrowRight, ChevronsUp } from 'lucide-react';
import type { DrivingControl } from './input';
import { SteeringPadInput, type SteeringDirection } from './steeringPad';

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
    const releaseAll = () => {
      for (const source of held) onRelease(source);
      held.clear();
      setPressed(false);
    };
    const onVisibility = () => {
      if (document.hidden) releaseAll();
    };
    window.addEventListener('blur', releaseAll);
    window.addEventListener('pagehide', releaseAll);
    window.addEventListener('resize', releaseAll);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      for (const source of held) onRelease(source);
      held.clear();
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('pagehide', releaseAll);
      window.removeEventListener('resize', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
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

function SteeringPad({ onPress, onRelease }: ControlCallbacks) {
  const padElementRef = useRef<HTMLFieldSetElement>(null);
  const pad = useMemo(
    () => new SteeringPadInput(onPress, onRelease),
    [onPress, onRelease],
  );
  const [, refresh] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    const clear = () => {
      pad.clear();
      refresh();
    };
    const onVisibility = () => {
      if (document.hidden) clear();
    };
    window.addEventListener('blur', clear);
    window.addEventListener('pagehide', clear);
    // Contacts retain the geometry at touch-down. Rotation invalidates it.
    window.addEventListener('resize', clear);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      pad.clear();
      window.removeEventListener('blur', clear);
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('resize', clear);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pad]);

  const release = (source: string) => {
    if (pad.release(source)) refresh();
  };
  return (
    <fieldset
      ref={padElementRef}
      className="touch-steering"
      aria-label="Steering. Tap a side, or slide across to change direction"
    >
      {(['left', 'right'] as const).map((direction: SteeringDirection) => (
        <button
          key={direction}
          type="button"
          className={`touch-button touch-${direction}`}
          aria-label={`Steer ${direction}`}
          aria-pressed={pad.isPressed(direction)}
          data-pressed={pad.isPressed(direction)}
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            event.preventDefault();
            const rect = padElementRef.current?.getBoundingClientRect();
            if (!rect) return;
            const accepted = pad.pointerDown(
              `steering:${event.pointerId}`,
              event.clientX,
              event.clientY,
              {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              },
            );
            if (accepted) {
              event.currentTarget.setPointerCapture(event.pointerId);
              refresh();
            }
          }}
          onPointerMove={(event) => {
            if (
              pad.pointerMove(
                `steering:${event.pointerId}`,
                event.clientX,
                event.clientY,
              )
            )
              refresh();
          }}
          onPointerUp={(event) => release(`steering:${event.pointerId}`)}
          onPointerCancel={(event) => release(`steering:${event.pointerId}`)}
          onLostPointerCapture={(event) =>
            release(`steering:${event.pointerId}`)
          }
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.code !== 'Space' && event.code !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            if (
              !event.repeat &&
              pad.press(direction, `steering:${direction}:${event.code}`)
            )
              refresh();
          }}
          onKeyUp={(event) => {
            if (event.code !== 'Space' && event.code !== 'Enter') return;
            event.preventDefault();
            release(`steering:${direction}:${event.code}`);
          }}
          onBlur={() => {
            release(`steering:${direction}:Space`);
            release(`steering:${direction}:Enter`);
          }}
          onClick={(event) => {
            if (event.detail !== 0) return;
            const source = `steering:activation:${direction}`;
            pad.press(direction, source);
            pad.release(source);
            refresh();
          }}
        >
          {direction === 'left' ? (
            <ArrowLeft aria-hidden="true" />
          ) : (
            <ArrowRight aria-hidden="true" />
          )}
          <span>{direction.toUpperCase()}</span>
        </button>
      ))}
    </fieldset>
  );
}

export function TouchControls({ onPress, onRelease }: ControlCallbacks) {
  const callbacks = { onPress, onRelease };
  return (
    <fieldset className="touch-controls" aria-label="Driving controls">
      <SteeringPad {...callbacks} />
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
