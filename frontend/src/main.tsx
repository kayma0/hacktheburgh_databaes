import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth";
import { Gate } from "./Landing";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <Gate>
        <App />
      </Gate>
    </AuthProvider>
  </React.StrictMode>
);
