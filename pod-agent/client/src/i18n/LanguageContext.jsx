import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { DEFAULT_LANGUAGE_CODE, SUPPORTED_LANGUAGES, getLanguageByCode } from "./languages";
import { translations } from "./translations";

const LanguageContext = createContext(null);

function translate(languageCode, key, variables = {}) {
  const fallbackValue = translations.en[key] || key;
  const template = translations[languageCode]?.[key] || fallbackValue;

  return String(template).replace(/\{(\w+)\}/g, (_, variableName) => {
    return variables[variableName] ?? "";
  });
}

export function LanguageProvider({ children }) {
  const [languageCode, setLanguageCode] = useState(DEFAULT_LANGUAGE_CODE);
  const selectedLanguage = getLanguageByCode(languageCode);

  useEffect(() => {
    document.documentElement.lang = selectedLanguage.code;
    document.documentElement.dir = selectedLanguage.direction;
  }, [selectedLanguage]);

  const value = useMemo(
    () => ({
      languageCode,
      selectedLanguage,
      supportedLanguages: SUPPORTED_LANGUAGES,
      setLanguageCode,
      t: (key, variables) => translate(languageCode, key, variables)
    }),
    [languageCode, selectedLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);

  if (!value) {
    throw new Error("useLanguage must be used within LanguageProvider.");
  }

  return value;
}
