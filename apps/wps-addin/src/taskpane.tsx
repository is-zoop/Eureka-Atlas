import { createRoot } from "react-dom/client";
import { AtlasPanel } from "./ui/atlas-panel.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<AtlasPanel />);
