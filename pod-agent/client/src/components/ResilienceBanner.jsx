import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function ResilienceBanner() {
  const { t } = useLanguage();

  return (
    <section className="resilience-banner">
      <div>
        <span className="alert-icon" aria-hidden="true">
          !
        </span>
        <strong>{t("banner.title")}</strong>
      </div>
      <p>{t("banner.message")}</p>
      <span className="offline-pill">{t("banner.pill")}</span>
    </section>
  );
}
