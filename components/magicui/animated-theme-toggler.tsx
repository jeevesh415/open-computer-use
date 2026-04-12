"use client";

import { Moon, SunDim } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

type props = {
  className?: string;
};

export const AnimatedThemeToggler = ({ className }: props) => {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const changeTheme = async () => {
    if (!buttonRef.current) return;

    const newTheme = resolvedTheme === "dark" ? "light" : "dark";

    // Simple instant toggle on mobile/small screens or without View Transition API
    const isSmallScreen = window.innerWidth < 768;
    if (isSmallScreen || !document.startViewTransition) {
      setTheme(newTheme);
      return;
    }

    const transition = document.startViewTransition(() => {
      flushSync(() => {
        setTheme(newTheme);
      });
    });

    try {
      await transition.ready;
    } catch {
      // View transition was skipped — theme already applied via flushSync
      return;
    }

    if (!buttonRef.current) return;

    const { top, left, width, height } =
      buttonRef.current.getBoundingClientRect();
    const y = top + height / 2;
    const x = left + width / 2;

    const right = window.innerWidth - left;
    const bottom = window.innerHeight - top;
    const maxRad = Math.hypot(Math.max(left, right), Math.max(top, bottom));

    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${maxRad}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 700,
        easing: "ease-in-out",
        pseudoElement: "::view-transition-new(root)",
      },
    );
  };
  
  if (!mounted) {
    return <button className={cn("inline-flex items-center justify-center", className)}></button>;
  }

  return (
    <button ref={buttonRef} onClick={changeTheme} className={cn("inline-flex items-center justify-center", className)}>
      {resolvedTheme === "dark" ? <Moon className="h-[1em] w-[1em]" /> : <SunDim className="h-[1em] w-[1em]" />}
    </button>
  );
};
