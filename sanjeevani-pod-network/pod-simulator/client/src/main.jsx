import React from "react";
import { createRoot } from "react-dom/client";
import { ManagerConsoleApplication } from "./pages/ManagerConsoleApplication.jsx";
import "./styles/application.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ManagerConsoleApplication />
  </React.StrictMode>
);
