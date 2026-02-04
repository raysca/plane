import { useState } from "react";
import { SignInForm, SignUpForm } from "@/core/components/account";

type AuthMode = "sign-in" | "sign-up";

export function HomePage() {
  const [mode, setMode] = useState<AuthMode>("sign-in");

  const toggleMode = () => {
    setMode(mode === "sign-in" ? "sign-up" : "sign-in");
  };

  return (
    <div className="relative z-10 flex flex-col items-center w-screen min-h-screen overflow-hidden overflow-y-auto pt-6 pb-10 px-8 bg-canvas">
      {/* Header */}
      <div className="flex items-center justify-between w-full max-w-[22.5rem]">
        <div className="flex items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-accent-primary">
            <path
              d="M12 2L2 7L12 12L22 7L12 2Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 17L12 22L22 17"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 12L12 17L22 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-xl font-semibold text-primary">Plane</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-col justify-center items-center flex-grow w-full py-6 mt-10">
        <div className="relative flex flex-col gap-6 max-w-[22.5rem] w-full">
          {/* Title */}
          <div className="flex flex-col gap-1">
            <span className="text-xl font-semibold text-primary">
              {mode === "sign-in" ? "Sign in to Plane" : "Create your account"}
            </span>
            <span className="text-xl font-semibold text-placeholder">
              {mode === "sign-in" ? "Get back to your projects" : "Start building with Plane"}
            </span>
          </div>

          {/* Form */}
          <div className="w-full">
            {mode === "sign-in" ? (
              <SignInForm onToggleMode={toggleMode} />
            ) : (
              <SignUpForm onToggleMode={toggleMode} />
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-col items-center gap-6 mt-auto">
        <span className="text-sm text-tertiary whitespace-nowrap">
          Join 10,000+ teams building with Plane
        </span>
      </div>
    </div>
  );
}
