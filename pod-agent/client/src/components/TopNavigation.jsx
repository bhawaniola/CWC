import { useState } from "react";
import { FiChevronDown, FiGlobe, FiHeadphones, FiRadio, FiShield } from "react-icons/fi";

import { ASSET_PATHS } from "../data/mapLocations";
import { useLanguage } from "../i18n/LanguageContext.jsx";

function LogoMark() {
  return (
    <span className="logo-fallback" aria-hidden="true">
      <FiRadio />
    </span>
  );
}

export default function TopNavigation() {
  const [showLogoImage, setShowLogoImage] = useState(true);
  const { selectedLanguage, setLanguageCode, supportedLanguages, t } = useLanguage();

  return (
    <header className="top-navigation">
      <div className="brand-lockup">
        {showLogoImage ? (
          <img
            className="brand-logo"
            src={ASSET_PATHS.logo}
            alt="SANJEEVANI"
            onError={() => setShowLogoImage(false)}
          />
        ) : (
          <LogoMark />
        )}
        <div>
          <p className="brand-name">SANJEEVANI</p>
          <p className="brand-tagline">Self-Healing Lifeline Network</p>
        </div>
      </div>

      <div className="navigation-actions" aria-label="Emergency information">
        <label className="nav-utility language-picker" aria-label={t("language.label")}>
          <FiGlobe aria-hidden="true" />
          <select
            value={selectedLanguage.code}
            onChange={(event) => setLanguageCode(event.target.value)}
          >
            {supportedLanguages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.nativeName} · {language.name}
              </option>
            ))}
          </select>
          <FiChevronDown aria-hidden="true" />
        </label>
        <div className="help-card">
          <span className="help-icon" aria-hidden="true">
            <FiHeadphones />
            <span>24</span>
          </span>
          <span>
            <small>{t("nav.emergencyHelp")}</small>
            <strong>1077</strong>
          </span>
        </div>
        <div className="resilience-card">
          <span className="shield-icon" aria-hidden="true">
            <FiShield />
          </span>
          <span>
            <strong>{t("nav.resilienceTitle")}</strong>
            <small>{t("nav.resilienceSub")}</small>
          </span>
        </div>
      </div>
    </header>
  );
}
