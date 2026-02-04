import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { HomePage } from "./pages/home";
import { ForgotPasswordPage } from "./pages/accounts/forgot-password";
import { ResetPasswordPage } from "./pages/accounts/reset-password";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/accounts/sign-in" element={<HomePage />} />
        <Route path="/accounts/sign-up" element={<HomePage />} />
        <Route path="/accounts/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/accounts/reset-password" element={<ResetPasswordPage />} />

        {/* TODO: Add more routes as they are migrated */}
        {/* <Route path="/onboarding" element={<OnboardingPage />} /> */}
        {/* <Route path="/:workspaceSlug/*" element={<WorkspaceRoutes />} /> */}
      </Routes>
    </BrowserRouter>
  );
}
