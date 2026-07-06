import { useMemo, useState } from "react";
import { FiMapPin, FiX } from "react-icons/fi";

import { ASSET_PATHS, MAP_LOCATIONS, createSelection } from "../data/mapLocations";
import { useLanguage } from "../i18n/LanguageContext.jsx";

function getClickPercent(event) {
  const rect = event.currentTarget.getBoundingClientRect();

  return {
    x: ((event.clientX - rect.left) / rect.width) * 100,
    y: ((event.clientY - rect.top) / rect.height) * 100
  };
}

function formatCoordinate(value) {
  return Number(value).toFixed(5);
}

export default function LocationSelector({ location, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftLocation, setDraftLocation] = useState(location);
  const { t } = useLanguage();

  const precisionText = useMemo(() => {
    return `Map ${draftLocation.x.toFixed(3)}%, ${draftLocation.y.toFixed(3)}%`;
  }, [draftLocation.x, draftLocation.y]);

  function handleOpen() {
    setDraftLocation(location);
    setIsOpen(true);
  }

  function handleMapClick(event) {
    const point = getClickPercent(event);
    setDraftLocation((current) => ({
      ...createSelection(point.x, point.y),
      address: current.address
    }));
  }

  function handleConfirm() {
    onChange(draftLocation);
    setIsOpen(false);
  }

  return (
    <>
      <aside className="location-card">
        <div className="section-title-row">
          <div className="section-title">
            <span className="section-icon green" aria-hidden="true">
              <FiMapPin />
            </span>
            <span>{t("location.title")}</span>
          </div>
          <button className="link-button" type="button" onClick={handleOpen}>
            {t("location.change")}
          </button>
        </div>

        <div className="location-card-body">
          <div>
            <h2>{location.label}</h2>
            <p>
              {t("location.lat")} {formatCoordinate(location.lat)}, {t("location.long")}{" "}
              {formatCoordinate(location.lng)}
            </p>
            <div className="location-accuracy">
              <span aria-hidden="true" />
              <span>{t("location.accurate")}</span>
            </div>
            <small>
              {t("location.updated")}: {t("location.justNow")}
            </small>
          </div>

          <button className="map-preview" type="button" onClick={handleOpen}>
            <img src={ASSET_PATHS.map} alt="Selected SANJEEVANI zone map" />
            <span
              className="map-pin"
              style={{ left: `${location.x}%`, top: `${location.y}%` }}
              aria-hidden="true"
            />
            <span
              className="map-radius"
              style={{ left: `${location.x}%`, top: `${location.y}%` }}
              aria-hidden="true"
            />
          </button>
        </div>
      </aside>

      {isOpen ? (
        <div className="map-overlay" role="dialog" aria-modal="true" aria-labelledby="map-title">
          <div className="map-dialog">
            <div className="map-dialog-header">
              <div>
                <p className="eyebrow">{t("location.select")}</p>
                <h2 id="map-title">{t("location.chooseExact")}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setIsOpen(false)}>
                <FiX aria-hidden="true" />
              </button>
            </div>

            <div className="map-dialog-grid">
              <div className="map-canvas">
                <img src={ASSET_PATHS.map} alt="SANJEEVANI coverage map" onClick={handleMapClick} />
                {MAP_LOCATIONS.map((item) => (
                  <span
                    className="zone-dot"
                    key={item.id}
                    style={{ left: `${item.x}%`, top: `${item.y}%` }}
                    title={item.label}
                  />
                ))}
                <span
                  className="selected-pin"
                  style={{ left: `${draftLocation.x}%`, top: `${draftLocation.y}%` }}
                />
              </div>

              <div className="selection-panel">
                <p className="eyebrow">{t("location.current")}</p>
                <h3>{draftLocation.label}</h3>
                <dl>
                  <div>
                    <dt>{t("location.latitude")}</dt>
                    <dd>{formatCoordinate(draftLocation.lat)}</dd>
                  </div>
                  <div>
                    <dt>{t("location.longitude")}</dt>
                    <dd>{formatCoordinate(draftLocation.lng)}</dd>
                  </div>
                  <div>
                    <dt>{t("location.precision")}</dt>
                    <dd>{precisionText}</dd>
                  </div>
                </dl>
                <p className="selection-help">{t("location.help")}</p>
                <button className="primary-button" type="button" onClick={handleConfirm}>
                  {t("location.confirm")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
