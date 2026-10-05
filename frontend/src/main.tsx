import { createRoot } from "react-dom/client";
import { App } from "@/app/app";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("The application root element is missing.");

createRoot(root).render(<App />);
