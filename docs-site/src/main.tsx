import { createRoot } from "react-dom/client";
import "./styles.css";
import { Shell } from "./components/Shell";
import { AiPage } from "./pages/ai";
import { DownloadPage } from "./pages/download";
import { FeaturesPage } from "./pages/features";
import { GuidePage } from "./pages/guide";
import { HomePage } from "./pages/home";
import { useRoute } from "./router";

const App = () => {
  const route = useRoute();

  return (
    <Shell page={route.page}>
      {route.page === "features" ? (
        <FeaturesPage />
      ) : route.page === "ai" ? (
        <AiPage />
      ) : route.page === "guide" ? (
        <GuidePage />
      ) : route.page === "download" ? (
        <DownloadPage />
      ) : (
        <HomePage />
      )}
    </Shell>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
