import { useEffect } from "react";
import { observer } from "mobx-react";
import { Outlet, useNavigate } from "react-router-dom";
import { AdminHeader } from "../components/common/header";
import { LogoSpinner } from "../components/common/logo-spinner";
import { NewUserPopup } from "../components/new-user-popup";
import { useUser } from "../hooks/store";
import { AdminSidebar } from "./sidebar";

function DashboardLayout() {
  const navigate = useNavigate();
  const { isUserLoggedIn } = useUser();

  useEffect(() => {
    if (isUserLoggedIn === false) navigate("/", { replace: true });
  }, [navigate, isUserLoggedIn]);

  if (isUserLoggedIn === undefined) {
    return (
      <div className="relative flex h-screen w-full items-center justify-center">
        <LogoSpinner />
      </div>
    );
  }

  if (isUserLoggedIn) {
    return (
      <div className="relative flex h-screen w-screen overflow-hidden">
        <AdminSidebar />
        <main className="relative flex h-full w-full flex-col overflow-hidden bg-surface-1">
          <AdminHeader />
          <div className="h-full w-full overflow-hidden overflow-y-scroll vertical-scrollbar scrollbar-md">
            <Outlet />
          </div>
        </main>
        <NewUserPopup />
      </div>
    );
  }

  return <></>;
}

export default observer(DashboardLayout);
