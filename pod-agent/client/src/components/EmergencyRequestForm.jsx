import { useEffect, useMemo, useRef, useState } from "react";
import {
  FiCheckCircle,
  FiChevronDown,
  FiClipboard,
  FiCoffee,
  FiDroplet,
  FiGlobe,
  FiHome,
  FiLifeBuoy,
  FiMapPin,
  FiMic,
  FiPhone,
  FiPlusSquare,
  FiSend,
  FiUser
} from "react-icons/fi";

import { submitSosRequest } from "../api/podApi";
import { MAP_LOCATIONS, createSelectionFromLocationId } from "../data/mapLocations";
import { useLanguage } from "../i18n/LanguageContext.jsx";

const categories = [
  { id: "Medical", labelKey: "category.Medical", Icon: FiPlusSquare },
  { id: "Rescue", labelKey: "category.Rescue", Icon: FiLifeBuoy },
  { id: "Food", labelKey: "category.Food", Icon: FiCoffee },
  { id: "Water", labelKey: "category.Water", Icon: FiDroplet },
  { id: "Shelter", labelKey: "category.Shelter", Icon: FiHome }
];

const defaultCitizens = [
  { name: "Asha Devi", age: "42", phone: "+91 98765 43101" },
  { name: "Imran Shaikh", age: "35", phone: "+91 98765 43102" },
  { name: "Meena Rao", age: "58", phone: "+91 98765 43103" },
  { name: "Suresh Kumar", age: "64", phone: "+91 98765 43104" },
  { name: "Farida Begum", age: "29", phone: "+91 98765 43105" },
  { name: "Joseph Mathew", age: "51", phone: "+91 98765 43106" },
  { name: "Kavita Patil", age: "68", phone: "+91 98765 43107" },
  { name: "Ravi Das", age: "46", phone: "+91 98765 43108" },
  { name: "Harpreet Kaur", age: "33", phone: "+91 98765 43109" },
  { name: "Ramesh Kumar", age: "72", phone: "+91 98765 43110" }
];

function getCitizenForPod(podId) {
  const match = String(podId || "").match(/\d+/);
  const podNumber = match ? Number(match[0]) : 1;

  return defaultCitizens[(podNumber - 1 + defaultCitizens.length) % defaultCitizens.length];
}

