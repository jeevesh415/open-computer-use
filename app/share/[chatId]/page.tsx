import { APP_DOMAIN } from "@/lib/config"
import { isSupabaseEnabled } from "@/lib/supabase/config"
import { createClient } from "@/lib/supabase/server"
import { decryptScreenshotsInMessages } from "@/lib/screenshot-encryption"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import SimpleArticle from "./simple-article"

// Dynamic page to handle authentication and public/private checks
export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ chatId: string }>
}): Promise<Metadata> {
  if (!isSupabaseEnabled) {
    return notFound()
  }

  const { chatId } = await params
  const supabase = await createClient()

  if (!supabase) {
    return notFound()
  }

  const { data: chat } = await supabase
    .from("chats")
    .select("title, created_at, public, user_id")
    .eq("id", chatId)
    .single()

  // Check if the chat is public or if the user owns it
  const { data: { user } } = await supabase.auth.getUser()
  const isOwner = user?.id === chat?.user_id
  const isPublic = chat?.public === true

  if (!chat || (!isPublic && !isOwner)) {
    return {
      title: "Session Not Found",
      description: "This Coasty Agent session is not available for viewing."
    }
  }

  const title = chat?.title || "Coasty Agent Session"
  const description = "Coasty Agent autonomous workflow demonstrating multi-model orchestration and intelligent problem-solving"

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: `${APP_DOMAIN}/share/${chatId}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  }
}

export default async function ShareChat({
  params,
}: {
  params: Promise<{ chatId: string }>
}) {
  if (!isSupabaseEnabled) {
    return notFound()
  }

  const { chatId } = await params
  const supabase = await createClient()

  if (!supabase) {
    return notFound()
  }

  const { data: chatData, error: chatError } = await supabase
    .from("chats")
    .select("id, title, created_at, public, user_id")
    .eq("id", chatId)
    .single()

  if (chatError || !chatData) {
    redirect("/")
  }

  // Check if the chat is public or if the user owns it
  const { data: { user } } = await supabase.auth.getUser()
  const isOwner = user?.id === chatData.user_id
  const isPublic = chatData.public === true

  if (!isPublic && !isOwner) {
    redirect("/")
  }

  const { data: messagesData, error: messagesError } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })

  if (messagesError || !messagesData) {
    redirect("/")
  }

  // Decrypt any `frontendScreenshot` values that were encrypted under the
  // chat owner's encryption preferences. Public viewers of the chat
  // legitimately need to see them — the encryption is an at-rest control
  // against DB leaks, not a per-viewer access control. Failures fall back
  // to dropping the screenshot (the rest of the message still renders).
  // The walker preserves row shape; the cast keeps the Supabase-derived
  // row type from being widened to `unknown` by TS's generic inference.
  const messages = decryptScreenshotsInMessages(messagesData) as typeof messagesData

  return (
    <SimpleArticle
      chatId={chatId}
      messages={messages}
      date={chatData.created_at || ""}
      title={chatData.title || ""}
      subtitle={"Autonomous execution by Coasty Agent"}
    />
  )
}
