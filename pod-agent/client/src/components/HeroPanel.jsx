import { useState } from "react";
import { FiActivity, FiShield, FiUsers } from "react-icons/fi";

import { ASSET_PATHS } from "../data/mapLocations";
import { useLanguage } from "../i18n/LanguageContext.jsx";

const highlights = [
  {
    tone: "green",
    Icon: FiActivity,
    titleKey: "hero.fastTitle",
    textKey: "hero.fastText"
  },
  {
    tone: "blue",
    Icon: FiShield,
    titleKey: "hero.trustedTitle",
    textKey: "hero.trustedText"
  },
  {
    tone: "purple",
    Icon: FiUsers,
    titleKey: "hero.everyoneTitle",
    textKey: "hero.everyoneText"
  }
];

export default function HeroPanel() {
  const [heroSource, setHeroSource] = useState(ASSET_PATHS.hero);
  const { t } = useLanguage();

  return (
    <section className="hero-panel">
      <div className="hero-copy">
        <h1>{t("hero.title")}</h1>
        <p>{t("hero.copy1")}</p>
        <p>{t("hero.copy2")}</p>
        <div className="hero-highlights">
          {highlights.map((item) => {
            const Icon = item.Icon;

            return (
              <div className="hero-highlight" key={item.titleKey}>
                <span className={`highlight-icon ${item.tone}`} aria-hidden="true">
                  <Icon />
                </span>
                <span>
                  <strong>{t(item.titleKey)}</strong>
                  <small>{t(item.textKey)}</small>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="hero-image-wrap">
        <img
          src={heroSource}
          alt="Rescue team moving through a flood response zone"
          onError={() => {
            if (heroSource !== ASSET_PATHS.map) {
              setHeroSource(ASSET_PATHS.map);
            }
          }}
        />
      </div>
    </section>
  );
}
