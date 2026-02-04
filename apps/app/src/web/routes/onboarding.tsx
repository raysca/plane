import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useState } from "react";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});

type ProfileFormValues = {
  firstName: string;
  lastName: string;
  displayName: string;
};

const USE_CASES = [
  { id: "software", label: "Software Development", icon: "💻" },
  { id: "marketing", label: "Marketing", icon: "📣" },
  { id: "design", label: "Design", icon: "🎨" },
  { id: "product", label: "Product Management", icon: "📦" },
  { id: "operations", label: "Operations", icon: "⚙️" },
  { id: "other", label: "Other", icon: "✨" },
];

const TEAM_SIZES = [
  { id: "solo", label: "Just me" },
  { id: "small", label: "2-10" },
  { id: "medium", label: "11-50" },
  { id: "large", label: "51-200" },
  { id: "enterprise", label: "200+" },
];

function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedUseCase, setSelectedUseCase] = useState<string | null>(null);
  const [selectedTeamSize, setSelectedTeamSize] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ProfileFormValues>({
    defaultValues: {
      firstName: "",
      lastName: "",
      displayName: "",
    },
  });

  const firstName = watch("firstName");

  async function handleProfileSubmit(data: ProfileFormValues) {
    setIsLoading(true);
    try {
      const response = await fetch("/api/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          first_name: data.firstName,
          last_name: data.lastName,
          display_name:
            data.displayName || `${data.firstName} ${data.lastName || ""}`.trim(),
        }),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to update profile");
      }

      setStep(2);
    } catch (error) {
      console.error("Profile update error:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUseCaseSubmit() {
    setStep(3);
  }

  async function handleComplete() {
    setIsLoading(true);
    try {
      // Save onboarding preferences
      await fetch("/api/users/me/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          useCase: selectedUseCase,
          teamSize: selectedTeamSize,
          completed: true,
        }),
        credentials: "include",
      });

      // Navigate to workspace creation or workspace home
      navigate({ to: "/create-workspace" });
    } catch (error) {
      console.error("Onboarding completion error:", error);
    } finally {
      setIsLoading(false);
    }
  }

  const totalSteps = 3;

  return (
    <div className="min-h-screen flex items-center justify-center bg-custom-background-100 p-4">
      <div className="w-full max-w-lg">
        {/* Progress indicator */}
        <div className="flex items-center justify-center mb-8">
          {Array.from({ length: totalSteps }).map((_, index) => (
            <div key={index} className="flex items-center">
              <div
                className={`h-2 w-2 rounded-full transition-colors ${
                  index + 1 <= step
                    ? "bg-custom-primary-100"
                    : "bg-custom-border-200"
                }`}
              />
              {index < totalSteps - 1 && (
                <div
                  className={`h-0.5 w-8 transition-colors ${
                    index + 1 < step
                      ? "bg-custom-primary-100"
                      : "bg-custom-border-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Profile */}
        {step === 1 && (
          <div className="bg-custom-background-100 border border-custom-border-200 rounded-lg shadow-sm">
            <div className="p-6 text-center">
              <h1 className="text-2xl font-bold text-custom-text-100">
                Welcome to Plane!
              </h1>
              <p className="text-sm text-custom-text-300 mt-1">
                Let's set up your profile
              </p>
            </div>
            <div className="px-6 pb-6">
              <form
                onSubmit={handleSubmit(handleProfileSubmit)}
                className="space-y-4"
              >
                {/* Avatar */}
                <div className="flex justify-center mb-6">
                  <div className="h-20 w-20 rounded-full bg-custom-background-80 flex items-center justify-center text-2xl text-custom-text-200">
                    {firstName?.[0]?.toUpperCase() || "?"}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label
                      htmlFor="firstName"
                      className="text-sm font-medium text-custom-text-200"
                    >
                      First name
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      placeholder="John"
                      className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                      {...register("firstName", {
                        required: "First name is required",
                      })}
                    />
                    {errors.firstName && (
                      <p className="text-sm text-red-600">
                        {errors.firstName.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="lastName"
                      className="text-sm font-medium text-custom-text-200"
                    >
                      Last name
                    </label>
                    <input
                      id="lastName"
                      type="text"
                      placeholder="Doe"
                      className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                      {...register("lastName")}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="displayName"
                    className="text-sm font-medium text-custom-text-200"
                  >
                    Display name (optional)
                  </label>
                  <input
                    id="displayName"
                    type="text"
                    placeholder="How you want to be called"
                    className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                    {...register("displayName")}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-10 px-4 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {isLoading ? (
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  ) : (
                    <>
                      Continue
                      <svg
                        className="ml-2 h-4 w-4"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M14 5l7 7m0 0l-7 7m7-7H3"
                        />
                      </svg>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Step 2: Use Case */}
        {step === 2 && (
          <div className="bg-custom-background-100 border border-custom-border-200 rounded-lg shadow-sm">
            <div className="p-6 text-center">
              <h1 className="text-2xl font-bold text-custom-text-100">
                What will you use Plane for?
              </h1>
              <p className="text-sm text-custom-text-300 mt-1">
                This helps us personalize your experience
              </p>
            </div>
            <div className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {USE_CASES.map((useCase) => (
                  <button
                    key={useCase.id}
                    type="button"
                    onClick={() => setSelectedUseCase(useCase.id)}
                    className={`flex items-center gap-3 p-4 rounded-lg border text-left transition-colors ${
                      selectedUseCase === useCase.id
                        ? "border-custom-primary-100 bg-custom-primary-100/5"
                        : "border-custom-border-200 hover:border-custom-primary-100/50"
                    }`}
                  >
                    <span className="text-2xl">{useCase.icon}</span>
                    <span className="text-sm font-medium text-custom-text-100">
                      {useCase.label}
                    </span>
                    {selectedUseCase === useCase.id && (
                      <svg
                        className="ml-auto h-4 w-4 text-custom-primary-100"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 h-10 px-4 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 hover:bg-custom-background-80 transition-colors"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleUseCaseSubmit}
                  disabled={!selectedUseCase}
                  className="flex-1 h-10 px-4 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  Continue
                  <svg
                    className="ml-2 h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M14 5l7 7m0 0l-7 7m7-7H3"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Team Size */}
        {step === 3 && (
          <div className="bg-custom-background-100 border border-custom-border-200 rounded-lg shadow-sm">
            <div className="p-6 text-center">
              <h1 className="text-2xl font-bold text-custom-text-100">
                How big is your team?
              </h1>
              <p className="text-sm text-custom-text-300 mt-1">
                We'll customize features based on your team size
              </p>
            </div>
            <div className="px-6 pb-6 space-y-4">
              <div className="flex flex-wrap gap-3 justify-center">
                {TEAM_SIZES.map((size) => (
                  <button
                    key={size.id}
                    type="button"
                    onClick={() => setSelectedTeamSize(size.id)}
                    className={`px-6 py-3 rounded-lg border text-sm font-medium transition-colors ${
                      selectedTeamSize === size.id
                        ? "border-custom-primary-100 bg-custom-primary-100 text-white"
                        : "border-custom-border-200 text-custom-text-100 hover:border-custom-primary-100/50"
                    }`}
                  >
                    {size.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="flex-1 h-10 px-4 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 hover:bg-custom-background-80 transition-colors"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleComplete}
                  disabled={!selectedTeamSize || isLoading}
                  className="flex-1 h-10 px-4 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {isLoading ? (
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  ) : (
                    <>
                      Get Started
                      <svg
                        className="ml-2 h-4 w-4"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M14 5l7 7m0 0l-7 7m7-7H3"
                        />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
