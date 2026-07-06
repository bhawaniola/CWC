export const DEFAULT_LANGUAGE_CODE = "en";

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", nativeName: "English", speechLocale: "en-IN", direction: "ltr" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", speechLocale: "hi-IN", direction: "ltr" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", speechLocale: "te-IN", direction: "ltr" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", speechLocale: "ta-IN", direction: "ltr" },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", speechLocale: "kn-IN", direction: "ltr" },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം", speechLocale: "ml-IN", direction: "ltr" },
  { code: "mr", name: "Marathi", nativeName: "मराठी", speechLocale: "mr-IN", direction: "ltr" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", speechLocale: "bn-IN", direction: "ltr" },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", speechLocale: "gu-IN", direction: "ltr" },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", speechLocale: "pa-IN", direction: "ltr" },
  { code: "ur", name: "Urdu", nativeName: "اردو", speechLocale: "ur-IN", direction: "rtl" },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", speechLocale: "or-IN", direction: "ltr" },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া", speechLocale: "as-IN", direction: "ltr" }
];

export function getLanguageByCode(code) {
  return (
    SUPPORTED_LANGUAGES.find((language) => language.code === code) ||
    SUPPORTED_LANGUAGES.find((language) => language.code === DEFAULT_LANGUAGE_CODE)
  );
}
