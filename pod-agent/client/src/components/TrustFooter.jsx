import { FiLock, FiRadio, FiShield, FiUsers } from "react-icons/fi";

import { useLanguage } from "../i18n/LanguageContext.jsx";

const items = [
  { Icon: FiRadio, tone: "green", labelKey: "footer.monitored" },
  { Icon: FiShield, tone: "blue", labelKey: "footer.verified" },
  { Icon: FiLock, tone: "purple", labelKey: "footer.privacy" },
  { Icon: FiUsers, tone: "green", labelKey: "footer.community" }
];

export default function TrustFooter() {
  const { t } = useLanguage();

  return (
    <footer className="trust-footer">
      {items.map((item) => {
        const Icon = item.Icon;

        return (
          <div key={item.labelKey}>
            <span className={item.tone} aria-hidden="true">
              <Icon />
            </span>
            <p>{t(item.labelKey)}</p>
          </div>
        );
      })}
    </footer>
  );
}
