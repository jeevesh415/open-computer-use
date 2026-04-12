import type { Metadata } from "next"
import { getLocalizedMetadata } from "@/lib/seo"

export async function generateMetadata(): Promise<Metadata> {
  return getLocalizedMetadata("computerUse", "/computer-use", [
    "computer use", "computer use agent", "computer use AI", "best computer use agent",
    "AI computer use", "computer-using agent", "desktop automation AI", "browser automation AI",
    "autonomous computer control", "AI desktop agent", "computer use software",
    "best AI agent", "AI employee", "computer use automation", "RPA alternative",
    "AI agent for computer", "computer use tool", "AI that uses computer",
    "automated computer use", "computer use platform", "Coasty computer use",
    "AI computer control", "computer use benchmark", "OSWorld", "computer use API",
  ])
}

export default function ComputerUseLayout({ children }: { children: React.ReactNode }) {
  return children
}
