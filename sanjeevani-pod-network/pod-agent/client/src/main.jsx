import React from "react";
import { createRoot } from "react-dom/client";
import { PodSosApplication } from "./pages/PodSosApplication.jsx";
import "./styles/application.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PodSosApplication />
  </React.StrictMode>
);
