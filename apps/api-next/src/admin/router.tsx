import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import { LogoSpinner } from "./components/common/logo-spinner";

// Layouts
const HomeLayout = lazy(() => import("./layouts/home-layout"));
const DashboardLayout = lazy(() => import("./layouts/dashboard-layout"));

// Pages
const HomePage = lazy(() => import("./pages/home"));
const GeneralPage = lazy(() => import("./pages/general"));
const WorkspacePage = lazy(() => import("./pages/workspace/index"));
const WorkspaceCreatePage = lazy(() => import("./pages/workspace/create"));
const EmailPage = lazy(() => import("./pages/email/index"));
const AuthenticationPage = lazy(() => import("./pages/authentication/index"));
const GitHubPage = lazy(() => import("./pages/authentication/github/index"));
const GitLabPage = lazy(() => import("./pages/authentication/gitlab/index"));
const GooglePage = lazy(() => import("./pages/authentication/google/index"));
const GiteaPage = lazy(() => import("./pages/authentication/gitea/index"));
const AIPage = lazy(() => import("./pages/ai/index"));
const ImagePage = lazy(() => import("./pages/image/index"));
const NotFoundPage = lazy(() => import("./pages/not-found"));

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen w-full">
          <LogoSpinner />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export const router = createBrowserRouter(
  [
    {
      element: (
        <SuspenseWrapper>
          <HomeLayout />
        </SuspenseWrapper>
      ),
      children: [
        {
          index: true,
          element: (
            <SuspenseWrapper>
              <HomePage />
            </SuspenseWrapper>
          ),
        },
      ],
    },
    {
      element: (
        <SuspenseWrapper>
          <DashboardLayout />
        </SuspenseWrapper>
      ),
      children: [
        {
          path: "general",
          element: (
            <SuspenseWrapper>
              <GeneralPage />
            </SuspenseWrapper>
          ),
        },
        {
          path: "workspace",
          element: (
            <SuspenseWrapper>
              <WorkspacePage />
            </SuspenseWrapper>
          ),
        },
        {
          path: "workspace/create",
          element: (
            <SuspenseWrapper>
              <WorkspaceCreatePage />
            </SuspenseWrapper>
          ),
        },
        {
          path: "email",
          element: (
            <SuspenseWrapper>
              <EmailPage />
            </SuspenseWrapper>
          ),
        },
        {
          path: "authentication",
          element: (
            <SuspenseWrapper>
              <AuthenticationPage />
            </SuspenseWrapper>
          ),
        },
        {
          path: "authentication/github",
          element: (
            <SuspenseWrapper>
              <GitHubPage />
            </SuspenseWrapper>
          ),
        },
        {
          path: "authentication/gitlab",
          element: (
            <SuspenseWrapper>
              <GitLabPage />
            </SuspenseWrapper>
          ),
        },
        {
          path: "authentication/google",
          element: (
            <SuspenseWrapper>
              <GooglePage />
            </SuspenseWrapper>
          ),
        },
        {
          path: "authentication/gitea",
          element: (
            <SuspenseWrapper>
              <GiteaPage />
            </SuspenseWrapper>
          ),
        },
        {
          path: "ai",
          element: (
            <SuspenseWrapper>
              <AIPage />
            </SuspenseWrapper>
          ),
        },
        {
          path: "image",
          element: (
            <SuspenseWrapper>
              <ImagePage />
            </SuspenseWrapper>
          ),
        },
      ],
    },
    {
      path: "*",
      element: (
        <SuspenseWrapper>
          <NotFoundPage />
        </SuspenseWrapper>
      ),
    },
  ],
  { basename: "/admin" }
);
