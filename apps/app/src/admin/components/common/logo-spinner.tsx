import { useTheme } from "next-themes";
import LogoSpinnerDark from "../../assets/images/logo-spinner-dark.gif";
import LogoSpinnerLight from "../../assets/images/logo-spinner-light.gif";

export function LogoSpinner() {
  const { resolvedTheme } = useTheme();
  const logoSrc = resolvedTheme === "dark" ? LogoSpinnerLight : LogoSpinnerDark;

  return (
    <div className="flex items-center justify-center">
      <img src={logoSrc} alt="logo" className="h-6 w-auto sm:h-11" />
    </div>
  );
}
