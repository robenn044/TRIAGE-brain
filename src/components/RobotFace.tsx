import { useCallback, useEffect, useRef, useState } from "react";
import "./RobotFace.css";

interface RobotFaceProps {
  onUnlock?: () => void;
  mini?: boolean;
}

type Expression = "happy" | "surprised" | "sad" | "sleepy" | "excited" | "smirk" | "neutral";

const EXPRESSIONS: Expression[] = [
  "happy", "happy", "happy",
  "excited", "excited",
  "surprised",
  "smirk",
  "neutral",
  "sleepy",
  "sad",
];

const MAX_EYE_OFFSET = 10;

export default function RobotFace({ onUnlock, mini }: RobotFaceProps) {
  const [expression, setExpression] = useState<Expression>("happy");
  const [blinking, setBlinking] = useState(false);
  const [squishing, setSquishing] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const eyeLRef = useRef<HTMLDivElement>(null);
  const eyeRRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const blinkRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exprRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pickNext = (current: Expression): Expression => {
    const pool = EXPRESSIONS.filter((entry) => entry !== current);
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const scheduleBlink = useCallback(() => {
    blinkRef.current = setTimeout(() => {
      setBlinking(true);
      setTimeout(() => {
        setBlinking(false);
        if (Math.random() < 0.25) {
          setTimeout(() => {
            setBlinking(true);
            setTimeout(() => {
              setBlinking(false);
              scheduleBlink();
            }, 220);
          }, 380);
        } else {
          scheduleBlink();
        }
      }, 220);
    }, 2400 + Math.random() * 3600);
  }, []);

  const scheduleExpression = useCallback((current: Expression) => {
    exprRef.current = setTimeout(() => {
      const next = pickNext(current);
      setExpression(next);
      scheduleExpression(next);
    }, 5500 + Math.random() * 5500);
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent | TouchEvent) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        const rect = wrapper.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        let clientX: number;
        let clientY: number;
        if ("touches" in event) {
          clientX = event.touches[0].clientX;
          clientY = event.touches[0].clientY;
        } else {
          clientX = event.clientX;
          clientY = event.clientY;
        }

        const dx = clientX - cx;
        const dy = clientY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const clamp = Math.min(dist / 300, 1) * MAX_EYE_OFFSET;
        const ox = (dx / dist) * clamp;
        const oy = (dy / dist) * clamp;
        const transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`;

        if (eyeLRef.current) eyeLRef.current.style.transform = transform;
        if (eyeRRef.current) eyeRRef.current.style.transform = transform;
      });
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    scheduleBlink();
    scheduleExpression("happy");

    return () => {
      if (blinkRef.current) clearTimeout(blinkRef.current);
      if (exprRef.current) clearTimeout(exprRef.current);
    };
  }, [scheduleBlink, scheduleExpression]);

  const handleClick = () => {
    if (onUnlock) {
      setLeaving(true);
      setTimeout(() => onUnlock(), 600);
      return;
    }

    setSquishing(true);
    setTimeout(() => setSquishing(false), 400);
    const next = pickNext(expression);
    setExpression(next);
    if (exprRef.current) clearTimeout(exprRef.current);
    scheduleExpression(next);
  };

  if (mini) {
    return (
      <div className="robot-face-mini" onClick={handleClick}>
        <span className="mini-dot" />
        <span className="mini-dot mini-mouth" />
        <span className="mini-dot" />
      </div>
    );
  }

  return (
    <div className="robot-face-wrapper" ref={wrapperRef}>
      <div
        className={`robot-face expr-${expression}${leaving ? " leaving" : ""}`}
        style={squishing && !leaving ? { animation: "squish 0.38s cubic-bezier(0.34,1.56,0.64,1) forwards" } : undefined}
        onClick={handleClick}
      >
        <div className="robot-features">
          <div className={`led robot-eye${blinking ? " blinking" : ""}`}>
            <div className="eye-pupil" ref={eyeLRef} />
          </div>
          <div className="led robot-mouth" />
          <div className={`led robot-eye${blinking ? " blinking" : ""}`}>
            <div className="eye-pupil" ref={eyeRRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
