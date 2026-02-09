import { useAppStore } from "./store";
import ErrorBoundary from "./components/ErrorBoundary";
import LoginPage from "./pages/LoginPage";
import ProfileSetupPage from "./pages/ProfileSetupPage";
import JobDescriptionPage from "./pages/JobDescriptionPage";
import ResumeSelectPage from "./pages/ResumeSelectPage";
import SectionEditorPage from "./pages/SectionEditorPage";
import CoverLetterPage from "./pages/CoverLetterPage";
import AutoFillPage from "./pages/AutoFillPage";

function PageRouter() {
  const { currentPage, isLoading, isAuthenticated } = useAppStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  // Force login if not authenticated
  if (!isAuthenticated && currentPage !== "login") {
    return <LoginPage />;
  }

  switch (currentPage) {
    case "login":
      return <LoginPage />;
    case "profile-setup":
      return <ProfileSetupPage />;
    case "job-description":
      return <JobDescriptionPage />;
    case "resume-select":
      return <ResumeSelectPage />;
    case "section-editor":
      return <SectionEditorPage />;
    case "cover-letter":
      return <CoverLetterPage />;
    case "autofill":
      return <AutoFillPage />;
    default:
      return <LoginPage />;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <PageRouter />
    </ErrorBoundary>
  );
}
