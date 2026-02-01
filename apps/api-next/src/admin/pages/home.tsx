import { observer } from "mobx-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import type { EAdminAuthErrorCodes, TAdminAuthErrorInfo } from "@plane/constants";
import { API_BASE_URL } from "@plane/constants";
import { Button } from "@plane/propel/button";
import { PlaneLockup } from "@plane/propel/icons";
import { AuthService } from "@plane/services";
import { Input, Spinner } from "@plane/ui";
import { Banner } from "../components/common/banner";
import { LogoSpinner } from "../components/common/logo-spinner";
import { InstanceFailureView } from "../components/instance/failure";
import { InstanceSetupForm } from "../components/instance/setup-form";
import { FormHeader } from "../components/instance/form-header";
import { useInstance } from "../hooks/store";

const authService = new AuthService();

// Auth header for the home page
function AuthHeader() {
  return (
    <div className="flex items-center justify-between gap-6 w-full flex-shrink-0 sticky top-0">
      <a href="/">
        <PlaneLockup height={20} width={95} className="text-primary" />
      </a>
    </div>
  );
}

// Sign in form
function InstanceSignInForm() {
  const [searchParams] = useSearchParams();
  const emailParam = searchParams.get("email") || undefined;
  const errorCode = searchParams.get("error_code") || undefined;
  const errorMessage = searchParams.get("error_message") || undefined;
  const [showPassword, setShowPassword] = useState(false);
  const [csrfToken, setCsrfToken] = useState<string | undefined>(undefined);
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFormChange = (key: string, value: string) => setFormData((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (csrfToken === undefined) authService.requestCSRFToken().then((data) => data?.csrf_token && setCsrfToken(data.csrf_token));
  }, [csrfToken]);

  useEffect(() => {
    if (emailParam) setFormData((prev) => ({ ...prev, email: emailParam }));
  }, [emailParam]);

  const errorData = useMemo(() => {
    if (errorCode && errorMessage) return { type: errorCode, message: errorMessage };
    return { type: undefined, message: undefined };
  }, [errorCode, errorMessage]);

  const isButtonDisabled = useMemo(() => !(!isSubmitting && formData.email && formData.password), [formData.email, formData.password, isSubmitting]);

  return (
    <>
      <AuthHeader />
      <div className="flex flex-col justify-center items-center flex-grow w-full py-6 mt-10">
        <div className="relative flex flex-col gap-6 max-w-[22.5rem] w-full">
          <FormHeader heading="Manage your Plane instance" subHeading="Configure instance-wide settings to secure your instance" />
          <form className="space-y-4" method="POST" action={`${API_BASE_URL}/api/instances/admins/sign-in/`} onSubmit={() => setIsSubmitting(true)} onError={() => setIsSubmitting(false)}>
            {errorData.type && errorData?.message && <Banner type="error" message={errorData.message} />}
            <input type="hidden" name="csrfmiddlewaretoken" value={csrfToken} />
            <div className="w-full space-y-1">
              <label className="text-13 text-tertiary font-medium" htmlFor="email">Email <span className="text-danger-primary">*</span></label>
              <Input className="w-full border border-subtle !bg-surface-1 placeholder:text-placeholder" id="email" name="email" type="email" inputSize="md" placeholder="name@company.com" value={formData.email} onChange={(e) => handleFormChange("email", e.target.value)} autoComplete="on" autoFocus />
            </div>
            <div className="w-full space-y-1">
              <label className="text-13 text-tertiary font-medium" htmlFor="password">Password <span className="text-danger-primary">*</span></label>
              <div className="relative">
                <Input className="w-full border border-subtle !bg-surface-1 placeholder:text-placeholder" id="password" name="password" type={showPassword ? "text" : "password"} inputSize="md" placeholder="Enter your password" value={formData.password} onChange={(e) => handleFormChange("password", e.target.value)} autoComplete="on" />
                <button type="button" className="absolute right-3 top-3.5 flex items-center justify-center text-placeholder" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="py-2">
              <Button type="submit" size="xl" className="w-full" disabled={isButtonDisabled}>
                {isSubmitting ? <Spinner height="20px" width="20px" /> : "Sign in"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// Home page
function HomePage() {
  const { instance, error } = useInstance();

  if (!instance && !error) {
    return (
      <div className="flex items-center justify-center h-screen w-full">
        <LogoSpinner />
      </div>
    );
  }

  if (error) return <InstanceFailureView />;

  if (instance && !instance?.is_setup_done) return <InstanceSetupForm />;

  return <InstanceSignInForm />;
}

export default observer(HomePage);
