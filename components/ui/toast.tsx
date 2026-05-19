"use client"

import { CheckCircle, Info, Warning } from "@phosphor-icons/react/dist/ssr"
import { toast as sonnerToast } from "sonner"
import { isSigningOut } from "@/lib/user-store/sign-out-state"
import { Button } from "./button"

type ToastProps = {
  id: string | number
  title: string
  description?: string
  button?: {
    label: string
    onClick: () => void
  }
  status?: "error" | "info" | "success" | "warning"
}

function Toast({ title, description, button, id, status }: ToastProps) {
  return (
    <div className="border-input bg-popover flex items-center overflow-hidden rounded-xl border p-4 shadow-xs backdrop-blur-xl">
      <div className="flex flex-1 items-center">
        {status === "error" ? (
          <Warning className="text-primary mr-3 size-4" />
        ) : null}
        {status === "info" ? (
          <Info className="text-primary mr-3 size-4" />
        ) : null}
        {status === "success" ? (
          <CheckCircle className="text-primary mr-3 size-4" />
        ) : null}
        <div className="w-full">
          <p className="text-foreground text-sm font-medium">{title}</p>
          {description && (
            <p className="text-muted-foreground mt-1 text-sm">{description}</p>
          )}
        </div>
      </div>
      {button ? (
        <div className="shrink-0">
          <Button
            size="sm"
            onClick={() => {
              button?.onClick()
              sonnerToast.dismiss(id)
            }}
            type="button"
            variant="secondary"
          >
            {button?.label}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function toast(toast: Omit<ToastProps, "id">) {
  // Suppress error / warning toasts during sign-out tear-down. Between
  // supabase.auth.signOut() clearing the cookie and window.location.replace
  // firing, anything in flight (chat stream, query refetch, websocket)
  // can fail and try to surface here. The user is intentionally leaving;
  // we don't want a red flash on the way out. Info / success toasts stay
  // through (they are user-initiated actions like "Copied" that deserve
  // to render even mid-navigation).
  if (isSigningOut() && (toast.status === "error" || toast.status === "warning")) {
    return undefined
  }
  return sonnerToast.custom(
    (id) => (
      <Toast
        id={id}
        title={toast.title}
        description={toast?.description}
        button={toast?.button}
        status={toast?.status}
      />
    ),
    {
      position: "top-center",
    }
  )
}

/** Dismiss every visible toast immediately, then sweep again over the next
 *  ~500ms. Used by the sign-out flow.
 *
 *  Why the repeated sweeps: not every toast in this codebase routes through
 *  the wrapper above — many components import `toast` directly from `sonner`
 *  (search: `from "sonner"` for ~25 hits). Those direct calls bypass our
 *  `isSigningOut()` gate and can fire AFTER the initial dismiss. The
 *  bounded poll (5 sweeps over 500ms — well under the unload latency on
 *  any reasonable connection) catches them defensively. The intervals are
 *  short enough that even if a toast does appear, the user perceives a
 *  brief flicker rather than a sustained banner.
 */
function dismissAllToasts() {
  sonnerToast.dismiss()
  for (const delay of [16, 50, 120, 250, 500]) {
    setTimeout(() => sonnerToast.dismiss(), delay)
  }
}

export { toast, dismissAllToasts }
