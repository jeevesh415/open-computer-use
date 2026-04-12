import { create } from 'zustand'

export interface DisplayInfo {
  id: number
  name: string
  width: number
  height: number
  isPrimary: boolean
  scaleFactor: number
  bounds: { x: number; y: number; width: number; height: number }
}

interface DisplayState {
  displays: DisplayInfo[]
  activeId: number | null // null = primary
  /** True when there are 2+ connected displays (only show selector when needed) */
  hasMultiple: boolean
  setActiveDisplay: (id: number | null) => void
  refreshDisplays: () => Promise<void>
}

export const useDisplayStore = create<DisplayState>((set) => ({
  displays: [],
  activeId: null,
  hasMultiple: false,

  setActiveDisplay: (id) => {
    set({ activeId: id })
    window.coasty.setActiveDisplay(id)
  },

  refreshDisplays: async () => {
    const [displays, activeId] = await Promise.all([
      window.coasty.getDisplays(),
      window.coasty.getActiveDisplay(),
    ])
    set({
      displays,
      activeId,
      hasMultiple: displays.length > 1,
    })
  },
}))
