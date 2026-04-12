import { useTranslations } from "next-intl"

export default function NotFound() {
  const t = useTranslations("errorPages")

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-xl font-semibold">{t("notFound.title")}</h1>
        <p className="text-muted-foreground mt-2">
          {t("notFound.description")}
        </p>
      </div>
    </div>
  )
}