export default function EmergencyRequestForm({
  location,
  onAddressChange,
  onLocationChange,
  podStatus
}) {
  const { selectedLanguage, t } = useLanguage();
  const activePodProfileRef = useRef(null);
  const [form, setForm] = useState({
    ...getCitizenForPod("POD-01"),
    category: "Medical",
    address: location.address || "Kothapalli Zone 3",
    message: "My grandfather needs insulin and cannot walk"
  });
  const [submission, setSubmission] = useState({
    state: "idle",
    message: "Ready. Submit a request to watch the current network route being used."
  });
  const [voiceMode, setVoiceMode] = useState("idle");
  const recognitionRef = useRef(null);
  const voiceBaseMessageRef = useRef("");
  const recognitionErrorRef = useRef(false);

  const messageLength = useMemo(() => form.message.length, [form.message]);
  const voiceMessage = {
    idle: t("form.micTap"),
    listening: t("form.micListening"),
    added: t("form.micAdded"),
    unsupported: t("form.micUnsupported"),
    error: t("form.micError")
  }[voiceMode];

  useEffect(() => {
    if (!podStatus?.podId || activePodProfileRef.current === podStatus.podId) {
      return;
    }

    activePodProfileRef.current = podStatus.podId;
    const nextCitizen = getCitizenForPod(podStatus.podId);
    setForm((current) => ({
      ...current,
      name: nextCitizen.name,
      age: nextCitizen.age,
      phone: nextCitizen.phone
    }));
  }, [podStatus?.podId]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      address: location.address || current.address
    }));
  }, [location.address]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "address") {
      onAddressChange(value);
    }
  }

  function handleZoneChange(locationId) {
    const nextLocation = createSelectionFromLocationId(locationId);

    onLocationChange(nextLocation);
    onAddressChange(nextLocation.address);
    setForm((current) => ({
      ...current,
      address: nextLocation.address
    }));
  }

  function mergeVoiceText(baseMessage, transcript) {
    return [baseMessage, transcript].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function handleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceMode("unsupported");
      return;
    }

    if (voiceMode === "listening" && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = selectedLanguage.speechLocale;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognitionErrorRef.current = false;
    voiceBaseMessageRef.current = form.message;

    recognition.onstart = () => {
      setVoiceMode("listening");
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();

      setForm((current) => ({
        ...current,
        message: mergeVoiceText(voiceBaseMessageRef.current, transcript).slice(0, 500)
      }));
    };

    recognition.onerror = () => {
      recognitionErrorRef.current = true;
      setVoiceMode("error");
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (!recognitionErrorRef.current) {
        setVoiceMode("added");
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmission({
      state: "loading",
      message: t("form.submitting")
    });

    try {
      const payload = {
        name: form.name,
        age: form.age,
        phone: form.phone,
        category: form.category,
        message: form.message,
        language: {
          code: selectedLanguage.code,
          name: selectedLanguage.name,
          nativeName: selectedLanguage.nativeName,
          speechLocale: selectedLanguage.speechLocale
        },
        location: [
          form.address || location.address || location.label,
          location.label,
          `lat ${location.lat}`,
          `long ${location.lng}`,
          `map ${location.x.toFixed(3)}%, ${location.y.toFixed(3)}%`
        ].join(" | ")
      };
      const result = await submitSosRequest(payload);
      setSubmission({
        state: "success",
        message: result.data?.activePath ? `${t("form.successFallback")} ${result.data.activePath}` : t("form.successFallback")
      });
    } catch (error) {
      setSubmission({
        state: "error",
        message: error.message
      });
    }
  }

  return (
    <section className="request-card">
      <div className="section-title">
        <span className="section-icon blue" aria-hidden="true">
          <FiClipboard />
        </span>
        <span>{t("form.title")}</span>
      </div>

      <form className="request-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label>
            <span>
              {t("form.fullName")} <strong>*</strong>
            </span>
            <div className="input-shell">
              <FiUser aria-hidden="true" />
              <input
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                required
              />
            </div>
          </label>

          <label>
            <span>
              {t("form.age")} <strong>*</strong>
            </span>
            <div className="input-shell">
              <FiUser aria-hidden="true" />
              <input
                inputMode="numeric"
                value={form.age}
                onChange={(event) => updateField("age", event.target.value)}
                required
              />
            </div>
          </label>

          <label>
            <span>
              {t("form.phone")} <strong>*</strong>
            </span>
            <div className="input-shell">
              <FiPhone aria-hidden="true" />
              <input
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
                required
              />
            </div>
          </label>

          <label>
            <span>
              {t("form.zone")} <strong>*</strong>
            </span>
            <div className="input-shell select-shell">
              <FiMapPin aria-hidden="true" />
              <select value={location.zoneId} onChange={(event) => handleZoneChange(event.target.value)}>
                {MAP_LOCATIONS.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.label} - {zone.zoneName}
                  </option>
                ))}
              </select>
              <FiChevronDown className="input-chevron" aria-hidden="true" />
            </div>
          </label>
        </div>

        <label className="full-width-field">
          <span>{t("form.address")}</span>
          <input
            value={form.address}
            onChange={(event) => updateField("address", event.target.value)}
            placeholder={t("form.addressPlaceholder")}
          />
        </label>

        <div className="field-group">
          <p>
            {t("form.category")} <strong>*</strong> <small>({t("form.selectMostRelevant")})</small>
          </p>
          <div className="category-grid">
            {categories.map((item) => {
              const Icon = item.Icon;

              return (
                <button
                  className={
                    form.category === item.id ? "category-button selected" : "category-button"
                  }
                  key={item.id}
                  type="button"
                  onClick={() => updateField("category", item.id)}
                >
                  <Icon aria-hidden="true" />
                  {t(item.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        <label className="message-field">
          <span>
            {t("form.message")} <strong>*</strong>
          </span>
          <textarea
            maxLength="500"
            value={form.message}
            onChange={(event) => updateField("message", event.target.value)}
            required
          />
          <small>{messageLength} / 500</small>
        </label>

        <div className="voice-row">
          <button
            className={`voice-card ${voiceMode === "listening" ? "listening" : ""}`}
            type="button"
            onClick={handleVoiceInput}
          >
            <span aria-hidden="true">
              <FiMic />
            </span>
            <span>
              <strong>
                {voiceMode === "listening" ? t("form.micListeningTitle") : t("form.micTitle")}
              </strong>
              <small>
                {voiceMessage} - {selectedLanguage.nativeName}
              </small>
              <em>{t("form.micWriteHint")}</em>
            </span>
          </button>
          <div className="language-card">
            <span aria-hidden="true">
              <FiGlobe />
            </span>
            <span>
              {t("form.languageHint")}
              <small>
                {t("form.languageSub")} - {selectedLanguage.name}
              </small>
            </span>
          </div>
        </div>

        <div className="submit-row">
          <button className="submit-button" type="submit" disabled={submission.state === "loading"}>
            {submission.state === "loading" ? t("form.submitting") : t("form.submit")}
            <FiSend aria-hidden="true" />
          </button>
          <p>
            <span aria-hidden="true">
              <FiCheckCircle />
            </span>
            {t("form.privacy")}
          </p>
        </div>

        {submission.state !== "idle" ? (
          <div className={`submission-message ${submission.state}`}>
            <strong>{submission.state === "success" ? t("form.requestReceived") : t("form.status")}</strong>
            <span>{submission.message}</span>
          </div>
        ) : null}
      </form>
    </section>
  );
}
