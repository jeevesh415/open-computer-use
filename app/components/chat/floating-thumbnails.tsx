"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "motion/react"

const VIDEO_IDS = [
  "icxgLDephHE",
  "qTvmGfg3HVw",
  "Wbo2o74hVIo",
  "mH-csaCa508",
  "AnHJuRMLCnE",
  "A_OvNh51Npg",
]

interface ThumbnailConfig {
  videoId: string
  x: number
  y: number
  driftX: number
  driftY: number
  durationX: number
  durationY: number
  rotation: number
  scale: number
  opacity: number
  enterFrom: { x: number; y: number; rotate: number }
}

// ── Desktop: 6 thumbnails — 4 corners + 2 mid-side accents ──
const DESKTOP_THUMBNAILS: ThumbnailConfig[] = [
  {
    videoId: VIDEO_IDS[0],
    x: 2, y: 10,
    driftX: 14, driftY: 10,
    durationX: 28, durationY: 22,
    rotation: -3, scale: 1, opacity: 0.7,
    enterFrom: { x: -120, y: -80, rotate: -45 },
  },
  {
    videoId: VIDEO_IDS[1],
    x: 72, y: 8,
    driftX: 12, driftY: 10,
    durationX: 32, durationY: 26,
    rotation: 2.5, scale: 1, opacity: 0.65,
    enterFrom: { x: 120, y: -80, rotate: 35 },
  },
  {
    videoId: VIDEO_IDS[2],
    x: 1, y: 58,
    driftX: 16, driftY: 10,
    durationX: 30, durationY: 24,
    rotation: 2, scale: 1, opacity: 0.65,
    enterFrom: { x: -100, y: 100, rotate: 40 },
  },
  {
    videoId: VIDEO_IDS[3],
    x: 71, y: 60,
    driftX: 12, driftY: 14,
    durationX: 26, durationY: 30,
    rotation: -2, scale: 1, opacity: 0.6,
    enterFrom: { x: 100, y: 100, rotate: -50 },
  },
  {
    videoId: VIDEO_IDS[4],
    x: 4, y: 32,
    driftX: 10, driftY: 8,
    durationX: 34, durationY: 28,
    rotation: -1.5, scale: 0.8, opacity: 0.4,
    enterFrom: { x: -140, y: 20, rotate: -30 },
  },
  {
    videoId: VIDEO_IDS[5],
    x: 78, y: 34,
    driftX: 10, driftY: 10,
    durationX: 30, durationY: 32,
    rotation: 1.5, scale: 0.8, opacity: 0.4,
    enterFrom: { x: 140, y: 20, rotate: 30 },
  },
]

// ── Mobile: 4 corner thumbnails only, smaller + tighter to edges ──
// Mid-side ones are dropped — on narrow screens they'd sit right on top of greeting text.
// Positions use small x% values so the 120px thumbnails don't overflow the viewport.
const MOBILE_THUMBNAILS: ThumbnailConfig[] = [
  {
    videoId: VIDEO_IDS[0],
    x: -4, y: 14,
    driftX: 8, driftY: 6,
    durationX: 26, durationY: 20,
    rotation: -4, scale: 1, opacity: 0.6,
    enterFrom: { x: -80, y: -60, rotate: -35 },
  },
  {
    videoId: VIDEO_IDS[1],
    x: 68, y: 13,
    driftX: 8, driftY: 6,
    durationX: 30, durationY: 24,
    rotation: 3, scale: 1, opacity: 0.55,
    enterFrom: { x: 80, y: -60, rotate: 30 },
  },
  {
    videoId: VIDEO_IDS[2],
    x: -6, y: 64,
    driftX: 10, driftY: 6,
    durationX: 28, durationY: 22,
    rotation: 3, scale: 1, opacity: 0.55,
    enterFrom: { x: -70, y: 70, rotate: 30 },
  },
  {
    videoId: VIDEO_IDS[3],
    x: 66, y: 66,
    driftX: 8, driftY: 8,
    durationX: 24, durationY: 28,
    rotation: -3, scale: 1, opacity: 0.5,
    enterFrom: { x: 70, y: 70, rotate: -40 },
  },
]

function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [breakpoint])
  return isMobile
}

export function FloatingThumbnails({ visible, skipEntrance = false }: { visible: boolean; skipEntrance?: boolean }) {
  const isMobile = useIsMobile()
  const thumbnails = isMobile ? MOBILE_THUMBNAILS : DESKTOP_THUMBNAILS

  useEffect(() => {
    VIDEO_IDS.forEach((id) => {
      const img = new window.Image()
      img.src = `https://img.youtube.com/vi/${id}/mqdefault.jpg`
    })
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="absolute inset-0 overflow-hidden pointer-events-none z-[1]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.8, ease: "easeOut" } }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes ft-drift-x {
              0%, 100% { transform: translateX(0); }
              50% { transform: translateX(var(--drift-x)); }
            }
            @keyframes ft-drift-y {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(var(--drift-y)); }
            }
            .ft-x { animation: ft-drift-x var(--dur-x) ease-in-out infinite; }
            .ft-y { animation: ft-drift-y var(--dur-y) ease-in-out infinite; }
          ` }} />

          {thumbnails.map((thumb, i) => (
            <FloatingThumb key={thumb.videoId} config={thumb} index={i} skipEntrance={skipEntrance} isMobile={isMobile} />
          ))}

          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 70% 60% at 50% 50%, transparent 30%, var(--background) 80%)",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function FloatingThumb({ config, index, skipEntrance = false, isMobile }: { config: ThumbnailConfig; index: number; skipEntrance?: boolean; isMobile: boolean }) {
  return (
    <motion.div
      className="absolute"
      initial={
        skipEntrance
          ? false
          : {
              left: `${config.x}%`,
              top: `${config.y}%`,
              x: config.enterFrom.x,
              y: config.enterFrom.y,
              rotate: config.enterFrom.rotate,
              scale: 0.3,
              opacity: 0,
            }
      }
      animate={{
        x: 0,
        y: 0,
        rotate: config.rotation,
        scale: config.scale,
        opacity: config.opacity,
      }}
      transition={{
        duration: 1.2,
        delay: 0.08 + index * 0.1,
        ease: [0.34, 1.56, 0.64, 1],
      }}
      style={{
        left: `${config.x}%`,
        top: `${config.y}%`,
      }}
    >
      <div
        className="ft-x"
        style={{ "--drift-x": `${config.driftX}px`, "--dur-x": `${config.durationX}s` } as React.CSSProperties}
      >
        <div
          className="ft-y"
          style={{ "--drift-y": `${config.driftY}px`, "--dur-y": `${config.durationY}s` } as React.CSSProperties}
        >
          <div className={`${isMobile ? "w-[120px]" : "w-[180px] sm:w-[220px]"} aspect-video rounded-xl overflow-hidden shadow-md ring-1 ring-foreground/[0.06]`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://img.youtube.com/vi/${config.videoId}/mqdefault.jpg`}
              alt=""
              width={320}
              height={180}
              decoding="async"
              draggable={false}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-background/10 dark:bg-background/20 mix-blend-normal" />
          </div>
        </div>
      </div>
    </motion.div>
  )
}
